#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDiagnostics = parseDiagnostics;
exports.renderReport = renderReport;
exports.runDiagnosticsCli = runDiagnosticsCli;
exports.runDiagnosticsMultiCli = runDiagnosticsMultiCli;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_process_1 = __importDefault(require("node:process"));
const glob_1 = require("./glob");
const serialize_for_script_1 = require("./serialize-for-script");
const theme_splice_1 = require("./theme-splice");
const tsconfig_checks_1 = require("./tsconfig-checks");
const metric_utils_1 = require("./utils/metric-utils");
const TSD_OUTPUT = node_process_1.default.env.TSD_OUTPUT;
function printUsage() {
    console.log(`
Usage:
  tsc-diagnostics diagnostics <target-root...> [options]
    [-- <extra tsc args>]

Modes:
  diagnostics
  extendedDiagnostics

Options:
  -m, --mode <mode>          Diagnostics mode to run
  -p, --project <path>       Path to tsconfig.json, relative to target root
  -f, --reportFormat <format> Format of the report to generate (default: html)
  --typescript <path>        Path to the TypeScript package or tsc entrypoint
  --trace                    Generate a TypeScript trace (automatically runs analyze-trace)
  --analyze-trace            Explicitly enable analyze-trace (enabled by default with --trace)
  -o, --output-base <path>   Parent directory for generated output (overrides TSD_OUTPUT env var)
  --build                    Run TypeScript in build mode
  --pretty                   Preserve pretty compiler output
  --fix                      Apply tsconfig performance fixes before diagnostics
  -h, --help                 Show this help

Environment Variables:
  TSD_OUTPUT  Parent directory for all reports (default: ./ts-diagnostics per project)

Output (output-base defaults to the target root):
  <output-base>/ts-diagnostics/<timestamp>/<target-name>-ts-diagnostics.json
  <output-base>/ts-diagnostics/<timestamp>/<target-name>-ts-diagnostics.html

Examples:
  tsc-diagnostics diagnostics ./projects/test-lib-1 \\
    --mode diagnostics \\
    --trace \\
    --analyze-trace

  tsc-diagnostics diagnostics ./projects/test-lib-1 \\
    --mode extendedDiagnostics \\
    --trace \\
    --build \\
    --project tsconfig.json

  tsc-diagnostics diagnostics ./projects/test-lib-1 \\
    --mode extendedDiagnostics \\
    --typescript ../../node_modules/typescript \\
    --project tsconfig.json \\
    -- --incremental false

  # Multiple projects (glob patterns supported)
  tsc-diagnostics diagnostics projects/lib-1 projects/lib-2 --mode extendedDiagnostics

  tsc-diagnostics diagnostics "projects/test-*" --mode extendedDiagnostics

  tsc-diagnostics diagnostics "packages/*" -p tsconfig.prod.json --trace
`.trim());
}
function requireValue(args, index, option) {
    const value = args[index];
    if (!value) {
        throw new Error(`Missing value for ${option}`);
    }
    return value;
}
function parseMode(value) {
    if (value === "diagnostics" ||
        value === "extendedDiagnostics") {
        return value;
    }
    throw new Error(`Invalid diagnostics mode "${value}". ` +
        'Expected "diagnostics" or "extendedDiagnostics".');
}
function parseReportFormat(value) {
    if (value === "html") {
        return value;
    }
    throw new Error(`Invalid report format "${value}". ` +
        'Expected "html".');
}
function parseArgs(argv) {
    if (argv.length === 0 ||
        argv.includes("-h") ||
        argv.includes("--help")) {
        printUsage();
        node_process_1.default.exit(argv.length === 0 ? 1 : 0);
    }
    const separatorIndex = argv.indexOf("--");
    const ownArgs = separatorIndex >= 0
        ? argv.slice(0, separatorIndex)
        : argv;
    const extraArgs = separatorIndex >= 0
        ? argv.slice(separatorIndex + 1)
        : [];
    const targetRoot = ownArgs[0];
    if (!targetRoot || targetRoot.startsWith("-")) {
        throw new Error("The first argument must be the TypeScript project root.");
    }
    let mode;
    let reportFormat;
    const options = {
        targetRoot: (0, node_path_1.resolve)(targetRoot),
        trace: false,
        analyzeTrace: false,
        build: false,
        pretty: false,
        fix: false,
        extraArgs,
    };
    for (let index = 1; index < ownArgs.length; index += 1) {
        const argument = ownArgs[index];
        switch (argument) {
            case "-m":
            case "--mode":
                mode = parseMode(requireValue(ownArgs, ++index, argument));
                break;
            case "-p":
            case "--project":
                options.project = requireValue(ownArgs, ++index, argument);
                break;
            case "-f":
            case "--reportFormat":
                reportFormat = parseReportFormat(requireValue(ownArgs, ++index, argument));
                break;
            case "--typescript":
                options.typescriptPath = requireValue(ownArgs, ++index, argument);
                break;
            case "--trace":
                options.trace = true;
                break;
            case "--analyze-trace":
                options.analyzeTrace = true;
                break;
            case "-o":
            case "--output-base":
                options.outputBase = (0, node_path_1.resolve)(requireValue(ownArgs, ++index, argument));
                break;
            case "--build":
                options.build = true;
                break;
            case "--pretty":
                options.pretty = true;
                break;
            case "--fix":
                options.fix = true;
                break;
            default:
                throw new Error(`Unknown option: ${argument}`);
        }
    }
    if (!mode) {
        mode = 'diagnostics';
    }
    if (!reportFormat) {
        reportFormat = 'html';
    }
    // Enable analyzeTrace by default when trace is enabled
    if (options.trace && !options.analyzeTrace) {
        options.analyzeTrace = true;
    }
    // Apply environment variable for output path if not provided via CLI
    if (!options.outputBase && TSD_OUTPUT) {
        options.outputBase = (0, node_path_1.isAbsolute)(TSD_OUTPUT)
            ? TSD_OUTPUT
            : (0, node_path_1.resolve)(node_process_1.default.cwd(), TSD_OUTPUT);
    }
    return {
        ...options,
        reportFormat,
        mode,
    };
}
function normalizeMetricKey(label) {
    return label
        .trim()
        .replace(/[()]/g, "")
        .replace(/[^a-zA-Z0-9]+(.)/g, (_, character) => character.toUpperCase())
        .replace(/^[A-Z]/, (character) => character.toLowerCase());
}
/**
 * Parses a statistic value as tsc prints it: a count, a time, a memory size
 * or a percentage. Returns undefined for anything else, which means the line
 * it came from is not a statistic.
 */
