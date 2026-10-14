# Encoding a reviewed pose sheet

Use `scripts/encode.cjs` after artwork is available. The encoder uses `sharp` and `@napi-rs/canvas`; it needs neither FFmpeg nor an API key. It never generates missing artwork, changes the original PNG, or interprets technical success as visual approval.

## Runtime

Run with Node.js 20.9 or newer. The standalone skill includes pinned dependencies in `package.json` and `package-lock.json`: run `npm ci` in the skill directory when no bundled runtime is available. From the GitHub repository root, `npm run setup` performs that same installation. In Codex, `load_workspace_dependencies` reports the bundled executable if `node` is absent from the shell. The helper resolves packages normally, then from `STICKER_NODE_MODULES` or `NODE_PATH`, then the current user's standard Codex runtime cache. Do not copy a machine-specific absolute home path into a skill or manifest.

The runtime registers `StickerCN` from `STICKER_FONT`, or a Chinese-capable font from known macOS/Linux/Windows locations. It checks Unicode font tables for Chinese support and the caption's Han/Kana glyphs. If none exists or glyphs are missing, install a suitable font or set `STICKER_FONT`; do not silently render missing-glyph boxes. The light/dark review is the final check for all caption typography.

```sh
node /path/to/create-wechat-stickers/scripts/encode.cjs --project /absolute/project
node /path/to/create-wechat-stickers/scripts/encode.cjs --project /absolute/project --ids 01,02
```

## Project manifest

Inputs are `/absolute/project/manifest.json` and `/absolute/project/raw/{id}.png`. Keep IDs as strings to preserve leading zeroes. The shared manifest used by encoding and packaging is:

```json
{
  "title": "我们的旅行日常",
  "items": [
    {
      "id": "01",
      "name": "出发",
      "caption": "出发啦！",
      "group": "旅行",
      "grid": { "cols": 4, "rows": 2 },
      "holds": [5, 3, 3, 2, 8, 5, 5, 9],
      "hero": 4,
      "keyMode": "alpha"
    }
  ],
  "albums": [
    {
      "id": "travel",
      "title": "我们的旅行日常",
      "itemIds": ["01"],
      "banner": "assets/travel-banner.png",
      "cover": "assets/travel-cover.png",
      "icon": "assets/travel-icon.png",
      "avatar": "assets/travel-avatar.png"
    }
  ]
}
```

The album example illustrates the schema, not an upload-ready item count. Check current WeChat requirements and the packaging reference for deliverable fields and permitted album counts. Album artwork paths are relative to the project unless absolute. `output` optionally overrides the default `project/output` directory. Extra planning fields such as scene/pose descriptions are preserved by the manifest and ignored by encoding.

Per-item fields:

- `id`, `name`, `caption` are required; `caption` can be an empty string. `lines` can override the caption with one or two shorter strings. Text is typeset consistently after artwork generation, never painted by the image generator. Text below 18px at 240px is rejected; shorten or split it.
- `grid` defaults to 4 columns × 2 rows. A 3 × 2 sheet is supported. Both use row-major order, left-to-right then top-to-bottom, without visible gutters or labels.
- `holds` specifies positive integer frame counts per drawn pose. The defaults are `[5,3,3,2,8,5,5,9]` for eight poses (40 frames, 2 seconds) and `[4,2,2,6,4,6]` for six poses (24 frames, 1.2 seconds). Adjust these holds to fit the action; explicit values can total up to 200 frames (10 seconds), with at least one frame per pose. Arrange anticipation → fast action → impact → reaction/settle → return before encoding. The helper cannot determine whether the drawings express these actions.
- `hero` is a zero-based pose index for the still frame (defaults 4 of eight or 3 of six). `textColor` optionally sets the caption fill.
- `keyMode` defaults to `alpha`; a verified native alpha channel always takes priority. Explicit `magenta` or `green` activates a constrained fallback only if a solid matching matte is detected on the cell boundary. `protectedColors`, an optional array of `#RRGGBB` clothing/prop colors, blocks matching colors from removal; a direct matte conflict stops the item. Prefer native alpha, especially with green clothing, pink clothing, translucent elements, or enclosed gaps. Native alpha preserves every original color.

## What the helper guarantees

Fractional cell sizes are split using rounded start/end coordinates, so sheets such as 1774 × 887 work without dropping or repeating boundary pixels. Smaller cells are padded to a common canvas. All poses share one crop and display scale. A pose touching a cell edge stops that item instead of silently cutting hands, props, or neighboring art. If the sheet has incorrect alignment, repair the source or regenerate the affected item; the helper does not guess shifts.

The animation advances through genuinely separate drawn poses with expressive holds. It deliberately adds no whole-image wobble, crossfade, optical-flow interpolation, or ghost trails. Every encoded frame gets an explicit 50ms delay. Six-pose sheets default to 24 frames and eight-pose sheets to 40 frames; explicit holds determine the actual count, including retained duplicate hold frames. The 240px GIF loops infinitely and must remain strictly below 500,000 bytes. The 480px preview uses the same pose sequence and delays. Palette reduction has seven bounded attempts, never silent resolution, timing, or frame removal.

Outputs under `output`:

- `透明GIF_240/{id}_{name}.gif`: transparent 240 × 240 main animation.
- `放大GIF_480/{id}_{name}.gif`: transparent 480 × 480 matching preview.
- `静态关键帧_240/{id}_{name}.png`: binary-alpha hero image matching the GIF's still pose.
- `逐张检查/{id}_light-dark.png`: all six/eight poses against both light and dark backgrounds.
- `逐张检查/{id}.json`: source SHA-256, manifest-item hash, crop bounds, matte decisions, output hashes, explicit delays, per-frame transparency/edge counts and decoded-frame hashes.

The JSON uses `technicalStatus: "PASS"` only after decoding both GIFs and checking dimensions, frame count, loop, timing, size, binary alpha, non-empty subjects, transparent outer edges, distinct drawn poses, and held-frame stability. All six/eight poses must be distinct except that the final pose may exactly repeat the first to close the loop; every intervening pose must remain distinct. Such a report records `closingPoseRepeated: true` and five/seven unique frames. Duplicated interior poses and collapsed animation fail. `visualStatus` remains `NOT_REVIEWED`. A technical PASS is not evidence of identity, anatomy, clean matte extraction, expressive movement, readability, or a smooth loop.

Inspect the actual animated GIF and the light/dark strip, record a real review against source/output hashes as described in the packaging reference, and fix the failed item before delivery. The helper writes a FAIL report with the ID and reason for bad inputs, continues independent items, exits nonzero if anything failed, and leaves original art and prior output files untouched. A FAIL report invalidates prior PASS output for that ID. Rerun selected IDs after repairing them; do not delete source folders or retry generation without a bound.

`runtime.cjs` exports `sharp`, Canvas helpers, `ensureFont`, `loadModule`, `loadManifest`, `safeName`, `sha256`, and `writeJson` for the package helper. `ensureFont()` returns the chosen font path; render text using the registered family `StickerCN`.
