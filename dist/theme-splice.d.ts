/**
 * The layout templates under theme/layouts already contain a real, working
 * copy of theme/design-tokens.css and theme/shared-report.js between
 * `MARKER:START`/`MARKER:END` comments, so opening a template directly
 * (without running a generator) still renders fully styled demo data. Each
 * report generator calls this to refresh that copy with the current source
 * file at generation time, so the two never drift apart.
 */
export declare function spliceMarkerBlock(html: string, marker: string, content: string): string;
