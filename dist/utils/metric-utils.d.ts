import { DiagnosticsMetrics, DiagnosticsResult } from "../diagnostic.types";
export declare function metricNumber(metrics: DiagnosticsMetrics, key: string): number | undefined;
export declare function metricSeconds(metrics: DiagnosticsMetrics, key: string): number | undefined;
export declare function metricMiB(metrics: DiagnosticsMetrics, key: string): number | undefined;
/**
 * Returns the compile errors tsc printed during the run, one line each
 * (`src/index.ts(1,14): error TS2322: …`). When this is non-empty, the
 * report's timings come from a program that failed to type-check.
 */
export declare function findCompileErrors(report: Pick<DiagnosticsResult, "stdout" | "stderr">): string[];
