/**
 * Heuristic thresholds shared by the analyze-*-report helpers. Not hard
 * limits — tune per workspace. Sources noted per line; see ./README.md for
 * the full reasoning behind each one.
 */
export declare const THRESHOLDS: {
    /** docs/tools.md: "Unexpected file count = include/exclude settings probably wrong" */
    readonly highFiles: 1500;
    /** docs/ts-code-checklist.md: instantiations is "the classic runaway-complexity signal" */
    readonly highInstantiations: 50000;
    /** docs/tools.md: "Large type counts often correlate with complex helper types" */
    readonly highTypes: 30000;
    /** Memory tends to follow Types/Instantiations rather than being an independent signal. */
    readonly highMemoryMiB: 500;
    /** docs/process.md: "Type Checking dominates compile time for most large TypeScript projects" */
    readonly checkTimeDominanceRatio: 0.6;
    /** Below this, Check time differences are noise-level and not worth flagging. */
    readonly minCheckTimeToFlagSeconds: 0.5;
    /** Lines of Definitions this many times Lines of TypeScript => skipLibCheck matters a lot. */
    readonly definitionsToSourceRatio: 5;
    /** Share of Total time spent resolving modules before it's worth a dedicated issue. */
    readonly resolveModuleShareOfTotal: 0.15;
    /** Share of Total time spent in the binder before it's worth a dedicated issue. */
    readonly bindTimeShareOfTotal: 0.2;
    /** Share of Total time spent parsing before it's worth a dedicated issue. */
    readonly parseTimeShareOfTotal: 0.2;
    /** Assignability cache entries this many times Types => heavy structural re-comparison. */
    readonly cacheToTypesRatio: 1.5;
    /** Step-over-step Check time increase in a compare-report worth calling a regression. */
    readonly regressionIncreaseRatio: 0.1;
    /** Check time improved this much (ratio) while Total time barely moved => stale .tsbuildinfo. */
    readonly checkImprovementWithoutTotalGain: 0.2;
    /** Total time improvement (ratio) below this counts as "barely moved". */
    readonly staleTsBuildInfoTotalTimeDropRatio: 0.05;
    /** A project's instantiations-per-file this many times the aggregate median counts as an outlier. */
    readonly instantiationsPerFileOutlierRatio: 3;
};
