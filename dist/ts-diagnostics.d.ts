#!/usr/bin/env node
import { DiagnosticsMetrics, DiagnosticsResult } from "./diagnostic.types";
export type DiagnosticMode = "diagnostics" | "extendedDiagnostics";
export type ReportFormat = "html";
export interface CliOptions {
    targetRoot: string;
    mode: DiagnosticMode;
    project?: string;
    typescriptPath?: string;
    trace: boolean;
    analyzeTrace: boolean;
    outputBase?: string;
    build: boolean;
    reportFormat: ReportFormat | null;
    pretty: boolean;
    fix: boolean;
    extraArgs: string[];
}
/**
 * Reads the statistics block of `--diagnostics` / `--extendedDiagnostics`
 * output. Everything else tsc prints is skipped, even when it contains a
 * colon: compile errors (`src/index.ts(1,14): error TS2322: …`), their
 * indented continuation lines, `--pretty` code frames and summaries, and the
 * output of flags such as `--traceResolution`. Their values are not numbers,
 * or they do not start in the first column with a letter.
 */
export declare function parseDiagnostics(output: string): DiagnosticsMetrics;
export interface RenderOptions {
    templatePath: string;
    outputPath: string;
    reportData: DiagnosticsResult;
}
export declare function renderReport(options: RenderOptions): Promise<void>;
/**
 * Runs diagnostics on one project and writes its JSON and HTML reports.
 * Resolves with the result even when tsc fails (check `exitCode`); rejects
 * only when the run itself cannot happen.
 */
export declare function runDiagnosticsCli(args: string[]): Promise<DiagnosticsResult>;
export declare function runDiagnosticsMultiCli(args: string[]): Promise<void>;
