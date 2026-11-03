# tsc-diagnostics

A CLI that runs TypeScript compiler diagnostics and writes the results to JSON and HTML reports, so you can compare compile performance across projects and over time.

## Purpose

The tool runs `tsc` with `--diagnostics` or `--extendedDiagnostics` on a project and records:
- Compiler statistics (time, memory, file counts), each parsed into a number and a unit
- The exit code and signal
- Stdout and stderr

Each run writes a JSON file, which scripts and CI jobs can read, and an HTML report to open in a browser.

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Installation

Add it as a dev dependency of the project you want to analyze:

```bash
npm install --save-dev @push-based/tsc-diagnostics
# or
pnpm add --save-dev @push-based/tsc-diagnostics
# or
yarn add --dev @push-based/tsc-diagnostics
```

Then run it with `npx` (or `pnpm exec` / `yarn`):

```bash
npx tsc-diagnostics diagnostics ./path/to/project --mode extendedDiagnostics
```

Or run it once without installing: `npx @push-based/tsc-diagnostics diagnostics ./path/to/project`.

The tool uses the TypeScript version installed in the analyzed project. The command also works under its previous name, `ts-diagnostics`.

### Installing from GitHub

To use an unreleased commit, install straight from the repository. Nothing is compiled during install, because `dist/` is committed:

```bash
npm install --save-dev github:push-based/tsc-diagnostics            # latest main
npm install --save-dev github:push-based/tsc-diagnostics#v1.0.0     # a tag
npm install --save-dev github:push-based/tsc-diagnostics#<commit>   # an exact commit
```

With pnpm, use the same specifier. With yarn, use `@push-based/tsc-diagnostics@github:push-based/tsc-diagnostics`. While the repository is private, you need read access to it, through an SSH key or HTTPS git credentials such as `gh auth setup-git`.

## Commands

```
tsc-diagnostics <command> [options]

Commands:
  diagnostics      Run TypeScript compiler diagnostics on one or more projects (supports glob patterns)
  aggregate        Collect and aggregate diagnostics JSON reports into one JSON file
  compare          Compare multiple diagnostic runs for a project over time (HTML report)
  fix-tsconfig     Audit and apply tsconfig performance fixes
  list             List all project paths from root tsconfig.json references
```

---

### `diagnostics`

Run TypeScript compiler diagnostics on one or more projects. Pass project folders, glob patterns, or both.

```bash
npx tsc-diagnostics diagnostics <target-root...> [options] [-- <extra tsc args>]
```

#### Options

