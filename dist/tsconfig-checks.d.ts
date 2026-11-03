export type Severity = 'error' | 'warn' | 'info' | 'pass';
export interface Finding {
    id: string;
    severity: Severity;
    message: string;
    recommendation?: string;
}
export interface ConfigReport {
    config: string;
    role: 'solution' | 'build' | 'other';
    /** The config and every config it extends, bases first, the config itself last. */
    extends_chain: string[];
    /** Effective values after `extends`, including TypeScript's defaults. */
    compiler_options: {
        incremental?: boolean;
        skipLibCheck?: boolean;
        composite?: boolean;
        tsBuildInfoFile?: string;
    };
    include?: string[];
    exclude?: string[];
    findings: Finding[];
    diagnostics?: {
        total_s?: number;
        check_s?: number;
        files?: number;
        instantiations?: number;
        types?: number;
    };
}
export interface PerformanceCheckReport {
    summary: {
        configs_checked: number;
        errors: number;
        warnings: number;
        infos: number;
        passed_checks: number;
        generated_at: string;
    };
    workflow: string[];
    configs: ConfigReport[];
}
export interface SolutionResult {
    config: string;
    total_s?: number;
    check_s?: number;
    files?: number;
    instantiations?: number;
    types?: number;
}
export interface ConfigFixResult {
    config: string;
    applied: string[];
    skipped: string[];
}
export interface FixReport {
    dry_run: boolean;
    files_modified: number;
    changes: ConfigFixResult[];
}
/** Every `tsconfig.json` under the workspace root, as workspace-relative paths. */
export declare function discoverSolutionConfigs(workspaceRoot: string, filter?: string): string[];
/** Every `tsconfig.{lib,spec,app,build}.json` under the workspace root, at any depth. */
export declare function discoverBuildConfigs(workspaceRoot: string, filter?: string): string[];
export declare function discoverAllTsconfigs(workspaceRoot: string, filter?: string): string[];
export declare function buildDiagnosticsIndex(solutions: SolutionResult[]): Map<string, ConfigReport['diagnostics']>;
export declare function workflowSteps(): string[];
export declare function auditTsconfigSettings(options: {
    workspaceRoot: string;
    filter?: string;
    solutions?: SolutionResult[];
}): PerformanceCheckReport;
export declare function configsNeedingAttention(report: PerformanceCheckReport): ConfigReport[];
/**
 * Applies the auto-fixable findings of an audit report. Files are edited in
 * place: comments and formatting are kept, only the changed settings differ.
 */
export declare function applyTsconfigFixes(options: {
    workspaceRoot: string;
    report: PerformanceCheckReport;
    dryRun?: boolean;
}): FixReport;
export declare function printFixReport(fixReport: FixReport): void;
export declare function countAvailableFixes(report: PerformanceCheckReport): number;
