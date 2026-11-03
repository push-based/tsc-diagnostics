import { DiagnosticsMetrics, DiagnosticsResult } from "../diagnostic.types";

export function metricNumber(
  metrics: DiagnosticsMetrics,
  key: string
): number | undefined {
  const metric = metrics[key];
  if (!metric) return undefined;
  const value = Number(metric.value);
  return Number.isFinite(value) ? value : undefined;
}

export function metricSeconds(
  metrics: DiagnosticsMetrics,
  key: string
): number | undefined {
  const metric = metrics[key];
  if (!metric) return undefined;
  const value = Number(metric.value);
  if (!Number.isFinite(value)) return undefined;
  return metric.unit === "milliseconds" ? value / 1000 : value;
}

export function metricMiB(
  metrics: DiagnosticsMetrics,
  key: string
): number | undefined {
  const metric = metrics[key];
  if (!metric) return undefined;
  const value = Number(metric.value);
  if (!Number.isFinite(value)) return undefined;
  if (metric.unit === "KiB") return value / 1024;
  if (metric.unit === "bytes") return value / (1024 * 1024);
  return value;
}

const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

/**
 * A compile error as tsc prints it, at the start of a line:
 *   src/index.ts(1,14): error TS2322: …   (--pretty false, the default)
 *   src/index.ts:1:14 - error TS2322: …   (--pretty)
 *   error TS5058: …                       (not tied to a file)
 */
const COMPILE_ERROR_LINE = /^(?:\S.*?(?:\(\d+,\d+\): |:\d+:\d+ - ))?error TS\d+:/;

/**
 * Returns the compile errors tsc printed during the run, one line each
 * (`src/index.ts(1,14): error TS2322: …`). When this is non-empty, the
 * report's timings come from a program that failed to type-check.
 */
export function findCompileErrors(
  report: Pick<DiagnosticsResult, "stdout" | "stderr">
): string[] {
  return `${report.stdout ?? ""}\n${report.stderr ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.replace(ANSI_ESCAPE, "").trimEnd())
    .filter((line) => COMPILE_ERROR_LINE.test(line));
}