function parseMetricValue(rawValue) {
    const value = rawValue.trim();
    const secondsMatch = value.match(/^(-?\d+(?:\.\d+)?)s$/i);
    if (secondsMatch) {
        return {
            raw: value,
            value: Number(secondsMatch[1]),
            unit: "seconds",
        };
    }
    const millisecondsMatch = value.match(/^(-?\d+(?:\.\d+)?)ms$/i);
    if (millisecondsMatch) {
        return {
            raw: value,
            value: Number(millisecondsMatch[1]),
            unit: "milliseconds",
        };
    }
    const memoryMatch = value.match(/^(-?\d+(?:\.\d+)?)\s*(K|KB|KiB|M|MB|MiB)$/i);
    if (memoryMatch) {
        const sourceUnit = memoryMatch[2].toLowerCase();
        return {
            raw: value,
            value: Number(memoryMatch[1]),
            unit: sourceUnit === "k" ||
                sourceUnit === "kb" ||
                sourceUnit === "kib"
                ? "KiB"
                : "MiB",
        };
    }
    const percentMatch = value.match(/^(-?\d+(?:\.\d+)?)%$/);
    if (percentMatch) {
        return {
            raw: value,
            value: Number(percentMatch[1]),
            unit: "percent",
        };
    }
    const numericValue = value.replaceAll(",", "");
    if (/^-?\d+(?:\.\d+)?$/.test(numericValue)) {
        return {
            raw: value,
            value: Number(numericValue),
            unit: "count",
        };
    }
    return undefined;
}
/**
 * A statistic line as tsc prints it: the label from the first column, a
 * colon, padding, then the value (`Check time:   0.29s`).
 */
