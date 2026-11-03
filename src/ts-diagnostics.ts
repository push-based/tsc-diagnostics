#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import {
    basename,
    dirname,
    isAbsolute,
    resolve,
} from "node:path";
import process from "node:process";
import {DiagnosticsMetrics, DiagnosticsResult, ParsedMetric} from "./diagnostic.types";
import { expandGlobPattern, isGlobPattern } from "./glob";
import { injectScriptData } from "./serialize-for-script";
import { spliceMarkerBlock } from "./theme-splice";
import { auditTsconfigSettings, applyTsconfigFixes, printFixReport } from "./tsconfig-checks";
import { findCompileErrors } from "./utils/metric-utils";

const TSD_OUTPUT = process.env.TSD_OUTPUT;

export type DiagnosticMode = "diagnostics" | "extendedDiagnostics";
export type ReportFormat = "html";

export interface CliOptions {
    targetRoot: string;
    mode: DiagnosticMode;
    project?: string;
    typescriptPath?: string;
    trace: boolean;
    analyzeTrace: boolean;
    outputBase?: string;
    build: boolean;
    reportFormat: ReportFormat | null;
    pretty: boolean;
    fix: boolean;
    extraArgs: string[];
}

interface TraceAnalysisData {
    tracePath: string;
    command: string[];
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    output: string;
    outputFile?: string;
    error?: string;
}

