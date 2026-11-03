/**
 * Programmatic API of @push-based/tsc-diagnostics.
 *
 * Importing this module has no side effects — the command-line interface
 * lives in `./cli` (the `tsc-diagnostics` bin).
 *
 * Exposes the shape of the JSON reports the CLI writes, plus helpers that
 * read those reports and return "issue ideas" worth investigating.
 */
export type {
    DiagnosticMode,
    DiagnosticsMetrics,
    DiagnosticsResult,
    KnownMetricKey,
    MetricUnit,
    ParsedMetric,
} from "./diagnostic.types";

export * from "./utils";
