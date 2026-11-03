#!/usr/bin/env node

import { existsSync } from "node:fs";
import process from "node:process";
import { auditTsconfigSettings, applyTsconfigFixes, printFixReport } from "./tsconfig-checks";

interface CliOptions {
    workspaceRoot: string;
    filter?: string;
    dryRun: boolean;
}

function printUsage(): void {
    console.log(`
Usage:
  tsc-diagnostics fix-tsconfig <workspace-root> [options]

Runs tsconfig performance audit and applies available auto-fixes.

Arguments:
  <workspace-root>          Root folder where tsconfig files are discovered

Options:
  -f, --filter <text>       Only include configs with paths matching text
  --dry-run                 Show planned changes without writing files
  -h, --help                Show this help message

Examples:
  tsc-diagnostics fix-tsconfig .
  tsc-diagnostics fix-tsconfig . --dry-run
  tsc-diagnostics fix-tsconfig . --filter packages/my-lib
`.trim());
}

function parseArgs(argv: string[]): CliOptions {
    if (argv.includes("-h") || argv.includes("--help")) {
        printUsage();
        process.exit(0);
    }

    const positional: string[] = [];
    let filter: string | undefined;
    let dryRun = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === "-f" || arg === "--filter") {
            if (!argv[i + 1] || argv[i + 1].startsWith("-")) {
                throw new Error("Missing value for --filter option");
            }
            filter = argv[++i];
            continue;
        }

        if (arg === "--dry-run") {
            dryRun = true;
            continue;
        }

        if (arg.startsWith("-")) {
            throw new Error(`Unknown option: ${arg}`);
        }

        positional.push(arg);
    }

    if (positional.length === 0) {
        throw new Error(
            "Missing required argument: <workspace-root>\n" +
            "Run 'tsc-diagnostics fix-tsconfig --help' for usage information."
        );
    }

    return {
        workspaceRoot: positional[0],
        filter,
        dryRun,
    };
}

export async function runFixTsconfigCli(args: string[]): Promise<void> {
    let options: CliOptions;
    try {
        options = parseArgs(args);
    } catch (error) {
        console.error((error as Error).message);
        printUsage();
        process.exit(1);
    }

    if (!existsSync(options.workspaceRoot)) {
        console.error(`Workspace root not found: ${options.workspaceRoot}`);
        process.exit(1);
    }

    console.log("\nAuditing tsconfig settings...");

    const report = auditTsconfigSettings({
        workspaceRoot: options.workspaceRoot,
        filter: options.filter,
    });

    const fixReport = applyTsconfigFixes({
        workspaceRoot: options.workspaceRoot,
        report,
        dryRun: options.dryRun,
    });

    printFixReport(fixReport);
}
