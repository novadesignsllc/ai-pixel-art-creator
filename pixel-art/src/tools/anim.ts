// npm run anim -- <name> [--ship]
//
// The fast loop for one animation: renders it (every facing) and writes
// out/anims/<name>/:
//   film.png        every frame, labeled, zoomed
//   onion.png       each frame over a ghost of the previous one
//   preview.gif     at the real timing
//   compare.png     (if the anim names a reference) reference frames above ours, same zoom
//   motion.md       our motion table, and the reference's, measured the same way
// Any off-palette pixel or frame-count mismatch is printed as CHECK: ...
// --ship also runs the full build so the app picks it up.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contactSheet, label, stack } from '../engine/board.js';
import { hex } from '../engine/color.js';
import { loadImage, writeGif } from '../engine/image.js';
import { applyLightingToFrames } from '../engine/lighting.js';
import { Raster } from '../engine/raster.js';
import type { Sheet } from '../engine/anim.js';
import { ANIMS } from '../art/registry.js';
import { measureMotion, motionSummary, motionTable, contentOnly, sliceFrames, type Frames } from './analyze/motion.js';
import { nativize } from './analyze/native.js';
import type { RefEntry } from './analyze/refs.js';
import { KIT, OUT, REFS } from './paths.js';
import { lightOpts } from './shared.js';

const argv = process.argv.slice(2);
const name = argv.find((a) => !a.startsWith('--'));
if (!name) {
  console.log(`usage: npm run anim -- <name> [--ship]\nanimations: ${ANIMS.map((a) => a.name).join(', ') || '(none yet)'}`);
  process.exit(name ? 0 : 1);
}
const anim = ANIMS.find((a) => a.name === name);
if (!anim) {
  console.error(`anim: no animation '${name}'. Registered: ${ANIMS.map((a) => a.name).join(', ') || '(none)'}`);
  process.exit(1);
}

async function referenceFrames(): Promise<Frames | null> {
  if (!anim!.reference) return null;
  const refsFile = join(REFS, 'refs.json');
  const refs: RefEntry[] = existsSync(refsFile) ? JSON.parse(readFileSync(refsFile, 'utf8')).references : [];
  const ref = refs.find((r) => r.id === anim!.reference!.ref);
  if (!ref) {
    console.log(`CHECK: reference '${anim!.reference.ref}' isn't in references/refs.json`);
    return null;
  }
  if (ref.rights === 'style-only' || ref.rights === 'unknown') {
    console.log(`CHECK: reference '${ref.id}' has rights '${ref.rights}'. Following its poses closely needs 'own' or 'licensed' (ask the user).`);
  }
  const img = await loadImage(join(REFS, ref.file));
  const base = nativize(img.frames[0], { scale: ref.scale, background: ref.background, noisy: img.format === 'jpeg' });
  const fr = sliceFrames(img.frames, img.delays, { frame: ref.frame, frames: ref.frames, row: ref.row, fps: ref.fps }, base);
  const pick = anim!.reference.frames;
  if (pick) {
    return { ...fr, frames: pick.map((i) => fr.frames[i]), masks: pick.map((i) => fr.masks[i]), delays: fr.delays ? pick.map((i) => fr.delays![i]) : null };
  }
  return fr;
}

