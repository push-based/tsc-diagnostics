"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverSolutionConfigs = discoverSolutionConfigs;
exports.discoverBuildConfigs = discoverBuildConfigs;
exports.discoverAllTsconfigs = discoverAllTsconfigs;
exports.buildDiagnosticsIndex = buildDiagnosticsIndex;
exports.workflowSteps = workflowSteps;
exports.auditTsconfigSettings = auditTsconfigSettings;
exports.configsNeedingAttention = configsNeedingAttention;
exports.applyTsconfigFixes = applyTsconfigFixes;
exports.printFixReport = printFixReport;
exports.countAvailableFixes = countAvailableFixes;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const tinyglobby_1 = require("tinyglobby");
const typescript_1 = __importDefault(require("typescript"));
const jsonc_edit_1 = require("./jsonc-edit");
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
function toPosix(path) {
    return node_path_1.sep === '\\' ? path.replace(/\\/g, '/') : path;
}
/**
 * The path as TypeScript spells it. Its config APIs normalize file names to
 * forward slashes and, for a file with syntax errors, assert the name they
 * were given matches, so passing `C:\...` crashes on Windows.
 */
function toTypeScriptPath(path) {
    return toPosix(path);
}
/** Workspace-relative POSIX path, or the absolute path when outside the workspace. */
function toWorkspacePath(workspaceRoot, absolutePath) {
    const relativePath = (0, node_path_1.relative)(workspaceRoot, absolutePath);
    const outside = relativePath === '..' ||
        relativePath.startsWith(`..${node_path_1.sep}`) ||
        (0, node_path_1.isAbsolute)(relativePath);
    if (!relativePath || outside) {
        return toPosix(absolutePath);
    }
    return toPosix(relativePath);
}
/** Relative path from a config's folder, as written inside that config. */
function toConfigRelative(configDir, absolutePath) {
    return toPosix((0, node_path_1.relative)(configDir, absolutePath)) || '.';
}
function stringArray(value) {
    return Array.isArray(value)
        ? value.filter((entry) => typeof entry === 'string')
        : undefined;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function describeDiagnostic(workspaceRoot, diagnostic) {
    const message = typescript_1.default.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    if (!diagnostic.file || diagnostic.start === undefined)
        return message;
    const { line, character } = typescript_1.default.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start);
    const file = toWorkspacePath(workspaceRoot, diagnostic.file.fileName);
    return `${message} (${file}:${line + 1}:${character + 1})`;
}
/**
 * Orders a config and everything it extends from lowest to highest
 * precedence: bases first, the config itself last. TypeScript records every
 * ancestor of a config file; its direct parents are the ancestors that are
 * not inherited through another ancestor.
 */
