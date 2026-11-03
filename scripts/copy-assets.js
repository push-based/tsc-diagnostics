#!/usr/bin/env node
// Copies the report theme assets the CLI reads at runtime into dist/.
// Plain Node instead of cp/mkdir so the build also works on Windows.
const { cpSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const assets = [
    "theme/design-tokens.css",
    "theme/shared-report.js",
    "theme/layouts/detail-layout.html",
    "theme/layouts/list-layout.html",
    "theme/layouts/comparison-layout.html",
];

for (const asset of assets) {
    const target = join(root, "dist", asset);
    mkdirSync(join(target, ".."), { recursive: true });
    cpSync(join(root, "src", asset), target);
}

console.log(`Copied ${assets.length} theme assets to dist/`);