async function main(): Promise<void> {
  const a = anim!;
  const dir = join(OUT, 'anims', a.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const light = a.lit === false ? null : lightOpts();
  const sheets: [string, Sheet][] = [['base', a.build()], ...Object.entries(a.facings ?? {}).map(([f, make]) => [f, make()] as [string, Sheet])];
  const delays = a.durations ?? Array(sheets[0][1].frames).fill(Math.round(1000 / a.fps));
  const zoom = Math.max(1, Math.min(8, Math.floor(160 / Math.max(a.frameW, a.frameH))));
  const ours: Raster[][] = [];
  for (const [facing, sheet] of sheets) {
    // checks: frame count per facing, and nothing drawn outside the legend
    if (sheet.frames !== sheets[0][1].frames) console.log(`CHECK: facing ${facing} has ${sheet.frames} frames, base has ${sheets[0][1].frames}`);
    const r = sheet.raster.clone();
    for (const c of r.colors()) if (!sheet.used.has(c.join(','))) console.log(`CHECK: ${facing}: pixel color ${c.join(',')} wasn't drawn from a legend`);
    if (light) applyLightingToFrames(r, a.frameW, a.frameH, light);
    const frames = Array.from({ length: sheet.frames }, (_, i) => r.crop(i * a.frameW, 0, a.frameW, a.frameH));
    for (let i = 0; i < frames.length; i++) if (!frames[i].colors().length) console.log(`CHECK: ${facing} frame ${i} is empty`);
    ours.push(frames);
    const suffix = facing === 'base' ? '' : `-${facing}`;
    writeFileSync(join(dir, `film${suffix}.png`), contactSheet(frames.map((f, i) => ({ name: `f${i}`, raster: f })), { zoom, cols: Math.min(8, frames.length), labelScale: 2 }).toPNG());
    const onion = frames.map((f, i) => {
      const o = new Raster(f.w, f.h);
      if (i > 0) o.blend(frames[i - 1], 0, 0, 0.3);
      o.blit(f, 0, 0);
      return { name: i ? `f${i - 1}>f${i}` : 'f0', raster: o };
    });
    writeFileSync(join(dir, `onion${suffix}.png`), contactSheet(onion, { zoom, cols: Math.min(8, frames.length), labelScale: 2 }).toPNG());
    writeGif(join(dir, `preview${suffix}.gif`), frames, delays, { zoom });
  }

  const md: string[] = [`# ${a.name}`, ''];
  const oursMotion = measureMotion({
    frames: ours[0],
    masks: ours[0].map((f) => {
      const m = new Uint8Array(f.w * f.h);
      for (let i = 0; i < m.length; i++) m[i] = f.data[i * 4 + 3] > 0 ? 1 : 0;
      return m;
    }),
    frameW: a.frameW,
    frameH: a.frameH,
    delays,
    notes: [],
  });
  md.push('## Ours', '', ...motionSummary(oursMotion), '', motionTable(oursMotion), '');

  const ref = await referenceFrames();
  if (ref) {
    const refMotion = measureMotion(ref);
    md.push(`## Reference: ${a.reference!.ref}`, '', ...motionSummary(refMotion), '', motionTable(refMotion), '');
    if (refMotion.frames !== oursMotion.frames) console.log(`CHECK: reference has ${refMotion.frames} frames, ours has ${oursMotion.frames}`);
    const refClean = ref.frames.map((f, i) => contentOnly(f, ref.masks[i]));
    const rz = Math.max(1, Math.min(8, Math.floor(160 / Math.max(ref.frameW, ref.frameH, a.frameW, a.frameH))));
    const rows = [
      label('reference', 2),
      contactSheet(refClean.map((f, i) => ({ name: `f${i}`, raster: f })), { zoom: rz, cols: Math.min(8, refClean.length), labelScale: 2 }),
      label('ours', 2),
      contactSheet(ours[0].map((f, i) => ({ name: `f${i}`, raster: f })), { zoom: rz, cols: Math.min(8, ours[0].length), labelScale: 2 }),
    ];
    writeFileSync(join(dir, 'compare.png'), stack(rows, 'down', 10, hex('#202028')).toPNG());
  }
  writeFileSync(join(dir, 'motion.md'), md.join('\n'));
  console.log(`anim: ${a.name} → ${dir} (film.png, onion.png, preview.gif${ref ? ', compare.png' : ''}, motion.md)`);
  if (argv.includes('--ship')) execFileSync('npm', ['run', '--silent', 'build'], { cwd: KIT, stdio: 'inherit' });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
