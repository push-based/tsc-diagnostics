#!/usr/bin/env node

import { readdir, stat, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, basename, dirname } from "node:path";
import process from "node:process";
import { DiagnosticsResult } from "./diagnostic.types";
import { injectScriptData } from "./serialize-for-script";
import { spliceMarkerBlock } from "./theme-splice";

interface CliOptions {
    inputPaths: string[];
    outputDir: string;
    targetName?: string;
}

function printUsage(): void {
    console.log(`
Usage:
  tsc-diagnostics compare <input-paths...> [options]

Collects all diagnostics JSON reports for a single project from one or more
folders and renders an interactive HTML comparison report showing performance
trends over time.

Arguments:
  <input-paths...>         Folders or JSON files to scan (default: current directory)
                           All reports must belong to the same project (targetName).

Options:
  -o, --output <dir>       Directory to write the comparison report (default: first input path or cwd)
  -n, --name <targetName>  Filter reports by targetName (useful when a folder has mixed projects)
  -h, --help               Show this help message

Examples:
  tsc-diagnostics compare projects/test-lib-1
  tsc-diagnostics compare projects/test-lib-1 -o ./reports
  tsc-diagnostics compare projects/test-lib-1 projects/test-lib-1/ts-diagnostics
`.trim());
}

function parseArgs(argv: string[]): CliOptions {
    if (argv.includes("-h") || argv.includes("--help")) {
        printUsage();
        process.exit(0);
    }

    const inputPaths: string[] = [];
    let outputDir: string | undefined;
    let targetName: string | undefined;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "-o" || arg === "--output") {
            if (!argv[i + 1] || argv[i + 1].startsWith("-")) {
                throw new Error("Missing value for --output option");
            }
            outputDir = argv[++i];
        } else if (arg === "-n" || arg === "--name") {
            if (!argv[i + 1] || argv[i + 1].startsWith("-")) {
                throw new Error("Missing value for --name option");
            }
            targetName = argv[++i];
        } else if (arg.startsWith("-")) {
            throw new Error(`Unknown option: ${arg}`);
        } else {
            inputPaths.push(arg);
        }
    }

    if (inputPaths.length === 0) {
        inputPaths.push(process.cwd());
    }

    return {
        inputPaths: inputPaths.map((p) => resolve(p)),
        outputDir: resolve(outputDir ?? inputPaths[0]),
        targetName,
    };
}

async function findReportFiles(
    dir: string,
    results: string[] = [],
): Promise<string[]> {
    try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (
                    entry.name === "node_modules" ||
                    entry.name === "dist" ||
                    entry.name === ".git" ||
                    entry.name === ".idea" ||
                    entry.name === "tmp"
                ) {
                    continue;
                }
                await findReportFiles(fullPath, results);
            } else if (
                entry.isFile() &&
                entry.name.endsWith(".json") &&
                entry.name.includes("-ts-diagnostics")
            ) {
                results.push(fullPath);
            }
        }
    } catch (error) {
        console.warn(
            `Warning: Could not read directory ${dir}: ${(error as Error).message}`,
        );
    }
    return results;
}

async function loadReport(file: string): Promise<DiagnosticsResult | null> {
    try {
        const content = await readFile(file, "utf8");
        const parsed = JSON.parse(content);
        if (
            parsed &&
            typeof parsed === "object" &&
            "schemaVersion" in parsed &&
            "metrics" in parsed
        ) {
            return parsed as DiagnosticsResult;
        }
        console.warn(`Skipping invalid report: ${file}`);
    } catch (error) {
        console.error(
            `Error reading ${file}: ${(error as Error).message}`,
        );
    }
    return null;
}

