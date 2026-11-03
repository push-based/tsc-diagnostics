import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { globSync } from 'tinyglobby';
import ts from 'typescript';
import { appendJsoncArrayItem, JsoncEditError, setJsoncValue } from './jsonc-edit';

const SOLUTION_CONFIG_NAME = 'tsconfig.json';

const BUILD_CONFIG_NAMES = new Set([
  'tsconfig.lib.json',
  'tsconfig.spec.json',
  'tsconfig.app.json',
  'tsconfig.build.json',
]);

/** Never searched for tsconfig files: dependencies, VCS data, caches, build output. */
const DISCOVERY_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.nx/**',
  '**/dist/**',
  '**/tmp/**',
];

const RISKY_GLOBS = [
  'node_modules',
  'dist',
  'build',
  'out-tsc',
  '.nx/cache',
  'coverage',
  'tmp',
];

const NODE_MODULES_EXCLUDE = '**/node_modules/**';
const FIXABLE_FINDING_IDS = new Set([
  'incremental-disabled',
  'composite-without-incremental',
  'skip-lib-check-disabled',
  'broad-include-without-node-modules-exclude',
  'missing-node-modules-exclude',
  'incremental-without-buildinfo-path',
]);

/** Findings that mean a config could not be audited (and is not auto-fixed). */
const UNAUDITED_FINDING_IDS = new Set(['invalid-tsconfig', 'unresolved-extends']);

/**
 * TypeScript diagnostics that mean a config's `extends` could not be followed,
 * so its effective settings are unknown.
 */
const UNRESOLVED_EXTENDS_CODES = new Set([
  5083, // Cannot read file '{0}'.
  6053, // File '{0}' not found.
  18000, // Circularity detected while resolving configuration: {0}
]);

export type Severity = 'error' | 'warn' | 'info' | 'pass';

export interface Finding {
  id: string;
  severity: Severity;
  message: string;
  recommendation?: string;
}

export interface ConfigReport {
  config: string;
  role: 'solution' | 'build' | 'other';
  /** The config and every config it extends, bases first, the config itself last. */
  extends_chain: string[];
  /** Effective values after `extends`, including TypeScript's defaults. */
  compiler_options: {
    incremental?: boolean;
    skipLibCheck?: boolean;
    composite?: boolean;
    tsBuildInfoFile?: string;
  };
  include?: string[];
  exclude?: string[];
  findings: Finding[];
  diagnostics?: {
    total_s?: number;
    check_s?: number;
    files?: number;
    instantiations?: number;
    types?: number;
  };
}

export interface PerformanceCheckReport {
  summary: {
    configs_checked: number;
    errors: number;
    warnings: number;
    infos: number;
    passed_checks: number;
    generated_at: string;
  };
  workflow: string[];
  configs: ConfigReport[];
}

interface TsConfigJson {
  extends?: string | string[];
  compilerOptions?: Record<string, unknown>;
  include?: unknown;
  exclude?: unknown;
  files?: unknown;
  references?: unknown;
}

/** A tsconfig as TypeScript reads it, with `extends` applied. */
interface LoadedTsConfig {
  config: string;
  absolutePath: string;
  extendsChain: string[];
  /** Effective compiler options; path options are absolute. */
  options: ts.CompilerOptions;
  /** Effective include/exclude/files, rebased onto this config's folder when inherited. */
  include?: string[];
  exclude?: string[];
  files?: string[];
  references?: unknown[];
  /** Set when the config cannot be audited. */
  problem?: Finding;
}

type TsConfigLoader = (configPath: string) => LoadedTsConfig;

export interface SolutionResult {
  config: string;
  total_s?: number;
  check_s?: number;
  files?: number;
  instantiations?: number;
  types?: number;
}

export interface ConfigFixResult {
  config: string;
  applied: string[];
  skipped: string[];
}

export interface FixReport {
  dry_run: boolean;
  files_modified: number;
  changes: ConfigFixResult[];
}

function toPosix(path: string): string {
  return sep === '\\' ? path.replace(/\\/g, '/') : path;
}

/**
 * The path as TypeScript spells it. Its config APIs normalize file names to
 * forward slashes and, for a file with syntax errors, assert the name they
 * were given matches, so passing `C:\...` crashes on Windows.
 */
function toTypeScriptPath(path: string): string {
  return toPosix(path);
}

