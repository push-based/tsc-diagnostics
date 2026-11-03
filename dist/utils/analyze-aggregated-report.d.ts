import { Issue } from "./issue.types";
import { AggregatedReport } from "./report.types";
/**
 * Analyzes a `projects-aggregated-report.json` (many projects, one run each)
 * and returns issue ideas — cross-project prioritization and outlier
 * detection that only make sense with the whole fleet in view, plus each
 * project's own compile-error/mode findings. See ./README.md.
 */
export declare function analyzeAggregatedReport(aggregated: AggregatedReport): Issue[];
