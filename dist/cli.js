#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_process_1 = __importDefault(require("node:process"));
const ts_diagnostics_1 = require("./ts-diagnostics");
const aggregate_reports_1 = require("./aggregate-reports");
const compare_reports_1 = require("./compare-reports");
const list_projects_1 = require("./list-projects");
const fix_tsconfig_cli_1 = require("./fix-tsconfig-cli");
function printMainUsage() {
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
async function main() {
    const args = node_process_1.default.argv.slice(2);
    const command = args[0];
    if (!command || command === "-h" || command === "--help") {
        printMainUsage();
        node_process_1.default.exit(0);
    }
    if (command === "diagnostics") {
        await (0, ts_diagnostics_1.runDiagnosticsMultiCli)(args.slice(1));
    }
    else if (command === "aggregate") {
        await (0, aggregate_reports_1.runAggregateCli)(args.slice(1));
    }
    else if (command === "compare") {
        await (0, compare_reports_1.runCompareCli)(args.slice(1));
    }
    else if (command === "fix-tsconfig") {
        await (0, fix_tsconfig_cli_1.runFixTsconfigCli)(args.slice(1));
    }
    else if (command === "list") {
        await (0, list_projects_1.runListProjectsCli)(args.slice(1));
    }
    else {
        console.error(`Unknown command: ${command}\n`);
        printMainUsage();
        node_process_1.default.exit(1);
    }
}
main().catch((error) => {
    console.error("Unhandled error:", error);
    node_process_1.default.exit(1);
});
