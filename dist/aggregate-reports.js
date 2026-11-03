#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAggregateCli = runAggregateCli;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_process_1 = __importDefault(require("node:process"));
const glob_1 = require("./glob");
const serialize_for_script_1 = require("./serialize-for-script");
const theme_splice_1 = require("./theme-splice");
function printUsage() {
    console.log(`
Usage:
  tsc-diagnostics aggregate <input-paths...> [options]

Collects diagnostics JSON reports from folders, files, or glob patterns and aggregates them into one JSON file.

Arguments:
  <input-paths...>         Folders, file paths, or glob patterns to scan for diagnostics JSON files (default: current directory)
                           Glob patterns: projects/*/ts-diagnostics, packages/**/*.json, etc.

Options:
  -o, --output <path>      Path to output the aggregated JSON file (default: ./projects-diagnostics.json)
  -r, --recursive          Scan directories recursively for reports (default: true)
  --no-recursive           Do not scan directories recursively
  -h, --help               Show this help message

Examples:
  tsc-diagnostics aggregate projects/test-lib-1 projects/test-lib-2 -o results.json
  tsc-diagnostics aggregate "projects/*/ts-diagnostics" -o results.json
  tsc-diagnostics aggregate "packages/**/ts-diagnostics/*.json" -o results.json
  tsc-diagnostics aggregate --no-recursive -o local-results.json .
`.trim());
}
function parseArgs(argv) {
    if (argv.includes("-h") || argv.includes("--help")) {
        printUsage();
        node_process_1.default.exit(0);
    }
    const inputPaths = [];
    let hasPositionalInputs = false;
    let outputFile = "./projects-diagnostics.json";
    let recursive = true;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "-o" || arg === "--output") {
            if (!argv[i + 1] || argv[i + 1].startsWith("-")) {
                throw new Error("Missing value for --output option");
            }
            outputFile = argv[++i];
        }
        else if (arg === "-r" || arg === "--recursive") {
            recursive = true;
        }
        else if (arg === "--no-recursive") {
            recursive = false;
        }
        else if (arg.startsWith("-")) {
            throw new Error(`Unknown option: ${arg}`);
        }
        else {
            hasPositionalInputs = true;
            // Glob patterns may match report files or folders to scan
            if ((0, glob_1.isGlobPattern)(arg)) {
                const expanded = (0, glob_1.expandGlobPattern)(arg);
                if (expanded.length === 0) {
                    console.warn(`Warning: No files or folders match "${arg}".`);
                }
                inputPaths.push(...expanded);
            }
            else {
                inputPaths.push(arg);
            }
        }
    }
    // Only scan the current directory when no inputs were given at all —
    // never as a silent fallback for patterns that matched nothing.
    if (!hasPositionalInputs) {
        inputPaths.push(node_process_1.default.cwd());
    }
    return {
        inputPaths: inputPaths.map((p) => (0, node_path_1.resolve)(p)),
        outputFile: (0, node_path_1.resolve)(outputFile),
        recursive,
    };
}
async function findReports(dir, recursive, results = []) {
    try {
        const entries = await (0, promises_1.readdir)(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = (0, node_path_1.join)(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules" ||
                    entry.name === "dist" ||
                    entry.name === ".git" ||
                    entry.name === ".idea" ||
                    entry.name === "tmp") {
                    continue;
                }
                if (recursive) {
                    await findReports(fullPath, recursive, results);
                }
            }
            else if (entry.isFile() && entry.name.endsWith("-ts-diagnostics.json")) {
                results.push(fullPath);
            }
        }
    }
    catch (error) {
        console.warn(`Warning: Failed to read directory ${dir}: ${error.message}`);
    }
    return results;
}
function formatMemoryToMiB(metric) {
    if (!metric)
        return "-";
    const val = Number(metric.value);
    if (isNaN(val))
        return metric.raw;
    if (metric.unit === "KiB") {
        return (val / 1024).toFixed(1);
    }
    if (metric.unit === "bytes") {
        return (val / (1024 * 1024)).toFixed(1);
    }
    if (metric.unit === "MiB") {
        return val.toFixed(1);
    }
    return metric.raw;
}
function formatTimeToSeconds(metric) {
    if (!metric)
        return "-";
    const val = Number(metric.value);
    if (isNaN(val))
        return metric.raw;
    if (metric.unit === "milliseconds") {
        return (val / 1000).toFixed(2);
    }
    if (metric.unit === "seconds") {
        return val.toFixed(2);
    }
    return metric.raw;
}
function parseMetricToNumber(metric) {
    if (!metric)
        return 0;
    const val = Number(metric.value);
    if (isNaN(val))
        return 0;
    if (metric.unit === "milliseconds")
        return val / 1000;
    if (metric.unit === "KiB")
        return val / 1024;
    if (metric.unit === "bytes")
        return val / (1024 * 1024);
    return val;
}
function calculateSummaryStats(reports) {
    let sumTotalTime = 0;
    let sumCheckTime = 0;
    let peakMemory = 0;
    for (const report of reports) {
        const totalTime = parseMetricToNumber(report.metrics.totalTime);
        const checkTime = parseMetricToNumber(report.metrics.checkTime);
        const memory = parseMetricToNumber(report.metrics.memoryUsed || report.metrics.memory);
        sumTotalTime += totalTime;
        sumCheckTime += checkTime;
        peakMemory = Math.max(peakMemory, memory);
    }
    const checkTimeShare = sumTotalTime > 0 ? (sumCheckTime / sumTotalTime) * 100 : 0;
    return {
        totalConfigs: reports.length,
        sumTotalTimeSeconds: sumTotalTime,
        sumCheckTimeSeconds: sumCheckTime,
        checkTimeSharePercent: checkTimeShare,
        peakMemoryMiB: peakMemory,
    };
}
/**
 * Identifies the project a report was run on: its root folder plus the `-p`
 * tsconfig, when one was given. `targetName` is only the folder's basename,
 * so it is not unique (`apps/web` and `libs/web` are both "web").
 */
