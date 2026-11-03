export declare function isGlobPattern(path: string): boolean;
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
export declare function expandGlobPattern(pattern: string, options?: ExpandGlobOptions): string[];
