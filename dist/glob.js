"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGlobPattern = isGlobPattern;
exports.expandGlobPattern = expandGlobPattern;
const node_process_1 = __importDefault(require("node:process"));
const tinyglobby_1 = require("tinyglobby");
const GLOB_CHARACTERS = /[*?[\]{}]/;
function isGlobPattern(path) {
    return GLOB_CHARACTERS.test(path);
}
/**
 * Expands a glob pattern in-process (no shell involved), so patterns behave
 * the same on every platform and cannot execute shell syntax.
 *
 * Returns matches relative to `cwd`, sorted, without trailing slashes.
 * `node_modules` and `.git` are never traversed.
 */
function expandGlobPattern(pattern, options = {}) {
    const normalizedPattern = node_process_1.default.platform === "win32"
        ? pattern.replace(/\\/g, "/")
        : pattern;
    const matches = (0, tinyglobby_1.globSync)(normalizedPattern, {
        cwd: options.cwd ?? node_process_1.default.cwd(),
        onlyDirectories: options.onlyDirectories ?? false,
        onlyFiles: false,
        expandDirectories: false,
        ignore: ["**/node_modules/**", "**/.git/**"],
    });
    return [...new Set(matches.map((match) => match.replace(/\/+$/, "")))]
        .filter(Boolean)
        .sort();
}
