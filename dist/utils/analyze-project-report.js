"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeProjectReport = analyzeProjectReport;
const thresholds_1 = require("./thresholds");
const metric_utils_1 = require("./metric-utils");
const DOCS = {
    processCheck: "docs/process.md#5-type-checking",
    processParse: "docs/process.md#3-parsing",
    processBind: "docs/process.md#4-binding",
    processResolve: "docs/process.md#2-module-resolution",
    processFileDiscovery: "docs/process.md#1-file-discovery",
    tools: "docs/tools.md",
    toolsExtended: "docs/tools.md#tsc---extendeddiagnostics",
    tsconfigChecklist: "docs/tsconfig-performance-checklist.md",
    tsconfigFiles: "docs/tsconfig-performance-checklist.md#reduce-files-typescript-has-to-check",
    tsconfigRefs: "docs/tsconfig-performance-checklist.md#project-references--monorepos",
    tsconfigModuleResolution: "docs/tsconfig-performance-checklist.md#module-resolution",
    tsconfigBestImpact: "docs/tsconfig-performance-checklist.md#best-impact-vs-effort",
    codeChecklist: "docs/ts-code-checklist.md",
    codeChecklistRecursive: "docs/ts-code-checklist.md#recursive--conditional-types",
    codeChecklistUnions: "docs/ts-code-checklist.md#union--intersection-shape",
    workspaceExample: "projects/test-lib-1/src/examples/09-workspace-package-as-source/README.md",
    traceResolutionExample: "projects/test-lib-1/src/examples/10-trace-resolution/README.md",
};
/**
 * Analyzes a single `<project-name>-project-report.json` snapshot (one
 * `tsc --diagnostics`/`--extendedDiagnostics` run) and returns issue ideas —
 * conclusions to investigate, not applied fixes. See ./README.md for the
 * full catalog these checks are drawn from.
 */
