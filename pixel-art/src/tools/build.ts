// npm run build
//
// Runs every factory in src/art/registry.ts and writes the art the app uses:
//   <PROJECT.outDir>/<name>.png (+ @2x/@3x copies if PROJECT.exportScales asks)
//   <PROJECT.outDir>/manifest.json   sizes, anchors, frames, fps: the contract with the app
// and review sheets for people and agents:
//   out/sheets/all.png, out/sheets/<tag>.png, out/sheets/anims.png
//
// A file in overrides/ named like a sprite (overrides/<name>.png, or
// <anim>[-<facing>].png for a sheet) ships instead of the generated one:
// hand-painted pixels always win. Sizes must match exactly.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { contactSheet } from '../engine/board.js';
import { applyLighting, applyLightingToFrames } from '../engine/lighting.js';
import { Raster } from '../engine/raster.js';
import { PROJECT } from '../art/project.js';
import { ANIMS, SPRITES } from '../art/registry.js';
import { STYLE } from '../art/style.js';
import { KIT, OUT, OVERRIDES } from './paths.js';
import { lightOpts } from './shared.js';

const outDir = resolve(KIT, PROJECT.outDir);
const sheetsDir = join(OUT, 'sheets');
mkdirSync(outDir, { recursive: true });
mkdirSync(sheetsDir, { recursive: true });

if (!Number.isInteger(PROJECT.baseScale) || PROJECT.baseScale < 1 || PROJECT.exportScales.some((s) => !Number.isInteger(s) || s < 1)) {
  throw new Error('build: PROJECT.baseScale and exportScales must be whole numbers >= 1 (pixel art only scales by whole numbers)');
}
if (STYLE.status === 'unset') {
  console.warn('build: STYLE is unset: no style decisions yet. Run the style setup (REFERENCES.md) before making real art.');
}

const LIGHT = lightOpts();

// --- overrides ---
function findAseprite(): string | null {
  const candidates = [
    '/Applications/Aseprite.app/Contents/MacOS/aseprite',
    join(homedir(), 'Applications/Aseprite.app/Contents/MacOS/aseprite'),
    join(homedir(), 'Library/Application Support/Steam/steamapps/common/Aseprite/Aseprite.app/Contents/MacOS/aseprite'),
    'C:\\Program Files\\Aseprite\\Aseprite.exe',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Aseprite\\Aseprite.exe',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  try {
    const found = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['aseprite'], { encoding: 'utf8' }).trim().split('\n')[0];
    return found || null;
  } catch {
    return null;
  }
}
let aseprite: string | null | undefined;

function loadOverride(name: string, w: number, h: number): Raster | null {
  const png = join(OVERRIDES, `${name}.png`);
  const ase = join(OVERRIDES, `${name}.aseprite`);
  let file: string | null = null;
  if (existsSync(png)) file = png;
  else if (existsSync(ase)) {
    if (aseprite === undefined) aseprite = findAseprite();
    if (!aseprite) {
      console.warn(`build: overrides/${name}.aseprite found but the Aseprite CLI isn't installed; skipping it`);
      return null;
    }
    file = join(OUT, `.override-${name}.png`);
    execFileSync(aseprite, ['-b', ase, '--save-as', file]);
  }
  if (!file) return null;
  const r = Raster.fromPNG(file);
  if (r.w !== w || r.h !== h) throw new Error(`build: override '${name}' is ${r.w}x${r.h}, expected ${w}x${h}`);
  console.log(`build: using override for ${name}`);
  return r;
}

// --- writing at every export scale ---
const written: string[] = [];
function save(base: string, r: Raster): string {
  for (const s of PROJECT.exportScales) {
    const file = s === 1 ? `${base}.png` : `${base}@${s}x.png`;
    const k = PROJECT.baseScale * s;
    writeFileSync(join(outDir, file), (k === 1 ? r : r.scaled(k)).toPNG());
    written.push(file);
  }
  return `${base}.png`;
}

// --- sprites ---
const spriteManifest: Record<string, object> = {};
const built: { name: string; raster: Raster; tags: string[] }[] = [];
for (const [name, entry] of Object.entries(SPRITES)) {
  let r = entry.make();
  if (!(r instanceof Raster) || r.w === 0 || r.h === 0) throw new Error(`build: sprite '${name}' didn't return a non-empty Raster`);
  const ov = loadOverride(name, r.w, r.h);
  if (ov) r = ov;
  else if (LIGHT && !entry.texture && entry.lit !== false) applyLighting(r, LIGHT);
  const file = save(name, r);
  spriteManifest[name] = {
    file,
    w: r.w,
    h: r.h,
    anchorX: entry.anchorX,
    anchorY: entry.anchorY,
    ...(entry.texture ? { texture: true } : {}),
    ...(entry.tags?.length ? { tags: entry.tags } : {}),
    ...(entry.meta ? { meta: entry.meta } : {}),
  };
  built.push({ name, raster: r, tags: entry.tags ?? [] });
}

