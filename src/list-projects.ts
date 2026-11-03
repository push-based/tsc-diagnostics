import { readFile } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import process from "node:process";
import ts from "typescript";

function printUsage(): void {
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

export async function runListProjectsCli(args: string[]): Promise<void> {
    let tsconfigPath = "tsconfig.json";

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-h" || arg === "--help") {
            printUsage();
            process.exit(0);
        } else if (arg === "--tsconfig") {
            tsconfigPath = args[++i];
            if (!tsconfigPath) {
                console.error("Error: --tsconfig requires a path argument");
                process.exit(1);
            }
        }
    }

    const resolvedTsconfig = resolve(process.cwd(), tsconfigPath);

    let raw: string;
    try {
        raw = await readFile(resolvedTsconfig, "utf-8");
    } catch {
        console.error(`Error: Cannot read tsconfig at: ${resolvedTsconfig}`);
        process.exit(1);
    }

    // TypeScript's own parser: accepts comments and trailing commas like tsc does.
    // It needs forward slashes: with `C:\...` it crashes on a file with syntax errors.
    const { config, error } = ts.parseConfigFileTextToJson(resolvedTsconfig.split(sep).join("/"), raw);
    if (error) {
        console.error(
            `Error: Cannot parse ${resolvedTsconfig}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`,
        );
        process.exit(1);
    }
    const parsed = (config ?? {}) as {
        references?: { path: string }[];
        compilerOptions?: { paths?: Record<string, string[]> };
    };

    const references = parsed.references;
    const paths = parsed.compilerOptions?.paths;
    const tsconfigDir = dirname(resolvedTsconfig);
    const collectedPaths: Set<string> = new Set();

    if (references && references.length > 0) {
        console.log(`Project references in ${tsconfigPath}:\n`);
        for (const ref of references) {
            const projectPath = resolve(tsconfigDir, ref.path);
            collectedPaths.add(projectPath);
            console.log(projectPath);
        }
    }

    if (paths && Object.keys(paths).length > 0) {
        if (references && references.length > 0) {
            console.log("");
        }
        console.log(`Paths in ${tsconfigPath}:\n`);
        const uniquePaths: Set<string> = new Set();
        for (const [, pathArray] of Object.entries(paths)) {
            for (const path of pathArray) {
                // Extract base path (remove wildcards like /*)
                const basePath = path.replace(/\/\*$/, "");
                const projectPath = resolve(tsconfigDir, basePath);
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
