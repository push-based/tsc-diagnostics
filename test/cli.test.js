// Tests run against the built package in dist/ (what actually gets published).
// Run with `npm test`, which builds first.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.join(__dirname, "..");
const dist = path.join(repoRoot, "dist");
const cli = path.join(dist, "cli.js");
const typescriptPath = path.dirname(require.resolve("typescript/package.json", { paths: [repoRoot] }));

const { expandGlobPattern, isGlobPattern } = require(path.join(dist, "glob.js"));
const { serializeForScript, injectScriptData } = require(path.join(dist, "serialize-for-script.js"));
const { parseDiagnostics } = require(path.join(dist, "ts-diagnostics.js"));
const { analyzeProjectReport, findCompileErrors } = require(dist);
const { auditTsconfigSettings } = require(path.join(dist, "tsconfig-checks.js"));
const { setJsoncValue, appendJsoncArrayItem } = require(path.join(dist, "jsonc-edit.js"));

const HOSTILE_TYPE = '"</script><img src=x onerror=alert(1)>"';

let workspace;
const extraWorkspaces = [];

/** Creates a temporary folder holding `files` (relative path -> content). */
function tempWorkspace(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ts-diagnostics-test-"));
    extraWorkspaces.push(root);
    for (const [relativePath, content] of Object.entries(files)) {
        const file = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
    return root;
}

function lines(...content) {
    return `${content.join("\n")}\n`;
}

function write(relativePath, content) {
    const file = path.join(workspace, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function createProject(name, source, parent = "packages") {
    write(`${parent}/${name}/tsconfig.json`, JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
        include: ["src"],
    }));
    write(`${parent}/${name}/src/index.ts`, source);
}

function run(file, args, options = {}) {
    const env = { ...process.env };
    delete env.TSD_OUTPUT;
    const result = spawnSync(process.execPath, [file, ...args], {
        cwd: workspace,
        encoding: "utf8",
        env,
        ...options,
    });
    return { ...result, output: `${result.stdout}\n${result.stderr}` };
}

function diagnostics(...args) {
    return run(cli, ["diagnostics", ...args, "--typescript", typescriptPath]);
}

function reportFiles(project, extension, parent = "packages") {
    const base = path.join(workspace, parent, project, "ts-diagnostics");
    if (!fs.existsSync(base)) return [];
    return fs.readdirSync(base).flatMap((stamp) =>
        fs.readdirSync(path.join(base, stamp))
            .filter((file) => file.endsWith(`-ts-diagnostics.${extension}`))
            .map((file) => path.join(base, stamp, file)));
}

function latestReportFile(project, extension) {
    // Run folders are named by timestamp, so they sort chronologically.
    const file = reportFiles(project, extension).sort().at(-1);
    assert.ok(file, `a ${extension} report exists for ${project}`);
    return file;
}

// Runs the HTML report's own script against a minimal stand-in for the DOM
// (Observable Plot, loaded from a CDN in the browser, is stubbed out) and
// returns a lookup for the elements the script wrote to.
function renderReportPage(htmlFile) {
    const html = fs.readFileSync(htmlFile, "utf8");
    const data = JSON.parse(html.match(/window\.__PB_REPORT_DATA__ = (.*?); \} catch/s)[1]);
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
        .replace(/^\s*import .*$/m, "");

    // Elements start with the classes the markup gives them (e.g. "hidden").
    const markupClasses = new Map();
    for (const [tag, id] of html.matchAll(/<[a-z]+\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
        markupClasses.set(`#${id}`, (tag.match(/\bclass="([^"]*)"/)?.[1] ?? "").split(/\s+/));
    }

    const elements = new Map();
    const createElement = (selector) => {
        const classes = new Set(markupClasses.get(selector));
        return {
            innerHTML: "",
            textContent: "",
            value: "time",
            dataset: {},
            classList: {
                add: (name) => classes.add(name),
                remove: (name) => classes.delete(name),
                contains: (name) => classes.has(name),
            },
            setAttribute() {},
            replaceChildren() {},
            appendChild() {},
            append() {},
            addEventListener() {},
        };
    };
    const element = (selector) => {
        if (!elements.has(selector)) elements.set(selector, createElement(selector));
        return elements.get(selector);
    };

    vm.runInNewContext(script, {
        window: { __PB_REPORT_DATA__: data },
        document: { querySelector: element, getElementById: (id) => element(`#${id}`), createElement: () => createElement() },
        Plot: new Proxy({}, { get: (_, name) => (name === "plot" ? () => createElement() : () => ({})) }),
    });
    return element;
}

function aggregate(...args) {
    const output = path.join(workspace, `agg-${Math.random().toString(36).slice(2)}.json`);
    const result = run(cli, ["aggregate", ...args, "-o", output]);
    assert.equal(result.status, 0, result.output);
    const html = fs.readFileSync(output.replace(/\.json$/, ".html"), "utf8");
    return { result, aggregated: JSON.parse(fs.readFileSync(output, "utf8")), html };
}

// A report as `diagnostics` writes it, trimmed to what `aggregate` reads.
function writeReport(relativeDir, report) {
    const full = {
        schemaVersion: 1,
        mode: "diagnostics",
        targetName: path.basename(report.targetRoot),
        command: [],
        cwd: report.targetRoot,
        exitCode: 0,
        signal: null,
        stdout: "",
        stderr: "",
        ...report,
        startedAt: report.generatedAt,
        finishedAt: report.generatedAt,
        metrics: {
            files: { raw: String(report.files), value: report.files, unit: "count" },
            totalTime: { raw: `${report.seconds}s`, value: report.seconds, unit: "seconds" },
        },
    };
    write(path.join(relativeDir, `${full.targetName}-ts-diagnostics.json`), JSON.stringify(full));
}

// The last path segments of a root, independent of the OS and temp folder.
function tail(root, segments = 2) {
    return root.split(/[\\/]/).slice(-segments).join("/");
}

// Runs the label helpers embedded in the HTML list report.
function htmlReportLabels(html, reports) {
    const start = html.indexOf("function reportLabel(");
    const end = html.indexOf("let currentDetailReports");
    assert.ok(start > 0 && end > start, "label helpers found in the HTML report");
    const context = { reports };
    vm.runInNewContext(`${html.slice(start, end)}\nresult = reportLabels(reports);`, context);
    return context.result;
}

before(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ts-diagnostics-test-"));
    createProject("app-a", "export const a: number = 1;\n");
    createProject("app-b", "export const b: string = 'b';\n");
    createProject("broken", [
        `export const z: ${HOSTILE_TYPE} = "a";`,
        `export const w: "$'tail$&" = "b";`,
        "",
    ].join("\n"));
});

after(() => {
    for (const root of [workspace, ...extraWorkspaces]) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

describe("glob expansion", () => {
    test("detects glob patterns", () => {
        assert.equal(isGlobPattern("packages/*"), true);
        assert.equal(isGlobPattern("packages/{a,b}"), true);
        assert.equal(isGlobPattern("packages/app-a"), false);
    });

    test("matches directories, sorted, without trailing slashes", () => {
        const matches = expandGlobPattern("packages/app-*", { cwd: workspace, onlyDirectories: true });
        assert.deepEqual(matches, ["packages/app-a", "packages/app-b"]);
    });

    test("never runs shell syntax inside a pattern", () => {
        const marker = path.join(workspace, "INJECTED");
        const matches = expandGlobPattern("packages/*;touch INJECTED", { cwd: workspace });
        assert.deepEqual(matches, []);
        assert.equal(fs.existsSync(marker), false);
    });
});

describe("script-safe serialization", () => {
    test("escapes </script> and round-trips through JSON.parse", () => {
        const value = { stdout: `error: ${HOSTILE_TYPE}   <!-- x` };
        const serialized = serializeForScript(value);
        assert.equal(serialized.includes("</script>"), false);
        assert.equal(serialized.includes("<!--"), false);
        assert.equal(serialized.includes(" "), false);
        assert.deepEqual(JSON.parse(serialized), value);
    });

    test("inserts $-sequences literally", () => {
        const html = injectScriptData("<script>x = {{DATA}};</script>", "DATA", { s: "$'$&$`" });
        assert.equal(html, '<script>x = {"s":"$\'$&$`"};</script>');
    });

    test("throws when the placeholder is missing", () => {
        assert.throws(() => injectScriptData("<p></p>", "DATA", {}), /DATA/);
    });
});

describe("metric parsing", () => {
    const ESC = "\u001b";
    const STATISTICS = [
        "Files:                          8",
        "Memory used:               51050K",
        "Check time:                 0.04s",
        "Total time:                 0.39s",
    ];
    const STATISTIC_KEYS = ["files", "memoryUsed", "checkTime", "totalTime"];
    const PLAIN_ERRORS = [
        "src/chain.ts(2,14): error TS2322: Type '{ a: number; }' is not assignable to type '{ a: string; }'.",
        "  Types of property 'a' are incompatible.",
        "    Type 'number' is not assignable to type 'string'.",
        "src/index.ts(4,5): error TS2322: Type '2' is not assignable to type '1'.",
        "error TS5083: Cannot read file '/missing/tsconfig.json'.",
    ];
    const PRETTY_ERRORS = [
        `${ESC}[96msrc/index.ts${ESC}[0m:${ESC}[93m4${ESC}[0m:${ESC}[93m5${ESC}[0m - ${ESC}[91merror${ESC}[0m${ESC}[90m TS2322: ${ESC}[0mType '2' is not assignable to type '1'.`,
        "",
        `${ESC}[7m4${ESC}[0m let x: 1`,
        "4 let x: 1",
        "      ~",
        "",
        "Found 1 error in src/index.ts:4",
        "Found 2 errors in the same file, starting at: src/index.ts:1",
        "",
    ];

    test("reads only the statistics, not compile errors or their continuation lines", () => {
        const metrics = parseDiagnostics([...PLAIN_ERRORS, ...STATISTICS].join("\n"));
        assert.deepEqual(Object.keys(metrics), STATISTIC_KEYS);
        assert.deepEqual(metrics.totalTime, { raw: "0.39s", value: 0.39, unit: "seconds" });
    });

    test("ignores --pretty code frames and error summaries", () => {
        const metrics = parseDiagnostics([...PRETTY_ERRORS, ...STATISTICS].join("\n"));
        assert.deepEqual(Object.keys(metrics), STATISTIC_KEYS);
    });

    test("ignores other output that contains a colon", () => {
        const metrics = parseDiagnostics([
            "Explicitly specified module resolution kind: 'Bundler'.",
            "TSFILE: /project/dist/index.js",
            "[10:22:01 AM] Projects in this build: ",
            ...STATISTICS,
        ].join("\n"));
        assert.deepEqual(Object.keys(metrics), STATISTIC_KEYS);
    });

    test("findCompileErrors returns each error line in plain and --pretty output", () => {
        const stdout = [...PLAIN_ERRORS, ...PRETTY_ERRORS, ...STATISTICS].join("\n");
        assert.deepEqual(findCompileErrors({ stdout, stderr: "" }), [
            PLAIN_ERRORS[0],
            PLAIN_ERRORS[3],
            PLAIN_ERRORS[4],
            "src/index.ts:4:5 - error TS2322: Type '2' is not assignable to type '1'.",
        ]);
        assert.deepEqual(findCompileErrors({ stdout: STATISTICS.join("\n"), stderr: "" }), []);
    });
});

describe("diagnostics command", () => {
    test("runs on a single project and writes JSON + HTML reports", () => {
        const result = diagnostics("packages/app-a", "--mode", "extendedDiagnostics");
        assert.equal(result.status, 0, result.output);
        const [jsonFile] = reportFiles("app-a", "json");
        assert.ok(jsonFile, "JSON report written");
        assert.ok(reportFiles("app-a", "html").length > 0, "HTML report written");
        const report = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
        assert.equal(report.targetName, "app-a");
        assert.equal(typeof report.metrics.totalTime.value, "number");
    });

    test("a glob matching one folder runs on that folder", () => {
        const result = diagnostics("packages/app-b*");
        assert.equal(result.status, 0, result.output);
        assert.ok(reportFiles("app-b", "json").length > 0);
        assert.equal(fs.existsSync(path.join(workspace, "packages", "app-b*")), false);
    });

    test("a glob matching nothing fails with a clear message", () => {
        const result = diagnostics("packages/nothing-*");
        assert.equal(result.status, 1);
        assert.match(result.output, /No project folders match "packages\/nothing-\*"/);
        assert.doesNotMatch(result.output, /Unhandled error|\n\s+at /);
    });

    test("a glob matching several folders runs each of them", () => {
        const result = diagnostics("packages/app-*");
        assert.equal(result.status, 0, result.output);
        assert.match(result.output, /\[1\/2\] packages\/app-a/);
        assert.match(result.output, /\[2\/2\] packages\/app-b/);
    });

    test("compiler output cannot break out of the HTML report", () => {
        const result = diagnostics("packages/broken");
        assert.equal(result.status, 2, "tsc exit code is passed through");
        const [htmlFile] = reportFiles("broken", "html");
        const [jsonFile] = reportFiles("broken", "json");
        const html = fs.readFileSync(htmlFile, "utf8");
        assert.equal(html.includes("</script><img"), false);
        const embedded = html.match(/window\.__PB_REPORT_DATA__ = (.*?); \} catch/s);
        assert.ok(embedded, "report data is embedded");
        assert.deepEqual(JSON.parse(embedded[1]), JSON.parse(fs.readFileSync(jsonFile, "utf8")));
        assert.ok(JSON.parse(embedded[1]).stdout.includes("$'tail$&"));
    });

    test("a project that fails to compile counts as failed in the summary", () => {
        const result = diagnostics("packages/*");
        assert.equal(result.status, 1, result.output);
        assert.match(result.output, /Total: 3 \| ✓ Success: 2 \| ✗ Failed: 1/);
        assert.match(result.output, /• packages\/broken: TypeScript exited with code 2 \(2 compile errors\)/);
        assert.doesNotMatch(result.output, /• packages\/app-/);
    });

    test("compile errors do not become metrics in the JSON report", () => {
        const result = diagnostics("packages/broken");
        assert.equal(result.status, 2, result.output);
        const report = JSON.parse(fs.readFileSync(latestReportFile("broken", "json"), "utf8"));
        assert.equal(typeof report.metrics.totalTime.value, "number");
        for (const [key, metric] of Object.entries(report.metrics)) {
            assert.doesNotMatch(key, /^src/, `${key} is not derived from an error location`);
            assert.equal(typeof metric.value, "number", `${key} has a numeric value`);
        }
        // The errors are still found, from stdout.
        const issues = analyzeProjectReport(report).filter((issue) => issue.id === "compile-error-present");
        assert.equal(issues.length, 2);
        assert.match(issues[0].message, /src\/index\.ts\(1,14\): error TS2322/);
    });

    test("the HTML report shows a notice when tsc fails", () => {
        const result = diagnostics("packages/broken");
        assert.equal(result.status, 2, result.output);
        const page = renderReportPage(latestReportFile("broken", "html"));
        const notice = page("#compileFailureNotice");
        assert.equal(notice.classList.contains("hidden"), false, "notice is shown");
        assert.match(notice.innerHTML, /TypeScript exited with code 2 \(2 compile errors\)/);
        assert.ok(notice.innerHTML.includes("&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;"), "error lines are escaped");
        assert.equal(notice.innerHTML.includes("<img"), false);
        assert.equal(page("#timingChartBadge").textContent, "Compile failed");
    });

    test("the HTML report shows no notice when tsc succeeds", () => {
        const result = diagnostics("packages/app-a");
        assert.equal(result.status, 0, result.output);
        const page = renderReportPage(latestReportFile("app-a", "html"));
        assert.equal(page("#compileFailureNotice").classList.contains("hidden"), true);
        assert.match(page("#timingChartBadge").textContent, /^(Healthy|Check-heavy)$/);
    });

    // Plain --diagnostics prints one "Lines:" total; only --extendedDiagnostics
    // splits it into "Lines of Library:", "Lines of Definitions:", ...
    test("the source composition card uses the total line count in diagnostics mode", () => {
        const result = diagnostics("packages/app-b");
        assert.equal(result.status, 0, result.output);
        const report = JSON.parse(fs.readFileSync(latestReportFile("app-b", "json"), "utf8"));
        assert.equal(report.mode, "diagnostics");
        assert.ok(report.metrics.lines.value > 0, "tsc reported a line count");
        assert.equal(report.metrics.linesOfDefinitions, undefined);

        const page = renderReportPage(latestReportFile("app-b", "html"));
        assert.equal(page("#totalSourceLinesValue").textContent, report.metrics.lines.value.toLocaleString("en-US"));
        const legend = page("#compositionLegend").innerHTML;
        assert.doesNotMatch(legend, /NaN/);
        assert.match(legend, /--mode extendedDiagnostics/);
        assert.match(page("#sourceCompositionHint").textContent, /only the total line count/);
        assert.match(page("#insights").innerHTML, /Source breakdown unavailable/);
        assert.doesNotMatch(page("#insights").innerHTML, /NaN|Infinity/);
    });

    test("the source composition card splits lines by kind in extendedDiagnostics mode", () => {
        const result = diagnostics("packages/app-b", "--mode", "extendedDiagnostics");
        assert.equal(result.status, 0, result.output);
        const { metrics } = JSON.parse(fs.readFileSync(latestReportFile("app-b", "json"), "utf8"));
        const total = ["Library", "Definitions", "TypeScript", "JavaScript", "JSON", "Other"]
            .reduce((sum, kind) => sum + (metrics[`linesOf${kind}`]?.value ?? 0), 0);
        assert.ok(total > 0, "tsc reported per-kind line counts");

        const page = renderReportPage(latestReportFile("app-b", "html"));
        assert.equal(page("#totalSourceLinesValue").textContent, total.toLocaleString("en-US"));
        const legend = page("#compositionLegend").innerHTML;
        assert.doesNotMatch(legend, /NaN/);
        assert.match(legend, /TypeScript<\/span>\s*[\d,]+ <span[^>]*>\(\d+(\.\d)?%\)/);
        assert.match(page("#sourceCompositionHint").textContent, /is the largest share of analyzed source lines \(\d+(\.\d)?%\)/);
        assert.match(page("#insights").innerHTML, /Dependency-heavy workload/);
        assert.doesNotMatch(page("#insights").innerHTML, /NaN|Infinity/);
    });
});

describe("aggregate command", () => {
    test("a glob only includes the matching projects", () => {
        const output = path.join(workspace, "agg-a.json");
        const result = run(cli, ["aggregate", "packages/app-a*/ts-diagnostics", "-o", output]);
        assert.equal(result.status, 0, result.output);
        const aggregated = JSON.parse(fs.readFileSync(output, "utf8"));
        assert.deepEqual(aggregated.reports.map((r) => r.targetName), ["app-a"]);
        assert.ok(fs.existsSync(output.replace(/\.json$/, ".html")));
    });

    test("a glob matching nothing does not scan the whole folder", () => {
        const output = path.join(workspace, "agg-none.json");
        const result = run(cli, ["aggregate", "nothing/*/ts-diagnostics", "-o", output]);
        assert.match(result.output, /No files or folders match/);
        assert.equal(fs.existsSync(output), false);
    });

    test("keeps projects in different folders that share a name", () => {
        createProject("web", "export const web = 'apps';\n", "apps");
        createProject("web", "export const web = 'libs';\n", "libs");
        const ran = diagnostics("apps/web", "libs/web");
        assert.equal(ran.status, 0, ran.output);
        assert.equal(reportFiles("web", "json", "apps").length, 1);
        assert.equal(reportFiles("web", "json", "libs").length, 1);

        const { result, aggregated, html } = aggregate("apps", "libs");
        assert.doesNotMatch(result.output, /Deduplication/);
        assert.deepEqual(aggregated.reports.map((r) => r.targetName), ["web", "web"]);
        assert.deepEqual(aggregated.reports.map((r) => tail(r.targetRoot)), ["apps/web", "libs/web"]);
        // The summary table names each by its folder, not just "web".
        assert.match(result.output, /apps[\\/]+web/);
        assert.match(result.output, /libs[\\/]+web/);
        assert.deepEqual(htmlReportLabels(html, aggregated.reports), ["apps/web", "libs/web"]);
    });

    test("keeps the latest run of a project, not the slowest or largest", () => {
        const root = path.join(workspace, "repeated", "app");
        // Folder names do not follow run order, so file order cannot decide.
        writeReport("repeated/app/ts-diagnostics/b", { targetRoot: root, generatedAt: "2026-03-01T10:00:00.000Z", files: 100, seconds: 1 });
        writeReport("repeated/app/ts-diagnostics/a", { targetRoot: root, generatedAt: "2026-01-01T10:00:00.000Z", files: 500, seconds: 9 });
        writeReport("repeated/app/ts-diagnostics/c", { targetRoot: root, generatedAt: "2026-02-01T10:00:00.000Z", files: 100, seconds: 5 });

        const { result, aggregated } = aggregate("repeated/app");
        assert.match(result.output, /Deduplication: 3 reports => 1 unique projects/);
        assert.equal(aggregated.reports.length, 1);
        assert.equal(aggregated.reports[0].generatedAt, "2026-03-01T10:00:00.000Z");
        assert.equal(aggregated.reports[0].metrics.totalTime.value, 1);
    });

    test("runs with a different -p tsconfig are separate projects", () => {
        const root = path.join(workspace, "configs", "app");
        const dir = "configs/app/ts-diagnostics";
        writeReport(`${dir}/1`, { targetRoot: root, generatedAt: "2026-01-01T10:00:00.000Z", files: 1, seconds: 1 });
        writeReport(`${dir}/2`, { targetRoot: root, project: "tsconfig.prod.json", generatedAt: "2026-01-02T10:00:00.000Z", files: 2, seconds: 2 });
        writeReport(`${dir}/3`, { targetRoot: root, project: "./tsconfig.prod.json", generatedAt: "2026-01-03T10:00:00.000Z", files: 3, seconds: 3 });

        const { result, aggregated, html } = aggregate(dir);
        assert.match(result.output, /Deduplication: 3 reports => 2 unique projects/);
        assert.deepEqual(aggregated.reports.map((r) => r.project ?? null), [null, "./tsconfig.prod.json"]);
        assert.deepEqual(htmlReportLabels(html, aggregated.reports), ["app", "app/./tsconfig.prod.json"]);
    });

    test("the HTML report labels same-named projects distinctly", () => {
        const template = fs.readFileSync(path.join(dist, "theme", "layouts", "list-layout.html"), "utf8");
        const labels = htmlReportLabels(template, [
            { targetName: "src", targetRoot: "/repo/a/pkg/src" },
            { targetName: "src", targetRoot: "/repo/b/pkg/src" },
            { targetName: "src", targetRoot: "C:\\repo\\c\\lib\\src" },
            { targetName: "api", targetRoot: "/repo/api" },
            { targetName: "api", targetRoot: "/repo/api", project: "tsconfig.prod.json" },
            { targetName: "api", targetRoot: "/repo/api", project: "tsconfig.prod.json" },
        ]);
        assert.deepEqual(labels, [
            "a/pkg/src",
            "b/pkg/src",
            "c/lib/src",
            "api",
            "api/tsconfig.prod.json",
            "api/tsconfig.prod.json (2)",
        ]);
    });
});

describe("compare command", () => {
    test("writes a comparison report for one project", () => {
        const outputDir = path.join(workspace, "compare-out");
        const result = run(cli, ["compare", "packages/app-a", "-o", outputDir]);
        assert.equal(result.status, 0, result.output);
        const files = fs.readdirSync(outputDir);
        assert.ok(files.some((f) => /^app-a-compare-.*\.html$/.test(f)));
        assert.ok(files.some((f) => /^app-a-compare-.*\.json$/.test(f)));
    });
});

describe("package entry points", () => {
    test("standalone aggregate and compare bins run", () => {
        assert.match(run(path.join(dist, "aggregate-reports.js"), ["--help"]).stdout, /Usage:/);
        assert.match(run(path.join(dist, "compare-reports.js"), ["--help"]).stdout, /Usage:/);
    });

    test("bins exist, and one matches the unscoped package name for npx", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
        const unscopedName = pkg.name.replace(/^@[^/]+\//, "");
        // `npx @scope/name` only knows which of several bins to run if one is named `name`.
        assert.equal(pkg.bin[unscopedName], "dist/cli.js");
        for (const [name, file] of Object.entries(pkg.bin)) {
            const content = fs.readFileSync(path.join(repoRoot, file), "utf8");
            assert.ok(content.startsWith("#!/usr/bin/env node"), `${name} -> ${file} has a node shebang`);
        }
    });

    test("requiring the package has no side effects and exposes the API", () => {
        const script = `const api = require(${JSON.stringify(dist)}); console.log(typeof api.analyzeProjectReport);`;
        const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), "function");
    });
});