// --- animations ---
const animManifest: Record<string, object> = {};
const animFirstFrames: { name: string; raster: Raster }[] = [];
for (const a of ANIMS) {
  const sheets: [string | null, ReturnType<typeof a.build>][] = [[null, a.build()]];
  for (const [facing, make] of Object.entries(a.facings ?? {})) sheets.push([facing, make()]);
  const frames = sheets[0][1].frames;
  const facingFiles: Record<string, string> = {};
  let baseFile = '';
  for (const [facing, sheet] of sheets) {
    if (sheet.frameW !== a.frameW || sheet.frameH !== a.frameH) {
      throw new Error(`build: anim '${a.name}'${facing ? ` facing ${facing}` : ''} has ${sheet.frameW}x${sheet.frameH} frames, expected ${a.frameW}x${a.frameH}`);
    }
    if (sheet.frames !== frames) {
      // same frame count per facing, so turning mid-animation keeps the frame index
      throw new Error(`build: anim '${a.name}' facing ${facing} has ${sheet.frames} frames, the base has ${frames}`);
    }
    const name = facing ? `${a.name}-${facing}` : a.name;
    let r = sheet.raster;
    const ov = loadOverride(name, r.w, r.h);
    if (ov) r = ov;
    else if (LIGHT && a.lit !== false) {
      r = r.clone();
      applyLightingToFrames(r, a.frameW, a.frameH, LIGHT);
    }
    const file = save(name, r);
    if (facing) facingFiles[facing] = file;
    else {
      baseFile = file;
      animFirstFrames.push({ name: a.name, raster: r.crop(0, 0, a.frameW, a.frameH) });
    }
  }
  animManifest[a.name] = {
    file: baseFile,
    frameW: a.frameW,
    frameH: a.frameH,
    frames,
    fps: a.fps,
    ...(a.durations ? { durations: a.durations } : {}),
    loop: a.loop,
    anchorX: a.anchorX,
    anchorY: a.anchorY,
    ...(a.baseFacing ? { baseFacing: a.baseFacing } : {}),
    ...(Object.keys(facingFiles).length ? { facings: facingFiles } : {}),
    ...(a.mirror ? { mirror: a.mirror } : {}),
    ...(a.tags?.length ? { tags: a.tags } : {}),
  };
}

// --- remove files an earlier build wrote that no longer exist ---
const manifestPath = join(outDir, PROJECT.manifest);
if (existsSync(manifestPath)) {
  try {
    const prev = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const f of (prev.files ?? []) as string[]) {
      if (!written.includes(f) && /^[a-z0-9_@.-]+\.png$/.test(f)) rmSync(join(outDir, f), { force: true });
    }
  } catch {
    console.warn(`build: couldn't read the old ${PROJECT.manifest}; stale files (if any) were left in place`);
  }
}

const manifest = {
  generator: 'pixel-art-creator',
  style: STYLE.status,
  tileSize: STYLE.tileSize,
  baseScale: PROJECT.baseScale, // every file is enlarged by this; sizes below are in art pixels
  scales: PROJECT.exportScales,
  sprites: spriteManifest,
  anims: animManifest,
  files: written, // every file this build wrote (used to clean up the next build)
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// --- review sheets ---
rmSync(sheetsDir, { recursive: true, force: true });
mkdirSync(sheetsDir, { recursive: true });
const zoomFor = (items: { raster: Raster }[]) => {
  const big = Math.max(1, ...items.map((i) => Math.max(i.raster.w, i.raster.h)));
  return Math.max(1, Math.min(8, Math.floor(96 / big)));
};
if (built.length) {
  writeFileSync(join(sheetsDir, 'all.png'), contactSheet(built, { zoom: zoomFor(built) }).toPNG());
  const tags = [...new Set(built.flatMap((b) => b.tags))];
  for (const t of tags) {
    const items = built.filter((b) => b.tags.includes(t));
    writeFileSync(join(sheetsDir, `${t}.png`), contactSheet(items, { zoom: zoomFor(items) }).toPNG());
  }
}
if (animFirstFrames.length) writeFileSync(join(sheetsDir, 'anims.png'), contactSheet(animFirstFrames, { zoom: zoomFor(animFirstFrames) }).toPNG());

console.log(`build: ${built.length} sprites, ${ANIMS.length} animations → ${outDir}`);
if (built.length || animFirstFrames.length) console.log(`build: review sheets in ${sheetsDir}`);
