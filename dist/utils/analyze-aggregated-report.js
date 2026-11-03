"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeAggregatedReport = analyzeAggregatedReport;
const thresholds_1 = require("./thresholds");
const metric_utils_1 = require("./metric-utils");
const DOCS = {
    auditFlowPhase0: "docs/performance-audit-flow.md#phase-0-optional-overview-measurement",
    toolsExtended: "docs/tools.md#tsc---extendeddiagnostics",
    toolsTrace: "docs/tools.md#tsc---generatetrace",
    codeChecklist: "docs/ts-code-checklist.md",
    workspaceExample: "projects/test-lib-1/src/examples/09-workspace-package-as-source/README.md",
};
function checkTimeShare(report) {
    const total = (0, metric_utils_1.metricSeconds)(report.metrics, "totalTime");
    const check = (0, metric_utils_1.metricSeconds)(report.metrics, "checkTime");
    if (total === undefined || total <= 0 || check === undefined) {
        return undefined;
    }
    return check / total;
}
/**
 * Analyzes a `projects-aggregated-report.json` (many projects, one run each)
 * and returns issue ideas — cross-project prioritization and outlier
 * detection that only make sense with the whole fleet in view, plus each
 * project's own compile-error/mode findings. See ./README.md.
 */
function analyzeAggregatedReport(aggregated) {
    const issues = [];
    const reports = aggregated.reports;
    if (reports.length === 0)
        return issues;
    const rankedByCheckTime = reports
        .map((report) => ({
        report,
        checkTime: (0, metric_utils_1.metricSeconds)(report.metrics, "checkTime") ?? 0,
    }))
        .sort((a, b) => b.checkTime - a.checkTime);
    const worstOffenders = rankedByCheckTime
        .slice(0, 3)
        .filter((entry) => entry.checkTime >= thresholds_1.THRESHOLDS.minCheckTimeToFlagSeconds);
    if (worstOffenders.length > 0) {
        issues.push({
            id: "worst-check-time-offenders",
            severity: "warn",
            title: "Prioritization target: highest Check time projects",
            message: worstOffenders
                .map((entry) => `${entry.report.targetName} (${entry.checkTime.toFixed(2)}s)`)
                .join(", "),
            recommendation: "Pick the top offender as the Phase 1 baseline target before doing per-project deep dives — fixing it moves the aggregate the most.",
            docs: [DOCS.auditFlowPhase0],
        });
    }
    for (const report of reports) {
        for (const error of (0, metric_utils_1.findCompileErrors)(report)) {
            issues.push({
                id: "compile-error-present",
                severity: "error",
                title: `Compilation did not succeed: ${report.targetName}`,
                message: `tsc reported: ${error}`,
                recommendation: "Fix this before trusting its timing metrics — a failed compile can abort early and under-report Check/Emit time.",
                docs: [DOCS.workspaceExample],
            });
        }
        if (report.mode !== "extendedDiagnostics") {
            issues.push({
                id: "missing-extended-diagnostics",
                severity: "info",
                title: `Re-run "${report.targetName}" with --extendedDiagnostics`,
                message: `Captured in "${report.mode}" mode, so cache sizes and phase breakdowns aren't available for this project.`,
                recommendation: "Re-run diagnostics with extendedDiagnostics mode for full metric coverage before comparing it against its peers.",
                docs: [DOCS.toolsExtended],
            });
        }
        const share = checkTimeShare(report);
        if (share !== undefined && share >= thresholds_1.THRESHOLDS.checkTimeDominanceRatio) {
            issues.push({
                id: "check-time-dominant",
                severity: "info",
                title: `Type Checking dominates "${report.targetName}"`,
                message: `Check time is ${(share * 100).toFixed(0)}% of total compile time.`,
                recommendation: "A strong candidate for the code-level checklist (distributive conditionals, recursive types, union/intersection shape).",
                docs: [DOCS.codeChecklist],
            });
        }
    }
    const instantiationsPerFile = reports
        .map((report) => ({
        targetName: report.targetName,
        instantiations: (0, metric_utils_1.metricNumber)(report.metrics, "instantiations"),
        files: (0, metric_utils_1.metricNumber)(report.metrics, "files"),
    }))
        .filter((entry) => entry.instantiations !== undefined &&
        entry.files !== undefined &&
        entry.files > 0)
        .map((entry) => ({ ...entry, ratio: entry.instantiations / entry.files }));
    if (instantiationsPerFile.length >= 3) {
        const sortedRatios = [...instantiationsPerFile]
            .map((entry) => entry.ratio)
            .sort((a, b) => a - b);
        const median = sortedRatios[Math.floor(sortedRatios.length / 2)];
        if (median > 0) {
            for (const entry of instantiationsPerFile) {
                if (entry.ratio >=
                    median * thresholds_1.THRESHOLDS.instantiationsPerFileOutlierRatio) {
                    issues.push({
                        id: "instantiations-per-file-outlier",
                        severity: "info",
                        title: `"${entry.targetName}" instantiates far more per file than its peers`,
                        message: `${entry.ratio.toFixed(0)} instantiations/file vs. a ${median.toFixed(0)} median across ${instantiationsPerFile.length} projects.`,
                        recommendation: "Localized type-level complexity rather than just a bigger codebase — profile this project on its own with --generateTrace.",
                        docs: [DOCS.codeChecklist, DOCS.toolsTrace],
                    });
                }
            }
        }
    }
    return issues;
}
