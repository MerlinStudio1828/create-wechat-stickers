# WeChat delivery packaging

Read [wechat-platform.md](wechat-platform.md) for the current official constraints and the distinction between required submission assets and extra deliverables. This helper assembles existing generated artwork. It does not create banner artwork, remove a background, approve visual quality, or submit anything to WeChat.

## Inputs and album planning

Run `scripts/encode.cjs --project PROJECT` first. Packaging reads the encoder's output, file hashes and per-item technical reports. Every manifest item must have a current report; a 30-item project must have 30 passing reports. A missing item is an error, not an invitation to shrink the delivery.

Keep `manifest.json`, `raw/{id}.png`, generated ancillary artwork, and the actual generation prompt records in the project. Prompt records go in `prompts/` as JSON, Markdown, or text, or in `manifest.prompts`. Only those text records are copied. Original reference photos are excluded by default.

Relevant manifest fields:

```json
{
  "title": "人物表情全集",
  "items": [
    {"id":"01", "name":"来了", "meaning":"来了", "caption":"我来啦！", "group":"日常", "grid":{"cols":3,"rows":2}},
    {"id":"02", "name":"收到", "meaning":"收到", "caption":"收到！", "group":"日常", "grid":{"cols":4,"rows":2}}
  ],
  "authorAvatar": {"source":"art/author-portrait.png"},
  "authorHomepageBanner": "art/artist-banner.png",
  "albums": [
    {
      "id":"album-01",
      "title":"日常频道",
      "intro":"挥手、点头和喝茶，把日常的小动作放进聊天里。",
      "itemIds":["01","02"],
      "banner":"art/banner-a.png",
      "cover":{"source":"art/clean-portrait-a.png"},
      "icon":{"source":"art/clean-portrait-a.png", "crop":{"x":0.1,"y":0,"width":0.8,"height":0.8}},
      "avatar":{"source":"art/clean-portrait-a.png"}
    }
  ]
}
```

This two-item example illustrates the schema; it is a personal-use pack, not a platform-ready album. Normal albums contain 8–24 items. Album IDs and item IDs are unique safe identifiers; `itemIds` must cover every item exactly once, with no duplicates. Thirty items without `albums` split into `album-01` and `album-02`, 15 each; provide two real artworks in `manifest.banners`. Other counts up to 24 default to one album and require `manifest.banner`. Other larger counts require explicit albums. A user-requested pack with fewer than eight items can still be delivered, with submission readiness explicitly false.

Each artwork can be a path string or `{source, crop}`. Crop coordinates are normalized fractions (`x`, `y`, `width`, `height`, all within the source), applied after image orientation. This makes crops portable across resolutions. Square transparent assets use containment; rectangular banners use a centered cover crop. Inspect the exported crop, not just the original source. Paths resolve relative to the project; no user-specific paths belong in reusable skill instructions.

- Every album requires its own genuine banner artwork. The script never makes a placeholder or adds text to a banner. Artwork should already follow the no-text, non-white-background, nontransparent design guidance.
- `cover` is clean transparent character artwork without the sticker's white outline or caption. `icon` and `avatar` may reuse that clean source with suitable crops. A single-album project may provide `manifest.master` as the fallback clean source. Different albums need distinct cover and chat-icon designs.
- `authorAvatar` is required for the full default delivery. It may be dedicated character artwork; do not substitute a personal photograph unless the user selected it for that purpose. `artistAvatar` is accepted as an alias.
- `authorHomepageBanner` is optional as an input: its output is always included and may use the first album banner artwork, exported separately under the stricter 80,000-byte limit.
- `name` identifies the asset, `caption` is the visible sticker text, and `meaning` is its platform meaning label. These are different fields. Do not truncate a meaningful caption to fabricate a platform label.

For normal submission albums, provide an introduction and short, distinct meaning labels within each album. The helper checks Chinese title/intro/meaning limits (8/80/4 Han characters), punctuation and Chinese-title spaces, and exact duplicate cover/icon output hashes across albums. English or mixed-script length beyond the simple count is a warning to verify in the upload form, not an invented English-character prohibition. Different-looking artwork and natural, appropriate wording still require actual visual/editorial review; differing hashes alone do not establish distinct designs. `albumTitles` and `albumIntros` arrays can supply metadata for automatically split albums.

