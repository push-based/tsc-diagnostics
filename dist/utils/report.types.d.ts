import { DiagnosticsResult } from "../diagnostic.types";
/**
 * One entry inside a `<project-name>-compare-report.json` file — the same
 * shape `compare-reports.ts` writes, with an optional free-text `note`
 * describing what changed at that step (e.g. "Extract shared helper types").
 */
export interface CompareReportEntry extends DiagnosticsResult {
    note?: string;
}
/** Shape of `<project-name>-compare-report.json` (history of one project). */
export interface CompareReport {
    schemaVersion: number;
    type: string;
    generatedAt: string;
    targetName: string;
    reports: CompareReportEntry[];
}
/** Shape of `projects-aggregated-report.json` (many projects, one run each). */
export interface AggregatedReport {
    schemaVersion: number;
    generatedAt: string;
    reportCount: number;
    reports: DiagnosticsResult[];
}
