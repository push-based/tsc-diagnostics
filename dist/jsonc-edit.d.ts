/**
 * Small, comment-preserving edits to JSON-with-comments files such as
 * tsconfig.json. Only the inserted or replaced text changes: comments,
 * formatting, line endings and trailing commas elsewhere stay as they were.
 *
 * Uses TypeScript's own JSON parser, so it accepts exactly what `tsc` does.
 */
export declare class JsoncEditError extends Error {
}
/**
 * Sets the value at `path` (e.g. `["compilerOptions", "incremental"]`),
 * creating missing objects along the way.
 */
export declare function setJsoncValue(text: string, path: readonly string[], value: unknown): string;
/** Appends `item` to the array at `path`, creating the array if it is missing. */
export declare function appendJsoncArrayItem(text: string, path: readonly string[], item: unknown): string;