const STATISTIC_LINE = /^([A-Za-z][^:]*):\s+(\S.*?)\s*$/;
/**
 * Reads the statistics block of `--diagnostics` / `--extendedDiagnostics`
 * output. Everything else tsc prints is skipped, even when it contains a
 * colon: compile errors (`src/index.ts(1,14): error TS2322: …`), their
 * indented continuation lines, `--pretty` code frames and summaries, and the
 * output of flags such as `--traceResolution`. Their values are not numbers,
 * or they do not start in the first column with a letter.
 */
function parseDiagnostics(output) {
    const metrics = {};
    for (const line of output.split(/\r?\n/)) {
        const match = line.match(STATISTIC_LINE);
        if (!match) {
            continue;
        }
        const [, label, rawValue] = match;
        const key = normalizeMetricKey(label);
        const metric = parseMetricValue(rawValue);
        if (key && metric) {
            metrics[key] = metric;
        }
    }
    return metrics;
}
function findTypeScriptCli(options) {
    const candidates = [];
    if (options.typescriptPath) {
        const suppliedPath = (0, node_path_1.isAbsolute)(options.typescriptPath)
            ? options.typescriptPath
            : (0, node_path_1.resolve)(node_process_1.default.cwd(), options.typescriptPath);
        candidates.push(suppliedPath, (0, node_path_1.resolve)(suppliedPath, "bin", "tsc"), (0, node_path_1.resolve)(suppliedPath, "lib", "tsc.js"));
    }
    candidates.push((0, node_path_1.resolve)(options.targetRoot, "node_modules", "typescript", "bin", "tsc"), (0, node_path_1.resolve)(options.targetRoot, "node_modules", "typescript", "lib", "tsc.js"), (0, node_path_1.resolve)(node_process_1.default.cwd(), "node_modules", "typescript", "bin", "tsc"), (0, node_path_1.resolve)(node_process_1.default.cwd(), "node_modules", "typescript", "lib", "tsc.js"));
    try {
        const packageJsonPath = require.resolve("typescript/package.json", {
            paths: [
                options.targetRoot,
                node_process_1.default.cwd(),
            ],
        });
        const packageRoot = (0, node_path_1.dirname)(packageJsonPath);
        candidates.push((0, node_path_1.resolve)(packageRoot, "bin", "tsc"), (0, node_path_1.resolve)(packageRoot, "lib", "tsc.js"));
    }
    catch {
        // TypeScript is not resolvable from the target or tool project.
    }
    // Only files qualify: a `--typescript` package folder must resolve to its
    // bin/tsc, not be executed as a directory (which runs the library entry).
    const cliPath = candidates.find((candidate) => (0, node_fs_1.existsSync)(candidate) && (0, node_fs_1.statSync)(candidate).isFile());
    if (!cliPath) {
        throw new Error([
            "Could not find the TypeScript compiler.",
            "",
            "Install TypeScript in the target workspace:",
            "  npm install --save-dev typescript",
            "",
            "Or provide it explicitly:",
            "  --typescript /path/to/node_modules/typescript",
        ].join("\n"));
    }
    return cliPath;
}
function buildCompilerArguments(options, tracePath) {
    const compilerArgs = [];
    if (options.build) {
        compilerArgs.push("--build");
        if (options.project) {
            compilerArgs.push(options.project);
        }
    }
    else if (options.project) {
        compilerArgs.push("--project", options.project);
    }
    compilerArgs.push(options.mode === "diagnostics"
        ? "--diagnostics"
        : "--extendedDiagnostics", "--pretty", String(options.pretty));
    if (tracePath) {
        compilerArgs.push("--generateTrace", tracePath);
    }
    compilerArgs.push(...options.extraArgs);
    return compilerArgs;
}
function buildDateStamp(date) {
    return date
        .toISOString()
        .replace(/:/g, "-")
        .replace(/\..+$/, "");
}
async function runTraceAnalysis(tracePath, targetRoot) {
    return new Promise((resolveAnalysis, rejectAnalysis) => {
        const child = (0, node_child_process_1.spawn)("npx", [
            "--yes",
            "@typescript/analyze-trace",
            tracePath,
        ], {
            cwd: targetRoot,
            env: node_process_1.default.env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
            node_process_1.default.stdout.write(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
            node_process_1.default.stderr.write(chunk);
        });
        child.once("error", rejectAnalysis);
        child.once("close", (exitCode, signal) => {
            resolveAnalysis({
                exitCode,
                signal,
                output: [stdout, stderr]
                    .filter(Boolean)
                    .join("\n"),
                command: [
                    "npx",
                    "--yes",
                    "@typescript/analyze-trace",
                    tracePath,
                ],
            });
        });
    });
}
async function runDiagnostics(options, typescriptCliPath, tracePath) {
    const compilerArgs = buildCompilerArguments(options, tracePath);
    const command = [
        node_process_1.default.execPath,
        typescriptCliPath,
        ...compilerArgs,
    ];
    const startedAt = new Date();
    const startedTime = node_process_1.default.hrtime.bigint();
    return new Promise((resolveRun, reject) => {
        const child = (0, node_child_process_1.spawn)(node_process_1.default.execPath, [
            typescriptCliPath,
            ...compilerArgs,
        ], {
            cwd: options.targetRoot,
            env: {
                ...node_process_1.default.env,
                FORCE_COLOR: options.pretty
                    ? node_process_1.default.env.FORCE_COLOR
                    : "0",
                NO_COLOR: options.pretty
                    ? node_process_1.default.env.NO_COLOR
                    : "1",
            },
            stdio: [
                "ignore",
                "pipe",
                "pipe",
            ],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
            node_process_1.default.stdout.write(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
            node_process_1.default.stderr.write(chunk);
        });
        child.once("error", reject);
        child.once("close", (exitCode, signal) => {
            const finishedAt = new Date();
            const durationMs = Number(node_process_1.default.hrtime.bigint() -
                startedTime) / 1_000_000;
            const compilerOutput = [
                stdout,
                stderr,
            ]
                .filter(Boolean)
                .join("\n");
            // Build result asynchronously to capture trace files
            (async () => {
                const traceFiles = tracePath && (0, node_fs_1.existsSync)(tracePath)
                    ? await (0, promises_1.readdir)(tracePath)
                    : undefined;
                resolveRun({
                    schemaVersion: 1,
                    mode: options.mode,
                    targetRoot: options.targetRoot,
                    targetName: (0, node_path_1.basename)(options.targetRoot),
                    ...(options.project && options.project !== 'tsconfig.lib.json' ? { project: options.project } : {}),
                    generatedAt: finishedAt.toISOString(),
                    command,
                    cwd: options.targetRoot,
                    startedAt: startedAt.toISOString(),
                    finishedAt: finishedAt.toISOString(),
                    durationMs,
                    exitCode,
                    signal,
                    metrics: parseDiagnostics(compilerOutput),
                    stdout,
                    stderr,
                    ...(traceFiles && { traceFiles }),
                });
            })();
        });
    });
}
async function renderReport(options) {
    const template = await (0, promises_1.readFile)(options.templatePath, "utf8");
    const sharedStyles = await (0, promises_1.readFile)((0, node_path_1.resolve)(__dirname, "theme", "design-tokens.css"), "utf8");
    const sharedScript = await (0, promises_1.readFile)((0, node_path_1.resolve)(__dirname, "theme", "shared-report.js"), "utf8");
    const html = (0, serialize_for_script_1.injectScriptData)((0, theme_splice_1.spliceMarkerBlock)((0, theme_splice_1.spliceMarkerBlock)(template, "SHARED_STYLES", sharedStyles), "SHARED_SCRIPT", sharedScript), "REPORT_DATA", options.reportData);
    await (0, promises_1.writeFile)(options.outputPath, html, "utf8");
}
/**
 * Describes how a failed tsc run ended, e.g.
 * "exited with code 2 (3 compile errors)".
 */
function describeCompilerFailure(result) {
    const outcome = result.exitCode === null
        ? `was terminated by ${result.signal ?? "a signal"}`
        : `exited with code ${result.exitCode}`;
    const errorCount = (0, metric_utils_1.findCompileErrors)(result).length;
    return errorCount > 0
        ? `${outcome} (${errorCount} compile error${errorCount === 1 ? "" : "s"})`
        : outcome;
}
/**
 * Runs diagnostics on one project and writes its JSON and HTML reports.
 * Resolves with the result even when tsc fails (check `exitCode`); rejects
 * only when the run itself cannot happen.
 */
async function runDiagnosticsCli(args) {
    const options = parseArgs(args);
    const targetName = (0, node_path_1.basename)(options.targetRoot);
    const typescriptCliPath = findTypeScriptCli(options);
    const baseOutputDirectory = (0, node_path_1.resolve)(options.outputBase ?? options.targetRoot, `ts-diagnostics`);
    const runStamp = buildDateStamp(new Date());
    const runOutputDirectory = (0, node_path_1.resolve)(baseOutputDirectory, runStamp);
    const tracePathForRun = options.trace
        ? runOutputDirectory
        : undefined;
    const runOptions = {
        ...options,
        trace: options.trace,
    };
    if (options.analyzeTrace && !tracePathForRun) {
        throw new Error("--analyze-trace requires --trace flag.");
    }
    await (0, promises_1.mkdir)(runOutputDirectory, {
        recursive: true,
    });
    let fixReport;
    if (options.fix) {
        console.log("\nAuditing and applying tsconfig fixes before diagnostics...\n");
        const auditReport = (0, tsconfig_checks_1.auditTsconfigSettings)({
            workspaceRoot: options.targetRoot,
        });
        const appliedFixes = (0, tsconfig_checks_1.applyTsconfigFixes)({
            workspaceRoot: options.targetRoot,
            report: auditReport,
            dryRun: false,
        });
        (0, tsconfig_checks_1.printFixReport)(appliedFixes);
        fixReport = appliedFixes;
    }
    console.log(`TypeScript CLI: ${typescriptCliPath}`);
    console.log(`\nRunning --${options.mode} in ` +
        `${options.targetRoot}\n`);
    console.log(`Run output directory: ${runOutputDirectory}`);
    const result = await runDiagnostics(runOptions, typescriptCliPath, tracePathForRun);
    let traceAnalysis;
    if (options.analyzeTrace && tracePathForRun) {
        console.log(`\nRunning analyze-trace for:\n${tracePathForRun}`);
        const analysisOutputPath = (0, node_path_1.resolve)(runOutputDirectory, `${targetName}-trace-analysis.txt`);
        try {
            const analysisResult = await runTraceAnalysis(tracePathForRun, options.targetRoot);
            await (0, promises_1.writeFile)(analysisOutputPath, `${analysisResult.output}\n`, "utf8");
            traceAnalysis = {
                tracePath: tracePathForRun,
                command: analysisResult.command,
                exitCode: analysisResult.exitCode,
                signal: analysisResult.signal,
                output: analysisResult.output,
                outputFile: analysisOutputPath,
            };
            console.log(`Trace analysis written to:\n${analysisOutputPath}`);
            if (analysisResult.exitCode !== 0) {
                console.warn(`analyze-trace exited with code ${String(analysisResult.exitCode)}.`);
            }
        }
        catch (error) {
            traceAnalysis = {
                tracePath: tracePathForRun,
                command: [
                    "npx",
                    "--yes",
                    "@typescript/analyze-trace",
                    tracePathForRun,
                ],
                exitCode: null,
                signal: null,
                output: "",
                error: error.message,
            };
            console.warn(`Warning: Failed to run analyze-trace: ${error.message}`);
        }
    }
    const resultWithAnalysis = {
        ...result,
        ...(traceAnalysis ? { traceAnalysis } : {}),
        ...(fixReport ? { fixReport } : {}),
    };
    const outputPath = (0, node_path_1.resolve)(runOutputDirectory, `${targetName}-ts-diagnostics.json`);
    await (0, promises_1.writeFile)(outputPath, `${JSON.stringify(resultWithAnalysis, null, 2)}\n`, "utf8");
    console.log(`\nJSON diagnostics written to:\n${outputPath}`);
    if (options.reportFormat !== null) {
        const reportOutputPath = (0, node_path_1.resolve)(runOutputDirectory, `${targetName}-ts-diagnostics.html`);
        await renderReport({
            templatePath: (0, node_path_1.resolve)(__dirname, "theme", "layouts", "detail-layout.html"),
            outputPath: reportOutputPath,
            reportData: resultWithAnalysis,
        });
        console.log(`HTML report written to:\n${reportOutputPath}`);
    }
    if (result.exitCode !== 0) {
        console.error(`\nTypeScript ${describeCompilerFailure(result)}.`);
    }
    return resultWithAnalysis;
}
async function runDiagnosticsMultiCli(args) {
    const argv = args;
    if (argv.length === 0 ||
        argv.includes("-h") ||
        argv.includes("--help")) {
        printUsage();
        node_process_1.default.exit(argv.length === 0 ? 1 : 0);
    }
    // Extract all target roots (first positional arguments before options)
    const targetRoots = [];
    const unmatchedPatterns = [];
    let argIndex = 0;
    while (argIndex < argv.length && !argv[argIndex].startsWith("-")) {
        const arg = argv[argIndex];
        if ((0, glob_1.isGlobPattern)(arg)) {
            const expanded = (0, glob_1.expandGlobPattern)(arg, { onlyDirectories: true });
            if (expanded.length === 0) {
                unmatchedPatterns.push(arg);
            }
            targetRoots.push(...expanded);
        }
        else {
            targetRoots.push(arg);
        }
        argIndex += 1;
    }
    for (const pattern of unmatchedPatterns) {
        console.warn(`Warning: No project folders match "${pattern}".`);
    }
    if (targetRoots.length === 0) {
        if (unmatchedPatterns.length > 0) {
            console.error("\nNo projects to run diagnostics on. " +
                "Check the pattern(s) above, relative to " +
                `${node_process_1.default.cwd()}.`);
            node_process_1.default.exitCode = 1;
            return;
        }
        throw new Error("The first argument must be one or more project root(s).");
    }
    const optionArgs = argv.slice(argIndex);
    // Single project: run normally (with the expanded path, not the raw pattern)
    // and pass tsc's exit code through.
    if (targetRoots.length === 1) {
        const result = await runDiagnosticsCli([targetRoots[0], ...optionArgs]);
        if (result.exitCode !== 0) {
            // null when tsc was killed by a signal
            node_process_1.default.exitCode = result.exitCode ?? 1;
        }
        return;
    }
    // Multiple projects: show summary
    console.log(`\nRunning diagnostics on ${targetRoots.length} project(s)...\n`);
    const results = [];
    for (let i = 0; i < targetRoots.length; i++) {
        const targetRoot = targetRoots[i];
        const projectNum = i + 1;
        try {
            console.log(`[${projectNum}/${targetRoots.length}] ${targetRoot}...`);
            // Build new args with this target
            const newArgs = [targetRoot, ...optionArgs];
            const result = await runDiagnosticsCli(newArgs);
            if (result.exitCode === 0) {
                results.push({ project: targetRoot, success: true });
            }
            else {
                results.push({
                    project: targetRoot,
                    success: false,
                    error: `TypeScript ${describeCompilerFailure(result)}`,
                });
            }
        }
        catch (error) {
            const errorMsg = error.message || String(error);
            console.error(`✗ Failed: ${errorMsg}\n`);
            results.push({
                project: targetRoot,
                success: false,
                error: errorMsg,
            });
        }
    }
    // Summary
    console.log("\n=== Diagnostics Summary ===");
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    console.log(`Total: ${results.length} | ✓ Success: ${succeeded} | ✗ Failed: ${failed}\n`);
    if (failed > 0) {
        console.log("Failed projects:");
        results.filter((r) => !r.success).forEach((r) => {
            console.log(`  • ${r.project}: ${r.error}`);
        });
        node_process_1.default.exitCode = 1;
    }
}