/** Workspace-relative POSIX path, or the absolute path when outside the workspace. */
function toWorkspacePath(workspaceRoot: string, absolutePath: string): string {
  const relativePath = relative(workspaceRoot, absolutePath);
  const outside =
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath);
  if (!relativePath || outside) {
    return toPosix(absolutePath);
  }
  return toPosix(relativePath);
}

/** Relative path from a config's folder, as written inside that config. */
function toConfigRelative(configDir: string, absolutePath: string): string {
  return toPosix(relative(configDir, absolutePath)) || '.';
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeDiagnostic(
  workspaceRoot: string,
  diagnostic: ts.Diagnostic
): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  if (!diagnostic.file || diagnostic.start === undefined) return message;
  const { line, character } = ts.getLineAndCharacterOfPosition(
    diagnostic.file,
    diagnostic.start
  );
  const file = toWorkspacePath(workspaceRoot, diagnostic.file.fileName);
  return `${message} (${file}:${line + 1}:${character + 1})`;
}

/**
 * Orders a config and everything it extends from lowest to highest
 * precedence: bases first, the config itself last. TypeScript records every
 * ancestor of a config file; its direct parents are the ancestors that are
 * not inherited through another ancestor.
 */
function orderExtendsChain(
  file: string,
  ancestorsOf: (file: string) => readonly string[]
): string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  const visit = (current: string): void => {
    if (visited.has(current)) return;
    visited.add(current);
    const ancestors = ancestorsOf(current).filter((ancestor) => ancestor !== current);
    const inherited = new Set(ancestors.flatMap((ancestor) => ancestorsOf(ancestor)));
    for (const parent of ancestors) {
      if (!inherited.has(parent)) visit(parent);
    }
    chain.push(current);
  };
  visit(file);
  return chain;
}

/**
 * Reads tsconfig files with TypeScript's own parser: comments and trailing
 * commas are accepted, and `extends` is resolved exactly like `tsc` does
 * (relative paths with or without `.json`, packages, arrays).
 */
function createTsConfigLoader(workspaceRoot: string): TsConfigLoader {
  const root = resolve(workspaceRoot);
  // Shared, so a base config extended by many projects is parsed once.
  const extendedConfigCache = new Map<string, ts.ExtendedConfigCacheEntry>();
  const host: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    fileExists: (path) => ts.sys.fileExists(path),
    readFile: (path) => ts.sys.readFile(path),
    // The audit needs compiler options and include/exclude, not the list of
    // matched source files, so skip walking the file system for them.
    readDirectory: () => [],
  };

  const ancestorsOf = (sourceFile: ts.TsConfigSourceFile) => {
    const known = new Map<string, readonly string[]>();
    for (const { extendedResult } of extendedConfigCache.values()) {
      known.set(extendedResult.fileName, extendedResult.extendedSourceFiles ?? []);
    }
    known.set(sourceFile.fileName, sourceFile.extendedSourceFiles ?? []);
    return (file: string) => known.get(file) ?? [];
  };

  return (configPath) => {
    const absolutePath = resolve(root, configPath);
    const unaudited = (problem: Finding): LoadedTsConfig => ({
      config: configPath,
      absolutePath,
      extendsChain: [configPath],
      options: {},
      problem,
    });

    const text = ts.sys.readFile(absolutePath);
    if (text === undefined) {
      return unaudited({
        id: 'invalid-tsconfig',
        severity: 'error',
        message: 'Cannot read the file.',
      });
    }

    const fileName = toTypeScriptPath(absolutePath);
    const { error: syntaxError } = ts.parseConfigFileTextToJson(fileName, text);
    if (syntaxError) {
      return unaudited({
        id: 'invalid-tsconfig',
        severity: 'error',
        message: `Not valid JSON: ${describeDiagnostic(root, syntaxError)}`,
        recommendation: 'Fix the syntax error; tsc cannot use this config either.',
      });
    }

    const sourceFile: ts.TsConfigSourceFile = ts.parseJsonText(fileName, text);
    const parsed = ts.parseJsonSourceFileConfigFileContent(
      sourceFile,
      host,
      toTypeScriptPath(dirname(absolutePath)),
      undefined,
      fileName,
      undefined,
      undefined,
      extendedConfigCache
    );

    const extendsError = parsed.errors.find(
      (diagnostic) =>
        UNRESOLVED_EXTENDS_CODES.has(diagnostic.code) ||
        // Syntax errors (TS1xxx) inside a config this one extends.
        (diagnostic.file !== undefined &&
          diagnostic.file !== sourceFile &&
          diagnostic.code < 2000)
    );
    if (extendsError) {
      return unaudited({
        id: 'unresolved-extends',
        severity: 'error',
        message: `Cannot resolve "extends": ${describeDiagnostic(root, extendsError)}`,
        recommendation:
          'Install the package that provides the base config or fix the "extends" path. Settings inherited from it are unknown, so this config was not checked.',
      });
    }

    // TypeScript copies inherited include/exclude/files into `raw`, rebased
    // onto this config's folder.
    const raw = parsed.raw as TsConfigJson;
    const chain = orderExtendsChain(sourceFile.fileName, ancestorsOf(sourceFile));
    return {
      config: configPath,
      absolutePath,
      extendsChain: [
        ...chain.slice(0, -1).map((file) => toWorkspacePath(root, file)),
        configPath,
      ],
      options: parsed.options,
      include: stringArray(raw.include),
      exclude: stringArray(raw.exclude),
      files: stringArray(raw.files),
      references: Array.isArray(raw.references) ? raw.references : undefined,
    };
  };
}

