"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsoncEditError = void 0;
exports.setJsoncValue = setJsoncValue;
exports.appendJsoncArrayItem = appendJsoncArrayItem;
const typescript_1 = __importDefault(require("typescript"));
/**
 * Small, comment-preserving edits to JSON-with-comments files such as
 * tsconfig.json. Only the inserted or replaced text changes: comments,
 * formatting, line endings and trailing commas elsewhere stay as they were.
 *
 * Uses TypeScript's own JSON parser, so it accepts exactly what `tsc` does.
 */
class JsoncEditError extends Error {
}
exports.JsoncEditError = JsoncEditError;
function parseDocument(text) {
    const { error } = typescript_1.default.parseConfigFileTextToJson("tsconfig.json", text);
    if (error) {
        throw new JsoncEditError(`the file is not valid JSON (${typescript_1.default.flattenDiagnosticMessageText(error.messageText, " ")})`);
    }
    const sourceFile = typescript_1.default.parseJsonText("tsconfig.json", text);
    const root = sourceFile.statements[0]?.expression;
    if (!root || !typescript_1.default.isObjectLiteralExpression(root)) {
        throw new JsoncEditError("the file does not contain a JSON object");
    }
    return {
        text,
        sourceFile,
        root,
        eol: text.includes("\r\n") ? "\r\n" : "\n",
        // The first indented property or string tells us the file's indent unit.
        indentUnit: /^([ \t]+)"/m.exec(text)?.[1] ?? "  ",
    };
}
function applyEdits(text, edits) {
    return [...edits]
        .sort((a, b) => b.offset - a.offset)
        .reduce((result, edit) => result.slice(0, edit.offset) + edit.content + result.slice(edit.offset + edit.length), text);
}
function lineStart(text, position) {
    return text.lastIndexOf("\n", position - 1) + 1;
}
function lineIndent(text, position) {
    return /^[ \t]*/.exec(text.slice(lineStart(text, position)))?.[0] ?? "";
}
function isFirstOnLine(text, position) {
    return text.slice(lineStart(text, position), position).trim() === "";
}
function propertyName(property) {
    if (!typescript_1.default.isPropertyAssignment(property))
        return undefined;
    const name = property.name;
    return typescript_1.default.isStringLiteral(name) || typescript_1.default.isIdentifier(name) || typescript_1.default.isNumericLiteral(name)
        ? name.text
        : undefined;
}
/** The last property with this name wins, as in TypeScript. */
function findProperty(object, name) {
    let found;
    for (const property of object.properties) {
        if (propertyName(property) === name) {
            found = property;
        }
    }
    return found;
}
function inlineJson(value) {
    if (Array.isArray(value)) {
        return `[${value.map(inlineJson).join(", ")}]`;
    }
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}: ${inlineJson(entry)}`);
        return `{ ${entries.join(", ")} }`;
    }
    return JSON.stringify(value);
}
/** Serializes `value` for a line starting at `indent`, or on one line when `indent` is null. */
function serialize(document, value, indent) {
    if (indent === null)
        return inlineJson(value);
    return JSON.stringify(value, null, document.indentUnit)
        .split("\n")
        .join(document.eol + indent);
}
/**
 * Adds an entry at the end of an object or array. Multi-line containers get
 * a new line in the existing indentation; one-line containers stay on one line.
 */
function insertEntry(document, container, render) {
    const { text, sourceFile, eol, indentUnit } = document;
    const elements = typescript_1.default.isObjectLiteralExpression(container)
        ? container.properties
        : container.elements;
    const open = container.getStart(sourceFile);
    const close = container.end - 1;
    const first = elements[0];
    const last = elements[elements.length - 1];
    const spansLines = text.slice(open, close).includes("\n");
    if (spansLines && isFirstOnLine(text, close)) {
        const closeIndent = lineIndent(text, close);
        const indent = first && isFirstOnLine(text, first.getStart(sourceFile))
            ? lineIndent(text, first.getStart(sourceFile))
            : closeIndent + indentUnit;
        const edits = [{
                offset: lineStart(text, close),
                length: 0,
                content: `${indent}${render(indent)}${elements.hasTrailingComma ? "," : ""}${eol}`,
            }];
        if (last && !elements.hasTrailingComma) {
            // Right after the value, so a comment following it stays on its line.
            edits.push({ offset: last.end, length: 0, content: "," });
        }
        return applyEdits(text, edits);
    }
    if (last) {
        return applyEdits(text, [{ offset: last.end, length: 0, content: `, ${render(null)}` }]);
    }
    // Empty container such as `{}`: open it up onto its own lines.
    const outerIndent = lineIndent(text, open);
    const indent = outerIndent + indentUnit;
    const inside = text.slice(open + 1, close);
    return applyEdits(text, [{
            offset: open + 1,
            length: inside.trim() === "" ? inside.length : 0,
            content: `${eol}${indent}${render(indent)}${eol}${outerIndent}`,
        }]);
}
/** Walks `path` (all but its last key) through nested objects. */
function walk(document, path) {
    let parent = document.root;
    for (let index = 0; index < path.length - 1; index++) {
        const property = findProperty(parent, path[index]);
        if (!property) {
            return { parent, key: path[index], missing: path.slice(index + 1) };
        }
        if (!typescript_1.default.isObjectLiteralExpression(property.initializer)) {
            throw new JsoncEditError(`"${path.slice(0, index + 1).join(".")}" is not an object`);
        }
        parent = property.initializer;
    }
    return { parent, key: path[path.length - 1] };
}
/**
 * Sets the value at `path` (e.g. `["compilerOptions", "incremental"]`),
 * creating missing objects along the way.
 */
function setJsoncValue(text, path, value) {
    if (path.length === 0)
        throw new JsoncEditError("empty path");
    const document = parseDocument(text);
    const { parent, key, missing } = walk(document, path);
    const nestedValue = (missing ?? []).reduceRight((inner, name) => ({ [name]: inner }), value);
    const existing = missing ? undefined : findProperty(parent, key);
    if (existing) {
        const start = existing.initializer.getStart(document.sourceFile);
        return applyEdits(text, [{
                offset: start,
                length: existing.initializer.end - start,
                content: serialize(document, value, lineIndent(text, start)),
            }]);
    }
    return insertEntry(document, parent, (indent) => `${JSON.stringify(key)}: ${serialize(document, nestedValue, indent)}`);
}
/** Appends `item` to the array at `path`, creating the array if it is missing. */
function appendJsoncArrayItem(text, path, item) {
    if (path.length === 0)
        throw new JsoncEditError("empty path");
    const document = parseDocument(text);
    const { parent, key, missing } = walk(document, path);
    const existing = missing ? undefined : findProperty(parent, key);
    if (!existing) {
        return setJsoncValue(text, path, [item]);
    }
    if (!typescript_1.default.isArrayLiteralExpression(existing.initializer)) {
        throw new JsoncEditError(`"${path.join(".")}" is not an array`);
    }
    return insertEntry(document, existing.initializer, (indent) => serialize(document, item, indent));
}