describe("tsconfig audit and fix-tsconfig command", () => {
    // What real workspaces contain: comments and trailing commas (as written
    // by `tsc --init`), bases from packages, extends arrays, extension-less
    // paths, and folder names the tool knows nothing about.
    const files = {
        "node_modules/@tsconfig/node20/package.json": JSON.stringify({ name: "@tsconfig/node20", version: "1.0.0" }),
        "node_modules/@tsconfig/node20/tsconfig.json": lines(
            "{",
            "  // from a package",
            '  "compilerOptions": { "strict": true, "skipLibCheck": true, },',
            "}",
        ),
        "tsconfig.base.json": lines(
            "{",
            "  /* shared settings, no skipLibCheck */",
            '  "compilerOptions": { "strict": true },',
            '  "exclude": ["**/*.spec.ts"],',
            "}",
        ),
        "tsconfig.json": lines(
            "{",
            "  // solution config",
            '  "files": [],',
            '  "references": [{ "path": "./apps/web/admin/tsconfig.app.json" },],',
            "}",
        ),
        "apps/web/admin/tsconfig.app.json": lines(
            "{",
            "  // package extends, nested folder",
            '  "extends": "@tsconfig/node20/tsconfig.json",',
            '  "compilerOptions": {',
            '    "outDir": "out", // build output',
            "  },",
            '  "include": ["src/**/*.ts"],',
            '  "exclude": ["**/node_modules/**"],',
            "}",
        ),
        "libs/shared/utils/tsconfig.lib.json": lines(
            "{",
            "  /* extension-less path in an extends array */",
            '  "extends": ["../../../tsconfig.base"],',
            '  "compilerOptions": {',
            '    "incremental": true,',
            '    "tsBuildInfoFile": "../../../dist/out-tsc/utils.tsbuildinfo", // cache',
            "  },",
            '  "include": ["src"],',
            "}",
        ),
        "packages/core/tsconfig.lib.json": JSON.stringify({
            compilerOptions: { composite: true, skipLibCheck: true, tsBuildInfoFile: "../../dist/core.tsbuildinfo" },
            include: ["src"],
            exclude: ["**/node_modules/**"],
        }),
        "libs/missing/tsconfig.json": '{ "extends": "@acme/not-installed/tsconfig.json", "include": ["src"] }\n',
        "templates/lib/tsconfig.json": lines("{", '  "compilerOptions": { "outDir": <%= outDir %> }', "}"),
    };
    let root;
    let configs;

    before(() => {
        root = tempWorkspace(files);
        configs = Object.fromEntries(
            auditTsconfigSettings({ workspaceRoot: root }).configs.map((config) => [config.config, config]),
        );
    });

    const ids = (config) => configs[config].findings.map((finding) => finding.id);
    const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

    test("finds tsconfigs in any folder, skipping node_modules", () => {
        assert.deepEqual(Object.keys(configs), [
            "apps/web/admin/tsconfig.app.json",
            "libs/missing/tsconfig.json",
            "libs/shared/utils/tsconfig.lib.json",
            "packages/core/tsconfig.lib.json",
            "templates/lib/tsconfig.json",
            "tsconfig.json",
        ]);
    });

    test("follows extends like tsc: packages, arrays, paths without .json", () => {
        assert.deepEqual(configs["apps/web/admin/tsconfig.app.json"].extends_chain, [
            "node_modules/@tsconfig/node20/tsconfig.json",
            "apps/web/admin/tsconfig.app.json",
        ]);
        assert.deepEqual(configs["libs/shared/utils/tsconfig.lib.json"].extends_chain, [
            "tsconfig.base.json",
            "libs/shared/utils/tsconfig.lib.json",
        ]);
        assert.deepEqual(configs["libs/shared/utils/tsconfig.lib.json"].exclude, ["../../../**/*.spec.ts"]);
    });

    test("reports skipLibCheck as TypeScript resolves it", () => {
        const inherited = configs["apps/web/admin/tsconfig.app.json"];
        assert.equal(inherited.compiler_options.skipLibCheck, true);
        assert.ok(ids("apps/web/admin/tsconfig.app.json").includes("skip-lib-check-enabled"));

        // Not set anywhere: TypeScript's default is false.
        const unset = configs["libs/shared/utils/tsconfig.lib.json"];
        assert.equal(unset.compiler_options.skipLibCheck, false);
        const finding = unset.findings.find((f) => f.id === "skip-lib-check-disabled");
        assert.ok(finding, "missing skipLibCheck is reported");
        assert.match(finding.message, /defaults it to false/);

        // A reference-only solution config checks no files, so it is not flagged.
        assert.equal(configs["tsconfig.json"].role, "solution");
        assert.ok(!ids("tsconfig.json").some((id) => id.startsWith("skip-lib-check")));
    });

    test("composite turns on incremental unless it is disabled explicitly", () => {
        assert.equal(configs["packages/core/tsconfig.lib.json"].compiler_options.incremental, true);
        assert.deepEqual(ids("packages/core/tsconfig.lib.json").sort(), [
            "exclude-node-modules",
            "incremental-enabled",
            "skip-lib-check-enabled",
        ]);
    });

    test("reports unparsable configs and missing bases instead of aborting", () => {
        assert.deepEqual(ids("templates/lib/tsconfig.json"), ["invalid-tsconfig"]);
        assert.deepEqual(ids("libs/missing/tsconfig.json"), ["unresolved-extends"]);
        assert.match(configs["libs/missing/tsconfig.json"].findings[0].message, /@acme\/not-installed/);
    });

    test("--dry-run lists the planned fixes and writes nothing", () => {
        const before = Object.keys(files).map(read);
        const result = run(cli, ["fix-tsconfig", root, "--dry-run"]);
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /Dry run: would update 2 tsconfig file\(s\)/);
        assert.match(result.stdout, /Could not check or fix 2 tsconfig file\(s\)/);
        assert.match(result.stdout, /No files were written/);
        assert.doesNotMatch(result.stdout, /No tsconfig changes|No auto-fixable/);
        assert.deepEqual(Object.keys(files).map(read), before);
    });

    test("applies fixes in place, keeping comments and formatting", () => {
        const result = run(cli, ["fix-tsconfig", root]);
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /Updated 2 tsconfig file\(s\)/);

        assert.equal(read("apps/web/admin/tsconfig.app.json"), lines(
            "{",
            "  // package extends, nested folder",
            '  "extends": "@tsconfig/node20/tsconfig.json",',
            '  "compilerOptions": {',
            '    "outDir": "out", // build output',
            '    "incremental": true,',
            '    "tsBuildInfoFile": "out/apps-web-admin-tsconfig.app.tsbuildinfo",',
            "  },",
            '  "include": ["src/**/*.ts"],',
            '  "exclude": ["**/node_modules/**"],',
            "}",
        ));
        // A new exclude would replace the inherited one, so its entries are kept.
        assert.equal(read("libs/shared/utils/tsconfig.lib.json"), lines(
            "{",
            "  /* extension-less path in an extends array */",
            '  "extends": ["../../../tsconfig.base"],',
            '  "compilerOptions": {',
            '    "incremental": true,',
            '    "tsBuildInfoFile": "../../../dist/out-tsc/utils.tsbuildinfo", // cache',
            '    "skipLibCheck": true,',
            "  },",
            '  "include": ["src"],',
            '  "exclude": [',
            '    "../../../**/*.spec.ts",',
            '    "**/node_modules/**"',
            "  ],",
            "}",
        ));
        assert.equal(read("templates/lib/tsconfig.json"), files["templates/lib/tsconfig.json"]);
    });

    test("a second run finds nothing left to fix", () => {
        const result = run(cli, ["fix-tsconfig", root]);
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /No auto-fixable tsconfig changes found/);
        assert.doesNotMatch(result.stdout, /Updated/);
    });

    test("fails clearly when the workspace root does not exist", () => {
        const result = run(cli, ["fix-tsconfig", path.join(root, "nope")]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Workspace root not found/);
    });
});

