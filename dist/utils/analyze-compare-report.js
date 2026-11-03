"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeCompareReport = analyzeCompareReport;
const thresholds_1 = require("./thresholds");
const metric_utils_1 = require("./metric-utils");
const analyze_project_report_1 = require("./analyze-project-report");
const DOCS = {
    auditFlowPhase1: "docs/performance-audit-flow.md#phase-1-base-measurement",
    auditFlowPhase3: "docs/performance-audit-flow.md#phase-3-measure-impact",
    auditFlowPhase4: "docs/performance-audit-flow.md#phase-4-detailed-analysis--type-optimization",
    codeChecklist: "docs/ts-code-checklist.md",
};
function sortedByTime(reports) {
    return [...reports].sort((a, b) => {
        const aTime = new Date(a.generatedAt ?? a.startedAt ?? 0).getTime();
        const bTime = new Date(b.generatedAt ?? b.startedAt ?? 0).getTime();
        return aTime - bTime;
    });
}
function label(entry) {
    return entry.note ?? entry.project ?? entry.targetName;
}
/**
 * Analyzes a `<project-name>-compare-report.json` history (the same project
 * measured across multiple runs/tsconfig variants) and returns issue ideas —
 * both the latest snapshot's own issues and trend-only conclusions that only
 * make sense across runs (regressions, plateaus). See ./README.md.
 */
function analyzeCompareReport(compare) {
    const issues = [];
    const reports = sortedByTime(compare.reports);
    if (reports.length === 0)
        return issues;
    const latest = reports[reports.length - 1];
    issues.push(...(0, analyze_project_report_1.analyzeProjectReport)(latest));
    if (reports.length === 1) {
        issues.push({
            id: "single-run-history",
            severity: "info",
            title: "Only one run recorded for this project",
            message: "This comparison currently contains a single report.",
            recommendation: "Record a Phase 1 baseline and re-run after each change so regressions and improvements become visible over time.",
            docs: [DOCS.auditFlowPhase1],
        });
        return issues;
    }
    for (let i = 1; i < reports.length; i++) {
        const prev = reports[i - 1];
        const curr = reports[i];
        const prevCheck = (0, metric_utils_1.metricSeconds)(prev.metrics, "checkTime");
        const currCheck = (0, metric_utils_1.metricSeconds)(curr.metrics, "checkTime");
        if (prevCheck === undefined || currCheck === undefined || prevCheck <= 0) {
            continue;
        }
        const change = (currCheck - prevCheck) / prevCheck;
        if (change >= thresholds_1.THRESHOLDS.regressionIncreaseRatio) {
            issues.push({
                id: "check-time-regression",
                severity: "warn",
                title: `Check time regressed at "${label(curr)}"`,
                message: `Check time went from ${prevCheck.toFixed(2)}s ("${label(prev)}") to ${currCheck.toFixed(2)}s (+${(change * 100).toFixed(0)}%).`,
                recommendation: "Diff whatever changed between these two steps against the TypeScript code performance checklist — the regression was introduced in that step.",
                docs: [DOCS.auditFlowPhase4, DOCS.codeChecklist],
            });
        }
    }
    const first = reports[0];
    const firstTotal = (0, metric_utils_1.metricSeconds)(first.metrics, "totalTime");
    const latestTotal = (0, metric_utils_1.metricSeconds)(latest.metrics, "totalTime");
    const firstCheck = (0, metric_utils_1.metricSeconds)(first.metrics, "checkTime");
    const latestCheck = (0, metric_utils_1.metricSeconds)(latest.metrics, "checkTime");
    if (firstTotal !== undefined &&
        latestTotal !== undefined &&
        firstCheck !== undefined &&
        latestCheck !== undefined &&
        firstCheck > 0) {
        const checkImprovement = (firstCheck - latestCheck) / firstCheck;
        const totalImprovement = firstTotal > 0 ? (firstTotal - latestTotal) / firstTotal : 0;
        if (checkImprovement >= thresholds_1.THRESHOLDS.checkImprovementWithoutTotalGain &&
            totalImprovement < thresholds_1.THRESHOLDS.staleTsBuildInfoTotalTimeDropRatio) {
            issues.push({
                id: "possible-stale-tsbuildinfo",
                severity: "warn",
                title: "Check time improved but Total time did not follow",
                message: `Check time dropped ${(checkImprovement * 100).toFixed(0)}% (${firstCheck.toFixed(2)}s → ${latestCheck.toFixed(2)}s) while Total time barely moved (${firstTotal.toFixed(2)}s → ${latestTotal.toFixed(2)}s).`,
                recommendation: "Delete the .tsbuildinfo file and re-measure — a stale incremental cache can mask real gains, or hide that incremental isn't wired up correctly.",
                docs: [DOCS.auditFlowPhase3],
            });
        }
        if (latestCheck >= thresholds_1.THRESHOLDS.minCheckTimeToFlagSeconds) {
            issues.push({
                id: "check-time-still-high-after-history",
                severity: "info",
                title: "Check time is still notable after this optimization history",
                message: `Latest run ("${label(latest)}") still spends ${latestCheck.toFixed(2)}s in Check.`,
                recommendation: "Move to Phase 4: run tsc --generateTrace + typescript-analyze-trace to find the next hotspot instead of guessing.",
                docs: [DOCS.auditFlowPhase4],
            });
        }
    }
    return issues;
}
