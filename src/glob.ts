import process from "node:process";
import { globSync } from "tinyglobby";

const GLOB_CHARACTERS = /[*?[\]{}]/;

export function isGlobPattern(path: string): boolean {
    return GLOB_CHARACTERS.test(path);
}

export interface ExpandGlobOptions {
    /** Match directories only (default: files and directories). */
    onlyDirectories?: boolean;
    cwd?: string;
}

/**
 * Expands a glob pattern in-process (no shell involved), so patterns behave
 * the same on every platform and cannot execute shell syntax.
 *
 * Returns matches relative to `cwd`, sorted, without trailing slashes.
 * `node_modules` and `.git` are never traversed.
 */
export function expandGlobPattern(
    pattern: string,
    options: ExpandGlobOptions = {},
): string[] {
    const normalizedPattern =
        process.platform === "win32"
            ? pattern.replace(/\\/g, "/")
            : pattern;

    const matches = globSync(normalizedPattern, {
        cwd: options.cwd ?? process.cwd(),
        onlyDirectories: options.onlyDirectories ?? false,
        onlyFiles: false,
        expandDirectories: false,
        ignore: ["**/node_modules/**", "**/.git/**"],
    });

    return [...new Set(matches.map((match) => match.replace(/\/+$/, "")))]
        .filter(Boolean)
        .sort();
}
