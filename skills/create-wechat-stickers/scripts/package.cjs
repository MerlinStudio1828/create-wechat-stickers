#!/usr/bin/env node
'use strict';
// Deterministic delivery assembly. This script never invents or passes visual review.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  sharp, createCanvas, loadImage, ensureFont, loadManifest, loadModule,
} = require('./runtime.cjs');

const MARKER = '.wechat-sticker-package.json';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const hashFile = file => hash(fs.readFileSync(file));
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const xml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fileComponent = value => String(value).normalize('NFC').replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 90) || 'untitled';
const href = value => value.split('/').map(encodeURIComponent).join('/');
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');
function fail(message) { throw new Error(message); }
function resolveInput(project, value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label}: expected an existing local file path.`);
  const p = path.resolve(project, value);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) fail(`${label}: missing input ${value}`);
  return p;
}
function within(root, rel, label) {
  if (typeof rel !== 'string' || path.isAbsolute(rel)) fail(`${label}: output path must be relative.`);
  const result = path.resolve(root, rel);
  if (result !== root && !result.startsWith(root + path.sep)) fail(`${label}: path escapes output directory.`);
  return result;
}
function copyFile(source, target) { fs.mkdirSync(path.dirname(target), {recursive: true}); fs.copyFileSync(source, target); }
function listFiles(root, prefix = '') {
  return fs.readdirSync(root).sort().flatMap(name => {
    const p = path.join(root, name), rel = prefix ? `${prefix}/${name}` : name;
    const s = fs.lstatSync(p);
    if (s.isSymbolicLink()) fail(`Refusing symbolic link in delivery: ${rel}`);
    return s.isDirectory() ? listFiles(p, rel) : [{relative: rel, path: p}];
  });
}
function parseArgs(argv) {
  const options = {allowUnreviewed: false, thumbnails: true, preview: true, includeOriginals: false};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project' || arg === '--destination') options[arg.slice(2)] = argv[++i];
    else if (arg === '--allow-unreviewed') options.allowUnreviewed = true;
    else if (arg === '--no-thumbnails') options.thumbnails = false;
    else if (arg === '--no-preview') options.preview = false;
    else if (arg === '--include-originals') options.includeOriginals = true;
    else if (arg === '--help') return {...options, help: true};
    else fail(`Unknown option ${arg}`);
  }
  if (!options.project || !options.project.trim()) fail('Usage: node package.cjs --project DIR [--allow-unreviewed]');
  if (argv.includes('--destination') && !options.destination) fail('--destination requires a path.');
  return options;
}
function resolveAlbums(manifest, items) {
  let albums = manifest.albums;
  if (!albums) {
    const slices = items.length === 30 ? [items.slice(0, 15), items.slice(15)] : items.length <= 24 ? [items] : null;
    if (!slices) fail('More than 24 items requires explicit albums; the 30-item default splits 15 + 15.');
    albums = slices.map((group, index) => ({
      id: `album-${String(index + 1).padStart(2, '0')}`,
      title: manifest.albumTitles?.[index] || (slices.length === 1 ? manifest.title : `${manifest.title}${index + 1}`),
      intro: manifest.albumIntros?.[index] || manifest.intro || '',
      itemIds: group.map(x => String(x.id)),
      banner: manifest.banners?.[index] || (slices.length === 1 ? manifest.banner : undefined),
    }));
  }
  if (!Array.isArray(albums) || !albums.length) fail('albums must be a nonempty array.');
  const known = new Set(items.map(x => String(x.id))), seen = new Set(), albumIds = new Set();
  return albums.map((album, index) => {
    const id = String(album.id || `album-${String(index + 1).padStart(2, '0')}`);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || albumIds.has(id)) fail(`Album id must be unique and contain only letters, digits, underscore, hyphen: ${id}`);
    albumIds.add(id);
    if (!Array.isArray(album.itemIds) || !album.itemIds.length || album.itemIds.length > 24) fail(`${id}: album must have 1–24 items; 8–24 is the platform range.`);
    const ids = album.itemIds.map(String);
    for (const itemId of ids) {
      if (!known.has(itemId)) fail(`${id}: unknown item ${itemId}`);
      if (seen.has(itemId)) fail(`${id}: item ${itemId} appears in more than one album or twice in this album.`);
      seen.add(itemId);
    }
    if (!album.banner) fail(`${id}: dedicated generated banner artwork is required; no placeholder is generated.`);
    return {...album, id, title: album.title || manifest.title || id, itemIds: ids, countWithinPlatformRange: ids.length >= 8};
  }).map((album, index, result) => {
    if (index === result.length - 1 && seen.size !== known.size) fail(`Albums omit items: ${[...known].filter(x => !seen.has(x)).join(', ')}`);
    return album;
  });
}
async function checkRaster(file, expected) {
  const bytes = fs.statSync(file).size;
  const m = await sharp(file, {animated: expected.animated === true}).metadata();
  const height = m.pageHeight || m.height;
  if (m.width !== expected.width || height !== expected.height) fail(`${path.basename(file)}: expected ${expected.width}×${expected.height}, got ${m.width}×${height}.`);
  if (expected.format && m.format !== expected.format) fail(`${path.basename(file)}: expected ${expected.format}, got ${m.format}.`);
  if (expected.maxBytes && bytes > expected.maxBytes) fail(`${path.basename(file)}: ${bytes} bytes exceeds ${expected.maxBytes}.`);
  let transparent = false;
  if (expected.transparent) {
    const {data, info} = await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    for (let i = 3; i < data.length; i += info.channels) { if (data[i] < 255) { transparent = true; break; } }
    if (!transparent) fail(`${path.basename(file)}: no transparent pixels.`);
  }
  if (expected.animated) {
    if (!m.pages || m.pages < 2) fail(`${path.basename(file)}: expected animation.`);
    if (m.loop !== 0) fail(`${path.basename(file)}: expected infinite loop.`);
    if (!m.delay?.length || m.delay.some(n => n <= 0)) fail(`${path.basename(file)}: missing or invalid frame durations.`);
  }
  return {width:m.width, height, format:m.format, bytes, ...(expected.transparent ? {transparent} : {}), ...(expected.animated ? {frames:m.pages, loop:m.loop, durationMs:m.delay.reduce((a,b)=>a+b,0)} : {}), sha256:hashFile(file)};
}
function checkPlatformText(album, entries) {
  const issues=[],warnings=[];
  function check(value,label,limit,noPunctuation=false){
    const text=String(value || '').trim(),hanCount=(text.match(/\p{Script=Han}/gu)||[]).length,han=hanCount>0;
    if(!text){issues.push(`${album.id}: missing ${label}`);return;}
    if(hanCount>limit)issues.push(`${album.id}: ${label} exceeds ${limit} Chinese characters`);
    if(noPunctuation && /\p{P}/u.test(text))issues.push(`${album.id}: ${label} contains punctuation`);
    if(han && noPunctuation && /\s/u.test(text))issues.push(`${album.id}: Chinese ${label} contains spaces`);
    if(hanCount<=limit && Array.from(text).length>limit)warnings.push(`${album.id}: confirm the upload page's non-Chinese/mixed-script length rule for ${label}; official wording specifies Chinese-character limits`);
    if(/\p{Extended_Pictographic}/u.test(text))issues.push(`${album.id}: ${label} contains emoji`);
  }
  check(album.title,'album title',8,true);check(album.intro,'album introduction',80);
  const meanings=new Set();
  for(const id of album.itemIds){
    const item=entries.find(e=>e.id===id).item,meaning=String(item.meaning ?? item.name).trim();
    check(meaning,`${id} meaning`,4,true);
    if(meanings.has(meaning))issues.push(`${album.id}: duplicate meaning ${meaning}`);
    meanings.add(meaning);
  }
  return {issues,warnings};
}
function deliveryState({missing,unreviewedItems,unreviewedAssets,platformIssues,tooSmall}) {
  const assetsComplete=!missing.length;
  const allReviewed=!unreviewedItems.length&&!unreviewedAssets.length;
  const deliveryComplete=assetsComplete&&allReviewed&&!platformIssues.length;
  const submissionAssetsReady=deliveryComplete&&!tooSmall.length;
  let status;
  if(submissionAssetsReady)status='已完成逐张技术检查与视觉检查；投稿素材齐全，尚未提交平台审核。';
  else if(deliveryComplete)status='个人使用包已完成，逐张技术检查与视觉检查已通过；部分专辑少于 8 张，不能作为完整专辑投稿。';
  else status=`待完成：${[missing.length?`缺少 ${missing.length} 项配套素材`:'',unreviewedItems.length?`${unreviewedItems.length} 张表情待视觉检查`:'',unreviewedAssets.length?`${unreviewedAssets.length} 项配图待视觉检查`:'',platformIssues.length?`${platformIssues.length} 项专辑规范待修正`:'',tooSmall.length?'部分专辑少于 8 张，仅供个人使用':''].filter(Boolean).join('；')}。不应称为完整投稿包。`;
  return {assetsComplete,allReviewed,deliveryComplete,submissionAssetsReady,status,archiveName:deliveryComplete?'complete-delivery.zip':'review-delivery.zip'};
}
async function loadItems(context, visualReview) {
  const result = [];
  for (const item of context.items) {
    const id = String(item.id);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail(`Unsafe item id ${id}`);
    const reportFile = path.join(context.output, '逐张检查', `${id}.json`);
    if (!fs.existsSync(reportFile)) fail(`Missing encoder report for ${id}; run encode.cjs first.`);
    const report = json(reportFile);
    const source = resolveInput(context.project, `raw/${id}.png`, `${id} source`);
    const sourceHash = hashFile(source);
    if (report.sourceHash !== sourceHash || report.manifestItemHash !== hash(JSON.stringify(item)) || report.technicalStatus !== 'PASS') fail(`${id}: encoder report is stale or technical checks did not pass.`);
    const files = {};
    for (const key of ['gif240','gif480','static240','qaStrip']) {
      if (!report.files?.[key]) fail(`${id}: encoder report missing files.${key}.`);
      files[key] = within(context.output, report.files[key], `${id}.${key}`);
      if (!fs.existsSync(files[key])) fail(`${id}: missing encoded ${key}.`);
      const encodedHash = report.fileHashes?.[key] || report.hashes?.[key];
      if (!encodedHash || encodedHash !== hashFile(files[key])) fail(`${id}: ${key} changed since encoder checks or lacks a hash; run encoder again.`);
    }
    const technical = {
      gif240: await checkRaster(files.gif240, {width:240,height:240,format:'gif',maxBytes:500000,transparent:true,animated:true}),
      gif480: await checkRaster(files.gif480, {width:480,height:480,format:'gif',transparent:true,animated:true}),
      static240: await checkRaster(files.static240, {width:240,height:240,format:'png',transparent:true}),
    };
    const review = visualReview.items?.[id];
    const reviewed = review?.status === 'pass' && review.sourceHash === sourceHash && review.outputHash === technical.gif240.sha256;
    result.push({item, id, sourceHash, files, technical, reviewed, review: review || null, report});
  }
  return result;
}
function sourceSpec(value, project, label) {
  const spec = typeof value === 'string' ? {source:value} : value;
  if (!spec || typeof spec !== 'object') fail(`${label}: provide dedicated artwork, optionally with a normalized crop.`);
  const source = resolveInput(project, spec.source, label);
  let crop;
  if (spec.crop) {
    const c = spec.crop;
    crop = {x:c.x, y:c.y, width:c.width, height:c.height};
    if (!Object.values(crop).every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001) fail(`${label}: crop values must be normalized fractions inside the source.`);
  }
  return {source, crop};
}
async function rasterPipeline(spec) {
  let image = sharp(spec.source).rotate();
  const oriented = await image.png().toBuffer();
  image = sharp(oriented);
  if (spec.crop) {
    const m = await image.metadata(), c = spec.crop;
    const left = Math.floor(c.x * m.width), top = Math.floor(c.y * m.height);
    const width = Math.max(1, Math.min(m.width - left, Math.round(c.width * m.width)));
    const height = Math.max(1, Math.min(m.height - top, Math.round(c.height * m.height)));
    image = image.extract({left,top,width,height});
  }
  return image;
}
async function makeAsset(stage, project, key, sourceValue, options, visualReview) {
  const spec = sourceSpec(sourceValue, project, key);
  const target = path.join(stage, options.relative);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  const input = await (await rasterPipeline(spec)).png().toBuffer();
  if (options.transparent) {
    const {data,info} = await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let clear = false;
    for (let i=3;i<data.length;i+=info.channels) if(data[i]<255){clear=true;break;}
    if (!clear) fail(`${key}: source must already have transparency; packaging does not remove backgrounds.`);
  }
  const resize = () => sharp(input).resize(options.width, options.height, {fit:options.transparent?'contain':'cover', position:'centre', background:'#00000000'});
  if (options.format === 'jpeg') {
    let buffer;
    for (const quality of [92,86,78,68,56,44,32]) {
      buffer = await resize().flatten({background:'#f4f1e9'}).jpeg({quality,mozjpeg:true}).toBuffer();
      if (buffer.length <= options.maxBytes) break;
    }
    if (buffer.length > options.maxBytes) fail(`${key}: JPEG remains too large; simplify its artwork.`);
    fs.writeFileSync(target, buffer);
  } else {
    let buffer = await resize().png({compressionLevel:9}).toBuffer();
    for (const colours of [256,192,128,96,64]) {
      if (buffer.length <= options.maxBytes) break;
      buffer = await resize().png({palette:true,colours,effort:10,dither:0.5}).toBuffer();
    }
    if (buffer.length > options.maxBytes) fail(`${key}: PNG remains too large; simplify its artwork.`);
    fs.writeFileSync(target, buffer);
  }
  const technical = await checkRaster(target, options);
  const review = visualReview.assets?.[key];
  return {key, file:options.relative, sourceHash:hashFile(spec.source), outputHash:technical.sha256, crop:spec.crop || null, technical, reviewed:review?.status === 'pass' && review.outputHash === technical.sha256, review:review || null};
}
function fontSetup() {
  ensureFont();
  return 'StickerCN';
}
function fitText(ctx, text, maxWidth, size, family) {
  while(size > 12) { ctx.font = `${size}px "${family}", sans-serif`; if(ctx.measureText(text).width <= maxWidth) break; size--; }
  return size;
}
async function createOverview(stage, title, entries, family) {
  const columns = Math.min(5, entries.length), cellW=220, cellH=256, top=82;
  const canvas=createCanvas(columns*cellW+40, Math.ceil(entries.length/columns)*cellH+top+22), ctx=canvas.getContext('2d');
  ctx.fillStyle='#f4f1e9';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#172a2b';fitText(ctx,title,canvas.width-64,30,family);ctx.fillText(title,24,42);
  ctx.font=`14px "${family}", sans-serif`;ctx.fillStyle='#526060';ctx.fillText(`${entries.length} 张 · 静态目录（动画请打开 gallery.html）`,24,65);
  for(let i=0;i<entries.length;i++){
    const e=entries[i],x=20+(i%columns)*cellW,y=top+Math.floor(i/columns)*cellH;
    ctx.fillStyle='#ffffff';ctx.fillRect(x+4,y+4,cellW-8,cellH-8);
    ctx.drawImage(await loadImage(e.files.static240),x+16,y+10,188,188);
    ctx.fillStyle='#213c3a';fitText(ctx,`${e.id}  ${e.item.name}`,cellW-24,17,family);ctx.fillText(`${e.id}  ${e.item.name}`,x+12,y+220);
    ctx.fillStyle='#65716a';fitText(ctx,e.item.caption||'',cellW-24,14,family);ctx.fillText(e.item.caption||'',x+12,y+242);
  }
  fs.writeFileSync(path.join(stage,'overview.png'),canvas.toBuffer('image/png'));
}
async function createPreview(stage, entries, family) {
  // Decode actual GIF frames; select frames according to their real durations.
  const selected=entries.slice(0,6), columns=Math.min(3,selected.length), cell=160, cellH=188;
  const width=columns*cell,height=Math.ceil(selected.length/columns)*cellH;
  const decoded=[];
  for(const entry of selected){
    const m=await sharp(entry.files.gif240,{animated:true}).metadata();
    const raw=await sharp(entry.files.gif240,{animated:true}).ensureAlpha().raw().toBuffer();
    const frames=[];
    for(let i=0;i<m.pages;i++){
      const rgba=raw.subarray(i*240*240*4,(i+1)*240*240*4);
      frames.push(await loadImage(await sharp(rgba,{raw:{width:240,height:240,channels:4}}).png().toBuffer()));
    }
    decoded.push({entry,frames,delays:m.delay,total:m.delay.reduce((a,b)=>a+b,0)});
  }
  const previewFrames=[];
  for(let t=0;t<1600;t+=100){
    const c=createCanvas(width,height),ctx=c.getContext('2d');ctx.fillStyle='#f3f0e9';ctx.fillRect(0,0,width,height);
    for(let i=0;i<decoded.length;i++){
      const d=decoded[i];let remaining=t%d.total,frame=0;
      while(frame<d.frames.length-1 && remaining>=d.delays[frame]) {remaining-=d.delays[frame];frame++;}
      const x=(i%columns)*cell,y=Math.floor(i/columns)*cellH;
      ctx.drawImage(d.frames[frame],x+10,y+4,140,140);ctx.fillStyle='#243f3a';fitText(ctx,`${d.entry.id} ${d.entry.item.name}`,cell-14,14,family);ctx.fillText(`${d.entry.id} ${d.entry.item.name}`,x+7,y+168);
    }
    previewFrames.push(Buffer.from(ctx.getImageData(0,0,width,height).data));
  }
  await sharp(Buffer.concat(previewFrames),{raw:{width,height:height*previewFrames.length,channels:4,pageHeight:height}}).gif({loop:0,delay:Array(previewFrames.length).fill(100),colours:128,effort:7,dither:0}).toFile(path.join(stage,'preview.gif'));
}
function writeGallery(stage, manifest, albums, entries, status) {
  const groups=[...new Set(entries.map(e=>String(e.item.group || '未分类')))];
  const cards=entries.map(e=>`<article class="card" data-group="${xml(e.item.group||'未分类')}" data-search="${xml(`${e.id} ${e.item.name} ${e.item.caption||''} ${e.item.group||''}`.toLocaleLowerCase())}"><div class="art"><img src="${href(`stickers/main240/${fileComponent(e.id)}.gif`)}" alt="${xml(e.item.caption || e.item.name)}" loading="lazy"></div><div class="copy"><strong>${xml(e.id)} · ${xml(e.item.name)}</strong><p>${xml(e.item.caption||'')}</p><small>${xml(e.item.group||'未分类')} · ${e.technical.gif240.frames} 帧 · ${(e.technical.gif240.bytes/1000).toFixed(0)} KB</small><div class="links"><a href="${href(`stickers/main240/${fileComponent(e.id)}.gif`)}" download>下载 GIF</a><a href="${href(`stickers/large480/${fileComponent(e.id)}.gif`)}" target="_blank" rel="noopener">放大查看</a></div></div></article>`).join('\n');
  const banners=albums.map(a=>`<section class="album"><img src="${href(a.bannerFile)}" alt="${xml(a.title)}横幅"><h2>${xml(a.title)}</h2><p>${a.itemIds.length} 张 · ${a.itemIds.map(xml).join('、')}</p></section>`).join('');
  fs.writeFileSync(path.join(stage,'gallery.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${xml(manifest.title)} · 表情图库</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f0e9;color:#213b37;font:16px system-ui,-apple-system,sans-serif}body.dark{background:#172522;color:#edf3ef}header,main,footer{max-width:1280px;margin:auto;padding:28px}h1{font-size:clamp(28px,5vw,48px);margin:0 0 12px}header p{max-width:760px;line-height:1.7}.status{padding:12px 16px;border:1px solid #9aaea2;border-radius:12px}.controls{display:flex;gap:10px;flex-wrap:wrap;position:sticky;top:0;padding:12px 0;background:inherit;z-index:2}input,select,button{font:inherit;padding:12px;border:1px solid #849d8e;border-radius:8px;color:inherit;background:inherit}input{min-width:180px;flex:1}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:18px}.card{background:#fff;border-radius:16px;overflow:hidden;border:1px solid #dbe2dc}.dark .card{background:#263d36;border-color:#476057}.art{display:flex;justify-content:center;padding:12px;background:#fff}.dark .art{background:#18201e}.art img{width:180px;height:180px;object-fit:contain}.copy{padding:16px;padding-top:0}.copy p{min-height:1.4em;margin:9px 0}.copy small{opacity:.75}.links{display:flex;gap:16px;margin-top:14px;font-size:14px}a{color:#087661}.dark a{color:#91daba}.album img{width:100%;aspect-ratio:750/400;object-fit:cover;border-radius:16px}.albums{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;margin:30px 0}footer{opacity:.75;font-size:14px;line-height:1.7}.hidden{display:none}button{cursor:pointer}
</style><body><header><h1>${xml(manifest.title)}</h1><p>${entries.length} 张透明动态表情。切换浅色 / 深色背景查看透明边缘；点击下载保存独立 GIF。</p><p class="status">${xml(status)}</p><nav><a href="overview.png">静态总览</a> · <a href="metadata/delivery.json">素材与检查记录</a></nav></header><main><div class="controls"><input id="search" type="search" placeholder="搜索名字、文案或分类" aria-label="搜索表情"><select id="category" aria-label="选择分类"><option value="">全部分类</option>${groups.map(g=>`<option value="${xml(g)}">${xml(g)}</option>`).join('')}</select><button id="theme" type="button">切换深色背景</button></div><p id="count">${entries.length} / ${entries.length} 张</p><div class="grid">${cards}</div><div class="albums">${banners}</div></main><footer>本页可离线打开。技术检查与视觉检查分别记录；本素材包尚未提交微信平台审核。120 像素缩略图为兼容备用，480 像素 GIF 为放大查看。</footer><script>
const search=document.querySelector('#search'),category=document.querySelector('#category'),cards=[...document.querySelectorAll('.card')];function filter(){let n=0;const q=search.value.trim().toLocaleLowerCase();for(const card of cards){const show=(!q||card.dataset.search.includes(q))&&(!category.value||card.dataset.group===category.value);card.classList.toggle('hidden',!show);if(show)n++;}document.querySelector('#count').textContent=n+' / '+cards.length+' 张';}search.addEventListener('input',filter);category.addEventListener('change',filter);document.querySelector('#theme').addEventListener('click',event=>{document.body.classList.toggle('dark');event.target.textContent=document.body.classList.contains('dark')?'切换浅色背景':'切换深色背景';});
</script></body></html>`);
}
async function main() {
  const options=parseArgs(process.argv.slice(2));
  if(options.help){console.log('Usage: node package.cjs --project DIR [--allow-unreviewed] [--destination DIR] [--no-thumbnails] [--no-preview] [--include-originals]');return;}
  const context=loadManifest(path.resolve(options.project));
  if(!context.items.length) fail('Manifest contains no items.');
  const ids=context.items.map(x=>String(x.id));if(new Set(ids).size!==ids.length) fail('Manifest item ids must be unique.');
  const manifest=context.manifest,albums=resolveAlbums(manifest,context.items);
  const reviewFile=path.join(context.project,'visual-review.json'),visualReview=fs.existsSync(reviewFile)?json(reviewFile):{};
  const entries=await loadItems(context,visualReview);
  const destination=path.resolve(context.project,options.destination||'delivery');
  if(destination===context.project || destination===context.output || context.project.startsWith(destination+path.sep) || context.output.startsWith(destination+path.sep)) fail('Delivery destination must not contain or replace the project or encoder output.');
  if(fs.existsSync(destination)){
    const marker=path.join(destination,MARKER);
    if(!fs.existsSync(marker)||json(marker).generator!=='create-wechat-stickers/package.cjs') fail('Refusing to overwrite an unrelated destination. Choose an empty directory.');
    const owned=new Set(json(marker).files || []);
    if(listFiles(destination).some(f=>!owned.has(f.relative)))fail('Destination contains files not created by this helper; choose another destination to preserve them.');
  }
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  const stage=fs.mkdtempSync(path.join(path.dirname(destination),'.wechat-delivery-'));
  try {
    const assets=[],albumResults=[],missing=[],platformIssues=[],metadataWarnings=[];
    const promptFiles=fs.existsSync(path.join(context.project,'prompts'))?listFiles(path.join(context.project,'prompts')).filter(f=>/\.(json|txt|md)$/i.test(f.relative)):[];
    const prompts=[];
    for(const f of promptFiles){copyFile(f.path,path.join(stage,'prompts',f.relative));prompts.push(`prompts/${f.relative}`);}
    if(manifest.prompts){writeJson(path.join(stage,'prompts.json'),manifest.prompts);prompts.push('prompts.json');}
    if(!prompts.length)missing.push('prompt records (prompts/ or manifest.prompts)');
    for(const entry of entries){
      for(const [key,folder,ext]of [['gif240','main240','gif'],['gif480','large480','gif'],['static240','static240','png']])copyFile(entry.files[key],path.join(stage,'stickers',folder,`${entry.id}.${ext}`));
      copyFile(entry.files.qaStrip,path.join(stage,'review',`${entry.id}_light-dark.png`));
    }
    for(const album of albums){
      const textCheck=checkPlatformText(album,entries);
      // User-requested small personal packs are not constrained by submission copy limits.
      (album.countWithinPlatformRange?platformIssues:metadataWarnings).push(...textCheck.issues);
      metadataWarnings.push(...textCheck.warnings);
      const base=`albums/${album.id}`,rows=[];
      for(let index=0;index<album.itemIds.length;index++){
        const entry=entries.find(e=>e.id===album.itemIds[index]),local=String(index+1).padStart(2,'0');
        copyFile(entry.files.gif240,path.join(stage,base,'main240',`${local}.gif`));
        if(options.thumbnails){
          const target=path.join(stage,base,'thumbnail120',`${local}.png`);fs.mkdirSync(path.dirname(target),{recursive:true});
          await sharp(entry.files.static240).resize(120,120).png({palette:true,colours:128,effort:10}).toFile(target);
          await checkRaster(target,{width:120,height:120,format:'png',maxBytes:50000,transparent:true});
        }
        rows.push({localId:local,id:entry.id,name:entry.item.name,meaning:entry.item.meaning??entry.item.name,caption:entry.item.caption||'',group:entry.item.group||''});
      }
      const baseSpec=album.cover || manifest.master;
      const specs=[
        ['banner',album.banner,{width:750,height:400,format:'jpeg',maxBytes:500000,relative:`${base}/detail-banner750x400.jpg`}],
        ['cover',baseSpec,{width:240,height:240,format:'png',maxBytes:500000,transparent:true,relative:`${base}/cover240.png`}],
        ['icon',album.icon || baseSpec,{width:50,height:50,format:'png',maxBytes:100000,transparent:true,relative:`${base}/chat-icon50.png`}],
        ['avatar',album.avatar || baseSpec,{width:240,height:240,format:'png',maxBytes:500000,transparent:true,relative:`${base}/character-avatar240.png`}],
      ];
      for(const [name,source,settings]of specs){
        if(!source){missing.push(`${album.id}.${name}`);continue;}
        assets.push(await makeAsset(stage,context.project,`${album.id}.${name}`,source,settings,visualReview));
      }
      const albumResult={id:album.id,title:album.title,intro:album.intro||'',itemIds:album.itemIds,countWithinPlatformRange:album.countWithinPlatformRange,bannerFile:`${base}/detail-banner750x400.jpg`,items:rows};
      writeJson(path.join(stage,base,'album.json'),albumResult);albumResults.push(albumResult);
    }
    const authorAvatar=manifest.authorAvatar || manifest.artistAvatar;
    if(authorAvatar) assets.push(await makeAsset(stage,context.project,'authorAvatar',authorAvatar,{width:640,height:640,format:'png',maxBytes:500000,relative:'artist/artist-avatar640.png'},visualReview));
    else missing.push('authorAvatar');
    assets.push(await makeAsset(stage,context.project,'authorHomepageBanner',manifest.authorHomepageBanner || albums[0].banner,{width:750,height:400,format:'jpeg',maxBytes:80000,relative:'artist/homepage-banner750x400.jpg'},visualReview));
    for(const kind of ['cover','icon']){
      const known=new Map();
      for(const asset of assets.filter(a=>a.key.endsWith(`.${kind}`))){
        if(known.has(asset.outputHash))platformIssues.push(`${asset.key} repeats ${known.get(asset.outputHash)}; different albums need different ${kind} artwork`);
        known.set(asset.outputHash,asset.key);
      }
    }
    const unreviewedItems=entries.filter(e=>!e.reviewed).map(e=>e.id),unreviewedAssets=assets.filter(a=>!a.reviewed).map(a=>a.key);
    const tooSmall=albumResults.filter(a=>!a.countWithinPlatformRange).map(a=>a.id);
    const state=deliveryState({missing,unreviewedItems,unreviewedAssets,platformIssues,tooSmall});
    const {status,archiveName}=state;
    if(!options.allowUnreviewed&&!state.deliveryComplete) fail(`${status}\n${platformIssues.join('\n')}\nUse --allow-unreviewed to create a visibly marked review package, inspect its real output, then add matching entries to visual-review.json.`);
    const family=fontSetup();await createOverview(stage,manifest.title||'微信表情',entries,family);
    let preview=null;
    if(options.preview){await createPreview(stage,entries,family);preview='preview.gif';}
    writeGallery(stage,manifest,albumResults,entries,status);
    const metadataDir=path.join(stage,'metadata');fs.mkdirSync(metadataDir,{recursive:true});
    writeJson(path.join(metadataDir,'technical-reports.json'),{description:'Original encoder checks for every item. The files paths refer to the encoder output; final delivery paths and subsequent visual reviews are recorded separately in delivery.json.',items:entries.map(e=>e.report)});
    const manifestSummary={title:manifest.title,items:context.items.map(({id,name,meaning,caption,lines,group,grid,holds,hero})=>({id,name,meaning,caption,lines,group,grid,holds,hero})),albums:albumResults.map(({id,title,intro,itemIds})=>({id,title,intro,itemIds}))};
    writeJson(path.join(metadataDir,'manifest.json'),manifestSummary);
    if(options.includeOriginals){
      if(!Array.isArray(manifest.originals)||!manifest.originals.length) fail('--include-originals requires manifest.originals file paths explicitly selected by the user.');
      for(let i=0;i<manifest.originals.length;i++){
        const source=resolveInput(context.project,manifest.originals[i],'original');copyFile(source,path.join(stage,'originals',`${String(i+1).padStart(2,'0')}_${fileComponent(path.basename(source))}`));
      }
    }
    const report={schemaVersion:1,title:manifest.title,generatedAt:new Date().toISOString(),status,technicalCheckedItems:entries.length,visualReviewedItems:entries.length-unreviewedItems.length,visualReviewedAssets:assets.length-unreviewedAssets.length,assetsComplete:state.assetsComplete,deliveryComplete:state.deliveryComplete,submissionAssetsReady:state.submissionAssetsReady,platformSubmitted:false,missing,platformIssues,metadataWarnings,unreviewedItems,unreviewedAssets,albums:albumResults,items:entries.map(e=>({id:e.id,name:e.item.name,sourceHash:e.sourceHash,technicalStatus:'PASS',visualStatus:e.reviewed?'PASS':'NOT_REVIEWED',technical:e.technical,visualReview:e.review})),assets,prompts,preview,originalsIncluded:options.includeOriginals};
    writeJson(path.join(metadataDir,'delivery.json'),report);
    const template={instructions:'Only change a status after actually inspecting this exact item/artwork. Item sourceHash ties review to the generated source sheet and outputHash ties review to the exact exported GIF. Asset outputHash ties review to the exported crop. Do not auto-pass this template.',items:Object.fromEntries(entries.map(e=>[e.id,{sourceHash:e.sourceHash,outputHash:e.technical.gif240.sha256,status:e.reviewed?'pass':'pending',note:e.review?.note||''}])),assets:Object.fromEntries(assets.map(a=>[a.key,{outputHash:a.outputHash,status:a.reviewed?'pass':'pending',note:a.review?.note||''}]))};
    writeJson(path.join(stage,'review-template.json'),template);
    fs.writeFileSync(path.join(stage,'使用说明.md'),`# ${manifest.title || '微信表情'}\n\n${status}\n\n共 ${entries.length} 张；每张均有真实编码技术检查记录，视觉检查 ${entries.length-unreviewedItems.length}/${entries.length} 张、配图 ${assets.length-unreviewedAssets.length}/${assets.length} 项。\n\n- gallery.html：离线动态图库，支持搜索、分类和浅色/深色背景。\n- overview.png：静态总览。${preview?'\n- preview.gif：最多前 6 张的缩小动态预览；独立 GIF 保留完整时长。':''}\n- stickers/main240：240×240 透明动态 GIF，每张不超过 500,000 字节。\n- stickers/large480：480 像素放大检查版，不作为微信投稿主图。\n- stickers/static240：透明静态关键帧。\n- albums：按专辑重新编号的主图、封面、聊天图标、形象头像和详情横幅。${options.thumbnails?'120×120 缩略图为兼容备用，不是当前官方必需项。':''}\n- artist：艺术家头像 640×640；主页横幅 750×400、80,000 字节以内，与详情横幅分别导出。\n- review、metadata：逐张检查图、技术报告、素材编号与视觉检查状态。\n- prompts：生成提示词记录。${options.includeOriginals?'已按用户选择包含原始参考照片。':'不包含原始参考照片。'}\n\n专辑允许 8–24 张；少于 8 张可个人使用，不算完整投稿专辑。素材符合尺寸和体积不代表获得微信审核通过；版权授权、文案与账号资料需由投稿者确认。\n\n官方制作指引：https://sticker.weixin.qq.com/cgi-bin/mmemoticon-bin/readtemplate?t=guide/index\n`);
    writeJson(path.join(stage,MARKER),{generator:'create-wechat-stickers/package.cjs',schemaVersion:1,files:[...listFiles(stage).map(f=>f.relative),MARKER,archiveName]});
    const archivePath=path.join(stage,archiveName),JSZip=loadModule('jszip'),zip=new JSZip();
    for(const f of listFiles(stage)) zip.file(f.relative,fs.readFileSync(f.path));
    fs.writeFileSync(archivePath,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}}));
    // Replace only a package created by this helper, after all validation succeeds.
    let backup;
    if(fs.existsSync(destination)){backup=`${destination}.previous-${crypto.randomBytes(6).toString('hex')}`;fs.renameSync(destination,backup);}
    try{fs.renameSync(stage,destination);}catch(error){if(backup)fs.renameSync(backup,destination);throw error;}
    if(backup)fs.rmSync(backup,{recursive:true,force:true});
    console.log(JSON.stringify({destination,items:entries.length,albums:albumResults.length,deliveryComplete:report.deliveryComplete,submissionAssetsReady:report.submissionAssetsReady,unreviewedItems,unreviewedAssets,missing,zip:path.join(destination,archiveName)},null,2));
  } catch(error) {fs.rmSync(stage,{recursive:true,force:true});throw error;}
}
if(require.main===module)main().catch(error=>{console.error(`Packaging failed: ${error.message}`);process.exitCode=1;});
module.exports={resolveAlbums,checkRaster,sourceSpec,deliveryState};