function projectKey(report) {
    const root = report.targetRoot || report.targetName;
    // `-p` is relative to the root; resolving it makes `./tsconfig.json`
    // and `tsconfig.json` the same project.
    const project = report.project ? (0, node_path_1.resolve)(root, report.project) : "";
    return JSON.stringify([root, project]);
}
/** When the run finished, in ms since the epoch; -Infinity when unknown. */
function runTime(report) {
    const time = Date.parse(report.generatedAt);
    return Number.isNaN(time) ? -Infinity : time;
}
/**
 * Row names for the summary table: `targetName` (plus the `-p` tsconfig),
 * or the root folder relative to the current directory when several
 * projects share that name.
 */
function tableNames(reports) {
    const withProject = (name, report) => report.project ? `${name}/${report.project}` : name;
    const names = reports.map((report) => withProject(report.targetName, report));
    const counts = new Map();
    for (const name of names)
        counts.set(name, (counts.get(name) ?? 0) + 1);
    return reports.map((report, index) => counts.get(names[index]) > 1 && report.targetRoot
        ? withProject((0, node_path_1.relative)(node_process_1.default.cwd(), report.targetRoot) || ".", report)
        : names[index]);
}
async function loadTemplate(templatePath) {
    try {
        return await (0, promises_1.readFile)(templatePath, "utf8");
    }
    catch (error) {
        console.warn(`Warning: Template file not found at ${templatePath}`);
        return "";
    }
}
async function runAggregateCli(args) {
    let options;
    try {
        options = parseArgs(args);
    }
    catch (error) {
        console.error(error.message);
        printUsage();
        node_process_1.default.exit(1);
    }
    const reportFiles = [];
    for (const path of options.inputPaths) {
        try {
            const pathStat = await (0, promises_1.stat)(path);
            if (pathStat.isFile()) {
                reportFiles.push(path);
            }
            else if (pathStat.isDirectory()) {
                await findReports(path, options.recursive, reportFiles);
            }
        }
        catch (error) {
            console.error(`Error checking path ${path}: ${error.message}`);
        }
    }
    const uniqueReportFiles = Array.from(new Set(reportFiles));
    if (uniqueReportFiles.length === 0) {
        console.log("No diagnostics report files (*-ts-diagnostics.json) found.");
        node_process_1.default.exit(0);
    }
    console.log(`Found ${uniqueReportFiles.length} report file(s). Reading data...`);
    const reports = [];
    for (const file of uniqueReportFiles) {
        try {
            const content = await (0, promises_1.readFile)(file, "utf8");
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === "object" && "schemaVersion" in parsed && "metrics" in parsed) {
                reports.push(parsed);
            }
            else {
                console.warn(`Skipping invalid diagnostic report file: ${file}`);
            }
        }
        catch (error) {
            console.error(`Error reading or parsing ${file}: ${error.message}`);
        }
    }
    if (reports.length === 0) {
        console.log("No valid TypeScript diagnostic reports collected.");
        node_process_1.default.exit(0);
    }
    // Deduplicate: keep the most recent run of each project.
    const latestByProject = new Map();
    for (const report of reports) {
        const key = projectKey(report);
        const existing = latestByProject.get(key);
        if (!existing || runTime(report) > runTime(existing)) {
            latestByProject.set(key, report);
        }
    }
    const deduplicatedReports = [...latestByProject.values()];
    deduplicatedReports.sort((a, b) => a.targetName.localeCompare(b.targetName) ||
        (a.targetRoot ?? "").localeCompare(b.targetRoot ?? "") ||
        (a.project ?? "").localeCompare(b.project ?? ""));
    const summaryStats = calculateSummaryStats(deduplicatedReports);
    const aggregated = {
        schemaVersion: 1,
        generatedAt: "aggregated", // Static timestamp for aggregation (timestamps kept in individual reports)
        reportCount: deduplicatedReports.length,
        reports: deduplicatedReports,
    };
    const outputDir = (0, node_path_1.dirname)(options.outputFile);
    await (0, promises_1.mkdir)(outputDir, { recursive: true });
    await (0, promises_1.writeFile)(options.outputFile, JSON.stringify(aggregated, null, 2) + "\n", "utf8");
    console.log(`\nAggregated JSON report successfully written to:\n  ${options.outputFile}\n`);
    // Show deduplication info
    if (reports.length > deduplicatedReports.length) {
        console.log(`Deduplication: ${reports.length} reports => ${deduplicatedReports.length} unique projects (-${reports.length - deduplicatedReports.length}, kept the latest run of each)\n`);
    }
    // Output visual summary table
    const names = tableNames(deduplicatedReports);
    const tableData = deduplicatedReports.map((r, index) => {
        const m = r.metrics;
        return {
            "Target Name": names[index],
            "Mode": r.mode,
            "Files": m.files?.value ?? "-",
            "Total Time (s)": formatTimeToSeconds(m.totalTime),
            "Check Time (s)": formatTimeToSeconds(m.checkTime),
            "Memory (MiB)": formatMemoryToMiB(m.memoryUsed || m.memory),
        };
    });
    console.table(tableData);
    // Summary statistics
    console.log("\n=== Summary Statistics ===");
    console.log(`Total Configs: ${summaryStats.totalConfigs}`);
    console.log(`Summed Total Time: ${summaryStats.sumTotalTimeSeconds.toFixed(2)}s`);
    console.log(`Summed Check Time: ${summaryStats.sumCheckTimeSeconds.toFixed(2)}s`);
    console.log(`Check-Time Share: ${summaryStats.checkTimeSharePercent.toFixed(1)}%`);
    console.log(`Peak Memory: ${Math.round(summaryStats.peakMemoryMiB)} MiB`);
    // --- HTML generation ---
    try {
        const templatePath = (0, node_path_1.resolve)(__dirname, "theme", "layouts", "list-layout.html");
        const template = await loadTemplate(templatePath);
        if (template) {
            const sharedStyles = await loadTemplate((0, node_path_1.resolve)(__dirname, "theme", "design-tokens.css"));
            const sharedScript = await loadTemplate((0, node_path_1.resolve)(__dirname, "theme", "shared-report.js"));
            const html = (0, serialize_for_script_1.injectScriptData)((0, theme_splice_1.spliceMarkerBlock)((0, theme_splice_1.spliceMarkerBlock)(template, "SHARED_STYLES", sharedStyles), "SHARED_SCRIPT", sharedScript), "AGGREGATED_REPORT", aggregated);
            const htmlPath = options.outputFile.replace(/\.json$/i, ".html");
            await (0, promises_1.writeFile)(htmlPath, html, "utf8");
            console.log(`\nHTML report generated at:\n  ${htmlPath}\n`);
        }
        else {
            console.log("\nSkipped HTML generation: template not found.");
        }
    }
    catch (error) {
        console.warn(`Warning: Failed to generate HTML report: ${error.message}`);
    }
}
// Allow running this file directly (the `ts-diagnostics-aggregate` bin).
if (require.main === module) {
    runAggregateCli(node_process_1.default.argv.slice(2)).catch((error) => {
        console.error("Unhandled error:", error);
        node_process_1.default.exit(1);
    });
}
