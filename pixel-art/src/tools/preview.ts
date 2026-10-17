// npm run preview -- <name>            one sprite: 8x, 1x, and 3x3 tiled if it's a texture
// npm run preview -- 'block-*'         a labeled contact sheet of every match
// npm run preview -- tag:calibration   everything with a tag
// npm run preview -- --board           the style board: references beside the calibration sprites
// npm run preview -- list              every sprite name
// options: --zoom N, --bg #hex (show on a backdrop, e.g. the ground color), --tile
// Output: out/previews/<name>.png

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hex } from '../engine/color.js';
import { contactSheet, label, solid, stack, tiled } from '../engine/board.js';
import { Raster } from '../engine/raster.js';
import { SPRITES } from '../art/registry.js';
import { OUT } from './paths.js';
import { matchNames, renderSprite } from './shared.js';

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const opt = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const target = argv.find((a, i) => !a.startsWith('--') && !['--zoom', '--bg'].includes(argv[i - 1] ?? ''));
const outDir = join(OUT, 'previews');
mkdirSync(outDir, { recursive: true });
const bg = opt('--bg') ? hex(opt('--bg')!) : undefined;

function write(name: string, r: Raster): void {
  const file = join(outDir, `${name.replace(/[^a-z0-9_-]+/gi, '_')}.png`);
  writeFileSync(file, r.toPNG());
  console.log(`preview: ${file}`);
}

function onBackdrop(r: Raster, pad = 2): Raster {
  if (!bg) return r;
  const out = solid(r.w + pad * 2, r.h + pad * 2, bg);
  out.blit(r, pad, pad);
  return out;
}

if (flag('--board')) {
  // Style board: every look reference (native pixels) over every sprite
  // tagged 'calibration', at one zoom, so they're judged at the same scale.
  const summary = join(OUT, 'analysis');
  const refs: { name: string; raster: Raster }[] = [];
  const refsFile = join(summary, '..', '..', 'references', 'refs.json');
  if (existsSync(refsFile)) {
    for (const r of JSON.parse(readFileSync(refsFile, 'utf8')).references as { id: string; roles: string[] }[]) {
      const native = join(summary, r.id, 'native.png');
      if (r.roles.some((x) => x !== 'animation') && existsSync(native)) refs.push({ name: r.id, raster: Raster.fromPNG(native) });
    }
  }
  const calib = matchNames('tag:calibration').map((n) => ({ name: n, raster: onBackdrop(renderSprite(n)) }));
  if (!refs.length) console.warn('preview: no analyzed look references (run npm run analyze first)');
  if (!calib.length) console.warn("preview: no sprites tagged 'calibration' yet");
  const all = [...refs, ...calib];
  const big = Math.max(1, ...all.map((i) => Math.max(i.raster.w, i.raster.h)));
  const zoom = Number(opt('--zoom')) || Math.max(1, Math.min(6, Math.floor(200 / big)));
  const rows: Raster[] = [];
  if (refs.length) rows.push(label('references', 2), contactSheet(refs, { zoom, labelScale: 2 }));
  if (calib.length) rows.push(label('ours', 2), contactSheet(calib, { zoom, labelScale: 2 }));
  write('board', stack(rows.length ? rows : [label('nothing to show yet', 2)], 'down', 10, hex('#202028')));
} else if (!target || target === 'list') {
  console.log(Object.keys(SPRITES).join('\n') || '(no sprites registered yet)');
} else if (SPRITES[target]) {
  const r = renderSprite(target);
  const zoom = Number(opt('--zoom')) || Math.max(2, Math.min(12, Math.floor(256 / Math.max(r.w, r.h))));
  const parts = [onBackdrop(r).scaled(zoom), onBackdrop(r)];
  if (SPRITES[target].texture || flag('--tile')) parts.push(tiled(r, 3).scaled(Math.max(1, Math.floor(zoom / 2))));
  write(target, stack(parts));
} else {
  const names = matchNames(target);
  if (!names.length) {
    console.error(`preview: nothing matches '${target}'. Try: npm run preview -- list`);
    process.exit(1);
  }
  const items = names.map((n) => ({ name: n, raster: onBackdrop(renderSprite(n)) }));
  const big = Math.max(...items.map((i) => Math.max(i.raster.w, i.raster.h)));
  const zoom = Number(opt('--zoom')) || Math.max(1, Math.min(8, Math.floor(96 / big)));
  write(target, contactSheet(items, { zoom }));
}