function analyzeProjectReport(report) {
    const issues = [];
    const m = report.metrics;
    for (const error of (0, metric_utils_1.findCompileErrors)(report)) {
        const looksLikeMissingModule = /Cannot find module/.test(error);
        issues.push({
            id: "compile-error-present",
            severity: "error",
            title: "Compilation did not succeed",
            message: `tsc reported: ${error}`,
            recommendation: looksLikeMissingModule
                ? "If the module lives in a workspace package, confirm it resolves to a built .d.ts and not raw .ts source, then re-run diagnostics — every timing metric below was recorded on a program that failed to type-check."
                : "Fix this error before trusting the timing metrics below — a failed compile can abort early and under-report Check/Emit time.",
            docs: [DOCS.workspaceExample, DOCS.traceResolutionExample],
        });
    }
    const totalTime = (0, metric_utils_1.metricSeconds)(m, "totalTime");
    const checkTime = (0, metric_utils_1.metricSeconds)(m, "checkTime");
    if (totalTime !== undefined && checkTime !== undefined && totalTime > 0) {
        const share = checkTime / totalTime;
        if (share >= thresholds_1.THRESHOLDS.checkTimeDominanceRatio &&
            checkTime >= thresholds_1.THRESHOLDS.minCheckTimeToFlagSeconds) {
            issues.push({
                id: "check-time-dominant",
                severity: "warn",
                title: "Type Checking dominates compile time",
                message: `Check time is ${checkTime.toFixed(2)}s, ${(share * 100).toFixed(0)}% of the ${totalTime.toFixed(2)}s total.`,
                recommendation: "Run tsc --generateTrace + typescript-analyze-trace to find the hotspot files/types, then work the TypeScript code performance checklist starting with its highest-impact rows.",
                docs: [DOCS.processCheck, DOCS.tools, DOCS.codeChecklist],
            });
        }
    }
    const files = (0, metric_utils_1.metricNumber)(m, "files");
    if (files !== undefined && files >= thresholds_1.THRESHOLDS.highFiles) {
        issues.push({
            id: "high-file-count",
            severity: "warn",
            title: "Unusually large number of files in the program",
            message: `${files.toLocaleString()} files were included (source + declarations + lib).`,
            recommendation: "Check include/exclude for accidental node_modules, build output, generated files, or nested monorepo configs; consider splitting into project references.",
            docs: [DOCS.processFileDiscovery, DOCS.tsconfigFiles, DOCS.tsconfigRefs],
        });
    }
    const instantiations = (0, metric_utils_1.metricNumber)(m, "instantiations");
    if (instantiations !== undefined &&
        instantiations >= thresholds_1.THRESHOLDS.highInstantiations) {
        issues.push({
            id: "high-instantiations",
            severity: "warn",
            title: "High generic instantiation count",
            message: `${instantiations.toLocaleString()} generic instantiations were recorded — the classic runaway-complexity signal.`,
            recommendation: "Audit hotspots for distributive conditionals, nested distributive conditionals, and recursive tuple/object construction — the highest-impact rows of the TypeScript code performance checklist.",
            docs: [DOCS.codeChecklistRecursive, DOCS.tools],
        });
    }
    const types = (0, metric_utils_1.metricNumber)(m, "types");
    if (types !== undefined && types >= thresholds_1.THRESHOLDS.highTypes) {
        issues.push({
            id: "high-type-count",
            severity: "info",
            title: "Large number of Type objects constructed",
            message: `${types.toLocaleString()} types were created during checking.`,
            recommendation: "Look for large unions borrowed wholesale from a library, and deep intersections that get re-derived on every comparison; consider union reduction or converting intersections to interface extends.",
            docs: [DOCS.codeChecklistUnions],
        });
    }
    const memoryMiB = (0, metric_utils_1.metricMiB)(m, "memoryUsed");
    if (memoryMiB !== undefined && memoryMiB >= thresholds_1.THRESHOLDS.highMemoryMiB) {
        issues.push({
            id: "high-memory-usage",
            severity: "info",
            title: "High checker memory usage",
            message: `tsc reported ${memoryMiB.toFixed(0)} MiB of heap use.`,
            recommendation: "Usually a side effect of high Types/Instantiations rather than an independent problem — fix those first and re-measure.",
            docs: [DOCS.tools],
        });
    }
    const linesOfDefinitions = (0, metric_utils_1.metricNumber)(m, "linesOfDefinitions");
    const linesOfTypeScript = (0, metric_utils_1.metricNumber)(m, "linesOfTypeScript");
    if (linesOfDefinitions !== undefined &&
        linesOfTypeScript !== undefined &&
        linesOfTypeScript > 0 &&
        linesOfDefinitions >= linesOfTypeScript * thresholds_1.THRESHOLDS.definitionsToSourceRatio) {
        issues.push({
            id: "definitions-outweigh-source",
            severity: "info",
            title: "Third-party declarations dwarf your own source",
            message: `${linesOfDefinitions.toLocaleString()} lines of .d.ts vs. ${linesOfTypeScript.toLocaleString()} lines of your TypeScript.`,
            recommendation: "Confirm skipLibCheck is enabled — otherwise the checker is validating other packages' declaration files on every compile.",
            docs: [DOCS.tsconfigBestImpact, DOCS.processCheck],
        });
    }
    const resolveModuleTime = (0, metric_utils_1.metricSeconds)(m, "resolveModuleTime");
    if (resolveModuleTime !== undefined &&
        totalTime !== undefined &&
        totalTime > 0 &&
        resolveModuleTime / totalTime >= thresholds_1.THRESHOLDS.resolveModuleShareOfTotal) {
        issues.push({
            id: "high-module-resolution-time",
            severity: "info",
            title: "Module resolution takes a notable share of compile time",
            message: `ResolveModule time is ${resolveModuleTime.toFixed(2)}s of ${totalTime.toFixed(2)}s total.`,
            recommendation: "Review moduleResolution, baseUrl/paths, and package exports; run tsc --traceResolution on a slow import to confirm what it actually resolves to.",
            docs: [
                DOCS.processResolve,
                DOCS.tsconfigModuleResolution,
                DOCS.traceResolutionExample,
            ],
        });
    }
    const bindTime = (0, metric_utils_1.metricSeconds)(m, "bindTime");
    if (bindTime !== undefined &&
        totalTime !== undefined &&
        totalTime > 0 &&
        bindTime / totalTime >= thresholds_1.THRESHOLDS.bindTimeShareOfTotal) {
        issues.push({
            id: "high-bind-time",
            severity: "info",
            title: "Binding takes a notable share of compile time",
            message: `Bind time is ${bindTime.toFixed(2)}s of ${totalTime.toFixed(2)}s total.`,
            recommendation: "Look for excessive declarations/exports per file or heavy namespace usage — both add binder work building the symbol table.",
            docs: [DOCS.processBind],
        });
    }
    const parseTime = (0, metric_utils_1.metricSeconds)(m, "parseTime");
    if (parseTime !== undefined &&
        totalTime !== undefined &&
        totalTime > 0 &&
        parseTime / totalTime >= thresholds_1.THRESHOLDS.parseTimeShareOfTotal) {
        issues.push({
            id: "high-parse-time",
            severity: "info",
            title: "Parsing takes a notable share of compile time",
            message: `Parse time is ${parseTime.toFixed(2)}s of ${totalTime.toFixed(2)}s total.`,
            recommendation: "Reduce file count/size and avoid large barrel files that re-export everything through one module.",
            docs: [DOCS.processParse],
        });
    }
    const assignabilityCacheSize = (0, metric_utils_1.metricNumber)(m, "assignabilityCacheSize");
    if (assignabilityCacheSize !== undefined &&
        types !== undefined &&
        types > 0 &&
        assignabilityCacheSize >= types * thresholds_1.THRESHOLDS.cacheToTypesRatio) {
        issues.push({
            id: "high-structural-comparison-volume",
            severity: "info",
            title: "Heavy structural comparison workload",
            message: `Assignability cache holds ${assignabilityCacheSize.toLocaleString()} entries against ${types.toLocaleString()} types.`,
            recommendation: "A sign the checker is repeatedly comparing/deriving the same shapes — a common symptom of large reused intersections; consider interface extends instead of A & B & C.",
            docs: [DOCS.codeChecklistUnions, DOCS.tools],
        });
    }
    if (report.mode !== "extendedDiagnostics") {
        issues.push({
            id: "missing-extended-diagnostics",
            severity: "info",
            title: "Re-run with --extendedDiagnostics",
            message: `This report was captured in "${report.mode}" mode.`,
            recommendation: "extendedDiagnostics adds the Lines breakdown, checker cache sizes, and per-phase timings needed for the rest of these checks.",
            docs: [DOCS.toolsExtended],
        });
    }
    return issues;
}