function findTsconfigFiles(
  workspaceRoot: string,
  fileNames: string[],
  filter?: string
): string[] {
  if (!existsSync(workspaceRoot)) {
    return [];
  }

  // In-process glob: same behaviour on every platform, no shell involved.
  const matches = globSync(
    fileNames.map((name) => `**/${name}`),
    {
      cwd: workspaceRoot,
      dot: true,
      onlyFiles: true,
      expandDirectories: false,
      ignore: DISCOVERY_IGNORE,
    }
  );
  const configs = [...new Set(matches)].sort();

  if (!filter) return configs;
  const needle = filter.replace(/\\/g, '/');
  return configs.filter((config) => config.includes(needle));
}

/** Every `tsconfig.json` under the workspace root, as workspace-relative paths. */
export function discoverSolutionConfigs(
  workspaceRoot: string,
  filter?: string
): string[] {
  return findTsconfigFiles(workspaceRoot, [SOLUTION_CONFIG_NAME], filter);
}

/** Every `tsconfig.{lib,spec,app,build}.json` under the workspace root, at any depth. */
export function discoverBuildConfigs(
  workspaceRoot: string,
  filter?: string
): string[] {
  return findTsconfigFiles(workspaceRoot, [...BUILD_CONFIG_NAMES], filter);
}

export function discoverAllTsconfigs(
  workspaceRoot: string,
  filter?: string
): string[] {
  return findTsconfigFiles(
    workspaceRoot,
    [SOLUTION_CONFIG_NAME, ...BUILD_CONFIG_NAMES],
    filter
  );
}

export function buildDiagnosticsIndex(
  solutions: SolutionResult[]
): Map<string, ConfigReport['diagnostics']> {
  const index = new Map<string, ConfigReport['diagnostics']>();
  for (const solution of solutions) {
    index.set(solution.config, {
      total_s: solution.total_s,
      check_s: solution.check_s,
      files: solution.files,
      instantiations: solution.instantiations,
      types: solution.types,
    });
  }
  return index;
}

function matchesRiskyGlob(pattern: string): string | null {
  const normalized = pattern.replace(/\\/g, '/').toLowerCase();
  return RISKY_GLOBS.find((risk) => normalized.includes(risk)) ?? null;
}

function hasNodeModulesExclude(exclude: string[] | undefined): boolean {
  if (!exclude?.length) return false;
  return exclude.some((pattern) =>
    pattern.toLowerCase().includes('node_modules')
  );
}

function isReferenceOnly(config: LoadedTsConfig): boolean {
  const hasReferences = (config.references?.length ?? 0) > 0;
  const includeEmpty = !config.include?.length;
  const filesEmpty = !config.files?.length;
  return hasReferences && includeEmpty && filesEmpty;
}

function isBuildConfig(configPath: string): boolean {
  return BUILD_CONFIG_NAMES.has(configPath.split('/').pop() ?? '');
}