function orderExtendsChain(file, ancestorsOf) {
    const chain = [];
    const visited = new Set();
    const visit = (current) => {
        if (visited.has(current))
            return;
        visited.add(current);
        const ancestors = ancestorsOf(current).filter((ancestor) => ancestor !== current);
        const inherited = new Set(ancestors.flatMap((ancestor) => ancestorsOf(ancestor)));
        for (const parent of ancestors) {
            if (!inherited.has(parent))
                visit(parent);
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
function createTsConfigLoader(workspaceRoot) {
    const root = (0, node_path_1.resolve)(workspaceRoot);
    // Shared, so a base config extended by many projects is parsed once.
    const extendedConfigCache = new Map();
    const host = {
        useCaseSensitiveFileNames: typescript_1.default.sys.useCaseSensitiveFileNames,
        fileExists: (path) => typescript_1.default.sys.fileExists(path),
        readFile: (path) => typescript_1.default.sys.readFile(path),
        // The audit needs compiler options and include/exclude, not the list of
        // matched source files, so skip walking the file system for them.
        readDirectory: () => [],
    };
    const ancestorsOf = (sourceFile) => {
        const known = new Map();
        for (const { extendedResult } of extendedConfigCache.values()) {
            known.set(extendedResult.fileName, extendedResult.extendedSourceFiles ?? []);
        }
        known.set(sourceFile.fileName, sourceFile.extendedSourceFiles ?? []);
        return (file) => known.get(file) ?? [];
    };
    return (configPath) => {
        const absolutePath = (0, node_path_1.resolve)(root, configPath);
        const unaudited = (problem) => ({
            config: configPath,
            absolutePath,
            extendsChain: [configPath],
            options: {},
            problem,
        });
        const text = typescript_1.default.sys.readFile(absolutePath);
        if (text === undefined) {
            return unaudited({
                id: 'invalid-tsconfig',
                severity: 'error',
                message: 'Cannot read the file.',
            });
        }
        const fileName = toTypeScriptPath(absolutePath);
        const { error: syntaxError } = typescript_1.default.parseConfigFileTextToJson(fileName, text);
        if (syntaxError) {
            return unaudited({
                id: 'invalid-tsconfig',
                severity: 'error',
                message: `Not valid JSON: ${describeDiagnostic(root, syntaxError)}`,
                recommendation: 'Fix the syntax error; tsc cannot use this config either.',
            });
        }
        const sourceFile = typescript_1.default.parseJsonText(fileName, text);
        const parsed = typescript_1.default.parseJsonSourceFileConfigFileContent(sourceFile, host, toTypeScriptPath((0, node_path_1.dirname)(absolutePath)), undefined, fileName, undefined, undefined, extendedConfigCache);
        const extendsError = parsed.errors.find((diagnostic) => UNRESOLVED_EXTENDS_CODES.has(diagnostic.code) ||
            // Syntax errors (TS1xxx) inside a config this one extends.
            (diagnostic.file !== undefined &&
                diagnostic.file !== sourceFile &&
                diagnostic.code < 2000));
        if (extendsError) {
            return unaudited({
                id: 'unresolved-extends',
                severity: 'error',
                message: `Cannot resolve "extends": ${describeDiagnostic(root, extendsError)}`,
                recommendation: 'Install the package that provides the base config or fix the "extends" path. Settings inherited from it are unknown, so this config was not checked.',
            });
        }
        // TypeScript copies inherited include/exclude/files into `raw`, rebased
        // onto this config's folder.
        const raw = parsed.raw;
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
function findTsconfigFiles(workspaceRoot, fileNames, filter) {
    if (!(0, node_fs_1.existsSync)(workspaceRoot)) {
        return [];
    }
    // In-process glob: same behaviour on every platform, no shell involved.
    const matches = (0, tinyglobby_1.globSync)(fileNames.map((name) => `**/${name}`), {
        cwd: workspaceRoot,
        dot: true,
        onlyFiles: true,
        expandDirectories: false,
        ignore: DISCOVERY_IGNORE,
    });
    const configs = [...new Set(matches)].sort();
    if (!filter)
        return configs;
    const needle = filter.replace(/\\/g, '/');
    return configs.filter((config) => config.includes(needle));
}
/** Every `tsconfig.json` under the workspace root, as workspace-relative paths. */
function discoverSolutionConfigs(workspaceRoot, filter) {
    return findTsconfigFiles(workspaceRoot, [SOLUTION_CONFIG_NAME], filter);
}
/** Every `tsconfig.{lib,spec,app,build}.json` under the workspace root, at any depth. */
function discoverBuildConfigs(workspaceRoot, filter) {
    return findTsconfigFiles(workspaceRoot, [...BUILD_CONFIG_NAMES], filter);
}
function discoverAllTsconfigs(workspaceRoot, filter) {
    return findTsconfigFiles(workspaceRoot, [SOLUTION_CONFIG_NAME, ...BUILD_CONFIG_NAMES], filter);
}
function buildDiagnosticsIndex(solutions) {
    const index = new Map();
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
function matchesRiskyGlob(pattern) {
    const normalized = pattern.replace(/\\/g, '/').toLowerCase();
    return RISKY_GLOBS.find((risk) => normalized.includes(risk)) ?? null;
}
function hasNodeModulesExclude(exclude) {
    if (!exclude?.length)
        return false;
    return exclude.some((pattern) => pattern.toLowerCase().includes('node_modules'));
}
function isReferenceOnly(config) {
    const hasReferences = (config.references?.length ?? 0) > 0;
    const includeEmpty = !config.include?.length;
    const filesEmpty = !config.files?.length;
    return hasReferences && includeEmpty && filesEmpty;
}
function isBuildConfig(configPath) {
    return BUILD_CONFIG_NAMES.has(configPath.split('/').pop() ?? '');
}
function getConfigRole(configPath, config) {
    if (isReferenceOnly(config))
        return 'solution';
    if (isBuildConfig(configPath))
        return 'build';
    return 'other';
}
function auditConfig(workspaceRoot, configPath, diagnosticsIndex, loadTsConfig) {
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
    const findings = [];
    const opts = resolved.options;
    // TypeScript defaults: incremental is on when composite is, skipLibCheck is off.
    const incremental = opts.incremental ?? opts.composite === true;
    const skipLibCheck = opts.skipLibCheck === true;
    const composite = opts.composite === true;
    const tsBuildInfoFile = typeof opts.tsBuildInfoFile === 'string'
        ? toWorkspacePath((0, node_path_1.resolve)(workspaceRoot), opts.tsBuildInfoFile)
        : undefined;
    if (role === 'build') {
        if (!incremental) {
            findings.push({
                id: 'incremental-disabled',
                severity: 'warn',
                message: 'Incremental builds are not enabled.',
                recommendation: 'Set "incremental": true in compilerOptions. This is one of the highest ROI improvements and creates a .tsbuildinfo cache for subsequent runs.',
            });
        }
        else if (!tsBuildInfoFile) {
            findings.push({
                id: 'incremental-without-buildinfo-path',
                severity: 'info',
                message: 'Incremental is enabled without an explicit tsBuildInfoFile.',
                recommendation: 'Consider setting tsBuildInfoFile so the .tsbuildinfo file lands in a predictable cache directory.',
            });
        }
        else {
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
                message: opts.skipLibCheck === false
                    ? 'skipLibCheck is disabled.'
                    : 'skipLibCheck is not set, so it is disabled (TypeScript defaults it to false).',
                recommendation: 'Set "skipLibCheck": true unless you have a strong reason to validate every dependency declaration file.',
            });
        }
        else {
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
                    recommendation: 'Tighten include/exclude so TypeScript does not check node_modules, build output, or generated files.',
                });
            }
        }
        const broadInclude = (resolved.include ?? []).some((pattern) => ['**/*.ts', '**/*'].includes(pattern));
        if (broadInclude && !hasNodeModulesExclude(resolved.exclude)) {
            findings.push({
                id: 'broad-include-without-node-modules-exclude',
                severity: 'warn',
                message: 'A broad include pattern is used without excluding node_modules.',
                recommendation: 'Add "**/node_modules/**" to exclude to avoid accidentally type-checking dependencies.',
            });
        }
        else if ((resolved.include?.length ?? 0) > 0 &&
            !hasNodeModulesExclude(resolved.exclude)) {
            findings.push({
                id: 'missing-node-modules-exclude',
                severity: 'info',
                message: 'No explicit node_modules exclude pattern was found.',
                recommendation: 'Consider excluding "**/node_modules/**" even if current file counts look fine.',
            });
        }
        if (hasNodeModulesExclude(resolved.exclude)) {
            findings.push({
                id: 'exclude-node-modules',
                severity: 'pass',
                message: 'node_modules is excluded.',
            });
        }
    }
    else {
        findings.push({
            id: 'reference-only-root',
            severity: 'pass',
            message: 'Reference-only solution root; file globs are delegated to project references.',
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
    const solutionPath = configPath.replace(/\/tsconfig\.(lib|spec|app|build)\.json$/, '/tsconfig.json');
    const diagnostics = diagnosticsIndex.get(configPath) ?? diagnosticsIndex.get(solutionPath);
    if (diagnostics) {
        if ((diagnostics.check_s ?? 0) >= 0.5) {
            findings.push({
                id: 'high-check-time',
                severity: 'warn',
                message: `Check time is ${diagnostics.check_s?.toFixed(2)}s.`,
                recommendation: 'Check time is the most important extendedDiagnostics metric. Run tsc --generateTrace and typescript-analyze-trace on hotspots.',
            });
        }
        if ((diagnostics.files ?? 0) >= 1500) {
            findings.push({
                id: 'high-file-count',
                severity: 'warn',
                message: `${diagnostics.files} files are being checked.`,
                recommendation: 'An unexpectedly high file count often means include/exclude is too broad or nested monorepo configs are pulling extra projects.',
            });
        }
        if ((diagnostics.instantiations ?? 0) >= 50000) {
            findings.push({
                id: 'high-instantiations',
                severity: 'warn',
                message: `${diagnostics.instantiations?.toLocaleString()} generic instantiations were recorded.`,
                recommendation: 'High instantiations usually point to expensive generics, large unions, intersections, or repeated conditional types. Optimize only reported hotspots.',
            });
        }
        if ((diagnostics.types ?? 0) >= 30000) {
            findings.push({
                id: 'high-type-count',
                severity: 'info',
                message: `${diagnostics.types?.toLocaleString()} types were created during checking.`,
                recommendation: 'Large type counts often correlate with complex helper types and polymorphic generics.',
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
function workflowSteps() {
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
function summarize(configs) {
    let errors = 0;
    let warnings = 0;
    let infos = 0;
    let passed = 0;
    for (const config of configs) {
        for (const finding of config.findings) {
            if (finding.severity === 'error')
                errors += 1;
            if (finding.severity === 'warn')
                warnings += 1;
            if (finding.severity === 'info')
                infos += 1;
            if (finding.severity === 'pass')
                passed += 1;
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
function auditTsconfigSettings(options) {
    const configs = discoverAllTsconfigs(options.workspaceRoot, options.filter);
    const diagnosticsIndex = buildDiagnosticsIndex(options.solutions ?? []);
    const loadTsConfig = createTsConfigLoader(options.workspaceRoot);
    const reports = configs.map((config) => auditConfig(options.workspaceRoot, config, diagnosticsIndex, loadTsConfig));
    return {
        summary: summarize(reports),
        workflow: workflowSteps(),
        configs: reports,
    };
}
function configsNeedingAttention(report) {
    return report.configs.filter((config) => config.findings.some((finding) => finding.severity === 'error' || finding.severity === 'warn'));
}
/**
 * Where to put the .tsbuildinfo file: in outDir when there is one, otherwise
 * in dist/out-tsc at the workspace root. Returned relative to the config.
 */
function defaultTsBuildInfoFile(workspaceRoot, config) {
    const slug = config.config.replace(/\.json$/, '').replace(/[/\\]/g, '-');
    const directory = config.options.outDir ?? (0, node_path_1.join)((0, node_path_1.resolve)(workspaceRoot), 'dist', 'out-tsc');
    return toConfigRelative((0, node_path_1.dirname)(config.absolutePath), (0, node_path_1.join)(directory, `${slug}.tsbuildinfo`));
}
/**
 * TypeScript's exclude when none is set: outDir and declarationDir
 * (node_modules is always skipped by wildcards).
 */
function defaultExclude(config) {
    const configDir = (0, node_path_1.dirname)(config.absolutePath);
    return [config.options.outDir, config.options.declarationDir]
        .filter((path) => typeof path === 'string')
        .map((path) => toConfigRelative(configDir, path));
}
function planFixesForConfig(workspaceRoot, report, loadTsConfig) {
    const unaudited = report.findings.find((finding) => UNAUDITED_FINDING_IDS.has(finding.id));
    if (unaudited) {
        return { changes: [], skipped: [`Not checked: ${unaudited.message}`] };
    }
    const findingIds = new Set(report.findings
        .map((finding) => finding.id)
        .filter((id) => FIXABLE_FINDING_IDS.has(id)));
    if (findingIds.size === 0) {
        return { changes: [], skipped: [] };
    }
    const config = loadTsConfig(report.config);
    if (config.problem) {
        return { changes: [], skipped: [`Not fixed: ${config.problem.message}`] };
    }
    const original = (0, node_fs_1.readFileSync)(config.absolutePath, 'utf-8');
    // The config's own JSON, without anything inherited through extends.
    const fileName = toTypeScriptPath(config.absolutePath);
    const own = (typescript_1.default.parseConfigFileTextToJson(fileName, original).config ??
        {});
    const ownOptions = isRecord(own.compilerOptions) ? own.compilerOptions : {};
    let text = original;
    const changes = [];
    const skipped = [];
    const edit = (description, apply) => {
        try {
            text = apply(text);
            changes.push(description);
        }
        catch (error) {
            if (!(error instanceof jsonc_edit_1.JsoncEditError))
                throw error;
            skipped.push(`Skipped "${description}": ${error.message}`);
        }
    };
    const needsIncremental = findingIds.has('incremental-disabled') ||
        findingIds.has('composite-without-incremental');
    const needsSkipLibCheck = findingIds.has('skip-lib-check-disabled');
    const needsNodeModulesExclude = findingIds.has('broad-include-without-node-modules-exclude') ||
        findingIds.has('missing-node-modules-exclude');
    const needsBuildInfoPath = findingIds.has('incremental-without-buildinfo-path') || needsIncremental;
    if (needsIncremental && ownOptions.incremental !== true) {
        edit('Set compilerOptions.incremental = true', (current) => (0, jsonc_edit_1.setJsoncValue)(current, ['compilerOptions', 'incremental'], true));
    }
    if (needsSkipLibCheck && ownOptions.skipLibCheck !== true) {
        edit('Set compilerOptions.skipLibCheck = true', (current) => (0, jsonc_edit_1.setJsoncValue)(current, ['compilerOptions', 'skipLibCheck'], true));
    }
    if (needsNodeModulesExclude && !hasNodeModulesExclude(config.exclude)) {
        if (own.exclude !== undefined) {
            edit(`Added exclude "${NODE_MODULES_EXCLUDE}"`, (current) => (0, jsonc_edit_1.appendJsoncArrayItem)(current, ['exclude'], NODE_MODULES_EXCLUDE));
        }
        else {
            // A new exclude replaces the inherited (or default) one, so carry its
            // entries over to keep excluding what is excluded today.
            const kept = config.exclude ?? defaultExclude(config);
            const note = kept.length
                ? ` (kept the ${config.exclude ? 'inherited' : 'default'} exclude ${kept
                    .map((pattern) => `"${pattern}"`)
                    .join(', ')})`
                : '';
            edit(`Added exclude "${NODE_MODULES_EXCLUDE}"${note}`, (current) => (0, jsonc_edit_1.setJsoncValue)(current, ['exclude'], [...kept, NODE_MODULES_EXCLUDE]));
        }
    }
    if (needsBuildInfoPath &&
        config.options.tsBuildInfoFile === undefined &&
        typeof ownOptions.tsBuildInfoFile !== 'string') {
        const tsBuildInfoFile = defaultTsBuildInfoFile(workspaceRoot, config);
        edit(`Set compilerOptions.tsBuildInfoFile = "${tsBuildInfoFile}"`, (current) => (0, jsonc_edit_1.setJsoncValue)(current, ['compilerOptions', 'tsBuildInfoFile'], tsBuildInfoFile));
    }
    if (text === original) {
        return { changes, skipped };
    }
    const { error } = typescript_1.default.parseConfigFileTextToJson(fileName, text);
    if (error) {
        return {
            changes: [],
            skipped: [
                `Not fixed: the edit would leave invalid JSON (${typescript_1.default.flattenDiagnosticMessageText(error.messageText, ' ')})`,
            ],
        };
    }
    return { text, changes, skipped };
}
/**
 * Applies the auto-fixable findings of an audit report. Files are edited in
 * place: comments and formatting are kept, only the changed settings differ.
 */
function applyTsconfigFixes(options) {
    const results = [];
    const loadTsConfig = createTsConfigLoader(options.workspaceRoot);
    let filesModified = 0;
    for (const configReport of options.report.configs) {
        const { text, changes, skipped } = planFixesForConfig(options.workspaceRoot, configReport, loadTsConfig);
        if (text !== undefined && !options.dryRun) {
            (0, node_fs_1.writeFileSync)((0, node_path_1.resolve)(options.workspaceRoot, configReport.config), text);
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
function printConfigChanges(result) {
    console.log(`• ${result.config}`);
    for (const change of result.applied) {
        console.log(`  + ${change}`);
    }
    for (const skip of result.skipped) {
        console.log(`  ~ ${skip}`);
    }
    console.log('');
}
function printFixReport(fixReport) {
    const fixed = fixReport.changes.filter((change) => change.applied.length > 0);
    const notFixed = fixReport.changes.filter((change) => change.applied.length === 0 && change.skipped.length > 0);
    if (fixed.length === 0) {
        console.log('\nNo auto-fixable tsconfig changes found.');
    }
    else if (fixReport.dry_run) {
        console.log(`\nDry run: would update ${fixed.length} tsconfig file(s):\n`);
    }
    else {
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
function countAvailableFixes(report) {
    return report.configs.filter((config) => config.findings.some((finding) => FIXABLE_FINDING_IDS.has(finding.id))).length;
}
