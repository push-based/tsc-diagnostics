# TypeScript diagnostics tutorial

This tutorial runs TypeScript compiler diagnostics on projects in an Nx monorepo and generates performance reports.

---

## Prerequisites

- Node.js and npm installed
- `@push-based/tsc-diagnostics` installed as a dev dependency
- A TypeScript project with `tsconfig.json` files

---

## Step 1: Clear old reports

```bash
rm -rf ts-diagnostics-reports ts-diagnostics 2>/dev/null
mkdir -p ts-diagnostics-reports
```

This keeps reports from earlier runs out of the aggregate in step 5.

---

## Step 2: List the projects

```bash
npx tsc-diagnostics list --tsconfig tsconfig.base.json
```

The command prints the project paths from the `references` and `compilerOptions.paths` entries in `tsconfig.base.json`.

---

## Step 3: Run diagnostics

### One project
```bash
npx tsc-diagnostics diagnostics <project-path> \
    --mode extendedDiagnostics \
    -o ./ts-diagnostics-reports
```

### Several projects
```bash
for project in graph/ui-components graph/ui-graph packages/nx; do
  npx tsc-diagnostics diagnostics "$project" \
      --mode extendedDiagnostics \
      -o ./ts-diagnostics-reports
done
```

`--mode diagnostics`, the default, reports the standard metrics. `--mode extendedDiagnostics` adds more, including cache sizes.

---

## Step 4: View the reports

### Generated files
```
ts-diagnostics-reports/ts-diagnostics/YYYY-MM-DDTHH-MM-SS/
├── <project>-ts-diagnostics.json    # Machine-readable metrics
└── <project>-ts-diagnostics.html    # Visual report
```

### Open the HTML reports
```bash
open ts-diagnostics-reports/ts-diagnostics/*/*-ts-diagnostics.html
```

### Query the JSON
```bash
jq '.metrics.memoryUsed' ts-diagnostics-reports/ts-diagnostics/*/*-ts-diagnostics.json
jq '.metrics.totalTime' ts-diagnostics-reports/ts-diagnostics/*/*-ts-diagnostics.json
```

---

## Step 5: Aggregate the results

Combine all reports into one workspace summary:

```bash
npx tsc-diagnostics aggregate \
    "ts-diagnostics-reports/ts-diagnostics/**/*-ts-diagnostics.json" \
    -o ./workspace-summary.json
```

This writes `workspace-summary.json` and `workspace-summary.html`.

---

## Step 6: Compare runs over time

To see how performance changed between runs:

```bash
npx tsc-diagnostics compare \
    ./ts-diagnostics-reports/ts-diagnostics \
    -o ./comparison-report
```

---

## More options

### Generate a trace
```bash
npx tsc-diagnostics diagnostics <project> \
    --trace --analyze-trace \
    -o ./ts-diagnostics-reports
```

### Fix tsconfig settings
```bash
# Preview fixes
npx tsc-diagnostics fix-tsconfig . --dry-run

# Apply fixes
npx tsc-diagnostics fix-tsconfig .
```

### Set the output folder with an environment variable
```bash
export TSD_OUTPUT=./ts-diagnostics-reports
npx tsc-diagnostics diagnostics <project> --mode extendedDiagnostics
```

---

## Full script

```bash
#!/bin/bash
set -e

REPORTS_DIR="./ts-diagnostics-reports"
rm -rf "$REPORTS_DIR" && mkdir -p "$REPORTS_DIR"

echo "Running diagnostics..."
for PROJECT in graph/ui-components graph/ui-graph packages/nx; do
  echo "[*] $PROJECT"
  npx tsc-diagnostics diagnostics "$PROJECT" \
      --mode extendedDiagnostics \
      -o "$REPORTS_DIR"
done

echo "Aggregating results..."
npx tsc-diagnostics aggregate \
    "$REPORTS_DIR/ts-diagnostics/**/*-ts-diagnostics.json" \
    -o ./workspace-summary.json

echo "✓ Done. Reports: $REPORTS_DIR"
```

---

## Key metrics

| Metric | Description |
|--------|-------------|
| `totalTime` | Total compile time |
| `checkTime` | Time spent type-checking |
| `memoryUsed` | Memory the compiler used |
| `types` | Number of types the checker created |
| `instantiations` | Number of generic type instantiations |
| `files` | Number of files in the program |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `list` prints nothing | Check that `tsconfig.base.json` exists and has `references` or `compilerOptions.paths`, and pass it with `--tsconfig ./tsconfig.base.json` |
| `diagnostics` fails | Check that the project has a `tsconfig.json`, then run `cd <project> && npx tsc --noEmit` to see tsc's own errors |
| No reports written | Check that you can write to the output folder, for example with `chmod 755 ts-diagnostics-reports` |
| High memory use | Run with `--trace` to find the files and types that cost the most, and run `fix-tsconfig` |

---

## Example run

The script above, run on three projects, wrote six reports (one JSON and one HTML file per project) to `./ts-diagnostics-reports/ts-diagnostics/2026-07-11T21-59-21/`. All three compiled without errors:

| Project | Memory | Types |
|---------|--------|-------|
| ui-components | 17,450K | 63 |
| ui-graph | 17,518K | 64 |
| packages/nx | 16,131K | 64 |