describe("tsconfig files with comments in other commands", () => {
    test("diagnostics --fix edits a commented tsconfig and still runs", () => {
        const root = tempWorkspace({
            "tsconfig.json": lines(
                "{",
                "  // created by tsc --init",
                '  "compilerOptions": {',
                '    "strict": true,',
                '    "noEmit": true, // type-check only',
                "  },",
                '  "include": ["src"],',
                "}",
            ),
            "src/index.ts": "export const x: number = 1;\n",
        });
        const result = run(cli, ["diagnostics", root, "--fix", "--typescript", typescriptPath]);
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /Updated 1 tsconfig file\(s\)/);
        const tsconfig = fs.readFileSync(path.join(root, "tsconfig.json"), "utf8");
        assert.match(tsconfig, /"noEmit": true, \/\/ type-check only\n    "skipLibCheck": true,\n/);
    });

    test("list reads a tsconfig with comments and trailing commas", () => {
        const root = tempWorkspace({
            "tsconfig.json": lines(
                "{",
                "  // projects",
                '  "files": [],',
                '  "references": [{ "path": "./packages/a" },],',
                "}",
            ),
        });
        const result = run(cli, ["list"], { cwd: root });
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /packages[\\/]a$/m);
    });

    test("list reports a tsconfig it cannot parse", () => {
        const root = tempWorkspace({ "tsconfig.json": '{ "references": <%= refs %> }\n' });
        const result = run(cli, ["list"], { cwd: root });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Cannot parse .*tsconfig\.json: Expression expected/);
        assert.doesNotMatch(result.output, /Debug Failure|\n\s+at /);
    });
});

