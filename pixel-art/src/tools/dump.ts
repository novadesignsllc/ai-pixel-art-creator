// npm run dump -- <ref-id | path/to/image> [--frames 0,1,2] [--region x0,y0,x1,y1]
//
// Prints frames as letter grids (one letter per color, '.' = empty) with x/y
// rulers: how a reference pose is read pixel by pixel before redrawing it.
// Works on a refs.json id (uses its scale/frame settings) or any image path.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadImage } from '../engine/image.js';
import { contentOnly, dumpFrames, sliceFrames } from './analyze/motion.js';
import { nativize } from './analyze/native.js';
import type { RefEntry } from './analyze/refs.js';
import { REFS } from './paths.js';

const argv = process.argv.slice(2);
const opt = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const target = argv.find((a, i) => !a.startsWith('--') && !['--frames', '--region'].includes(argv[i - 1] ?? ''));

async function main(): Promise<void> {
  if (!target) throw new Error('usage: npm run dump -- <ref-id | image path> [--frames 0,1] [--region x0,y0,x1,y1]');
  const refsFile = join(REFS, 'refs.json');
  const refs: RefEntry[] = existsSync(refsFile) ? JSON.parse(readFileSync(refsFile, 'utf8')).references : [];
  const ref = refs.find((r) => r.id === target);
  const file = ref ? join(REFS, ref.file) : resolve(process.env.INIT_CWD ?? process.cwd(), target);
  if (!existsSync(file)) throw new Error(`dump: '${target}' is neither a refs.json id nor a file`);
  const img = await loadImage(file);
  const base = nativize(img.frames[0], { scale: ref?.scale, background: ref?.background, noisy: img.format === 'jpeg' });
  const fr = sliceFrames(img.frames, img.delays, { frame: ref?.frame, frames: ref?.frames, row: ref?.row, fps: ref?.fps }, base);
  const pick = opt('--frames')?.split(',').map(Number) ?? fr.frames.map((_, i) => i);
  const frames = pick.map((i) => {
    if (!fr.frames[i]) throw new Error(`dump: no frame ${i} (there are ${fr.frames.length})`);
    return contentOnly(fr.frames[i], fr.masks[i]);
  });
  const region = opt('--region')?.split(',').map(Number) as [number, number, number, number] | undefined;
  for (const n of [...base.notes, ...fr.notes]) console.log(`note: ${n}`);
  console.log(`native ${base.img.w}x${base.img.h} (file scale ${base.scale}x), frames ${fr.frameW}x${fr.frameH}, showing ${pick.join(',')}`);
  console.log(dumpFrames(frames, { region, labels: pick }));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
