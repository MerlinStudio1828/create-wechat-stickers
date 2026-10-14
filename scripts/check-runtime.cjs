'use strict';
const assert = require('node:assert/strict');
const { sharp, createCanvas, loadModule, ensureFont } = require('../skills/create-wechat-stickers/scripts/runtime.cjs');

async function main() {
  const JSZip = loadModule('jszip');
  ensureFont('你好微信表情包');
  const canvas = createCanvas(240, 240);
  const ctx = canvas.getContext('2d');
  ctx.font = '24px StickerCN';
  ctx.fillText('微信表情包', 12, 120);
  const png = canvas.toBuffer('image/png');
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 240);
  assert.equal(metadata.height, 240);
  assert.equal(metadata.hasAlpha, true);
  const gif = await sharp(png).gif().toBuffer();
  assert.equal((await sharp(gif).metadata()).format, 'gif');
  const zip = new JSZip();
  zip.file('check.txt', '微信表情包');
  const packed = await zip.generateAsync({ type: 'nodebuffer' });
  const opened = await JSZip.loadAsync(packed);
  assert.equal(await opened.file('check.txt').async('string'), '微信表情包');
  console.log('PASS: Chinese font, Canvas PNG, sharp GIF and ZIP round-trip.');
  console.log('This checks local encoding prerequisites; image generation access and artistic review are separate.');
}
main().catch(error => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
