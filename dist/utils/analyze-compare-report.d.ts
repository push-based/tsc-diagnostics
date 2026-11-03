import { Issue } from "./issue.types";
import { CompareReport } from "./report.types";
/**
 * Analyzes a `<project-name>-compare-report.json` history (the same project
 * measured across multiple runs/tsconfig variants) and returns issue ideas —
 * both the latest snapshot's own issues and trend-only conclusions that only
 * make sense across runs (regressions, plateaus). See ./README.md.
 */
export declare function analyzeCompareReport(compare: CompareReport): Issue[];