function printUsage(): void {
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

function requireValue(
    args: string[],
    index: number,
    option: string,
): string {
    const value = args[index];

    if (!value) {
        throw new Error(`Missing value for ${option}`);
    }

    return value;
}

function parseMode(value: string): DiagnosticMode {
    if (
        value === "diagnostics" ||
        value === "extendedDiagnostics"
    ) {
        return value;
    }

    throw new Error(
        `Invalid diagnostics mode "${value}". ` +
        'Expected "diagnostics" or "extendedDiagnostics".',
    );
}

function parseReportFormat(value: string): ReportFormat {
    if (value === "html") {
        return value;
    }

    throw new Error(
        `Invalid report format "${value}". ` +
        'Expected "html".',
    );
}

function parseArgs(argv: string[]): CliOptions {
    if (
        argv.length === 0 ||
        argv.includes("-h") ||
        argv.includes("--help")
    ) {
        printUsage();
        process.exit(argv.length === 0 ? 1 : 0);
    }

    const separatorIndex = argv.indexOf("--");

    const ownArgs =
        separatorIndex >= 0
            ? argv.slice(0, separatorIndex)
            : argv;

    const extraArgs =
        separatorIndex >= 0
            ? argv.slice(separatorIndex + 1)
            : [];

    const targetRoot = ownArgs[0];

    if (!targetRoot || targetRoot.startsWith("-")) {
        throw new Error(
            "The first argument must be the TypeScript project root.",
        );
    }

    let mode: DiagnosticMode | undefined;
    let reportFormat: ReportFormat | undefined;

    const options: Omit<CliOptions, "mode" | "reportFormat"> = {
        targetRoot: resolve(targetRoot),
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
                mode = parseMode(
                    requireValue(ownArgs, ++index, argument),
                );
                break;

            case "-p":
            case "--project":
                options.project = requireValue(
                    ownArgs,
                    ++index,
                    argument,
                );
                break;

            case "-f":
            case "--reportFormat":
                reportFormat = parseReportFormat(
                    requireValue(ownArgs, ++index, argument),
                );
                break;

            case "--typescript":
                options.typescriptPath = requireValue(
                    ownArgs,
                    ++index,
                    argument,
                );
                break;

            case "--trace":
                options.trace = true;
                break;

            case "--analyze-trace":
                options.analyzeTrace = true;
                break;

            case "-o":
            case "--output-base":
                options.outputBase = resolve(
                    requireValue(ownArgs, ++index, argument),
                );
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
        options.outputBase = isAbsolute(TSD_OUTPUT)
            ? TSD_OUTPUT
            : resolve(process.cwd(), TSD_OUTPUT);
    }

    return {
        ...options,
        reportFormat,
        mode,
    };
}

function normalizeMetricKey(label: string): string {
    return label
        .trim()
        .replace(/[()]/g, "")
        .replace(
            /[^a-zA-Z0-9]+(.)/g,
            (_, character: string) => character.toUpperCase(),
        )
        .replace(
            /^[A-Z]/,
            (character) => character.toLowerCase(),
        );
}

/**
 * Parses a statistic value as tsc prints it: a count, a time, a memory size
 * or a percentage. Returns undefined for anything else, which means the line
 * it came from is not a statistic.
 */
function parseMetricValue(rawValue: string): ParsedMetric | undefined {
    const value = rawValue.trim();

    const secondsMatch = value.match(
        /^(-?\d+(?:\.\d+)?)s$/i,
    );

    if (secondsMatch) {
        return {
            raw: value,
            value: Number(secondsMatch[1]),
            unit: "seconds",
        };
    }

    const millisecondsMatch = value.match(
        /^(-?\d+(?:\.\d+)?)ms$/i,
    );

    if (millisecondsMatch) {
        return {
            raw: value,
            value: Number(millisecondsMatch[1]),
            unit: "milliseconds",
        };
    }

    const memoryMatch = value.match(
        /^(-?\d+(?:\.\d+)?)\s*(K|KB|KiB|M|MB|MiB)$/i,
    );

    if (memoryMatch) {
        const sourceUnit = memoryMatch[2].toLowerCase();

        return {
            raw: value,
            value: Number(memoryMatch[1]),
            unit:
                sourceUnit === "k" ||
                sourceUnit === "kb" ||
                sourceUnit === "kib"
                    ? "KiB"
                    : "MiB",
        };
    }

    const percentMatch = value.match(
        /^(-?\d+(?:\.\d+)?)%$/,
    );

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
export function parseDiagnostics(
    output: string,
): DiagnosticsMetrics {
    const metrics: DiagnosticsMetrics = {};

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

function findTypeScriptCli(
    options: CliOptions,
): string {
    const candidates: string[] = [];

    if (options.typescriptPath) {
        const suppliedPath = isAbsolute(
            options.typescriptPath,
        )
            ? options.typescriptPath
            : resolve(
                process.cwd(),
                options.typescriptPath,
            );

        candidates.push(
            suppliedPath,
            resolve(suppliedPath, "bin", "tsc"),
            resolve(suppliedPath, "lib", "tsc.js"),
        );
    }

    candidates.push(
        resolve(
            options.targetRoot,
            "node_modules",
            "typescript",
            "bin",
            "tsc",
        ),
        resolve(
            options.targetRoot,
            "node_modules",
            "typescript",
            "lib",
            "tsc.js",
        ),
        resolve(
            process.cwd(),
            "node_modules",
            "typescript",
            "bin",
            "tsc",
        ),
        resolve(
            process.cwd(),
            "node_modules",
            "typescript",
            "lib",
            "tsc.js",
        ),
    );

    try {
        const packageJsonPath = require.resolve(
            "typescript/package.json",
            {
                paths: [
                    options.targetRoot,
                    process.cwd(),
                ],
            },
        );

        const packageRoot = dirname(packageJsonPath);

        candidates.push(
            resolve(packageRoot, "bin", "tsc"),
            resolve(packageRoot, "lib", "tsc.js"),
        );
    } catch {
        // TypeScript is not resolvable from the target or tool project.
    }

    // Only files qualify: a `--typescript` package folder must resolve to its
    // bin/tsc, not be executed as a directory (which runs the library entry).
    const cliPath = candidates.find(
        (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    );

    if (!cliPath) {
        throw new Error(
            [
                "Could not find the TypeScript compiler.",
                "",
                "Install TypeScript in the target workspace:",
                "  npm install --save-dev typescript",
                "",
                "Or provide it explicitly:",
                "  --typescript /path/to/node_modules/typescript",
            ].join("\n"),
        );
    }

    return cliPath;
}

function buildCompilerArguments(
    options: CliOptions,
    tracePath?: string,
): string[] {
    const compilerArgs: string[] = [];

    if (options.build) {
        compilerArgs.push("--build");

        if (options.project) {
            compilerArgs.push(options.project);
        }
    } else if (options.project) {
        compilerArgs.push(
            "--project",
            options.project,
        );
    }

    compilerArgs.push(
        options.mode === "diagnostics"
            ? "--diagnostics"
            : "--extendedDiagnostics",
        "--pretty",
        String(options.pretty),
    );

    if (tracePath) {
        compilerArgs.push(
            "--generateTrace",
            tracePath,
        );
    }

    compilerArgs.push(...options.extraArgs);

    return compilerArgs;
}

function buildDateStamp(date: Date): string {
    return date
        .toISOString()
        .replace(/:/g, "-")
        .replace(/\..+$/, "");
}

interface TraceAnalysisResult {
    command: string[];
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    output: string;
}

async function runTraceAnalysis(
    tracePath: string,
    targetRoot: string,
): Promise<TraceAnalysisResult> {
    return new Promise<TraceAnalysisResult>(
        (resolveAnalysis, rejectAnalysis) => {
            const child = spawn(
                "npx",
                [
                    "--yes",
                    "@typescript/analyze-trace",
                    tracePath,
                ],
                {
                    cwd: targetRoot,
                    env: process.env,
                    stdio: ["ignore", "pipe", "pipe"],
                },
            );

            let stdout = "";
            let stderr = "";

            child.stdout.setEncoding("utf8");
            child.stderr.setEncoding("utf8");

            child.stdout.on("data", (chunk: string) => {
                stdout += chunk;
                process.stdout.write(chunk);
            });

            child.stderr.on("data", (chunk: string) => {
                stderr += chunk;
                process.stderr.write(chunk);
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
        },
    );
}

async function runDiagnostics(
    options: CliOptions,
    typescriptCliPath: string,
    tracePath?: string,
): Promise<DiagnosticsResult> {
    const compilerArgs =
        buildCompilerArguments(options, tracePath);

    const command = [
        process.execPath,
        typescriptCliPath,
        ...compilerArgs,
    ];

    const startedAt = new Date();
    const startedTime = process.hrtime.bigint();

    return new Promise<DiagnosticsResult>(
        (resolveRun, reject) => {
            const child = spawn(
                process.execPath,
                [
                    typescriptCliPath,
                    ...compilerArgs,
                ],
                {
                    cwd: options.targetRoot,
                    env: {
                        ...process.env,
                        FORCE_COLOR: options.pretty
                            ? process.env.FORCE_COLOR
                            : "0",
                        NO_COLOR: options.pretty
                            ? process.env.NO_COLOR
                            : "1",
                    },
                    stdio: [
                        "ignore",
                        "pipe",
                        "pipe",
                    ],
                },
            );

            let stdout = "";
            let stderr = "";

            child.stdout.setEncoding("utf8");
            child.stderr.setEncoding("utf8");

            child.stdout.on(
                "data",
                (chunk: string) => {
                    stdout += chunk;
                    process.stdout.write(chunk);
                },
            );

            child.stderr.on(
                "data",
                (chunk: string) => {
                    stderr += chunk;
                    process.stderr.write(chunk);
                },
            );

            child.once("error", reject);

            child.once(
                "close",
                (
                    exitCode: number | null,
                    signal: NodeJS.Signals | null,
                ) => {
                    const finishedAt = new Date();

                    const durationMs =
                        Number(
                            process.hrtime.bigint() -
                            startedTime,
                        ) / 1_000_000;

                    const compilerOutput = [
                        stdout,
                        stderr,
                    ]
                        .filter(Boolean)
                        .join("\n");

                    // Build result asynchronously to capture trace files
                    (async () => {
                        const traceFiles: string[] | undefined =
                            tracePath && existsSync(tracePath)
                                ? await readdir(tracePath)
                                : undefined;

                        resolveRun({
                            schemaVersion: 1,
                            mode: options.mode,
                            targetRoot: options.targetRoot,
                            targetName: basename(
                                options.targetRoot,
                            ),
                            ...(options.project && options.project !== 'tsconfig.lib.json' ? { project: options.project } : {}),
                            generatedAt:
                                finishedAt.toISOString(),
                            command,
                            cwd: options.targetRoot,
                            startedAt:
                                startedAt.toISOString(),
                            finishedAt:
                                finishedAt.toISOString(),
                            durationMs,
                            exitCode,
                            signal,
                            metrics:
                                parseDiagnostics(
                                    compilerOutput,
                                ),
                            stdout,
                            stderr,
                            ...(traceFiles && { traceFiles }),
                        });
                    })();
                },
            );
        },
    );
}

export interface RenderOptions {
    templatePath: string;
    outputPath: string;
    reportData: DiagnosticsResult;
}

export async function renderReport(
    options: RenderOptions,
): Promise<void> {
    const template = await readFile(
        options.templatePath,
        "utf8",
    );
    const sharedStyles = await readFile(
        resolve(__dirname, "theme", "design-tokens.css"),
        "utf8",
    );
    const sharedScript = await readFile(
        resolve(__dirname, "theme", "shared-report.js"),
        "utf8",
    );

    const html = injectScriptData(
        spliceMarkerBlock(
            spliceMarkerBlock(template, "SHARED_STYLES", sharedStyles),
            "SHARED_SCRIPT",
            sharedScript,
        ),
        "REPORT_DATA",
        options.reportData,
    );

    await writeFile(
        options.outputPath,
        html,
        "utf8",
    );
}

/**
 * Describes how a failed tsc run ended, e.g.
 * "exited with code 2 (3 compile errors)".
 */
function describeCompilerFailure(result: DiagnosticsResult): string {
    const outcome =
        result.exitCode === null
            ? `was terminated by ${result.signal ?? "a signal"}`
            : `exited with code ${result.exitCode}`;
    const errorCount = findCompileErrors(result).length;

    return errorCount > 0
        ? `${outcome} (${errorCount} compile error${errorCount === 1 ? "" : "s"})`
        : outcome;
}

/**
 * Runs diagnostics on one project and writes its JSON and HTML reports.
 * Resolves with the result even when tsc fails (check `exitCode`); rejects
 * only when the run itself cannot happen.
 */
export async function runDiagnosticsCli(args: string[]): Promise<DiagnosticsResult> {
    const options = parseArgs(args);

    const targetName = basename(
        options.targetRoot,
    );

    const typescriptCliPath =
        findTypeScriptCli(options);

    const baseOutputDirectory = resolve(
        options.outputBase ?? options.targetRoot,
        `ts-diagnostics`,
    );

    const runStamp = buildDateStamp(new Date());

    const runOutputDirectory = resolve(
        baseOutputDirectory,
        runStamp,
    );

    const tracePathForRun = options.trace
        ? runOutputDirectory
        : undefined;

    const runOptions: CliOptions = {
        ...options,
        trace: options.trace,
    };

    if (options.analyzeTrace && !tracePathForRun) {
        throw new Error(
            "--analyze-trace requires --trace flag.",
        );
    }

    await mkdir(runOutputDirectory, {
        recursive: true,
    });

    let fixReport: DiagnosticsResult["fixReport"] | undefined;

    if (options.fix) {
        console.log("\nAuditing and applying tsconfig fixes before diagnostics...\n");

        const auditReport = auditTsconfigSettings({
            workspaceRoot: options.targetRoot,
        });

        const appliedFixes = applyTsconfigFixes({
            workspaceRoot: options.targetRoot,
            report: auditReport,
            dryRun: false,
        });

        printFixReport(appliedFixes);
        fixReport = appliedFixes;
    }

    console.log(
        `TypeScript CLI: ${typescriptCliPath}`,
    );

    console.log(
        `\nRunning --${options.mode} in ` +
        `${options.targetRoot}\n`,
    );

    console.log(
        `Run output directory: ${runOutputDirectory}`,
    );

    const result = await runDiagnostics(
        runOptions,
        typescriptCliPath,
        tracePathForRun,
    );

    let traceAnalysis: TraceAnalysisData | undefined;

    if (options.analyzeTrace && tracePathForRun) {
        console.log(
            `\nRunning analyze-trace for:\n${tracePathForRun}`,
        );

        const analysisOutputPath = resolve(
            runOutputDirectory,
            `${targetName}-trace-analysis.txt`,
        );

        try {
            const analysisResult = await runTraceAnalysis(
                tracePathForRun,
                options.targetRoot,
            );

            await writeFile(
                analysisOutputPath,
                `${analysisResult.output}\n`,
                "utf8",
            );

            traceAnalysis = {
                tracePath: tracePathForRun,
                command: analysisResult.command,
                exitCode: analysisResult.exitCode,
                signal: analysisResult.signal,
                output: analysisResult.output,
                outputFile: analysisOutputPath,
            };

            console.log(
                `Trace analysis written to:\n${analysisOutputPath}`,
            );

            if (analysisResult.exitCode !== 0) {
                console.warn(
                    `analyze-trace exited with code ${String(analysisResult.exitCode)}.`,
                );
            }
        } catch (error) {
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
                error: (error as Error).message,
            };

            console.warn(
                `Warning: Failed to run analyze-trace: ${(error as Error).message}`,
            );
        }
    }

    const resultWithAnalysis: DiagnosticsResult = {
        ...result,
        ...(traceAnalysis ? { traceAnalysis } : {}),
        ...(fixReport ? { fixReport } : {}),
    };

    const outputPath = resolve(
        runOutputDirectory,
        `${targetName}-ts-diagnostics.json`,
    );

    await writeFile(
        outputPath,
        `${JSON.stringify(
            resultWithAnalysis,
            null,
            2,
        )}\n`,
        "utf8",
    );

    console.log(
        `\nJSON diagnostics written to:\n${outputPath}`,
    );

    if (options.reportFormat !== null) {
        const reportOutputPath = resolve(
            runOutputDirectory,
            `${targetName}-ts-diagnostics.html`,
        );

        await renderReport({
            templatePath: resolve(
                __dirname,
                "theme",
                "layouts",
                "detail-layout.html",
            ),
            outputPath: reportOutputPath,
            reportData: resultWithAnalysis,
        });

        console.log(
            `HTML report written to:\n${reportOutputPath}`,
        );
    }

    if (result.exitCode !== 0) {
        console.error(
            `\nTypeScript ${describeCompilerFailure(result)}.`,
        );
    }

    return resultWithAnalysis;
}

export async function runDiagnosticsMultiCli(args: string[]): Promise<void> {
    const argv = args;
    if (
        argv.length === 0 ||
        argv.includes("-h") ||
        argv.includes("--help")
    ) {
        printUsage();
        process.exit(argv.length === 0 ? 1 : 0);
    }

    // Extract all target roots (first positional arguments before options)
    const targetRoots: string[] = [];
    const unmatchedPatterns: string[] = [];
    let argIndex = 0;

    while (argIndex < argv.length && !argv[argIndex].startsWith("-")) {
        const arg = argv[argIndex];
        if (isGlobPattern(arg)) {
            const expanded = expandGlobPattern(arg, { onlyDirectories: true });
            if (expanded.length === 0) {
                unmatchedPatterns.push(arg);
            }
            targetRoots.push(...expanded);
        } else {
            targetRoots.push(arg);
        }
        argIndex += 1;
    }

    for (const pattern of unmatchedPatterns) {
        console.warn(`Warning: No project folders match "${pattern}".`);
    }

    if (targetRoots.length === 0) {
        if (unmatchedPatterns.length > 0) {
            console.error(
                "\nNo projects to run diagnostics on. " +
                "Check the pattern(s) above, relative to " +
                `${process.cwd()}.`,
            );
            process.exitCode = 1;
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
            process.exitCode = result.exitCode ?? 1;
        }
        return;
    }

    // Multiple projects: show summary
    console.log(`\nRunning diagnostics on ${targetRoots.length} project(s)...\n`);

    const results: { project: string; success: boolean; error?: string }[] = [];

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
            } else {
                results.push({
                    project: targetRoot,
                    success: false,
                    error: `TypeScript ${describeCompilerFailure(result)}`,
                });
            }
        } catch (error) {
            const errorMsg = (error as Error).message || String(error);
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
        process.exitCode = 1;
    }
}