function getConfigRole(
  configPath: string,
  config: LoadedTsConfig
): ConfigReport['role'] {
  if (isReferenceOnly(config)) return 'solution';
  if (isBuildConfig(configPath)) return 'build';
  return 'other';
}

function auditConfig(
  workspaceRoot: string,
  configPath: string,
  diagnosticsIndex: Map<string, ConfigReport['diagnostics']>,
  loadTsConfig: TsConfigLoader
): ConfigReport {
  const resolved = loadTsConfig(configPath);
  if (resolved.problem) {
    return {
      config: configPath,
      role: isBuildConfig(configPath) ? 'build' : 'other',
      extends_chain: resolved.extendsChain,
      compiler_options: {},
      findings: [resolved.problem],
    };
  }

  const role = getConfigRole(configPath, resolved);
  const findings: Finding[] = [];
  const opts = resolved.options;
  // TypeScript defaults: incremental is on when composite is, skipLibCheck is off.
  const incremental = opts.incremental ?? opts.composite === true;
  const skipLibCheck = opts.skipLibCheck === true;
  const composite = opts.composite === true;
  const tsBuildInfoFile =
    typeof opts.tsBuildInfoFile === 'string'
      ? toWorkspacePath(resolve(workspaceRoot), opts.tsBuildInfoFile)
      : undefined;

  if (role === 'build') {
    if (!incremental) {
      findings.push({
        id: 'incremental-disabled',
        severity: 'warn',
        message: 'Incremental builds are not enabled.',
        recommendation:
          'Set "incremental": true in compilerOptions. This is one of the highest ROI improvements and creates a .tsbuildinfo cache for subsequent runs.',
      });
    } else if (!tsBuildInfoFile) {
      findings.push({
        id: 'incremental-without-buildinfo-path',
        severity: 'info',
        message: 'Incremental is enabled without an explicit tsBuildInfoFile.',
        recommendation:
          'Consider setting tsBuildInfoFile so the .tsbuildinfo file lands in a predictable cache directory.',
      });
    } else {
      findings.push({
        id: 'incremental-enabled',
        severity: 'pass',
        message: 'Incremental builds are enabled.',
      });
    }
  }

  // A reference-only solution config type-checks nothing itself, so its
  // skipLibCheck has no effect.
  if (role !== 'solution') {
    if (!skipLibCheck) {
      findings.push({
        id: 'skip-lib-check-disabled',
        severity: 'error',
        message:
          opts.skipLibCheck === false
            ? 'skipLibCheck is disabled.'
            : 'skipLibCheck is not set, so it is disabled (TypeScript defaults it to false).',
        recommendation:
          'Set "skipLibCheck": true unless you have a strong reason to validate every dependency declaration file.',
      });
    } else {
      findings.push({
        id: 'skip-lib-check-enabled',
        severity: 'pass',
        message: 'skipLibCheck is enabled.',
      });
    }
  }

  if (!isReferenceOnly(resolved)) {
    for (const pattern of resolved.include ?? []) {
      const risky = matchesRiskyGlob(pattern);
      if (risky) {
        findings.push({
          id: 'risky-include',
          severity: 'error',
          message: `Include pattern "${pattern}" may pull in ${risky} files.`,
          recommendation:
            'Tighten include/exclude so TypeScript does not check node_modules, build output, or generated files.',
        });
      }
    }

    const broadInclude = (resolved.include ?? []).some((pattern) =>
      ['**/*.ts', '**/*'].includes(pattern)
    );
    if (broadInclude && !hasNodeModulesExclude(resolved.exclude)) {
      findings.push({
        id: 'broad-include-without-node-modules-exclude',
        severity: 'warn',
        message:
          'A broad include pattern is used without excluding node_modules.',
        recommendation:
          'Add "**/node_modules/**" to exclude to avoid accidentally type-checking dependencies.',
      });
    } else if (
      (resolved.include?.length ?? 0) > 0 &&
      !hasNodeModulesExclude(resolved.exclude)
    ) {
      findings.push({
        id: 'missing-node-modules-exclude',
        severity: 'info',
        message: 'No explicit node_modules exclude pattern was found.',
        recommendation:
          'Consider excluding "**/node_modules/**" even if current file counts look fine.',
      });
    }

    if (hasNodeModulesExclude(resolved.exclude)) {
      findings.push({
        id: 'exclude-node-modules',
        severity: 'pass',
        message: 'node_modules is excluded.',
      });
    }
  } else {
    findings.push({
      id: 'reference-only-root',
      severity: 'pass',
      message:
        'Reference-only solution root; file globs are delegated to project references.',
    });
  }

  if (composite && !incremental) {
    findings.push({
      id: 'composite-without-incremental',
      severity: 'warn',
      message: 'composite is enabled but incremental is explicitly disabled.',
      recommendation: 'Enable incremental alongside composite project references.',
    });
  }

  const solutionPath = configPath.replace(
    /\/tsconfig\.(lib|spec|app|build)\.json$/,
    '/tsconfig.json'
  );
  const diagnostics =
    diagnosticsIndex.get(configPath) ?? diagnosticsIndex.get(solutionPath);

  if (diagnostics) {
    if ((diagnostics.check_s ?? 0) >= 0.5) {
      findings.push({
        id: 'high-check-time',
        severity: 'warn',
        message: `Check time is ${diagnostics.check_s?.toFixed(2)}s.`,
        recommendation:
          'Check time is the most important extendedDiagnostics metric. Run tsc --generateTrace and typescript-analyze-trace on hotspots.',
      });
    }
    if ((diagnostics.files ?? 0) >= 1500) {
      findings.push({
        id: 'high-file-count',
        severity: 'warn',
        message: `${diagnostics.files} files are being checked.`,
        recommendation:
          'An unexpectedly high file count often means include/exclude is too broad or nested monorepo configs are pulling extra projects.',
      });
    }
    if ((diagnostics.instantiations ?? 0) >= 50000) {
      findings.push({
        id: 'high-instantiations',
        severity: 'warn',
        message: `${diagnostics.instantiations?.toLocaleString()} generic instantiations were recorded.`,
        recommendation:
          'High instantiations usually point to expensive generics, large unions, intersections, or repeated conditional types. Optimize only reported hotspots.',
      });
    }
    if ((diagnostics.types ?? 0) >= 30000) {
      findings.push({
        id: 'high-type-count',
        severity: 'info',
        message: `${diagnostics.types?.toLocaleString()} types were created during checking.`,
        recommendation:
          'Large type counts often correlate with complex helper types and polymorphic generics.',
      });
    }
  }

  return {
    config: configPath,
    role,
    extends_chain: resolved.extendsChain,
    compiler_options: {
      incremental,
      skipLibCheck,
      composite,
      tsBuildInfoFile,
    },
    include: resolved.include,
    exclude: resolved.exclude,
    findings,
    diagnostics,
  };
}

