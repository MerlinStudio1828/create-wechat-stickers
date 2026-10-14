#!/usr/bin/env node
'use strict';
// Drawn pose holds only: no crossfade, optical flow, or artificial whole-image wiggle.
const fs = require('fs');
const path = require('path');
const { sharp, createCanvas, loadImage, ensureFont, loadManifest, safeName, sha256, writeJson } = require('./runtime.cjs');
const FPS = 20, DELAY = 50, MAX_BYTES = 500000;
const DIRS = ['透明GIF_240', '放大GIF_480', '静态关键帧_240', '逐张检查'];
function linesFor(item) {
  const lines = item.lines || (item.caption ? item.caption.split('\n') : []);
  if (!Array.isArray(lines) || lines.length > 2 || lines.some(x => typeof x !== 'string')) throw new Error(`${item.id}: use zero, one, or two caption lines.`);
  return lines;
}
function settings(item) {
  const grid = item.grid || { cols: 4, rows: 2 };
  if (grid.rows !== 2 || ![3, 4].includes(grid.cols)) throw new Error(`${item.id}: supported grids are 4×2 and 3×2.`);
  const count = grid.cols * grid.rows;
  const holds = item.holds || (count === 8 ? [5, 3, 3, 2, 8, 5, 5, 9] : [4, 2, 2, 6, 4, 6]);
  if (!Array.isArray(holds) || holds.length !== count || holds.some(x => !Number.isInteger(x) || x < 1)) throw new Error(`${item.id}: holds must contain ${count} positive integers.`);
  const n = holds.reduce((a, b) => a + b, 0);
  if (n > 200) throw new Error(`${item.id}: holds may total at most 200 frames (10 seconds at 20fps).`);
  const hero = item.hero ?? (count === 8 ? 4 : 3);
  if (!Number.isInteger(hero) || hero < 0 || hero >= count) throw new Error(`${item.id}: hero must be a zero-based pose index.`);
  linesFor(item);
  return { grid, count, holds, hero, n, sequence: holds.flatMap((n, i) => Array(n).fill(i)) };
}
function mattePixel(r, g, b, mode) {
  return mode === 'magenta' ? r > 210 && b > 210 && g < 45 && Math.abs(r - b) < 45 : g > 210 && r < 45 && b < 45;
}
function decodeColor(s) {
  if (!/^#[a-fA-F0-9]{6}$/.test(s)) throw new Error('protectedColors must contain #RRGGBB strings.');
  return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
}
function cleanBackground(input, width, height, item) {
  const data = Buffer.from(input), pixels = width * height;
  let transparent = 0, boundaryTransparent = 0, boundaryPixels = 0;
  for (let p = 0; p < pixels; p++) {
    const x = p % width, y = Math.floor(p / width), alpha = data[p * 4 + 3];
    if (alpha < 16) transparent++;
    if (!x || !y || x === width - 1 || y === height - 1) { boundaryPixels++; if (alpha < 16) boundaryTransparent++; }
  }
  // Real alpha always wins; never key actual clothing colors in an already-transparent image.
  if (transparent > pixels * 0.01 && boundaryTransparent > boundaryPixels * 0.5) {
    for (let i = 0; i < data.length; i += 4) if (!data[i + 3]) data.fill(0, i, i + 4);
    return { data, mode: 'native-alpha', transparent, boundaryTransparent, removedPixels: 0 };
  }
  const mode = item.keyMode || 'alpha';
  if (!['magenta', 'green'].includes(mode)) throw new Error(`${item.id}: no verified native alpha in this cell. Regenerate transparency, or explicitly set keyMode only after confirming a flat magenta/green matte avoids garment and prop colors.`);
  const protectedColors = (item.protectedColors || []).map(decodeColor);
  if (protectedColors.some(([r, g, b]) => mattePixel(r, g, b, mode))) throw new Error(`${item.id}: ${mode} matte conflicts with protected garment/prop colors; regenerate using alpha or another matte.`);
  const mask = new Uint8Array(pixels), queue = new Int32Array(pixels);
  const protectedPixel = i => protectedColors.some(c => Math.hypot(data[i] - c[0], data[i + 1] - c[1], data[i + 2] - c[2]) < 55);
  const eligible = p => mattePixel(data[p * 4], data[p * 4 + 1], data[p * 4 + 2], mode) && !protectedPixel(p * 4);
  let qlen = 0, boundaryMatte = 0;
  const add = p => { if (!mask[p] && eligible(p)) { mask[p] = 1; queue[qlen++] = p; } };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!x || !y || x === width - 1 || y === height - 1) { const p = y * width + x; if (eligible(p)) boundaryMatte++; add(p); }
  }
  if (boundaryMatte < boundaryPixels * 0.7) throw new Error(`${item.id}: requested ${mode} matte is not dominant on cell boundaries; refusing broad color deletion.`);
  // Remove only the matte connected to the outside. Enclosed garment regions are retained.
  for (let k = 0; k < qlen; k++) {
    const p = queue[k], x = p % width, y = Math.floor(p / width);
    if (x) add(p - 1); if (x + 1 < width) add(p + 1); if (y) add(p - width); if (y + 1 < height) add(p + width);
  }
  if (qlen < pixels * 0.05) throw new Error(`${item.id}: flat matte detection failed.`);
  let residual = 0;
  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    if (mask[p]) { data.fill(0, i, i + 4); continue; }
    if (eligible(p)) residual++;
    if (protectedPixel(i)) continue;
    const x = p % width, y = Math.floor(p / width);
    let near = false;
    for (let yy = Math.max(0, y - 2); yy <= Math.min(height - 1, y + 2) && !near; yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(width - 1, x + 2); xx++) if (mask[yy * width + xx]) { near = true; break; }
    if (!near) continue;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const excess = mode === 'magenta' ? Math.min(r, b) - g : g - Math.max(r, b);
    if (excess <= 35 || (mode === 'magenta' && Math.abs(r - b) > 100)) continue;
    const alpha = Math.max(0, Math.min(1, 1 - excess / 255));
    if (alpha < 0.14) { data.fill(0, i, i + 4); continue; }
    const matte = mode === 'magenta' ? [255, 0, 255] : [0, 255, 0];
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round((data[i + c] - (1 - alpha) * matte[c]) / alpha)));
    data[i + 3] = Math.round(data[i + 3] * alpha);
  }
  if (residual > pixels * 0.0005) throw new Error(`${item.id}: ${residual} enclosed matte-colored pixels remain. Inspect garment colors and enclosed gaps; regenerate or prepare a reviewed alpha source instead of deleting all similar colors.`);
  return { data, mode, transparent, boundaryTransparent, removedPixels: qlen, residualMattePixels: residual };
}
function bounds(data, width, height) {
  let l = width, t = height, r = -1, b = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 105) { l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y); }
  if (r < 0) throw new Error('A source pose is empty.');
  return { l, t, r, b };
}
async function keyframes(project, item, options) {
  const sourceFile = path.join(project, 'raw', item.id + '.png');
  const sourceBuffer = fs.readFileSync(sourceFile), m = await sharp(sourceBuffer).metadata();
  if (m.format !== 'png' || !m.width || !m.height || m.width < 240 || m.height < 160) throw new Error(`${item.id}: expected a usable PNG pose sheet.`);
  const cw = Math.ceil(m.width / options.grid.cols), ch = Math.ceil(m.height / options.grid.rows);
  const arr = [], poseBoxes = [], cells = [], backgrounds = [];
  for (let i = 0; i < options.count; i++) {
    const col = i % options.grid.cols, row = Math.floor(i / options.grid.cols);
    const left = Math.round(col * m.width / options.grid.cols), top = Math.round(row * m.height / options.grid.rows);
    const width = Math.round((col + 1) * m.width / options.grid.cols) - left, height = Math.round((row + 1) * m.height / options.grid.rows) - top;
    const raw = await sharp(sourceBuffer).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer();
    const result = cleanBackground(raw, width, height, item);
    const bb = bounds(result.data, width, height);
    if (bb.l === 0 || bb.t === 0 || bb.r === width - 1 || bb.b === height - 1) throw new Error(`${item.id}: pose ${i} touches its cell edge; inspect clipping/neighbor leakage and regenerate or repair the source.`);
    const padded = await sharp(result.data, { raw: { width, height, channels: 4 } }).extend({ left: 0, top: 0, right: cw - width, bottom: ch - height, background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer();
    arr.push(padded); poseBoxes.push(bb); cells.push({ left, top, width, height });
    const { data: _, ...report } = result; backgrounds.push(report);
  }
  // One shared crop and one scale across all poses prevent accidental size pumping.
  const crop = { l: Math.max(0, Math.min(...poseBoxes.map(x => x.l)) - 3), t: Math.max(0, Math.min(...poseBoxes.map(x => x.t)) - 3), r: Math.min(cw - 1, Math.max(...poseBoxes.map(x => x.r)) + 3), b: Math.min(ch - 1, Math.max(...poseBoxes.map(x => x.b)) + 3) };
  const images = [];
  for (const data of arr) {
    const png = await sharp(data, { raw: { width: cw, height: ch, channels: 4 } }).extract({ left: crop.l, top: crop.t, width: crop.r - crop.l + 1, height: crop.b - crop.t + 1 }).png().toBuffer();
    images.push(await loadImage(png));
  }
  return { images, crop, sourceHash: sha256(sourceBuffer), source: { width: m.width, height: m.height, hasAlpha: m.hasAlpha, cellCanvas: [cw, ch], cells, poseBoxes, backgrounds } };
}
function renderPose(image, item, size) {
  const canvas = createCanvas(size, size), ctx = canvas.getContext('2d'), lines = linesFor(item);
  ctx.scale(size / 240, size / 240);
  const artHeight = lines.length === 2 ? 167 : lines.length ? 195 : 224;
  const scale = Math.min(220 / image.width, artHeight / image.height), w = image.width * scale, h = image.height * scale;
  ctx.drawImage(image, 120 - w / 2, 8 + (artHeight - h) / 2, w, h);
  if (lines.length) {
    ensureFont(lines.join('')); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    lines.forEach((line, k) => {
      let font = lines.length === 1 ? 27 : 24;
      ctx.font = `bold ${font}px StickerCN`;
      while (ctx.measureText(line).width > 218 && font > 18) ctx.font = `bold ${--font}px StickerCN`;
      if (ctx.measureText(line).width > 218) throw new Error(`${item.id}: caption is too long at readable size; use two shorter lines.`);
      const y = lines.length === 1 ? 218 : 190 + k * 28;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.2; ctx.strokeText(line, 120, y);
      ctx.fillStyle = item.textColor || '#403C41'; ctx.fillText(line, 120, y);
    });
  }
  const data = Buffer.from(ctx.getImageData(0, 0, size, size).data);
  for (let i = 0; i < data.length; i += 4) { data[i + 3] = data[i + 3] > 105 ? 255 : 0; if (!data[i + 3]) data.fill(0, i, i + 4); }
  return data;
}
async function encodeGif(frames, size, limit) {
  let buffer, colours;
  for (colours of [256, 192, 128, 96, 64, 48, 32]) {
    buffer = await sharp(Buffer.concat(frames), { raw: { width: size, height: size * frames.length, channels: 4, pageHeight: size } })
      .gif({ loop: 0, delay: Array(frames.length).fill(DELAY), colours, dither: 0, effort: 10, interFrameMaxError: 0, interPaletteMaxError: 0, keepDuplicateFrames: true }).toBuffer();
    if (!limit || buffer.length < limit) return { buffer, colours };
  }
  throw new Error(`GIF exceeds ${limit} bytes after seven palette attempts (${buffer.length} bytes). Simplify/regenerate artwork; do not reduce dimensions, pose count, or timing silently.`);
}
async function inspectGif(buffer, size, options, limit) {
  const m = await sharp(buffer, { animated: true }).metadata();
  if (m.width !== size || m.pageHeight !== size || m.pages !== options.n || !m.hasAlpha || m.loop !== 0 || !m.delay || m.delay.length !== options.n || m.delay.some(x => x !== DELAY) || (limit && buffer.length >= limit)) throw new Error(`Encoded ${size}px GIF failed size/frame/timing/alpha metadata validation.`);
  const data = await sharp(buffer, { animated: true }).ensureAlpha().raw().toBuffer();
  const frameBytes = size * size * 4, frames = [], hashes = new Set();
  if (data.length !== options.n * frameBytes) throw new Error('Decoded GIF frame byte count mismatch.');
  for (let f = 0; f < options.n; f++) {
    const frame = data.subarray(f * frameBytes, (f + 1) * frameBytes); let transparent = 0, opaque = 0, edgeOpaque = 0, partialAlpha = 0;
    for (let p = 0; p < size * size; p++) {
      const alpha = frame[p * 4 + 3], x = p % size, y = Math.floor(p / size);
      if (!alpha) transparent++; else if (alpha === 255) opaque++; else partialAlpha++;
      if (alpha && (!x || !y || x === size - 1 || y === size - 1)) edgeOpaque++;
    }
    if (transparent < size * size * 0.15 || opaque < size * size * 0.01 || edgeOpaque || partialAlpha) throw new Error(`Decoded frame ${f} failed nonempty/transparent/binary-alpha/edge validation.`);
    const hash = sha256(frame); hashes.add(hash);
    frames.push({ index: f, pose: options.sequence[f], delayMs: m.delay[f], transparentPixels: transparent, opaquePixels: opaque, edgeOpaquePixels: edgeOpaque, sha256: hash });
  }
  for (let f = 1; f < frames.length; f++) if (options.sequence[f] === options.sequence[f - 1] && frames[f].sha256 !== frames[f - 1].sha256) throw new Error('A held pose changed after GIF encoding.');
  const poseHashes = Array.from({ length: options.count }, (_, pose) => frames[options.sequence.indexOf(pose)].sha256);
  const closingPoseRepeated = poseHashes.at(-1) === poseHashes[0];
  const validClosingRepeat = closingPoseRepeated && hashes.size === options.count - 1 && new Set(poseHashes.slice(0, -1)).size === options.count - 1;
  if (hashes.size !== options.count && !validClosingRepeat) throw new Error(`Only ${hashes.size} unique decoded poses; expected ${options.count} distinct poses, allowing only a final pose identical to the first for a seamless loop. Redraw duplicated interior or indistinguishable key poses.`);
  return { bytes: buffer.length, width: size, height: size, frames: options.n, fps: FPS, durationMs: m.delay.reduce((a, b) => a + b, 0), delays: m.delay, loop: m.loop, uniqueFrames: hashes.size, closingPoseRepeated, transparent: true, frameChecks: frames, sha256: sha256(buffer) };
}
async function qaStrip(poseData, item) {
  const count = poseData.length, canvas = createCanvas(count * 240, 480), ctx = canvas.getContext('2d');
  for (let row = 0; row < 2; row++) {
    ctx.fillStyle = row ? '#283545' : '#f5f4f0'; ctx.fillRect(0, row * 240, count * 240, 240);
    for (let i = 0; i < count; i++) {
      const png = await sharp(poseData[i], { raw: { width: 240, height: 240, channels: 4 } }).png().toBuffer();
      ctx.drawImage(await loadImage(png), i * 240, row * 240);
    }
  }
  return canvas.toBuffer('image/png');
}
function writeAtomic(file, buffer) {
  const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, buffer); fs.renameSync(temp, file);
}
async function one(context, item) {
  const options = settings(item), poses = await keyframes(context.project, item, options);
  const smallPoses = poses.images.map(im => renderPose(im, item, 240)), largePoses = poses.images.map(im => renderPose(im, item, 480));
  const smallEncode = await encodeGif(options.sequence.map(i => smallPoses[i]), 240, MAX_BYTES);
  const largeEncode = await encodeGif(options.sequence.map(i => largePoses[i]), 480);
  const small = await inspectGif(smallEncode.buffer, 240, options, MAX_BYTES), large = await inspectGif(largeEncode.buffer, 480, options);
  if (JSON.stringify(small.delays) !== JSON.stringify(large.delays)) throw new Error('240px and 480px preview timing differs.');
  const still = await sharp(smallPoses[options.hero], { raw: { width: 240, height: 240, channels: 4 } }).png().toBuffer();
  const files = { gif240: path.join(DIRS[0], safeName(item, 'gif')), gif480: path.join(DIRS[1], safeName(item, 'gif')), static240: path.join(DIRS[2], safeName(item, 'png')), qaStrip: path.join(DIRS[3], item.id + '_light-dark.png') };
  // Complete validation before replacing any prior deliverable for this item.
  const strip = await qaStrip(smallPoses, item);
  writeAtomic(path.join(context.output, files.gif240), smallEncode.buffer);
  writeAtomic(path.join(context.output, files.gif480), largeEncode.buffer);
  writeAtomic(path.join(context.output, files.static240), still);
  writeAtomic(path.join(context.output, files.qaStrip), strip);
  const report = {
    id: item.id, name: item.name, caption: item.caption, technicalStatus: 'PASS', visualStatus: 'NOT_REVIEWED',
    method: 'Separately drawn anticipation, action, impact and recovery poses, held at explicit 50ms frame delays; no crossfade or synthetic whole-image motion.',
    sourceHash: poses.sourceHash, manifestItemHash: sha256(JSON.stringify(item)), source: poses.source, crop: poses.crop,
    grid: options.grid, keyPoses: options.count, holds: options.holds, hero: options.hero,
    small: { ...small, colours: smallEncode.colours }, large: { ...large, colours: largeEncode.colours },
    files, staticHash: sha256(still), qaStripHash: sha256(strip),
    fileHashes: { gif240: small.sha256, gif480: large.sha256, static240: sha256(still), qaStrip: sha256(strip) },
    visualReviewRequired: ['Recognizable identity and outfit', 'Expressive anticipation, impact and recovery', 'Stable scale and loop seam', 'Clean hands, face and props', 'Readable caption', 'No matte fringe, checkerboard or clipping on light and dark backgrounds']
  };
  writeJson(path.join(context.output, DIRS[3], item.id + '.json'), report);
  return report;
}
async function main(argv = process.argv.slice(2)) {
  let project, ids;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') project = argv[++i];
    else if (argv[i] === '--ids') ids = argv[++i]?.split(',').filter(Boolean);
    else if (['--help', '-h'].includes(argv[i])) { console.log('Usage: node encode.cjs --project /absolute/project [--ids 01,02]\nReads manifest.json and raw/{id}.png. Writes transparent GIF240, matching GIF480, still PNG and technical QA.'); return; }
    else throw new Error('Unknown argument: ' + argv[i]);
  }
  if (!project) throw new Error('Required: --project /absolute/project');
  const context = loadManifest(project);
  if (ids && (!ids.length || ids.some(id => !context.items.some(item => item.id === id)))) throw new Error('Unknown or empty --ids selection.');
  DIRS.forEach(dir => fs.mkdirSync(path.join(context.output, dir), { recursive: true }));
  const items = ids ? context.items.filter(item => ids.includes(item.id)) : context.items;
  const results = [];
  for (const item of items) {
    try {
      const report = await one(context, item);
      results.push({ id: item.id, technicalStatus: 'PASS', bytes: report.small.bytes });
      console.log(`${item.id} ${item.name}: technical PASS — ${report.small.frames} frames, ${report.small.durationMs}ms, ${report.small.bytes} bytes; visual review pending.`);
    } catch (error) {
      const source = path.join(context.project, 'raw', item.id + '.png');
      const failure = { id: item.id, technicalStatus: 'FAIL', visualStatus: 'NOT_REVIEWED', sourceHash: fs.existsSync(source) ? sha256(fs.readFileSync(source)) : null, error: error.message };
      writeJson(path.join(context.output, DIRS[3], item.id + '.json'), failure);
      results.push(failure); console.error(`${item.id} ${item.name}: FAIL — ${error.message}`);
    }
  }
  const failed = results.filter(x => x.technicalStatus === 'FAIL');
  console.log(`Encoded ${results.length - failed.length}/${results.length}. Output: ${context.output}${failed.length ? '. Failed IDs: ' + failed.map(x => x.id).join(', ') : '. Review light/dark strips and actual GIF playback before delivery.'}`);
  if (failed.length) process.exitCode = 1;
  return results;
}
module.exports = { settings, keyframes, renderPose, encodeGif, inspectGif, cleanBackground, one, main, FPS, DELAY, MAX_BYTES };
if (require.main === module) main().catch(error => { console.error('Encoder failed: ' + error.message); process.exitCode = 1; });
