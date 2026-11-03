#!/usr/bin/env node

import process from "node:process";
import { runDiagnosticsMultiCli } from "./ts-diagnostics";
import { runAggregateCli } from "./aggregate-reports";
import { runCompareCli } from "./compare-reports";
import { runListProjectsCli } from "./list-projects";
import { runFixTsconfigCli } from "./fix-tsconfig-cli";

function printMainUsage(): void {
    console.log(`
Usage:
  tsc-diagnostics <command> [options]

Commands:
  diagnostics      Run TypeScript compiler diagnostics on one or more project folders (supports glob patterns)
  aggregate        Collect and aggregate diagnostics JSON reports into one JSON file
  compare          Compare multiple diagnostic runs for a project over time (HTML report)
  fix-tsconfig     Audit and apply tsconfig performance fixes
  list             List all project paths from root tsconfig.json references

Global Options:
  -h, --help    Show help message

Run 'tsc-diagnostics <command> --help' for command-specific options.
`.trim());
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command || command === "-h" || command === "--help") {
        printMainUsage();
        process.exit(0);
    }

    if (command === "diagnostics") {
        await runDiagnosticsMultiCli(args.slice(1));
    } else if (command === "aggregate") {
        await runAggregateCli(args.slice(1));
    } else if (command === "compare") {
        await runCompareCli(args.slice(1));
    } else if (command === "fix-tsconfig") {
        await runFixTsconfigCli(args.slice(1));
    } else if (command === "list") {
        await runListProjectsCli(args.slice(1));
    } else {
        console.error(`Unknown command: ${command}\n`);
        printMainUsage();
        process.exit(1);
    }
}

main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
});