export async function runCompareCli(args: string[]): Promise<void> {
    let options: CliOptions;
    try {
        options = parseArgs(args);
    } catch (error) {
        console.error((error as Error).message);
        printUsage();
        process.exit(1);
    }

    // Collect all candidate JSON files from input paths
    const reportFiles: string[] = [];
    for (const inputPath of options.inputPaths) {
        try {
            const s = await stat(inputPath);
            if (s.isFile()) {
                reportFiles.push(inputPath);
            } else if (s.isDirectory()) {
                await findReportFiles(inputPath, reportFiles);
            }
        } catch (error) {
            console.error(
                `Error checking path ${inputPath}: ${(error as Error).message}`,
            );
        }
    }

    const uniqueFiles = Array.from(new Set(reportFiles));

    if (uniqueFiles.length === 0) {
        console.log("No diagnostics JSON files found in the specified paths.");
        process.exit(0);
    }

    // Load and validate reports
    const allReports: DiagnosticsResult[] = [];
    for (const file of uniqueFiles) {
        const report = await loadReport(file);
        if (report) {
            allReports.push(report);
        }
    }

    if (allReports.length === 0) {
        console.log("No valid TypeScript diagnostics reports found.");
        process.exit(0);
    }

    // Filter by targetName if specified
    const filtered = options.targetName
        ? allReports.filter((r) => r.targetName === options.targetName)
        : allReports;

    if (filtered.length === 0) {
        console.log(
            `No reports found matching targetName "${options.targetName}".`,
        );
        console.log(
            `Available project names: ${[...new Set(allReports.map((r) => r.targetName))].join(", ")}`,
        );
        process.exit(1);
    }

    // Warn if multiple projects found (when no filter)
    if (!options.targetName) {
        const projects = [...new Set(filtered.map((r) => r.targetName))];
        if (projects.length > 1) {
            console.warn(
                `Warning: Reports from multiple projects found: ${projects.join(", ")}`,
            );
            console.warn(
                `The comparison report will include all of them. Use --name to filter to a single project.`,
            );
        }
    }

    // Sort reports chronologically
    filtered.sort((a, b) => {
        const dateA = new Date(a.generatedAt ?? a.finishedAt ?? "").getTime();
        const dateB = new Date(b.generatedAt ?? b.finishedAt ?? "").getTime();
        return dateA - dateB;
    });

    const targetName =
        options.targetName ?? filtered[0].targetName ?? "project";

    console.log(
        `Collected ${filtered.length} report(s) for "${targetName}".`,
    );

    // Build a datetime stamp for the output filename
    const now = new Date();
    const dateStamp = now
        .toISOString()
        .replace(/:/g, "-")
        .replace(/\..+$/, "");

    await mkdir(options.outputDir, { recursive: true });

    // Write the aggregated JSON
    const jsonOutputPath = resolve(
        options.outputDir,
        `${targetName}-compare-${dateStamp}.json`,
    );

    const jsonPayload = {
        schemaVersion: 1,
        type: "typescript-performance-history",
        generatedAt: now.toISOString(),
        targetName,
        reports: filtered,
    };

    await writeFile(
        jsonOutputPath,
        JSON.stringify(jsonPayload, null, 2) + "\n",
        "utf8",
    );

    console.log(`\nAggregated JSON written to:\n  ${jsonOutputPath}`);

    // Write the HTML comparison report
    const htmlOutputPath = resolve(
        options.outputDir,
        `${targetName}-compare-${dateStamp}.html`,
    );

    const templatePath = resolve(__dirname, "theme", "layouts", "comparison-layout.html");
    const template = await readFile(templatePath, "utf8");
    const sharedStyles = await readFile(resolve(__dirname, "theme", "design-tokens.css"), "utf8");
    const sharedScript = await readFile(resolve(__dirname, "theme", "shared-report.js"), "utf8");

    const html = injectScriptData(
        spliceMarkerBlock(
            spliceMarkerBlock(template, "SHARED_STYLES", sharedStyles),
            "SHARED_SCRIPT",
            sharedScript,
        ),
        "COMPARE_REPORTS",
        filtered,
    );

    await writeFile(htmlOutputPath, html, "utf8");

    console.log(`HTML comparison report written to:\n  ${htmlOutputPath}`);

    // Print a summary table
    const tableData = filtered.map((r) => {
        const m = r.metrics;
        const getSeconds = (k: string): string => {
            const mv = m[k];
            if (!mv) return "-";
            const val = Number(mv.value);
            if (!Number.isFinite(val)) return String(mv.value);
            if (mv.unit === "milliseconds") return (val / 1000).toFixed(2);
            return val.toFixed(2);
        };
        const getMiB = (): string => {
            const mv = m["memoryUsed"] ?? m["memory"];
            if (!mv) return "-";
            const val = Number(mv.value);
            if (!Number.isFinite(val)) return String(mv.value);
            if (mv.unit === "KiB") return (val / 1024).toFixed(1);
            if (mv.unit === "bytes") return (val / (1024 * 1024)).toFixed(1);
            return val.toFixed(1);
        };
        return {
            "Target": r.targetName,
            "Generated": new Date(r.generatedAt ?? "").toLocaleString(),
            "Total (s)": getSeconds("totalTime"),
            "Check (s)": getSeconds("checkTime"),
            "Memory (MiB)": getMiB(),
            "Types": m["types"]?.value ?? "-",
            "Instantiations": m["instantiations"]?.value ?? "-",
        };
    });

    console.log("\nComparison summary:");
    console.table(tableData);
}

// Allow running this file directly (the `ts-diagnostics-compare` bin).
if (require.main === module) {
    runCompareCli(process.argv.slice(2)).catch((error) => {
        console.error("Unhandled error:", error);
        process.exit(1);
    });
}