export function workflowSteps(): string[] {
  return [
    'Run tsc --extendedDiagnostics and inspect Check time, Files, Instantiations, and Types.',
    'Enable { "incremental": true } on build tsconfigs to create .tsbuildinfo for subsequent runs.',
    'If diagnostics are not enough, run: tsc --generateTrace trace',
    'Then analyze hotspots with: typescript-analyze-trace trace',
    'Focus optimization on CheckSourceFile hotspots, not Program or Bind unless they are enormous.',
    'For hotspots: prefer interfaces over intersections, shrink large unions, and extract reusable conditional/helper types.',
    'Only add explicit return types or generic defaults on identified hotspots, not everywhere.',
    'For especially difficult cases, also try: tsc --generateCpuProfile profile.cpuprofile',
  ];
}

function summarize(configs: ConfigReport[]): PerformanceCheckReport['summary'] {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  let passed = 0;

  for (const config of configs) {
    for (const finding of config.findings) {
      if (finding.severity === 'error') errors += 1;
      if (finding.severity === 'warn') warnings += 1;
      if (finding.severity === 'info') infos += 1;
      if (finding.severity === 'pass') passed += 1;
    }
  }

  return {
    configs_checked: configs.length,
    errors,
    warnings,
    infos,
    passed_checks: passed,
    generated_at: new Date().toISOString(),
  };
}

export function auditTsconfigSettings(options: {
  workspaceRoot: string;
  filter?: string;
  solutions?: SolutionResult[];
}): PerformanceCheckReport {
  const configs = discoverAllTsconfigs(options.workspaceRoot, options.filter);
  const diagnosticsIndex = buildDiagnosticsIndex(options.solutions ?? []);
  const loadTsConfig = createTsConfigLoader(options.workspaceRoot);
  const reports = configs.map((config) =>
    auditConfig(options.workspaceRoot, config, diagnosticsIndex, loadTsConfig)
  );

  return {
    summary: summarize(reports),
    workflow: workflowSteps(),
    configs: reports,
  };
}

