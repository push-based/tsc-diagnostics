import ts from "typescript";

/**
 * Small, comment-preserving edits to JSON-with-comments files such as
 * tsconfig.json. Only the inserted or replaced text changes: comments,
 * formatting, line endings and trailing commas elsewhere stay as they were.
 *
 * Uses TypeScript's own JSON parser, so it accepts exactly what `tsc` does.
 */

export class JsoncEditError extends Error {}

type JsonContainer = ts.ObjectLiteralExpression | ts.ArrayLiteralExpression;

interface TextEdit {
    offset: number;
    length: number;
    content: string;
}

interface JsoncDocument {
    text: string;
    sourceFile: ts.JsonSourceFile;
    root: ts.ObjectLiteralExpression;
    eol: string;
    indentUnit: string;
}

function parseDocument(text: string): JsoncDocument {
    const { error } = ts.parseConfigFileTextToJson("tsconfig.json", text);
    if (error) {
        throw new JsoncEditError(
            `the file is not valid JSON (${ts.flattenDiagnosticMessageText(error.messageText, " ")})`,
        );
    }

    const sourceFile = ts.parseJsonText("tsconfig.json", text);
    const root = sourceFile.statements[0]?.expression;
    if (!root || !ts.isObjectLiteralExpression(root)) {
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

function applyEdits(text: string, edits: TextEdit[]): string {
    return [...edits]
        .sort((a, b) => b.offset - a.offset)
        .reduce(
            (result, edit) =>
                result.slice(0, edit.offset) + edit.content + result.slice(edit.offset + edit.length),
            text,
        );
}

function lineStart(text: string, position: number): number {
    return text.lastIndexOf("\n", position - 1) + 1;
}

function lineIndent(text: string, position: number): string {
    return /^[ \t]*/.exec(text.slice(lineStart(text, position)))?.[0] ?? "";
}

function isFirstOnLine(text: string, position: number): boolean {
    return text.slice(lineStart(text, position), position).trim() === "";
}

function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const name = property.name;
    return ts.isStringLiteral(name) || ts.isIdentifier(name) || ts.isNumericLiteral(name)
        ? name.text
        : undefined;
}

/** The last property with this name wins, as in TypeScript. */
function findProperty(
    object: ts.ObjectLiteralExpression,
    name: string,
): ts.PropertyAssignment | undefined {
    let found: ts.PropertyAssignment | undefined;
    for (const property of object.properties) {
        if (propertyName(property) === name) {
            found = property as ts.PropertyAssignment;
        }
    }
    return found;
}

function inlineJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(inlineJson).join(", ")}]`;
    }
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value).map(
            ([key, entry]) => `${JSON.stringify(key)}: ${inlineJson(entry)}`,
        );
        return `{ ${entries.join(", ")} }`;
    }
    return JSON.stringify(value);
}

/** Serializes `value` for a line starting at `indent`, or on one line when `indent` is null. */
function serialize(document: JsoncDocument, value: unknown, indent: string | null): string {
    if (indent === null) return inlineJson(value);
    return JSON.stringify(value, null, document.indentUnit)
        .split("\n")
        .join(document.eol + indent);
}

/**
 * Adds an entry at the end of an object or array. Multi-line containers get
 * a new line in the existing indentation; one-line containers stay on one line.
 */
function insertEntry(
    document: JsoncDocument,
    container: JsonContainer,
    render: (indent: string | null) => string,
): string {
    const { text, sourceFile, eol, indentUnit } = document;
    const elements: ts.NodeArray<ts.Node> = ts.isObjectLiteralExpression(container)
        ? container.properties
        : container.elements;
    const open = container.getStart(sourceFile);
    const close = container.end - 1;
    const first = elements[0];
    const last = elements[elements.length - 1];
    const spansLines = text.slice(open, close).includes("\n");

    if (spansLines && isFirstOnLine(text, close)) {
        const closeIndent = lineIndent(text, close);
        const indent =
            first && isFirstOnLine(text, first.getStart(sourceFile))
                ? lineIndent(text, first.getStart(sourceFile))
                : closeIndent + indentUnit;
        const edits: TextEdit[] = [{
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
function walk(
    document: JsoncDocument,
    path: readonly string[],
): { parent: ts.ObjectLiteralExpression; key: string; missing?: string[] } {
    let parent = document.root;
    for (let index = 0; index < path.length - 1; index++) {
        const property = findProperty(parent, path[index]);
        if (!property) {
            return { parent, key: path[index], missing: path.slice(index + 1) };
        }
        if (!ts.isObjectLiteralExpression(property.initializer)) {
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
export function setJsoncValue(text: string, path: readonly string[], value: unknown): string {
    if (path.length === 0) throw new JsoncEditError("empty path");
    const document = parseDocument(text);
    const { parent, key, missing } = walk(document, path);
    const nestedValue = (missing ?? []).reduceRight<unknown>(
        (inner, name) => ({ [name]: inner }),
        value,
    );

    const existing = missing ? undefined : findProperty(parent, key);
    if (existing) {
        const start = existing.initializer.getStart(document.sourceFile);
        return applyEdits(text, [{
            offset: start,
            length: existing.initializer.end - start,
            content: serialize(document, value, lineIndent(text, start)),
        }]);
    }

    return insertEntry(
        document,
        parent,
        (indent) => `${JSON.stringify(key)}: ${serialize(document, nestedValue, indent)}`,
    );
}

/** Appends `item` to the array at `path`, creating the array if it is missing. */
export function appendJsoncArrayItem(text: string, path: readonly string[], item: unknown): string {
    if (path.length === 0) throw new JsoncEditError("empty path");
    const document = parseDocument(text);
    const { parent, key, missing } = walk(document, path);
    const existing = missing ? undefined : findProperty(parent, key);

    if (!existing) {
        return setJsoncValue(text, path, [item]);
    }
    if (!ts.isArrayLiteralExpression(existing.initializer)) {
        throw new JsoncEditError(`"${path.join(".")}" is not an array`);
    }
    return insertEntry(document, existing.initializer, (indent) => serialize(document, item, indent));
}
