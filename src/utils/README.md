# Issue helpers

This folder has three functions, one for each report shape in [`../theme/data`](../theme/data).
Each reads a diagnostics report's `metrics` and returns issue ideas, meaning conclusions worth
investigating, based on the [TypeScript Performance Guide](../../../../docs/README.md). They
don't apply fixes. They point at what to look at next. On the config side,
[`../tsconfig-checks.ts`](../tsconfig-checks.ts) applies fixes.

## Helpers

| Data set | Shape | Helper |
| --- | --- | --- |
| [`example-project-report.json`](../theme/data/example-project-report.json) | one `DiagnosticsResult` snapshot | [`analyzeProjectReport(report)`](./analyze-project-report.ts) |
| [`example-compare-report.json`](../theme/data/example-compare-report.json) | `{ targetName, reports: DiagnosticsResult[] }`, one project over time | [`analyzeCompareReport(compare)`](./analyze-compare-report.ts) |
| [`projects-aggregated-report.json`](../theme/data/projects-aggregated-report.json) | `{ reportCount, reports: DiagnosticsResult[] }`, many projects with one run each | [`analyzeAggregatedReport(aggregated)`](./analyze-aggregated-report.ts) |

All three return `Issue[]` ([`issue.types.ts`](./issue.types.ts)):

```ts
interface Issue {
  id: string;
  severity: "error" | "warn" | "info";
  title: string;
  message: string;        // what the data shows, with the actual numbers
  recommendation: string; // what to go do about it
  docs: string[];         // repo-root-relative doc paths backing the call
}
```

`analyzeCompareReport` calls `analyzeProjectReport` on the latest run and adds conclusions that
need a history of runs. `analyzeAggregatedReport` calls it on every project and adds conclusions
that compare projects with each other. The catalog below lists which helper produces each
conclusion.

Two shared modules support them. [`metric-utils.ts`](./metric-utils.ts) reads metric values
with their units and detects compile errors. [`thresholds.ts`](./thresholds.ts) holds every
numeric cutoff with the reason for it.

## Catalog of conclusions

These are all the conclusions the helpers could draw, grouped by the doc that backs them. ✅ marks
a conclusion a helper implements, with its issue `id` and the helpers that report it. 💡 marks an
idea that needs more data than these JSON reports hold.

### Compiler phases, from [process.md](../../../../docs/process.md)

| Conclusion | Signal | Status |
| --- | --- | --- |
| File Discovery is misconfigured | `Files` unexpectedly high | ✅ `high-file-count` (project) |
| Module resolution is expensive | `ResolveModule time` is a large share of `Total time` | ✅ `high-module-resolution-time` (project) |
| Parsing is expensive (large/barrel files) | `Parse time` is a large share of `Total time` | ✅ `high-parse-time` (project) |
| Binding is expensive (too many declarations/exports, namespaces) | `Bind time` is a large share of `Total time`, or `Symbols` is very high | ✅ `high-bind-time` (project) |
| Type Checking dominates (the expected case) | `Check time` ≥ ~60% of `Total time` | ✅ `check-time-dominant` (project, aggregated) |
| Transform/Emit is worth skipping | `Emit time` non-trivial in a type-check-only workflow | 💡 Idea. The metrics can't show whether emit is needed. That takes the invoking command or the CI config. |

### CLI, IDE and CI share one bottleneck, from [where-it-runs.md](../../../../docs/where-it-runs.md)

| Conclusion | Signal | Status |
| --- | --- | --- |
| A slow Check phase will also make `tsserver` (IDE) laggy, not just CI | any `check-time-dominant` finding | ✅ Implicit. The same finding fires whichever tool ran tsc, and the recommendations are phase-level fixes, which this doc says apply everywhere. |
| Watch mode / editor feels un-incremental | repeated full `Total time` cost across a compare history with no drop | 💡 Idea. Needs `tsc -w` timings between saves, which these reports don't capture. |

### Diagnostics metric reference, from [tools.md](../../../../docs/tools.md)

| Conclusion | Signal | Status |
| --- | --- | --- |
| High generic instantiation count ("runaway-complexity signal") | `Instantiations` ≥ threshold | ✅ `high-instantiations` (project) |
| Large type-object count | `Types` ≥ threshold | ✅ `high-type-count` (project) |
| High checker memory use | `Memory used` ≥ threshold | ✅ `high-memory-usage` (project) |
| Report was captured without extended metrics | `mode !== "extendedDiagnostics"` | ✅ `missing-extended-diagnostics` (project, aggregated) |
| Heavy structural comparison workload | `Assignability cache size` large relative to `Types` | ✅ `high-structural-comparison-volume` (project) |
| A specific hotspot file/type is slow | `analyze-trace` hot-spot output | 💡 Idea. Needs a `trace.json` and `types.json` pair from `tsc --generateTrace`, which these reports don't include. |
| Duplicate packages inflating the program | `analyze-trace`'s duplicate-packages report | 💡 Idea. Also needs trace data. |

