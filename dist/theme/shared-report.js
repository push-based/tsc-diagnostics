/*
 * Shared report helpers — inlined into theme/layouts/list-layout.html,
 * theme/layouts/detail-layout.html, and theme/layouts/comparison-layout.html
 * between their SHARED_SCRIPT:START/END marker comments. Each layout template
 * already carries a working copy of this file so it renders correctly when
 * opened directly; src/theme-splice.ts refreshes that copy from this file at
 * report-generation time, so the two never drift apart. Keep this the single
 * source of truth for formatting/chart-mounting logic used across all three
 * reports; don't re-implement fmt/toSeconds/mountPlot/etc. locally in a
 * template again.
 *
 * Written as plain top-level declarations (no import/export) since it is
 * spliced as text into each template's `<script type="module">` block, not
 * loaded as a separate module file — the shipped HTML report stays a single
 * self-contained file.
 */

const fmtNumber = new Intl.NumberFormat("en-US");
const fmtPercent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

function fmt(n, digits = 1) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(n);
}

function toSeconds(metric) {
  if (!metric) return 0;
  const value = Number(metric.value);
  if (!Number.isFinite(value)) return 0;
  if (metric.unit === "milliseconds") return value / 1000;
  return value;
}

function toMiB(metric) {
  if (!metric) return 0;
  const value = Number(metric.value);
  if (!Number.isFinite(value)) return 0;
  if (metric.unit === "KiB") return value / 1024;
  if (metric.unit === "bytes") return value / (1024 * 1024);
  return value;
}

function toCount(metric) {
  if (!metric) return 0;
  const value = Number(metric.value);
  return Number.isFinite(value) ? value : 0;
}

// camelCase metric key -> "Human Label" (e.g. "checkTime" -> "Check time")
function labelize(key) {
  return key
    .replace(/TimeTime$/, " time")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^i O/i, "I/O")
    .replace(/^./, (s) => s.toUpperCase());
}

// Format a raw {value, unit} metric object for display (ms / MiB / count).
function formatMetric(metric) {
  if (metric.unit === "seconds") return `${(metric.value * 1000).toFixed(0)} ms`;
  if (metric.unit === "milliseconds") return `${metric.value.toFixed(0)} ms`;
  if (metric.unit === "KiB") return `${(metric.value / 1024).toFixed(1)} MiB`;
  return fmtNumber.format(metric.value);
}

// Format an already-normalized plain number for a given display unit.
function formatValue(value, unit) {
  if (unit === "ms") return `${value.toFixed(value < 10 ? 1 : 0)} ms`;
  if (unit === "MiB" || unit === "MB") return `${value.toFixed(1)} ${unit}`;
  return fmtNumber.format(Math.round(value));
}

// Relative change from a to b, or null when there's no meaningful baseline.
function delta(a, b) {
  return a === 0 ? (b === 0 ? 0 : null) : (b - a) / a;
}

function deltaText(a, b, unit = "") {
  const d = delta(a, b);
  if (d === null) return "new value";
  const signedAbs = Math.abs(b - a) >= 100 ? (b - a).toFixed(0) : (b - a).toFixed(1);
  return `${d > 0 ? "+" : ""}${(d * 100).toFixed(1)}% (${b - a > 0 ? "+" : ""}${signedAbs}${unit ? ` ${unit}` : ""})`;
}

// CSS class for a delta value — lower-is-better by default (time/memory metrics).
function deltaClass(d, lowerIsBetter = true) {
  if (d === null || Math.abs(d) < 0.001) return "pb-delta-flat";
  const good = lowerIsBetter ? d < 0 : d > 0;
  return good ? "pb-delta-good" : "pb-delta-bad";
}

// Severity/status -> badge class (see .pb-badge* in design-tokens.css).
function badgeClass(kind) {
  const map = {
    error: "pb-badge pb-badge--error",
    bad: "pb-badge pb-badge--bad",
    warn: "pb-badge pb-badge--warn",
    mid: "pb-badge pb-badge--mid",
    info: "pb-badge pb-badge--info",
    pass: "pb-badge pb-badge--pass",
    good: "pb-badge pb-badge--good",
    baseline: "pb-badge pb-badge--baseline",
  };
  return map[kind] || "pb-badge pb-badge--info";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}

// Qualitative chart palette — brand-tinted but wider than the 4 legal emphasis
// colors, since charts with many series (e.g. 11 compiler phases) need more
// distinguishable hues than the slide-deck emphasis-color rule allows.
const PB_CHART_PALETTE = [
  "#38bdf8", // sky (I/O read)
  "#875bf7", // pb-primary-600 (parse)
  "#a48afb", // pb-primary-400 (resolve module)
  "#c4b5fd", // light violet (resolve type ref)
  "#f472b6", // pink (resolve library)
  "#fbbf24", // pb-warning-400 (bind)
  "#d70033", // pb-secondary-700 (check — the expensive phase)
  "#84cc16", // lime (print)
  "#14b8a6", // teal (I/O write)
  "#22c55e", // pb-success-500 (emit)
  "#64748b", // slate (other)
];

// Tooltip styling shared by every Plot chart across all three reports.
const TIP_STYLE = { fill: "#ffffff", stroke: "#94a3b8", strokeWidth: 1 };

function plotWidth(containerId) {
  const el = document.getElementById(containerId);
  return Math.max(320, el.clientWidth - 24);
}

// Mount an Observable Plot chart into a `.pb-chart` container, wiring up the
// `data-title` heading and the scrollable `.pb-plot-root` wrapper.
function mountPlot(containerId, plot) {
  const el = document.getElementById(containerId);
  el.replaceChildren();

  const title = el.dataset.title;
  if (title) {
    const heading = document.createElement("h3");
    heading.className = "pb-chart-title";
    heading.textContent = title;
    el.appendChild(heading);
  }

  const wrap = document.createElement("div");
  wrap.className = "pb-plot-root";
  wrap.append(plot);
  el.appendChild(wrap);
}