export function configsNeedingAttention(
  report: PerformanceCheckReport
): ConfigReport[] {
  return report.configs.filter((config) =>
    config.findings.some(
      (finding) => finding.severity === 'error' || finding.severity === 'warn'
    )
  );
}

/**
 * Where to put the .tsbuildinfo file: in outDir when there is one, otherwise
 * in dist/out-tsc at the workspace root. Returned relative to the config.
 */
function defaultTsBuildInfoFile(
  workspaceRoot: string,
  config: LoadedTsConfig
): string {
  const slug = config.config.replace(/\.json$/, '').replace(/[/\\]/g, '-');
  const directory =
    config.options.outDir ?? join(resolve(workspaceRoot), 'dist', 'out-tsc');
  return toConfigRelative(
    dirname(config.absolutePath),
    join(directory, `${slug}.tsbuildinfo`)
  );
}

/**
 * TypeScript's exclude when none is set: outDir and declarationDir
 * (node_modules is always skipped by wildcards).
 */
function defaultExclude(config: LoadedTsConfig): string[] {
  const configDir = dirname(config.absolutePath);
  return [config.options.outDir, config.options.declarationDir]
    .filter((path): path is string => typeof path === 'string')
    .map((path) => toConfigRelative(configDir, path));
}

interface PlannedFix {
  /** New file content, when it changes. */
  text?: string;
  changes: string[];
  skipped: string[];
}

function planFixesForConfig(
  workspaceRoot: string,
  report: ConfigReport,
  loadTsConfig: TsConfigLoader
): PlannedFix {
  const unaudited = report.findings.find((finding) =>
    UNAUDITED_FINDING_IDS.has(finding.id)
  );
  if (unaudited) {
    return { changes: [], skipped: [`Not checked: ${unaudited.message}`] };
  }

  const findingIds = new Set(
    report.findings
      .map((finding) => finding.id)
      .filter((id) => FIXABLE_FINDING_IDS.has(id))
  );
  if (findingIds.size === 0) {
    return { changes: [], skipped: [] };
  }

  const config = loadTsConfig(report.config);
  if (config.problem) {
    return { changes: [], skipped: [`Not fixed: ${config.problem.message}`] };
  }

  const original = readFileSync(config.absolutePath, 'utf-8');
  // The config's own JSON, without anything inherited through extends.
  const fileName = toTypeScriptPath(config.absolutePath);
  const own = (ts.parseConfigFileTextToJson(fileName, original).config ??
    {}) as TsConfigJson;
  const ownOptions = isRecord(own.compilerOptions) ? own.compilerOptions : {};

  let text = original;
  const changes: string[] = [];
  const skipped: string[] = [];
  const edit = (description: string, apply: (current: string) => string) => {
    try {
      text = apply(text);
      changes.push(description);
    } catch (error) {
      if (!(error instanceof JsoncEditError)) throw error;
      skipped.push(`Skipped "${description}": ${error.message}`);
    }
  };

  const needsIncremental =
    findingIds.has('incremental-disabled') ||
    findingIds.has('composite-without-incremental');
  const needsSkipLibCheck = findingIds.has('skip-lib-check-disabled');
  const needsNodeModulesExclude =
    findingIds.has('broad-include-without-node-modules-exclude') ||
    findingIds.has('missing-node-modules-exclude');
  const needsBuildInfoPath =
    findingIds.has('incremental-without-buildinfo-path') || needsIncremental;

  if (needsIncremental && ownOptions.incremental !== true) {
    edit('Set compilerOptions.incremental = true', (current) =>
      setJsoncValue(current, ['compilerOptions', 'incremental'], true)
    );
  }

  if (needsSkipLibCheck && ownOptions.skipLibCheck !== true) {
    edit('Set compilerOptions.skipLibCheck = true', (current) =>
      setJsoncValue(current, ['compilerOptions', 'skipLibCheck'], true)
    );
  }

  if (needsNodeModulesExclude && !hasNodeModulesExclude(config.exclude)) {
    if (own.exclude !== undefined) {
      edit(`Added exclude "${NODE_MODULES_EXCLUDE}"`, (current) =>
        appendJsoncArrayItem(current, ['exclude'], NODE_MODULES_EXCLUDE)
      );
    } else {
      // A new exclude replaces the inherited (or default) one, so carry its
      // entries over to keep excluding what is excluded today.
      const kept = config.exclude ?? defaultExclude(config);
      const note = kept.length
        ? ` (kept the ${config.exclude ? 'inherited' : 'default'} exclude ${kept
            .map((pattern) => `"${pattern}"`)
            .join(', ')})`
        : '';
      edit(`Added exclude "${NODE_MODULES_EXCLUDE}"${note}`, (current) =>
        setJsoncValue(current, ['exclude'], [...kept, NODE_MODULES_EXCLUDE])
      );
    }
  }

  if (
    needsBuildInfoPath &&
    config.options.tsBuildInfoFile === undefined &&
    typeof ownOptions.tsBuildInfoFile !== 'string'
  ) {
    const tsBuildInfoFile = defaultTsBuildInfoFile(workspaceRoot, config);
    edit(`Set compilerOptions.tsBuildInfoFile = "${tsBuildInfoFile}"`, (current) =>
      setJsoncValue(current, ['compilerOptions', 'tsBuildInfoFile'], tsBuildInfoFile)
    );
  }

  if (text === original) {
    return { changes, skipped };
  }

  const { error } = ts.parseConfigFileTextToJson(fileName, text);
  if (error) {
    return {
      changes: [],
      skipped: [
        `Not fixed: the edit would leave invalid JSON (${ts.flattenDiagnosticMessageText(error.messageText, ' ')})`,
      ],
    };
  }

  return { text, changes, skipped };
}

