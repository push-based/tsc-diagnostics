export type DiagnosticMode = "diagnostics" | "extendedDiagnostics";

export type KnownMetricKey =
    | "files"
    | "lines"
    | "nodes"
    | "identifiers"
    | "symbols"
    | "types"
    | "instantiations"
    | "memoryUsed"
    | "ioRead"
    | "ioWrite"
    | "parseTime"
    | "bindTime"
    | "checkTime"
    | "emitTime"
    | "programTime"
    | "totalTime"
    | "createSourceFileTime"
    | "forEachChildTime"
    | "getSymbolOfNodeTime"
    | "resolveTypeReferenceDirectivesTime"
    | "getResolvedProjectReferencePerProjectTime"
    | "getSignatureFromDeclarationTime";

export type MetricUnit =
    | "count"
    | "seconds"
    | "milliseconds"
    | "KiB"
    | "MiB"
    | "bytes"
    | "percent";

export interface ParsedMetric {
    raw: string;
    value: number | string;
    unit?: MetricUnit;
}

/**
 * Known keys receive editor completion, while the index signature supports
 * new or version-specific labels emitted by TypeScript.
 */
export type DiagnosticsMetrics =
    Partial<Record<KnownMetricKey, ParsedMetric>> &
    Record<string, ParsedMetric>;

export interface CliOptions {
    targetRoot: string;
    mode: DiagnosticMode;
    project?: string;
    typescriptPath?: string;
    outputBase?: string;
    build: boolean;
    pretty: boolean;
    extraArgs: string[];
}

export interface DiagnosticsResult {
    schemaVersion: 1;
    mode: DiagnosticMode;
    targetRoot: string;
    targetName: string;
    project?: string;
    generatedAt: string;
    command: string[];
    cwd: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    metrics: DiagnosticsMetrics;
    stdout: string;
    stderr: string;
    traceFiles?: string[];
    traceAnalysis?: {
        tracePath: string;
        command: string[];
        exitCode: number | null;
        signal: NodeJS.Signals | null;
        output: string;
        outputFile?: string;
        error?: string;
    };
    fixReport?: {
        dry_run: boolean;
        files_modified: number;
        changes: Array<{
            config: string;
            applied: string[];
            skipped: string[];
        }>;
    };
}
