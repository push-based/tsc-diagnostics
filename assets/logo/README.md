# tsc-diagnostics logo — Pulse

Code brackets around a heartbeat line: a diagnostic reading taken from the TypeScript compiler. The bright dot marks the peak, the hotspot the reports point you to.

## Files

| File | Use |
|---|---|
| `tsc-diagnostics-icon.svg` / `-icon-dark.svg` | App icon, avatar, social media profile picture |
| `tsc-diagnostics-favicon.svg`, `favicon.ico` | Browser tab. Thicker strokes and one spike so it reads at 16–32px |
| `tsc-diagnostics-glyph.svg` / `-glyph-white.svg` | Mark without its tile, for coloured backgrounds |
| `tsc-diagnostics-horizontal.svg` / `-horizontal-dark.svg` | README header, website header |
| `tsc-diagnostics-vertical.svg` / `-vertical-dark.svg` | Slides, stickers, square spaces |
| `tsc-diagnostics-wordmark.svg` / `-wordmark-dark.svg` | Name only |
| `tsc-diagnostics-*-mono*.svg` | Flat, one colour, for print, embossing and badges |
| `png/` | Ready-made PNGs with transparent backgrounds (icon 256 and 512, horizontal and vertical at 2×) |

Use the `-dark` files on dark backgrounds.

## Colours

| Role | Values |
|---|---|
| Tile | `#1C3D72` → `#0B1F3A` (dark version: `#28508F` → `#132C55`) |
| Brackets | `#6CB4FF` → `#2F6FC0` |
| Pulse | `#FF4F8B` → `#FF9A3D`, with a soft glow |
| `tsc` in the name | `#4D9DF5` → `#2A62B0` |
| Rest of the name | `#0B1F3A` (white on dark backgrounds) |
| Flat versions | TypeScript blue `#3178C6`, navy `#0B1F3A`, pink `#FF4F8B` |

## Type

The name is set in **Geist** (ExtraBold for `tsc`, SemiBold for `-diagnostics`) and converted to outlines, so you don't need the font to display it.

## Usage

- Leave clear space around the logo of at least a quarter of the icon's height.
- Use the horizontal version at 120px wide or more; below that, use the icon. Below 32px, use the favicon.
- Don't stretch, recolour or rotate the logo, and don't put the coloured version on busy photos. Use a flat version there instead.
- The glow uses an SVG blur filter. Browsers, Figma and Inkscape render it. Simpler renderers can get it wrong: ImageMagick's built-in one drops the brackets and pulse line completely. Where you need a bitmap, use the files in `png/`, which were exported from Chrome.
