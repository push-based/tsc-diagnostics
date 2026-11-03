"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.spliceMarkerBlock = spliceMarkerBlock;
/**
 * The layout templates under theme/layouts already contain a real, working
 * copy of theme/design-tokens.css and theme/shared-report.js between
 * `MARKER:START`/`MARKER:END` comments, so opening a template directly
 * (without running a generator) still renders fully styled demo data. Each
 * report generator calls this to refresh that copy with the current source
 * file at generation time, so the two never drift apart.
 */
function spliceMarkerBlock(html, marker, content) {
    const pattern = new RegExp(`/\\* ${marker}:START[\\s\\S]*?${marker}:END \\*/`);
    if (!pattern.test(html)) {
        throw new Error(`Could not find ${marker} marker block in template`);
    }
    return html.replace(pattern, () => `/* ${marker}:START */\n${content}\n/* ${marker}:END */`);
}
