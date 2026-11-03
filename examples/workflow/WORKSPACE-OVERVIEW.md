# Workspace diagnostics overview

This report summarizes an `aggregate` run from 2026-07-11. It covers 78 tsconfig entries, taken from 57 diagnostics reports across 55 projects.

---

## Key metrics

| Metric | Value |
|--------|-------|
| Summed total time | 39.51s |
| Summed check time | 18.79s |
| Check-time share | 47.6% |
| Peak memory | 891 MiB |

---

## Projects

### Largest projects by file count

| Project | Files | Total Time | Check Time | Memory |
|---------|-------|-----------|-----------|--------|
| graph-client (batch 1) | 2,106 | 3.64s | 1.50s | 834.3 MiB |
| graph-client (batch 6) | 1,714 | 1.46s | 1.15s | 890.5 MiB |
| graph-client (batch 3) | 1,596 | 2.80s | 1.34s | 610.0 MiB |
| graph-client (batch 7) | 1,579 | 2.52s | 1.10s | 550.4 MiB |
| graph-client (batch 5) | 1,596 | 2.75s | 1.29s | 617.4 MiB |

### Medium-sized projects

| Project | Files | Total Time | Check Time | Memory |
|---------|-------|-----------|-----------|--------|
| nx (multiple batches) | 839 | ~1.74s avg | ~0.66s avg | ~402 MiB avg |
| ui-graph | 511 | 0.73s | 0.22s | 224.8 MiB |
| ui-components | 437 | 0.48s | 0.10s | 183.7 MiB |

### Projects with no source files

More than 45 projects report 0 files, among them Angular, Cypress, Devkit, Esbuild, Expo, Express, Jest, Linter, Nest, Next, Node, Plugin, React, React-Native, Rollup, Storybook, Tao, Vite, Web, Webpack and Workspace. These are type-only packages with no TypeScript source files.

---

## Failed projects

| Project | Reason |
|---------|--------|
| docs | TypeScript compilation error |
| e2e/utils | TypeScript compilation error |
| workspace/testing | Node spawn error |
| (empty) | Parse error |

---

## Insights

### Where the time goes
- Type-checking takes 47.6% of the summed compile time.
- graph-client is the most expensive project, with several batches above 1.5s each.
- Memory use peaked at 891 MiB, while compiling graph-client.

### Config entries
- graph/client has 13 config entries and packages/nx has 7, one per tsconfig variant.
- Another 50 entries come from packages with no source files.

### Opportunities
1. Look into why graph/client is slow to compile. Its slowest batch takes 3.64s.
2. Type-checking takes 47.6% of the time. Try `skipLibCheck` or incremental builds.
3. The 891 MiB peak suggests large type instantiation graphs.

---

## Report files

| File | Size | Purpose |
|------|------|---------|
| `workspace-diagnostics-overview.json` | 1.0 MB | Aggregated data as JSON |
| `workspace-diagnostics-overview.html` | 931 KB | HTML report |

---

## Usage

### Open the HTML report
```bash
open workflow/workspace-diagnostics-overview.html
```

### Query the aggregated JSON
```bash
# Total statistics
jq '.totalStats' workflow/workspace-diagnostics-overview.json

# All project entries
jq '.configs[] | {targetName, totalTime: .metrics.totalTime.value, memory: .metrics.memoryUsed.value}' \
  workflow/workspace-diagnostics-overview.json

# Find slowest projects
jq -s 'sort_by(.metrics.totalTime.value) | reverse | .[0:10]' \
  workflow/workspace-diagnostics-overview.json
```

### Find the largest memory users
```bash
# Top 10 memory consumers
jq '.configs | sort_by(.metrics.memoryUsed.value) | reverse | .[0:10] | \
  .[] | "\(.targetName): \(.metrics.memoryUsed.value) MiB"' \
  workflow/workspace-diagnostics-overview.json
```

---

## Next steps

1. Profile graph-client to find what makes it slow.
2. Set `incremental: true` in tsconfig.json.
3. Set `skipLibCheck: true`.
4. Fix the compile errors in docs and e2e/utils, and the spawn error in workspace/testing.
5. Run diagnostics and `aggregate` again after the changes, and compare the numbers.

---

## Generated files

```
workflow/
├── workspace-diagnostics-overview.json    (1.0 MB)
├── workspace-diagnostics-overview.html    (931 KB)
├── DIAGNOSTICS-SUMMARY.md
├── TS-DIAGNOSTICS-WORKFLOW.md
├── tsconfig-paths.txt
├── tsconfig-paths-relative.txt
├── tsconfig-paths.json
├── tsconfig-projects.txt
├── run-all-diagnostics.sh
└── reports/
    └── ts-diagnostics/
        ├── 2026-07-11T22-06-57/
        ├── 2026-07-11T22-06-58/
        ├── 2026-07-11T22-06-59/
        └── 2026-07-11T22-07-02/
```