describe("comment-preserving tsconfig edits", () => {
    test("adds to multi-line objects and arrays without touching other lines", () => {
        const input = lines(
            "{",
            '  "compilerOptions": {',
            '    "strict": true // keep',
            "  },",
            '  "exclude": [',
            '    "dist", // output',
            "  ]",
            "}",
        );
        let output = setJsoncValue(input, ["compilerOptions", "incremental"], true);
        output = appendJsoncArrayItem(output, ["exclude"], "**/node_modules/**");
        assert.equal(output, lines(
            "{",
            '  "compilerOptions": {',
            '    "strict": true, // keep',
            '    "incremental": true',
            "  },",
            '  "exclude": [',
            '    "dist", // output',
            '    "**/node_modules/**",',
            "  ]",
            "}",
        ));
    });

    test("keeps one-line objects on one line and opens up empty ones", () => {
        assert.equal(
            setJsoncValue('{"include": ["src"]}', ["compilerOptions", "skipLibCheck"], true),
            '{"include": ["src"], "compilerOptions": { "skipLibCheck": true }}',
        );
        assert.equal(
            setJsoncValue('{\n\t"compilerOptions": {}\n}', ["compilerOptions", "skipLibCheck"], true),
            '{\n\t"compilerOptions": {\n\t\t"skipLibCheck": true\n\t}\n}',
        );
    });

    test("replaces existing values and keeps CRLF line endings", () => {
        assert.equal(
            setJsoncValue('{\r\n  "compilerOptions": {\r\n    "skipLibCheck": false\r\n  }\r\n}\r\n', ["compilerOptions", "skipLibCheck"], true),
            '{\r\n  "compilerOptions": {\r\n    "skipLibCheck": true\r\n  }\r\n}\r\n',
        );
    });

    test("refuses edits that do not fit the file", () => {
        assert.throws(() => setJsoncValue('{"compilerOptions": true}', ["compilerOptions", "x"], 1), /not an object/);
        assert.throws(() => appendJsoncArrayItem('{"exclude": "dist"}', ["exclude"], "x"), /not an array/);
    });
});