| Option | Description |
|--------|-------------|
| `-m, --mode <mode>` | Diagnostics mode: `diagnostics` or `extendedDiagnostics` (default: `diagnostics`) |
| `-p, --project <path>` | Path to `tsconfig.json`, relative to target root |
| `-f, --reportFormat <format>` | Report format: `html` (default: `html`) |
| `--typescript <path>` | Path to the TypeScript package or tsc entrypoint |
| `--trace` | Generate a TypeScript trace and run analyze-trace on it |
| `--analyze-trace` | Run analyze-trace. `--trace` turns this on already. |
| `-o, --output-base <path>` | Parent directory for generated output (overrides `TSD_OUTPUT` env var) |
| `--build` | Run `tsc --build` instead of `tsc --project` |
| `--pretty` | Keep tsc's colored, pretty-printed output |
| `--fix` | Apply the [`fix-tsconfig`](#fix-tsconfig) fixes under the target root before running diagnostics |
| `-h, --help` | Show help message |

#### Environment variables

| Variable | Description |
|----------|-------------|
| `TSD_OUTPUT` | Parent directory for all reports (default: `./ts-diagnostics` per project) |

#### Examples

```bash
# Single project
npx tsc-diagnostics diagnostics ./my-project

# Multiple projects (literal paths)
npx tsc-diagnostics diagnostics projects/lib-1 projects/lib-2 --mode extendedDiagnostics

# Glob pattern matching all test projects
npx tsc-diagnostics diagnostics "projects/test-*" --mode extendedDiagnostics

# Glob pattern with subdirectories
npx tsc-diagnostics diagnostics "packages/*/src" -p tsconfig.prod.json

# Multiple projects with trace and auto-fix
npx tsc-diagnostics diagnostics "projects/*" --trace --fix

# Write all output under ./reports
export TSD_OUTPUT=./reports
npx tsc-diagnostics diagnostics projects/lib-1 projects/lib-2 --mode extendedDiagnostics
# All output: ./reports/ts-diagnostics/<timestamp>/
```

When you pass more than one project, the CLI prints progress lines such as `[1/5] project-path...`. It ends with a summary such as `Total: 5 | ✓ Success: 4 | ✗ Failed: 1`, followed by each failed project and the reason, for example `• packages/app: TypeScript exited with code 2 (3 compile errors)`. Each project gets its own report folder.

A project fails when tsc exits with a non-zero code, for example because of compile errors, or when the run cannot start. If tsc ran, the project's reports are still written. The command exits with code 1 if any project fails.

When tsc exits with a non-zero code, the HTML report opens with a notice showing the exit code, the number of compile errors and the first error lines. The timings in that report come from a failed compile.

With `--trace`, the CLI writes the trace and the analyzer output to the run folder. It also embeds the analyzer results in the JSON report, as `traceAnalysis`, and in the HTML report.

---

### `aggregate`

Collect diagnostics JSON reports from folders, files or glob patterns into one JSON file and one HTML summary.

Each project appears once. If `aggregate` finds several runs of a project, it uses the most recent one. It identifies a project by its folder, plus the `-p` tsconfig if one was given, so same-named folders such as `apps/web` and `libs/web` get separate entries.

```bash
npx tsc-diagnostics aggregate <input-paths...> [options]
```

#### Options

| Option | Description |
|--------|-------------|
| `-o, --output <path>` | Output JSON file path (default: `./projects-diagnostics.json`) |
| `-r, --recursive` | Scan directories recursively (default: `true`) |
| `--no-recursive` | Don't scan subdirectories |
| `-h, --help` | Show help message |

#### Examples

```bash
# Aggregate all reports from a single projects folder
npx tsc-diagnostics aggregate ./projects -o results.json

# Aggregate specific projects (multiple paths)
npx tsc-diagnostics aggregate projects/test-lib-1 projects/test-lib-2 -o results.json

# Aggregate all reports in all ts-diagnostics folders (glob pattern)
npx tsc-diagnostics aggregate "*/ts-diagnostics" -o all-reports.json

# Aggregate all reports across projects directory
npx tsc-diagnostics aggregate "projects/*/ts-diagnostics" -o workspace-reports.json

# Aggregate specific JSON files using glob
npx tsc-diagnostics aggregate "*/ts-diagnostics/**/*-ts-diagnostics.json" -o all-reports.json

# Mix literal paths and patterns
npx tsc-diagnostics aggregate projects/test-lib-1 "packages/*/ts-diagnostics" -o mixed-results.json
```

With `-o results.json`, the command writes the aggregated data to `results.json` and the summary report to `results.html` next to it.

---

### `fix-tsconfig`

Audit tsconfig files for settings that slow down compiles, and fix them.

```bash
npx tsc-diagnostics fix-tsconfig <workspace-root> [options]
```

#### Options

| Option | Description |
|--------|-------------|
| `-f, --filter <text>` | Only check configs whose path contains this text |
| `--dry-run` | Show planned changes without writing files |
| `-h, --help` | Show help message |

#### Examples

```bash
# Run audit and apply fixes
npx tsc-diagnostics fix-tsconfig .

# Preview fixes without applying (dry-run)
npx tsc-diagnostics fix-tsconfig . --dry-run

# Fix only specific projects
npx tsc-diagnostics fix-tsconfig . --filter packages/my-lib

# Dry-run on specific filter
npx tsc-diagnostics fix-tsconfig . --filter packages/my-lib --dry-run
```

The command audits every `tsconfig.json` and `tsconfig.{lib,spec,app,build}.json` under the workspace root, at any depth. It skips `node_modules`, `.git`, `.nx`, `dist` and `tmp` folders.

It reads configs with TypeScript's own parser, so comments and trailing commas work, and it resolves `extends` the way `tsc` does. That covers relative paths with or without `.json`, packages such as `@tsconfig/node20/tsconfig.json`, and `extends` arrays. The checks run on the settings after `extends` is applied and use TypeScript's defaults for anything not set. For example, `skipLibCheck` counts as off unless a config turns it on.

The fixes:
- Enable `incremental` builds on build configs
- Enable `skipLibCheck`, so tsc skips type-checking `.d.ts` files
- Add `**/node_modules/**` to `exclude`. A new `exclude` replaces the inherited or default one, so the fix copies those entries over.
- Set `tsBuildInfoFile`, where tsc keeps its incremental cache, to a path in `outDir` or in `dist/out-tsc` at the workspace root

Fixes edit each file in place and keep its comments, formatting and line endings, so the diff shows only the changed settings. If a config cannot be parsed, or its `extends` target cannot be found (for example, a package that is not installed), the command lists it as not checked and leaves the file alone.

---

### `compare`

Read one project's diagnostics reports from one or more paths and write a JSON and an HTML report of how its metrics changed between runs.

```bash
npx tsc-diagnostics compare <ts-diagnostics-dir> [options]
```

#### Options

| Option | Description |
|--------|-------------|
| `-o, --output <dir>` | Output directory for generated compare files (default: first input path or cwd) |
| `-n, --name <targetName>` | Only include reports with this `targetName` |
| `-h, --help` | Show help message |

#### Examples

```bash
npx tsc-diagnostics compare ./projects/test-lib-1
```

The HTML report starts with the reports the CLI embedded in it. In the browser you can drag in or import more diagnostics JSON files, or load the bundled demo runs. The page doesn't store any of this, not even in `localStorage`, so a reload shows only the embedded reports again.

---

### `list`

Print the project paths from a root `tsconfig.json`: the entries of its `references` array, then the folders its `compilerOptions.paths` point to. You can loop over the output to run `diagnostics` on each project.

```bash
npx tsc-diagnostics list [options]
```

#### Options

| Option | Description |
|--------|-------------|
| `--tsconfig <path>` | Path to root tsconfig.json (default: `tsconfig.json` in cwd) |
| `-h, --help` | Show help message |

#### Examples

```bash
# List projects from default tsconfig.json
npx tsc-diagnostics list

# List projects from a specific tsconfig
npx tsc-diagnostics list --tsconfig ./tsconfig.json
```

## Output

### Output directory structure

```
<target-root>/ts-diagnostics/
└── YYYY-MM-DDTHH-MM-SS/
    ├── <target-folder-name>-ts-diagnostics.json
    ├── <target-folder-name>-ts-diagnostics.html
    ├── <target-folder-name>-trace-analysis.txt   (with --trace)
    ├── trace.json                              (with --trace)
    └── types.json                              (with --trace)
```

Each run gets its own timestamped folder, which holds both the diagnostics reports and the trace files. With `-o/--output-base` or the `TSD_OUTPUT` environment variable, the CLI creates the `ts-diagnostics/` folder there instead of in the target root.

### Output format

Each JSON file contains a `DiagnosticsResult` object:

```json
{
  "schemaVersion": 1,
  "mode": "diagnostics",
  "targetRoot": "/absolute/path/to/project",
  "targetName": "project-name",
  "project": "tsconfig.json",
  "generatedAt": "2026-07-11T16:35:46.123Z",
  "command": ["node", "/path/to/tsc", "--project", "tsconfig.json", "--diagnostics", "--pretty", "false"],
  "cwd": "/absolute/path/to/project",
  "startedAt": "2026-07-11T16:35:44.000Z",
  "finishedAt": "2026-07-11T16:35:46.500Z",
  "durationMs": 2500,
  "exitCode": 0,
  "signal": null,
  "metrics": {
    "files": { "raw": "42", "value": 42, "unit": "count" },
    "lines": { "raw": "125,000", "value": 125000, "unit": "count" },
    "identifiers": { "raw": "8,500", "value": 8500, "unit": "count" },
    "symbols": { "raw": "3,200", "value": 3200, "unit": "count" },
    "types": { "raw": "1,850", "value": 1850, "unit": "count" },
    "instantiations": { "raw": "420", "value": 420, "unit": "count" },
    "memoryUsed": { "raw": "256 MiB", "value": 256, "unit": "MiB" },
    "parseTime": { "raw": "0.5s", "value": 0.5, "unit": "seconds" },
    "checkTime": { "raw": "1.2s", "value": 1.2, "unit": "seconds" },
    "emitTime": { "raw": "0.8s", "value": 0.8, "unit": "seconds" },
    "totalTime": { "raw": "2.5s", "value": 2.5, "unit": "seconds" }
  },
  "stdout": "...",
  "stderr": ""
}
```

### Supported metrics

| Kind | Metrics |
|------|---------|
| Counts | `files`, `lines`, `nodes`, `identifiers`, `symbols`, `types`, `instantiations` |
| Time | `parseTime`, `bindTime`, `checkTime`, `emitTime`, `programTime`, `totalTime`, `ioRead`, `ioWrite` |
| Memory | `memoryUsed` |

Any other statistic tsc prints, such as the cache sizes in `extendedDiagnostics` mode, is stored under its label in camelCase. For example, `Assignability cache size` becomes `assignabilityCacheSize`.

Only tsc's statistics (`Label:   value` lines with a count, time, memory or percentage) become metrics. Compile errors such as `src/index.ts(1,14): error TS2322: …` and other compiler output stay in `stdout` only.

Each metric has three fields. `raw` is the string tsc printed, `value` is the parsed number, and `unit` is one of `count`, `seconds`, `milliseconds`, `KiB`, `MiB`, `bytes` or `percent`.

## Exit behavior

- The CLI writes the report files for every run where tsc finished.
- If tsc exits with a non-zero code, the CLI exits with the same code after writing the reports.
- With several projects, the CLI exits with code 1 if any project fails, including a project where tsc exited with a non-zero code.

## Usage

### Get performance metrics for a single project

1. Run diagnostics for the project.

```bash
npx tsc-diagnostics diagnostics ./projects/test-lib-1 --mode extendedDiagnostics
```

2. Open the reports in the project's diagnostics folder:
- JSON: `./projects/test-lib-1/ts-diagnostics/<timestamp>/*.json`
- HTML: `./projects/test-lib-1/ts-diagnostics/<timestamp>/*.html`

3. Check the key metrics in the report:
- `totalTime`
- `checkTime`
- `memoryUsed`
- `types` and `instantiations`

### Run diagnostics on multiple projects at once

1. Pass glob patterns or several paths to the diagnostics command.

```bash
# Glob pattern
npx tsc-diagnostics diagnostics "projects/test-*" --mode extendedDiagnostics

# Multiple paths
npx tsc-diagnostics diagnostics projects/lib-1 projects/lib-2 projects/lib-3

# Subdirectory glob
npx tsc-diagnostics diagnostics "packages/*/src" -p tsconfig.prod.json
```

2. Watch the progress lines and the summary at the end.

```
[1/5] projects/test-lib-1...
[2/5] projects/test-lib-2...
...
=== Diagnostics Summary ===
Total: 5 | ✓ Success: 5 | ✗ Failed: 0
```

### Get a repo-wide performance overview

1. Run diagnostics on multiple projects.

```bash
npx tsc-diagnostics diagnostics "projects/test-*" --mode extendedDiagnostics
```

2. Aggregate the reports into one JSON file and HTML summary. Any of these works:

```bash
# Option A: Aggregate all ts-diagnostics folders in projects directory
npx tsc-diagnostics aggregate "projects/*/ts-diagnostics" -o workspace-reports.json

# Option B: Aggregate all ts-diagnostics report files (recursive)
npx tsc-diagnostics aggregate "*/ts-diagnostics/**/*-ts-diagnostics.json" -o all-reports.json

# Option C: Aggregate from root with TSD_OUTPUT env var (centralized reports)
export TSD_OUTPUT=./reports
npx tsc-diagnostics diagnostics "projects/test-*" --mode extendedDiagnostics
npx tsc-diagnostics diagnostics "packages/lib-*" --mode extendedDiagnostics
npx tsc-diagnostics aggregate "./reports/ts-diagnostics" -o workspace-summary.json
```

3. Open the workspace-level reports:
- `workspace-reports.json`
- `workspace-reports.html`

4. In the aggregated report, look for projects that stand out by total time, check-time share or peak memory.

### Measure the impact of a refactor on one project

1. Run diagnostics before the refactor to get a baseline.

```bash
npx tsc-diagnostics diagnostics ./projects/test-lib-1 --mode extendedDiagnostics
```

2. Make the refactor in the target project.

3. Run diagnostics again.

```bash
npx tsc-diagnostics diagnostics ./projects/test-lib-1 --mode extendedDiagnostics
```

4. Generate a comparison report across all runs for that project.

```bash
npx tsc-diagnostics compare ./projects/test-lib-1/ts-diagnostics
```

5. Open the HTML report in the output folder and check how these metrics changed:
- `totalTime`
- `checkTime`
- `memoryUsed`
- `types` and `instantiations`

### Collect all reports in one folder with `TSD_OUTPUT`

In a large monorepo, writing every report to one folder lets a single `aggregate` command pick them all up.

1. Set the `TSD_OUTPUT` environment variable. The CLI reads it from the environment and does not load `.env` files.

```bash
export TSD_OUTPUT=./ts-diagnostics-reports
```

2. Run diagnostics. All reports go to `./ts-diagnostics-reports/ts-diagnostics/`.

```bash
npx tsc-diagnostics diagnostics ./projects/test-lib-1 --mode extendedDiagnostics
npx tsc-diagnostics diagnostics ./projects/test-lib-2 --mode extendedDiagnostics
npx tsc-diagnostics diagnostics ./packages/my-lib --mode extendedDiagnostics
```

Or use glob patterns to run on many projects at once:
```bash
npx tsc-diagnostics diagnostics "projects/*" "packages/*/src" --mode extendedDiagnostics
```

3. Aggregate the reports with a glob pattern.

```bash
# All reports in centralized folder
npx tsc-diagnostics aggregate "./ts-diagnostics-reports/ts-diagnostics/**/*-ts-diagnostics.json" -o workspace-full-report.json
```

4. Open the aggregated HTML report:
```bash
open workspace-full-report.html
```

In CI, set `TSD_OUTPUT` once for the job, and every diagnostics step writes to the same folder.

### Auto-fix tsconfig performance issues

Before measuring, run `fix-tsconfig` to find and fix tsconfig settings that slow down compiles:

```bash
# Preview planned fixes (dry-run)
npx tsc-diagnostics fix-tsconfig . --dry-run

# Apply fixes
npx tsc-diagnostics fix-tsconfig .

# Preview fixes for one project
npx tsc-diagnostics fix-tsconfig . --filter packages/my-lib --dry-run
```

See [`fix-tsconfig`](#fix-tsconfig) for the list of fixes.

Then run diagnostics to measure the impact:
```bash
npx tsc-diagnostics diagnostics . --mode extendedDiagnostics
```

## Tracing and CPU profiling with tsc

The `diagnostics` reports show totals. To find which files and types cost the most, use tsc's own flags.

Generate a trace and analyze it:

```bash
tsc --generateTrace trace
typescript-analyze-trace trace
```

After a fix, run both again to check that the hot spots shrank and no new ones appeared.

To profile the compiler's CPU use:

```bash
tsc --generateCpuProfile profile.cpuprofile
```

Open `profile.cpuprofile` in the Performance tab of Chrome DevTools to see which compiler functions take the most CPU time.

## Programmatic API

Besides the CLI, the package exports the report types and helpers that turn a report into a list of issues worth investigating. Importing it has no side effects.

```ts
import { readFileSync } from "node:fs";
import { analyzeProjectReport, type DiagnosticsResult } from "@push-based/tsc-diagnostics";

const report: DiagnosticsResult = JSON.parse(readFileSync("app-ts-diagnostics.json", "utf8"));
for (const issue of analyzeProjectReport(report)) {
  console.log(`[${issue.severity}] ${issue.title}: ${issue.recommendation}`);
}
```

`analyzeCompareReport` and `analyzeAggregatedReport` do the same for `compare` and `aggregate` output. `findCompileErrors(report)` returns the compile error lines tsc printed during a run.

## Development

```bash
npm install
npm run build   # rebuilds dist/ from scratch
npm test        # builds, then runs the test suite against dist/
```

`dist/` is committed on purpose, because installing from GitHub uses it as-is without a build step. Run `npm run build` and commit `dist/` with every source change. CI fails when `dist/` does not match the sources.

### Releasing

Pushing a version tag runs the [Publish workflow](.github/workflows/publish.yml), which publishes the package to npm. The workflow uses npm trusted publishing, so the repository stores no npm token.

1. Bump `version` in `package.json`, move the `CHANGELOG.md` entry out of "unreleased", run `npm run build`, and merge to `main`.
2. Tag that commit with the same version and push the tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow checks that the tag matches `package.json`, runs the tests, and publishes. Afterwards consumers can install `@push-based/tsc-diagnostics@1.0.0` or pin the GitHub tag `github:push-based/tsc-diagnostics#v1.0.0`.

#### One-time setup

- In the GitHub repository settings, create an environment named `release` under Environments. Ideally, limit it to `v*` tags or require approval.
- On npm, open the package's settings page and add a trusted publisher for GitHub Actions with organization `push-based`, repository `tsc-diagnostics`, workflow `publish.yml` and environment `release`. If no publish succeeds through a new trusted publisher within 48 hours, it expires and you have to create it again.
- If npm does not let you add a trusted publisher before the package exists, publish the first version by hand with `npm publish` from a clean checkout of the tag. `prepublishOnly` runs the tests first, and `publishConfig.access` is already `public`.
- npm only generates provenance for packages published from a public repository. While this repository is private, packages go out without it.
