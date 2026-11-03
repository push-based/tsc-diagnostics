#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFixTsconfigCli = runFixTsconfigCli;
const node_fs_1 = require("node:fs");
const node_process_1 = __importDefault(require("node:process"));
const tsconfig_checks_1 = require("./tsconfig-checks");
function printUsage() {
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
function parseArgs(argv) {
    if (argv.includes("-h") || argv.includes("--help")) {
        printUsage();
        node_process_1.default.exit(0);
    }
    const positional = [];
    let filter;
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
        throw new Error("Missing required argument: <workspace-root>\n" +
            "Run 'tsc-diagnostics fix-tsconfig --help' for usage information.");
    }
    return {
        workspaceRoot: positional[0],
        filter,
        dryRun,
    };
}
async function runFixTsconfigCli(args) {
    let options;
    try {
        options = parseArgs(args);
    }
    catch (error) {
        console.error(error.message);
        printUsage();
        node_process_1.default.exit(1);
    }
    if (!(0, node_fs_1.existsSync)(options.workspaceRoot)) {
        console.error(`Workspace root not found: ${options.workspaceRoot}`);
        node_process_1.default.exit(1);
    }
    console.log("\nAuditing tsconfig settings...");
    const report = (0, tsconfig_checks_1.auditTsconfigSettings)({
        workspaceRoot: options.workspaceRoot,
        filter: options.filter,
    });
    const fixReport = (0, tsconfig_checks_1.applyTsconfigFixes)({
        workspaceRoot: options.workspaceRoot,
        report,
        dryRun: options.dryRun,
    });
    (0, tsconfig_checks_1.printFixReport)(fixReport);
}
