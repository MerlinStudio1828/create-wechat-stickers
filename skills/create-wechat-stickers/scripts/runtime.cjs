'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function loadModule(name) {
  const locations = [
    ...(process.env.STICKER_NODE_MODULES || '').split(path.delimiter),
    ...(process.env.NODE_PATH || '').split(path.delimiter),
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
  ].filter(Boolean);
  try { return require(name); } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  for (const root of locations) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) return require(candidate);
  }
  throw new Error(`Missing ${name}. Run npm ci inside the skill directory to install sharp, @napi-rs/canvas and jszip, or set STICKER_NODE_MODULES to their node_modules directory. In Codex, load_workspace_dependencies reports the bundled Node executable and packages.`);
}
const sharp = loadModule('sharp');
const { createCanvas, loadImage, GlobalFonts } = loadModule('@napi-rs/canvas');
let fontPath, fontCoverage;
// Inspect Unicode cmap tables so a supplied Latin-only font cannot pass registration
// and silently fall back to missing-glyph boxes. TTC, TTF and OTF share these tables.
function readFontCoverage(file) {
  const data = fs.readFileSync(file), subtables = [];
  const faces = data.toString('ascii', 0, 4) === 'ttcf'
    ? Array.from({ length: data.readUInt32BE(8) }, (_, i) => data.readUInt32BE(12 + i * 4)) : [0];
  for (const face of faces) {
    const count = data.readUInt16BE(face + 4);
    for (let i = 0; i < count; i++) {
      const table = face + 12 + i * 16;
      if (data.toString('ascii', table, table + 4) !== 'cmap') continue;
      const cmap = data.readUInt32BE(table + 8), encodings = data.readUInt16BE(cmap + 2);
      for (let n = 0; n < encodings; n++) {
        const rec = cmap + 4 + n * 8, platform = data.readUInt16BE(rec), encoding = data.readUInt16BE(rec + 2);
        if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue;
        const start = cmap + data.readUInt32BE(rec + 4), format = data.readUInt16BE(start);
        if ([4, 12, 13].includes(format)) subtables.push({ start, format });
      }
    }
  }
  return cp => subtables.some(({ start, format }) => {
    if (format === 4) {
      if (cp > 65535) return false;
      const n = data.readUInt16BE(start + 6) / 2, ends = start + 14, starts = ends + n * 2 + 2, deltas = starts + n * 2, ranges = deltas + n * 2;
      for (let i = 0; i < n; i++) {
        const end = data.readUInt16BE(ends + i * 2), begin = data.readUInt16BE(starts + i * 2);
        if (cp < begin || cp > end) continue;
        const delta = data.readInt16BE(deltas + i * 2), range = data.readUInt16BE(ranges + i * 2);
        if (!range) return ((cp + delta) & 65535) !== 0;
        const glyph = data.readUInt16BE(ranges + i * 2 + range + (cp - begin) * 2);
        return glyph !== 0 && ((glyph + delta) & 65535) !== 0;
      }
      return false;
    }
    const groups = data.readUInt32BE(start + 12);
    for (let i = 0; i < groups; i++) {
      const pos = start + 16 + i * 12, first = data.readUInt32BE(pos), last = data.readUInt32BE(pos + 4);
      if (cp >= first && cp <= last) return data.readUInt32BE(pos + 8) + (format === 12 ? cp - first : 0) !== 0;
    }
    return false;
  });
}
function ensureFont(text = '') {
  if (fontPath) {
    const missing = [...text].filter(c => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(c) && !fontCoverage(c.codePointAt(0)));
    if (missing.length) throw new Error(`STICKER_FONT lacks caption glyphs: ${[...new Set(missing)].join('')}. Choose a font covering these characters.`);
    return fontPath;
  }
  const candidates = process.env.STICKER_FONT ? [process.env.STICKER_FONT] : [
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'msyh.ttc'),
    path.join(os.homedir(), '.local/share/fonts/NotoSansCJK-Regular.ttc')
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    let coverage;
    try { coverage = readFontCoverage(file); } catch { continue; }
    if (![...'你好微信'].every(c => coverage(c.codePointAt(0)))) continue;
    if (!GlobalFonts.registerFromPath(file, 'StickerCN')) continue;
    fontPath = path.resolve(file); fontCoverage = coverage; return ensureFont(text);
  }
  throw new Error('No usable Chinese font. Set STICKER_FONT to a Chinese-capable .ttf/.otf/.ttc file (for example Noto Sans CJK), then retry.');
}
function safeName(item, ext) {
  const name = String(item.name || item.id).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/g, '');
  if (!name) throw new Error(`Empty filename for item ${item.id}`);
  return `${item.id}_${name}.${ext}`;
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temp, file);
}
function loadManifest(project) {
  project = path.resolve(project);
  const manifest = JSON.parse(fs.readFileSync(path.join(project, 'manifest.json'), 'utf8'));
  if (!manifest || !Array.isArray(manifest.items) || !manifest.items.length) throw new Error('manifest.json must contain a non-empty items array.');
  const ids = new Set();
  const items = manifest.items.map(raw => {
    const item = { ...raw, id: String(raw.id ?? '') };
    if (!/^[A-Za-z0-9_-]+$/.test(item.id)) throw new Error('Each item id must be a safe, non-empty string such as "01".');
    if (ids.has(item.id)) throw new Error(`Duplicate item id: ${item.id}`);
    ids.add(item.id);
    if (typeof item.name !== 'string' || !item.name.trim()) throw new Error(`Item ${item.id} requires name.`);
    if (typeof item.caption !== 'string') throw new Error(`Item ${item.id} requires caption (empty string is allowed).`);
    return item;
  });
  return { project, manifest, items, output: path.resolve(project, manifest.output || 'output') };
}
module.exports = { sharp, createCanvas, loadImage, GlobalFonts, ensureFont, loadModule, loadManifest, safeName, sha256, writeJson };