## Build, inspect, finalize

Use the Node executable returned by `load_workspace_dependencies` when `node` is unavailable in the terminal. Modules resolve through the shared runtime helper; it supports `STICKER_NODE_MODULES` / `NODE_PATH`. Packaging needs `sharp`, `@napi-rs/canvas`, and `jszip`. It makes no network requests or image-generation calls.

```sh
node scripts/package.cjs --project PROJECT --allow-unreviewed
```

This writes `PROJECT/delivery/`, including `gallery.html`, `overview.png`, exported ancillary artwork, actual GIFs, and `review-template.json`. Until the required artwork and reviews are complete, the archive is called `review-delivery.zip`, its gallery is visibly marked as incomplete, and `submissionAssetsReady` is false. The review build is for inspection, not a finished delivery claim. Technical failure remains an error even in review mode.

Codex performs the routine visual review itself by opening the real outputs; this is not a request for user approval. Inspect every item at actual size and enlarged, on both light and dark backgrounds, and inspect the moving GIF or representative decoded frames for pose order, animation, unwanted objects, caption correctness, clear transparency and clipping. Inspect every exported banner, cover, icon and avatar; pay special attention to a tiny 50-pixel icon and the heavily compressed homepage banner. Only after viewing each result, copy the template to `PROJECT/visual-review.json` and record an honest pass/fail with a brief concrete note. Do not bulk-populate `pass` from technical success.

```json
{
  "items": {
    "01": {
      "sourceHash": "SHA256 from the template",
      "outputHash": "SHA256 of the exact exported 240-pixel GIF",
      "status": "pass",
      "note": "Inspected actual animation and light/dark preview: caption correct, poses distinct, no edge debris."
    }
  },
  "assets": {
    "album-01.cover": {
      "outputHash": "SHA256 from the template",
      "status": "pass",
      "note": "Clean outline, transparent background, no caption, uncropped silhouette."
    }
  }
}
```

Item review requires both the current source-sheet hash and the exported GIF hash. A new caption, animation or source invalidates the old review. Ancillary reviews use hashes of their exact exported output, including crop/resize/compression. Asset keys are `{albumId}.banner`, `.cover`, `.icon`, `.avatar`, plus `authorAvatar` and `authorHomepageBanner`. When a review fails, repair the artwork, rebuild and inspect that changed output again. Never change a failure to pass merely to satisfy the script.

Then run the same command without `--allow-unreviewed`:

```sh
node scripts/package.cjs --project PROJECT
```

The final build refuses missing assets, missing prompt records, stale technical reports and unreviewed visual outputs. The final archive is `complete-delivery.zip`. A complete personal pack with fewer than eight items is still marked as unsuitable for album submission. No readiness flag means platform approval; every build reports `platformSubmitted:false`.

## Contents and safeguards

The final folder and ZIP contain all independent 240-pixel GIFs, 480-pixel enlarged GIFs, transparent static keyframes, per-album numbered GIFs, optional 120-pixel PNG thumbnails, covers, chat icons, character avatars, album banners, artist avatar and homepage banner, an offline search/filter gallery with light/dark views, static overview, a small six-item animated preview, prompt records, sanitized manifest metadata, and technical/visual review records.

`--no-thumbnails` omits the optional compatibility thumbnails; `--no-preview` omits only the small animated collage. The independent animations are never truncated to match the collage. The collage shows at most six items over 1.6 seconds; it is a convenient glance, not proof that all animations were inspected.

The helper builds into a temporary directory and replaces only a directory with its own marker and known file inventory after successful validation. Use `--destination OTHER_DIRECTORY` to preserve a previous deliverable. Files placed by someone else in the delivery folder cause replacement to stop. Inputs and encoder outputs are never removed. The ZIP uses only the newly assembled delivery directory, not an indiscriminate project-folder archive.

Only if the user explicitly requests original reference photos, set `manifest.originals` to the chosen files and add `--include-originals`. Do not enable this option for ordinary delivery. Absolute paths or reference notes inside a text prompt are not the original photos; still remove irrelevant private context from shared prompt records when appropriate.
