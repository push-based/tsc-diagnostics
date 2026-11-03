import { DiagnosticsResult } from "../diagnostic.types";
import { Issue } from "./issue.types";
/**
 * Analyzes a single `<project-name>-project-report.json` snapshot (one
 * `tsc --diagnostics`/`--extendedDiagnostics` run) and returns issue ideas —
 * conclusions to investigate, not applied fixes. See ./README.md for the
 * full catalog these checks are drawn from.
 */
export declare function analyzeProjectReport(report: DiagnosticsResult): Issue[];