### The audit workflow, from [performance-audit-flow.md](../../../../docs/performance-audit-flow.md)

| Conclusion | Signal | Status |
| --- | --- | --- |
| Pick a Phase 1 target from all projects | rank projects by `Check time` | ✅ `worst-check-time-offenders` (aggregated) |
| No baseline recorded yet | a compare history with a single entry | ✅ `single-run-history` (compare) |
| A step regressed Check time | `Check time` rose step-over-step in a compare history | ✅ `check-time-regression` (compare) |
| Improvement stalled, possibly because of a stale `.tsbuildinfo` | `Check time` improved a lot but `Total time` barely moved | ✅ `possible-stale-tsbuildinfo` (compare) |
| Still worth another Phase 4 pass | latest `Check time` in a compare history is still above threshold | ✅ `check-time-still-high-after-history` (compare) |
| Workspace package consumed as `.ts` source, not built `.d.ts` | a `Cannot find module`/resolution error mentioning a workspace-style specifier | ✅ `compile-error-present` (project, compare, aggregated), which points at the [09-workspace-package-as-source](../../../../projects/test-lib-1/src/examples/09-workspace-package-as-source/README.md) example |
| Confirm which file an import actually resolved to | ambiguous resolution, `--traceResolution` needed | 💡 Idea. Needs `--traceResolution` output, which these reports don't include. See [10-trace-resolution](../../../../projects/test-lib-1/src/examples/10-trace-resolution/README.md). |

### Config conclusions inferred from metrics, from [tsconfig-performance-checklist.md](../../../../docs/tsconfig-performance-checklist.md)

| Conclusion | Signal | Status |
| --- | --- | --- |
| `skipLibCheck` likely matters a lot here | `Lines of Definitions` ≫ `Lines of TypeScript` | ✅ `definitions-outweigh-source` (project) |
| `include`/`exclude`/project references need attention | `Files` unexpectedly high | ✅ `high-file-count` (project) |
| `moduleResolution`/`paths`/`baseUrl` need attention | `ResolveModule time` share high | ✅ `high-module-resolution-time` (project) |
| `incremental` not enabled / not effective | rebuild `Total time` not dropping run-over-run | ✅ `possible-stale-tsbuildinfo` (compare), the closest signal in these reports. The tsconfig itself isn't in this data. [`tsconfig-checks.ts`](../tsconfig-checks.ts) audits the config directly. |
| Emit-related options (`declaration`, `sourceMap`, …) are on but unneeded | `Emit time` non-trivial | 💡 Idea. Same limitation as the emit row under compiler phases. |

### Type-level code patterns, from [ts-code-checklist.md](../../../../docs/ts-code-checklist.md)

Aggregate metrics can't point to the line where one of these patterns occurs. That needs
`analyze-trace` hot-spot data. The metrics show that the checklist is worth working through, not
which pattern is to blame, so these findings point at the checklist instead of naming a pattern.

| Conclusion | Signal | Status |
| --- | --- | --- |
| Distributive conditionals / nested distributive conditionals / recursive tuple construction | `Instantiations` ≥ threshold | ✅ folded into `high-instantiations` (project) |
| Union type reduction | `Types` ≥ threshold | ✅ folded into `high-type-count` (project) |
| Intersection-to-interface / complex type extraction | `Assignability cache size` large relative to `Types` | ✅ folded into `high-structural-comparison-volume` (project) |
| One project is a type-level outlier vs. its peers | `Instantiations / Files` far above the median across projects | ✅ `instantiations-per-file-outlier` (aggregated) |
| Annotation review / generic simplification | None | 💡 Idea. The lowest-impact checklist item and the hardest to see in metrics. These reports have no reliable signal for it. |

## Usage

```ts
import {
  analyzeProjectReport,
  analyzeCompareReport,
  analyzeAggregatedReport,
} from "./src/utils";

const issues = analyzeProjectReport(projectReportJson);
// issues: Issue[]. Render them as-is, or group by `severity` or `id`.
```

Every `docs` entry is a path relative to the repo root (e.g.
`docs/ts-code-checklist.md#recursive--conditional-types`,
`projects/test-lib-1/src/examples/09-workspace-package-as-source/README.md`)
so callers can turn them into links without guessing the prefix.
