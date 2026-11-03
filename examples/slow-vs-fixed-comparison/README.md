# Slow vs. fixed comparison

This example runs `tsc-diagnostics` on
[push-based/ts-perf-experiments](https://github.com/push-based/ts-perf-experiments).
It first compares the slow and fixed versions of the whole `projects/test-lib-1`
project, then compares each example under `projects/test-lib-1/src/examples` on
its own. All paths below are relative to the root of a ts-perf-experiments
checkout with `@push-based/tsc-diagnostics` installed as a dev dependency, so
`npx tsc-diagnostics` works.

**Expect exit code 2 from the whole-project runs.** `tsconfig.slow.json` and
`tsconfig.fixed.json` include `src/**/*`, which pulls in
`09-workspace-package-as-source/consumer-example.ts`. Its `@workspace/config`
import only resolves through a `paths` alias in that example's own tsconfig, not
in the top-level one, so both runs hit the same `TS2307` error. The CLI still
writes the JSON and HTML reports before it exits, and both runs fail the same
way, so the error does not skew the comparison.

## Manual steps

Run from the ts-perf-experiments root:

```bash
# 0. Force a clean "fixed" build. tsconfig.fixed.json sets incremental: true,
#    so a leftover tsconfig.fixed.tsbuildinfo makes tsc skip the type check and
#    report almost no types or instantiations, which skews the comparison.
rm -f projects/test-lib-1/tsconfig.fixed.tsbuildinfo

# 0b. Delete earlier reports too. `compare` reads every report under
#     ts-diagnostics/, so reports from earlier runs would show up in the
#     comparison next to this run's.
rm -rf projects/test-lib-1/ts-diagnostics

# 1. Diagnostics for slow version
npx tsc-diagnostics diagnostics ./projects/test-lib-1 \
  -p tsconfig.slow.json \
  --mode extendedDiagnostics

# 2. Diagnostics for fixed version
npx tsc-diagnostics diagnostics ./projects/test-lib-1 \
  -p tsconfig.fixed.json \
  --mode extendedDiagnostics

# 3. Compare the two runs and write a JSON and an HTML report.
#    -n limits the comparison to this project's reports.
npx tsc-diagnostics compare ./projects/test-lib-1/ts-diagnostics -n test-lib-1
```

Open `ts-diagnostics/test-lib-1-compare-*.html` to see the report.

## Manual steps per example

Run these from the ts-perf-experiments root. Most examples pass their
`.slow.ts` and `.fixed.ts` files straight to `tsc` after `--`, instead of using
`-p` with a tsconfig. The flags after the file are the ones the example's
`tsconfig.*.json` sets, so each command works on its own.
`05-incremental-builds`, `09-workspace-package-as-source` and
`10-trace-resolution` need `include` globs or `paths` aliases, which only a
tsconfig can set, so they keep `-p`.

Each command writes its run to its own `-o` subfolder. Without that, both runs
land in the same timestamp folder, because the folder name only goes down to the
second. The second run's report then overwrites the first, and `compare` finds
only one report.

The subfolders are always named `slow` and `fixed`, to match the example's
`tsconfig.slow.json` and `tsconfig.fixed.json`, or its `.slow.ts` and
`.fixed.ts` files. That holds even when the example's README uses other words,
such as `bad` and `good` or `incremental` and `no-incremental`. Use those words
in prose only, and keep file and folder names as `slow` and `fixed`.

```bash
# 0. Force a clean "fixed" build. tsconfig.fixed.json sets incremental: true,
#    so a leftover tsconfig.fixed.tsbuildinfo makes tsc skip the type check and
#    report almost no types or instantiations, which skews the comparison.
rm -f projects/test-lib-1/tsconfig.fixed.tsbuildinfo

# 0b. Delete earlier reports too. `compare` reads every report under
#     ts-diagnostics/, so reports from earlier runs would show up in the
#     comparison next to this run's.
rm -rf projects/test-lib-1/ts-diagnostics
```

### 01-distributive-conditional

```bash
npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/01-distributive-conditional \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/01-distributive-conditional/ts-diagnostics/slow \
  -- ./distributive-conditional.slow.ts --strict --noEmit --skipLibCheck --incremental false --target ES2022 --module ESNext

npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/01-distributive-conditional \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/01-distributive-conditional/ts-diagnostics/fixed \
  -- ./distributive-conditional.fixed.ts --strict --noEmit --skipLibCheck --incremental false --target ES2022 --module ESNext

npx tsc-diagnostics compare \
  ./projects/test-lib-1/src/examples/01-distributive-conditional/ts-diagnostics/slow \
  ./projects/test-lib-1/src/examples/01-distributive-conditional/ts-diagnostics/fixed \
  -o ./projects/test-lib-1/src/examples/01-distributive-conditional/ts-diagnostics \
  -n 01-distributive-conditional
```

### 02-nested-distributive-conditionals

```bash
npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/02-nested-distributive-conditionals \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/02-nested-distributive-conditionals/ts-diagnostics/slow \
  -- ./nested-distributive-conditionals.slow.ts --strict --noEmit --skipLibCheck --incremental false --target ES2022 --module ESNext

npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/02-nested-distributive-conditionals \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/02-nested-distributive-conditionals/ts-diagnostics/fixed \
  -- ./nested-distributive-conditionals.fixed.ts --strict --noEmit --skipLibCheck --incremental false --target ES2022 --module ESNext

npx tsc-diagnostics compare \
  ./projects/test-lib-1/src/examples/02-nested-distributive-conditionals/ts-diagnostics/slow \
  ./projects/test-lib-1/src/examples/02-nested-distributive-conditionals/ts-diagnostics/fixed \
  -o ./projects/test-lib-1/src/examples/02-nested-distributive-conditionals/ts-diagnostics \
  -n 02-nested-distributive-conditionals
```

### 03-recursive-tuple-construction

```bash
npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/03-recursive-tuple-construction \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/03-recursive-tuple-construction/ts-diagnostics/slow \
  -- ./recursive-tuple-construction.slow.ts --strict --noEmit --skipLibCheck --incremental false --target ES2022 --module ESNext

npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/03-recursive-tuple-construction \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/03-recursive-tuple-construction/ts-diagnostics/fixed \
  -- ./recursive-tuple-construction.fixed.ts --strict --noEmit --skipLibCheck --incremental false --target ES2022 --module ESNext

npx tsc-diagnostics compare \
  ./projects/test-lib-1/src/examples/03-recursive-tuple-construction/ts-diagnostics/slow \
  ./projects/test-lib-1/src/examples/03-recursive-tuple-construction/ts-diagnostics/fixed \
  -o ./projects/test-lib-1/src/examples/03-recursive-tuple-construction/ts-diagnostics \
  -n 03-recursive-tuple-construction
```

### 04-deep-recursive-object

```bash
npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/04-deep-recursive-object \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/04-deep-recursive-object/ts-diagnostics/slow \
  -- ./deep-recursive-object.slow.ts --strict --noEmit --skipLibCheck --incremental false --target ES2022 --module ESNext

npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/04-deep-recursive-object \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/04-deep-recursive-object/ts-diagnostics/fixed \
  -- ./deep-recursive-object.fixed.ts --strict --noEmit --skipLibCheck --incremental false --target ES2022 --module ESNext

npx tsc-diagnostics compare \
  ./projects/test-lib-1/src/examples/04-deep-recursive-object/ts-diagnostics/slow \
  ./projects/test-lib-1/src/examples/04-deep-recursive-object/ts-diagnostics/fixed \
  -o ./projects/test-lib-1/src/examples/04-deep-recursive-object/ts-diagnostics \
  -n 04-deep-recursive-object
```

### 05-incremental-builds

This example needs `include: ["./generated/**/*"]` and a `tsBuildInfoFile`,
and neither can be passed as forwarded arguments, so it keeps `-p`. Delete any
leftover `tsconfig.fixed.tsbuildinfo` first, for the same reason as step 0
above. With a cached buildinfo, the incremental (`fixed`) run reports almost no
types or instantiations instead of the numbers for a cold first build:

```bash
rm -f ./projects/test-lib-1/src/examples/05-incremental-builds/tsconfig.fixed.tsbuildinfo

npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/05-incremental-builds \
  -p tsconfig.slow.json \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/05-incremental-builds/ts-diagnostics/slow

npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/05-incremental-builds \
  -p tsconfig.fixed.json \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/05-incremental-builds/ts-diagnostics/fixed

npx tsc-diagnostics compare \
  ./projects/test-lib-1/src/examples/05-incremental-builds/ts-diagnostics/slow \
  ./projects/test-lib-1/src/examples/05-incremental-builds/ts-diagnostics/fixed \
  -o ./projects/test-lib-1/src/examples/05-incremental-builds/ts-diagnostics \
  -n 05-incremental-builds
```

### 06-skip-lib-check

Both runs compile the same file. Only `--skipLibCheck` changes:

```bash
npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/06-skip-lib-check \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/06-skip-lib-check/ts-diagnostics/slow \
  -- ./skip-lib-check-example.ts --target ES2020 --module commonjs --moduleResolution node --strict --esModuleInterop --noEmit --incremental false --skipLibCheck false

npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/06-skip-lib-check \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/06-skip-lib-check/ts-diagnostics/fixed \
  -- ./skip-lib-check-example.ts --target ES2020 --module commonjs --moduleResolution node --strict --esModuleInterop --noEmit --incremental false --skipLibCheck true

npx tsc-diagnostics compare \
  ./projects/test-lib-1/src/examples/06-skip-lib-check/ts-diagnostics/slow \
  ./projects/test-lib-1/src/examples/06-skip-lib-check/ts-diagnostics/fixed \
  -o ./projects/test-lib-1/src/examples/06-skip-lib-check/ts-diagnostics \
  -n 06-skip-lib-check
```

### 07-union-type-reduction

```bash
npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/07-union-type-reduction \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/07-union-type-reduction/ts-diagnostics/slow \
  -- ./union-type-reduction.slow.ts --strict --noEmit --skipLibCheck --incremental false --target ES2022 --module ESNext

npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/07-union-type-reduction \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/07-union-type-reduction/ts-diagnostics/fixed \
  -- ./union-type-reduction.fixed.ts --strict --noEmit --skipLibCheck --incremental false --target ES2022 --module ESNext

npx tsc-diagnostics compare \
  ./projects/test-lib-1/src/examples/07-union-type-reduction/ts-diagnostics/slow \
  ./projects/test-lib-1/src/examples/07-union-type-reduction/ts-diagnostics/fixed \
  -o ./projects/test-lib-1/src/examples/07-union-type-reduction/ts-diagnostics \
  -n 07-union-type-reduction
```

### 08-intersection-to-interface

```bash
npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/08-intersection-to-interface \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/08-intersection-to-interface/ts-diagnostics/slow \
  -- ./intersection-to-interface.slow.ts --strict --noEmit --skipLibCheck --incremental false --target ES2022 --module ESNext

npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/08-intersection-to-interface \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/08-intersection-to-interface/ts-diagnostics/fixed \
  -- ./intersection-to-interface.fixed.ts --strict --noEmit --skipLibCheck --incremental false --target ES2022 --module ESNext

npx tsc-diagnostics compare \
  ./projects/test-lib-1/src/examples/08-intersection-to-interface/ts-diagnostics/slow \
  ./projects/test-lib-1/src/examples/08-intersection-to-interface/ts-diagnostics/fixed \
  -o ./projects/test-lib-1/src/examples/08-intersection-to-interface/ts-diagnostics \
  -n 08-intersection-to-interface
```

### 09-workspace-package-as-source

The `paths` alias (`package-lib/src/index.ts` vs `package-lib/dist/index.d.ts`)
only exists in the tsconfig, so this one keeps `-p` too:

```bash
npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/09-workspace-package-as-source \
  -p tsconfig.slow.json \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/09-workspace-package-as-source/ts-diagnostics/slow

npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/09-workspace-package-as-source \
  -p tsconfig.fixed.json \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/09-workspace-package-as-source/ts-diagnostics/fixed

npx tsc-diagnostics compare \
  ./projects/test-lib-1/src/examples/09-workspace-package-as-source/ts-diagnostics/slow \
  ./projects/test-lib-1/src/examples/09-workspace-package-as-source/ts-diagnostics/fixed \
  -o ./projects/test-lib-1/src/examples/09-workspace-package-as-source/ts-diagnostics \
  -n 09-workspace-package-as-source
```

### 10-trace-resolution

This one keeps `-p` for the same reason as `09`. The `paths` override it tests
only exists in `tsconfig.slow.json`:

```bash
npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/10-trace-resolution \
  -p tsconfig.slow.json \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/10-trace-resolution/ts-diagnostics/slow

npx tsc-diagnostics diagnostics ./projects/test-lib-1/src/examples/10-trace-resolution \
  -p tsconfig.fixed.json \
  --mode extendedDiagnostics \
  -o ./projects/test-lib-1/src/examples/10-trace-resolution/ts-diagnostics/fixed

npx tsc-diagnostics compare \
  ./projects/test-lib-1/src/examples/10-trace-resolution/ts-diagnostics/slow \
  ./projects/test-lib-1/src/examples/10-trace-resolution/ts-diagnostics/fixed \
  -o ./projects/test-lib-1/src/examples/10-trace-resolution/ts-diagnostics \
  -n 10-trace-resolution
```

### All examples combined

Each example above has its own compare report. This command puts all of them in
one report. The `*/ts-diagnostics` glob matches each example's `ts-diagnostics`
folder one level down. It does not match the output folder
`src/examples/ts-diagnostics`, which sits next to the example folders rather
than inside one, and `README.template.md` is not a folder. So the command needs
no list of examples and no `-n` filter, and it picks up new examples without
changes.

```bash
npx tsc-diagnostics compare \
  ./projects/test-lib-1/src/examples/*/ts-diagnostics \
  -o ./projects/test-lib-1/src/examples/ts-diagnostics
```

`compare` warns "Reports from multiple projects found" and lists all 10. That is expected, since each example is its own target. The output file is named after the first project it read, for example `01-distributive-conditional-compare-*.html`. The report inside still groups every example by its `Target` column.