/**
 * Applies the auto-fixable findings of an audit report. Files are edited in
 * place: comments and formatting are kept, only the changed settings differ.
 */
export function applyTsconfigFixes(options: {
  workspaceRoot: string;
  report: PerformanceCheckReport;
  dryRun?: boolean;
}): FixReport {
  const results: ConfigFixResult[] = [];
  const loadTsConfig = createTsConfigLoader(options.workspaceRoot);
  let filesModified = 0;

  for (const configReport of options.report.configs) {
    const { text, changes, skipped } = planFixesForConfig(
      options.workspaceRoot,
      configReport,
      loadTsConfig
    );

    if (text !== undefined && !options.dryRun) {
      writeFileSync(resolve(options.workspaceRoot, configReport.config), text);
      filesModified += 1;
    }

    if (changes.length > 0 || skipped.length > 0) {
      results.push({
        config: configReport.config,
        applied: changes,
        skipped,
      });
    }
  }

  return {
    dry_run: options.dryRun ?? false,
    files_modified: filesModified,
    changes: results,
  };
}

function printConfigChanges(result: ConfigFixResult): void {
  console.log(`• ${result.config}`);
  for (const change of result.applied) {
    console.log(`  + ${change}`);
  }
  for (const skip of result.skipped) {
    console.log(`  ~ ${skip}`);
  }
  console.log('');
}

export function printFixReport(fixReport: FixReport): void {
  const fixed = fixReport.changes.filter((change) => change.applied.length > 0);
  const notFixed = fixReport.changes.filter(
    (change) => change.applied.length === 0 && change.skipped.length > 0
  );

  if (fixed.length === 0) {
    console.log('\nNo auto-fixable tsconfig changes found.');
  } else if (fixReport.dry_run) {
    console.log(`\nDry run: would update ${fixed.length} tsconfig file(s):\n`);
  } else {
    console.log(`\nUpdated ${fixReport.files_modified} tsconfig file(s):\n`);
  }
  fixed.forEach(printConfigChanges);

  if (notFixed.length > 0) {
    console.log(`\nCould not check or fix ${notFixed.length} tsconfig file(s):\n`);
    notFixed.forEach(printConfigChanges);
  }

  if (fixReport.dry_run && fixed.length > 0) {
    console.log('No files were written. Run again without --dry-run to apply these changes.');
  }
}

export function countAvailableFixes(report: PerformanceCheckReport): number {
  return report.configs.filter((config) =>
    config.findings.some((finding) => FIXABLE_FINDING_IDS.has(finding.id))
  ).length;
}
