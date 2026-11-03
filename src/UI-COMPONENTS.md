# Report template UI components

This file describes the UI components of the three HTML report templates in `theme/layouts/`.
Each template is one self-contained file. The CLI replaces a `{{PLACEHOLDER}}` in it with JSON
data, and the page renders in the browser without a build step.

| Template | Data placeholder | Scope | Styling |
|---|---|---|---|
| [theme/layouts/list-layout.html](theme/layouts/list-layout.html) | `{{AGGREGATED_REPORT}}` | Many solutions, one snapshot in time | Hand-written CSS |
| [theme/layouts/detail-layout.html](theme/layouts/detail-layout.html) | `{{REPORT_DATA}}` | One solution, one run | Tailwind CSS (CDN) |
| [theme/layouts/comparison-layout.html](theme/layouts/comparison-layout.html) | `{{COMPARE_REPORTS}}` | One project, many runs over time | Tailwind CSS (CDN) |

All three draw charts with [Observable Plot](https://observablehq.com/plot/), which they import
from a CDN at runtime as an ES module (`import * as Plot from ".../+esm"`). There is no bundler.

---

## Shared components

These components appear in all three templates, except where noted:

- **Card.** A rounded, bordered panel (`.card`, or Tailwind `rounded-2xl border border-white/10`)
  that holds metrics, charts and tables.
- **Summary card grid.** A grid of cards (`#cards` or `#summaryCards`), each showing one label and
  one large value. It shows 1 to 4 columns depending on the viewport width.
- **Chart mount point.** An empty `<div>` with an id, such as `#timeChart`, `#timingPlot` or
  `#trendPlot`. The script fills it with an Observable Plot SVG, either with `Plot.plot({...})`
  and `element.append(plot)` or through a small `mountPlot()` or `addPlot()` helper.
- **Badge.** A small rounded label for a severity (`error`, `warn`, `info`, `pass`) or a status
  such as `Healthy`, the mode name or the baseline marker.
- **Embedded JSON.** A `const data = {{PLACEHOLDER}}` line that the CLI fills in before writing
  the file. If the placeholder is empty or malformed, each template falls back to an empty state,
  demo data or a caught render error instead of breaking.
- **Print styles.** detail-layout and comparison-layout have a `@media print` block that turns the
  background white and hides `.no-print` elements such as buttons, drop zones and toggles, so the
  page prints cleanly to PDF.

---

## theme/layouts/list-layout.html

A dark dashboard with hand-written CSS that summarizes many tsconfig solutions from one
aggregated diagnostics run. A single `<script type="module">` block renders the page. It converts
`embeddedAggregatedReport` into chart rows with `fromAggregatedReport()`.

- **Header.** A title and a subtitle naming the source command (`tsc -b --extendedDiagnostics`).
- **Status bar** (`.status`). A colored dot and a line of text showing the load state. After
  rendering succeeds, it reads "Loaded … generated …".
- **Summary cards** (`#cards`). Cards for total configs, diagnostics coverage, summed total time,
  summed check time, check-time share and peak memory.
- **Chart grid** (`.grid`). Two columns that collapse to one on narrow screens, holding four charts:
  - **Compiler phases by solution** (`#timeChart`, full width). A stacked bar chart (`Plot.barY`)
    with one bar per solution. Each segment is a compiler phase (I/O read, parse, resolve, bind,
    check, print, emit and so on), colored from the shared `COMPILER_PHASES` palette.
  - **Generic/type instantiations** (`#instChart`). A horizontal bar chart (`Plot.barX`) that ranks
    solutions by instantiation count.
  - **Scale profile** (`#scatterChart`). A bubble chart (`Plot.dot` with `Plot.text` labels) of
    files on x against total time on y. Bubble size shows memory use.
  - **E2E example** (`#e2eChart`, full width). A small bar chart of Program, Bind, Check and Total
    time for the slowest solution, with value labels and a caption listing its files, types,
    instantiations and memory.
- **Notes** (`#notes`). A grid of text cards about where the data came from and its caveats.
- **Tsconfig performance check** (`#configCheck`). Hidden when `config_check` is `null`. It contains:
  - **Config cards.** Counts of errors, warnings, infos, passed checks and audited configs, colored
    by severity (`.config-card.error`, `.warn`, `.pass`).
  - **Workflow list** (`<ol class="workflow-list">`). The audit steps that ran, in order.
  - **Finding table** (`.finding-table`). One row per issue, with a severity `.badge`, the config
    path and its role, the finding message, and an optional recommendation.
- On `window.resize`, the charts render again (`render(cachedData)`), because Plot takes its width
  from the container's `clientWidth` at render time (`plotWidth()`).

## theme/layouts/detail-layout.html

A Tailwind report for one solution and one compiler run. It loads the Tailwind browser build from
a CDN and adds an inline `@theme` and `@layer` block, so there is no separate CSS build.

- **Background** (`no-print`). Two blurred gradient blobs, hidden when printing.
- **Header.** Small badges above the title ("TypeScript Compiler" and the mode), the page title, a
  one-line description naming the target, and two buttons. **Print / Save PDF** calls
  `window.print()`. **Copy summary** copies a one-line text summary to the clipboard, and the
  button label briefly changes to "Copied".
- **Summary cards** (`#summaryCards`). Four cards in cyan, indigo, emerald and amber, showing wall
  duration, compiler total with its share of wall time, type-check time with its share of compiler
  time, and memory with the number of files loaded.
- **Two-column section**, with:
  - **Compiler phase timings** (`#timingPlot`). A horizontal bar chart of every non-zero phase
    (Program, Parse, Bind, Check, Resolve modules, Resolve libraries, Emit, Print), longest first,
    with each bar labeled in milliseconds. A status badge reads "Healthy", "Check-heavy" or
    "Compile failed".
  - **Source composition** (`#linesPlot` and `#compositionLegend`). One stacked bar labeled
    "Source", split into Definitions, Library and TypeScript line counts, with the total in large
    centered text on top. A legend below gives each part's count and percentage.
- **Interpretation section**, with:
  - **Insights** (`#insights`). Up to four numbered cards of generated text about checker hot
    spots, the share of setup cost, dependency-heavy composition, and the caveat that one run is a
    single sample.
  - **Run metadata** (`#metadata`). A definition list (`<dl>`) of the target, mode, exit code,
    generation time, working directory and command.
- **Trace analysis** (`#traceAnalysisSection`). A collapsible `<details>` section, shown only when
  `report.traceAnalysis` exists. It shows the `@typescript/analyze-trace` command line, its exit
  code, the output file path, and the raw output or error text in a `<pre>` block.
- **All metrics.** A collapsible `<details>` section, closed by default, with a table
  (`#metricsTable`) of every key in `report.metrics`. Each row shows the metric's label, a
  formatted value, the raw value and the unit.
- **Footer.** A fixed caption and the generation timestamp.

## theme/layouts/comparison-layout.html

A Tailwind dashboard for one project across many runs. It is the most interactive of the three
templates. You can import more report files in the browser, and the page keeps them in memory
only, so nothing survives a reload.

- **Background** (`no-print`). The same blurred blobs as in detail-layout.
- **Header.** Badges, a title, a description and three controls. **Import JSON reports** is a
  `<label>` styled as a button around a hidden multi-file `<input type="file">`. **Load demo
  runs** adds six made-up runs, so you can try the UI without real data. **Print / PDF** prints
  the page.
- **Drop zone** (`#dropZone`, `no-print`). A panel with a dashed border that accepts dragged JSON
  files and highlights on `dragenter` and `dragover`.
- **Empty state** (`#emptyState`). Visible until at least one valid report has loaded.
- **Dashboard** (`#dashboard`). Hidden until there is data. It contains:
  - **Project selector** (`#projectSelect`, `#projectListbox`). A custom combobox rather than a
    native `<select>`, with ARIA roles and states (`role="combobox"`, `role="listbox"`,
    `aria-expanded`, `aria-activedescendant`). Arrow Up and Down move between projects, Home and
    End jump to the first and last, Enter, Space or a click opens and closes the list, and Escape
    or a click outside closes it. It groups the imported reports by `targetName`.
  - **Summary cards** (`#summaryCards`). Four metrics for the latest selected run: wall duration,
    compiler total, check time and memory. Each shows the change from the baseline, which is the
    oldest selected run, colored by whether the metric improved (`goodClass`).
  - **Performance over time** (`#trendPlot`). A line chart with dots for one metric, picked in the
    `#trendMetric` `<select>`, across every run of the current project. Each point has a Plot
    tooltip.
  - **Selected run comparison** (`#comparisonPlot`). A bar chart of the five main compiler phases,
    with a **By run** / **By phase** toggle:
    - *By run* shows one group per run on the x axis, with the phases stacked (`Plot.barY` with
      `fill: phase`).
    - *By phase* uses one facet (`fx`) per phase, with the runs as side-by-side bars inside each
      facet, so you can compare bar heights across runs.
  - **Impact against baseline** (`#insights`). A large sortable table. Metrics fall into four
    groups (Program scale, Type system, Caches & memory, Phase timings), and chip buttons
    (`#insightsFilters`) show or hide each group. Three presets set them all at once: **Key
    metrics**, **All** and **None**. Clicking a column header sorts by value or by Δ%, cycling
    through ascending, descending and off, with a `▲`, `▼` or `↕` indicator. Each run's row shows
    the value and the change from the baseline for every visible metric, and a badge marks the
    baseline row.
  - **Run history** (`#historyTable`). A table of every imported run, newest import first. Each
    row shows total, check and program time, memory, files, types and instantiations, with a
    **Remove** button. The **Export combined JSON** button in the header downloads all runs of the
    current project as one JSON file.
- **Footer.** A fixed caption noting that the page loads its libraries from a CDN.
