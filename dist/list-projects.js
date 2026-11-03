"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runListProjectsCli = runListProjectsCli;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_process_1 = __importDefault(require("node:process"));
const typescript_1 = __importDefault(require("typescript"));
function printUsage() {
    console.log(`
Usage:
  tsc-diagnostics list [options]

Options:
  --tsconfig <path>   Path to root tsconfig.json (default: tsconfig.json in cwd)
  -h, --help          Show help message

Description:
  Lists all project paths from the references array and paths property in a root tsconfig.json.
  Output is one resolved path per line, suitable for copying into the diagnostics command.

Example:
  tsc-diagnostics list
  tsc-diagnostics list --tsconfig ./tsconfig.json
`.trim());
}
async function runListProjectsCli(args) {
    let tsconfigPath = "tsconfig.json";
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-h" || arg === "--help") {
            printUsage();
            node_process_1.default.exit(0);
        }
        else if (arg === "--tsconfig") {
            tsconfigPath = args[++i];
            if (!tsconfigPath) {
                console.error("Error: --tsconfig requires a path argument");
                node_process_1.default.exit(1);
            }
        }
    }
    const resolvedTsconfig = (0, node_path_1.resolve)(node_process_1.default.cwd(), tsconfigPath);
    let raw;
    try {
        raw = await (0, promises_1.readFile)(resolvedTsconfig, "utf-8");
    }
    catch {
        console.error(`Error: Cannot read tsconfig at: ${resolvedTsconfig}`);
        node_process_1.default.exit(1);
    }
    // TypeScript's own parser: accepts comments and trailing commas like tsc does.
    // It needs forward slashes: with `C:\...` it crashes on a file with syntax errors.
    const { config, error } = typescript_1.default.parseConfigFileTextToJson(resolvedTsconfig.split(node_path_1.sep).join("/"), raw);
    if (error) {
        console.error(`Error: Cannot parse ${resolvedTsconfig}: ${typescript_1.default.flattenDiagnosticMessageText(error.messageText, " ")}`);
        node_process_1.default.exit(1);
    }
    const parsed = (config ?? {});
    const references = parsed.references;
    const paths = parsed.compilerOptions?.paths;
    const tsconfigDir = (0, node_path_1.dirname)(resolvedTsconfig);
    const collectedPaths = new Set();
    if (references && references.length > 0) {
        console.log(`Project references in ${tsconfigPath}:\n`);
        for (const ref of references) {
            const projectPath = (0, node_path_1.resolve)(tsconfigDir, ref.path);
            collectedPaths.add(projectPath);
            console.log(projectPath);
        }
    }
    if (paths && Object.keys(paths).length > 0) {
        if (references && references.length > 0) {
            console.log("");
        }
        console.log(`Paths in ${tsconfigPath}:\n`);
        const uniquePaths = new Set();
        for (const [, pathArray] of Object.entries(paths)) {
            for (const path of pathArray) {
                // Extract base path (remove wildcards like /*)
                const basePath = path.replace(/\/\*$/, "");
                const projectPath = (0, node_path_1.resolve)(tsconfigDir, basePath);
                uniquePaths.add(projectPath);
            }
        }
        // Sort and print unique paths
        for (const projectPath of Array.from(uniquePaths).sort()) {
            collectedPaths.add(projectPath);
            console.log(projectPath);
        }
    }
    if (collectedPaths.size === 0) {
        console.log("No project references or paths found in tsconfig.");
    }
}
