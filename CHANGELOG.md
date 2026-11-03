## 1.0.0 (2026-11-03)

First standalone release, extracted from `push-based/ts-perf-experiments`.

Published as `@push-based/tsc-diagnostics`. The command is `tsc-diagnostics`. `ts-diagnostics`, `ts-diagnostics-aggregate` and `ts-diagnostics-compare` remain available as aliases.

### Features

- `diagnostics` runs `tsc --diagnostics` or `--extendedDiagnostics` on one or more projects, given as literal paths or glob patterns, and writes a JSON and an HTML report per run.
- `aggregate` collects reports from folders, files or glob patterns into one JSON and HTML overview.
- `compare` renders one project's runs over time as a JSON and HTML trend report.
- `fix-tsconfig` audits tsconfig performance settings and applies fixes, or previews them with `--dry-run`.
- `list` prints the project paths referenced by a root `tsconfig.json`.
- `--trace` generates a TypeScript trace and runs `@typescript/analyze-trace` on it.
- `-o/--output-base` or the `TSD_OUTPUT` environment variable collect all reports in one place.
- The package exports the report types and `analyzeProjectReport`, `analyzeCompareReport` and `analyzeAggregatedReport`.

### Fixes

- The CLI expands glob patterns itself instead of passing them through the shell. This closes a command injection hole and makes globs work on Windows. A pattern that matches one folder now runs on that folder, a pattern that matches nothing fails with an error message, and `aggregate` no longer falls back to scanning the whole current directory.
- HTML reports escape their embedded data and rendered values, so compiler output containing `</script>`, markup, or `$'` can no longer break the page, run script, or make it show the bundled demo data.
- `--typescript <package folder>` now runs that package's `bin/tsc` instead of its library entry, which exited 0 without type-checking.
- The `ts-diagnostics-aggregate` and `ts-diagnostics-compare` bins now run. Before, they exited without doing anything.
- `require("@push-based/tsc-diagnostics")` no longer starts the CLI.
- `diagnostics` on several projects counts a project as failed when tsc exits with a non-zero code. The summary lists it with the exit code and number of compile errors, and the command exits with code 1. Before, only crashes counted, so a project with compile errors was reported as a success.
- The CLI no longer parses compile errors as metrics. It reads only tsc's statistics, so lines such as `src/index.ts(1,14): error TS2322: …` no longer show up as metrics like `srcIndexTs114` in the JSON or the "All metrics" table.
- `findCompileErrors()` now takes the report and reads the errors from its `stdout` and `stderr`, since they are no longer in `metrics`. `analyzeProjectReport` and `analyzeAggregatedReport` still flag compile errors.
- When tsc exits with a non-zero code, the HTML report shows a notice with the exit code, the number of compile errors and the first error lines. Its timing badge reads "Compile failed" instead of "Healthy" or "Check-heavy".
- `aggregate` tells projects apart by folder and `-p` tsconfig instead of by folder name. Same-named projects such as `apps/web` and `libs/web`, or every project matched by `"packages/*/src"`, are no longer dropped, and the summary table and HTML report give each its own label.
- When `aggregate` finds several runs of one project, it keeps the most recent run (by `generatedAt`), not the one with the most files or the highest total time.
- `fix-tsconfig`, `diagnostics --fix` and `list` read tsconfig files with TypeScript's parser. Comments and trailing commas no longer crash the audit or print "Invalid JSON". `extends` resolves the way it does in `tsc`, including packages (`@tsconfig/node20/tsconfig.json`), `extends` arrays and paths without `.json`. The audit reports and skips a config that cannot be parsed, or whose base cannot be found, instead of aborting the run.
- tsconfig discovery no longer assumes the Nx repository layout or shells out to `find`, which failed on Windows. The audit now covers every `tsconfig.json` and `tsconfig.{lib,spec,app,build}.json` at any depth.
- A missing `skipLibCheck` is reported as disabled (TypeScript's default) instead of enabled, `composite` counts as enabling `incremental`, and reference-only solution configs are no longer flagged for `skipLibCheck`.
- tsconfig fixes edit files in place and keep comments and formatting. Adding `exclude` keeps the inherited or default entries it would otherwise replace, and `tsBuildInfoFile` is computed from the config's actual location instead of assuming it is two folders deep.
- `fix-tsconfig --dry-run` no longer prints "No tsconfig changes to apply." after listing the planned changes.
