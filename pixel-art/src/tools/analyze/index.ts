// npm run analyze [-- <id> ...]
//
// Measures every reference in references/ the same way, every time:
//   1. native.ts   undo upscaling, clean colors, find the background
//   2. measure.ts  palette ramps, outline, light, shading, detail, tile size
//   3. motion.ts   (animations) frame-by-frame motion table + letter dumps
// and writes, per reference, out/analysis/<id>/:
//   report.md + report.json   the numbers, in a fixed order
//   view.png                  the reference at native pixels, zoomed
//   palette.png               its colors grouped into material ramps
//   value.png                 lightness only (how the shading is built)
//   map.png                   blue = silhouette edge, red = dark lines, green = dither
//   (animations) film.png, onion.png, preview.gif, dump.txt, motion.json
// plus out/analysis/SUMMARY.md (every reference side by side, and the
// weighted "decision inputs" for STYLE.md) and out/analysis/refs-board.png.
// It also creates references/notes/<id>.md: the fixed checklist the agent
// answers after looking at the images (REFERENCES.md, step 3).

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hex, luma, type RGBA } from '../../engine/color.js';
import { contactSheet, label, stack, TEXT_H } from '../../engine/board.js';
import { loadImage, writeGif } from '../../engine/image.js';
import { Raster } from '../../engine/raster.js';
import { OUT, REFS } from '../paths.js';
import { direction, measure, type MeasureMaps, type Measures } from './measure.js';
import { dumpFrames, measureMotion, motionSummary, motionTable, sliceFrames, contentOnly, type Motion } from './motion.js';
import { nativize, type Native } from './native.js';
import { loadRefs, type RefEntry } from './refs.js';
import { matchNames, renderSprite } from '../shared.js';

const ANALYSIS = join(OUT, 'analysis');

function fitZoom(w: number, h: number, target = 640, max = 8): number {
  return Math.max(1, Math.min(max, Math.floor(target / Math.max(w, h))));
}

function paletteImage(m: Measures): Raster {
  const SW = 28;
  const rows = m.palette.ramps.map((ramp) => {
    const head = label(`${ramp.name}  ${Math.round(ramp.share * 100)}%`, 1);
    const r = new Raster(Math.max(head.w, ramp.colors.length * (SW + 2)), TEXT_H + 4 + SW + 2 + TEXT_H + 2);
    r.blit(head, 0, 0);
    ramp.colors.forEach((c, i) => {
      r.rect(i * (SW + 2), TEXT_H + 4, SW, SW, hex(c.hex));
      r.blit(label(c.hex.slice(1), 1), i * (SW + 2), TEXT_H + 4 + SW + 2);
    });
    return r;
  });
  return stack(rows.length ? rows : [label('no colors', 1)], 'down', 6, hex('#202028'));
}

const BACKDROP: RGBA = [24, 24, 30, 255];

function valueImage(n: Native, zoom: number): Raster {
  const out = new Raster(n.img.w, n.img.h);
  for (let i = 0; i < n.img.w * n.img.h; i++) {
    if (!n.mask[i]) {
      out.set(i % n.img.w, Math.floor(i / n.img.w), BACKDROP);
      continue;
    }
    const v = Math.round(luma(n.img.get(i % n.img.w, Math.floor(i / n.img.w))) * 255);
    out.set(i % n.img.w, Math.floor(i / n.img.w), [v, v, v, 255]);
  }
  return out.scaled(zoom);
}

function mapImage(n: Native, maps: MeasureMaps, zoom: number): Raster {
  const out = new Raster(n.img.w, n.img.h);
  for (let i = 0; i < n.img.w * n.img.h; i++) {
    const x = i % n.img.w;
    const y = Math.floor(i / n.img.w);
    if (!n.mask[i]) {
      out.set(x, y, BACKDROP);
      continue;
    }
    let c: RGBA;
    if (maps.dither[i]) c = [60, 220, 90, 255];
    else if (maps.line[i]) c = [235, 60, 60, 255];
    else if (maps.edge[i]) c = [70, 130, 255, 255];
    else {
      const v = Math.round(60 + luma(n.img.get(x, y)) * 90);
      c = [v, v, v, 255];
    }
    out.set(x, y, c);
  }
  return out.scaled(zoom);
}

function fmtRamp(r: Measures['palette']['ramps'][number]): string {
  return `| ${r.name} | ${Math.round(r.share * 100)}% | ${r.colors.length} | ${r.colors.map((c) => c.hex).join(' ')} | ${r.lightRange[0]}–${r.lightRange[1]} | ${r.avgStep} | ${r.shadowTowards} | ${r.highlightTowards} |`;
}

function report(ref: RefEntry, n: Native, m: Measures, motion: Motion | null, notes: string[]): string {
  const L: string[] = [];
  L.push(`# Reference analysis: ${ref.id}`, '');
  L.push(`- file: \`references/${ref.file}\``);
  L.push(`- roles: ${ref.roles.join(', ')} · rights: **${ref.rights}** · weight: ${ref.weight ?? 1}`);
  if (ref.subject) L.push(`- subject: ${ref.subject}`);
  if (ref.take) L.push(`- take: ${ref.take}`);
  if (ref.ignore) L.push(`- ignore: ${ref.ignore}`);
  L.push('', '## 1. Pixels', '');
  L.push(`- native size: ${n.img.w}x${n.img.h} px (file was upscaled ${n.scale}x; grid fit x ${Math.round(n.scaleX.score * 100)}%, y ${Math.round(n.scaleY.score * 100)}%)`);
  L.push(`- mode: **${n.mode}** (background: ${n.background}); content pixels: ${m.size.contentPixels}`);
  L.push(`- colors: ${n.colorsRaw} distinct${n.colorsClean !== n.colorsRaw ? ` → ${n.colorsClean} after merging noise` : ''}; ${m.palette.significant} cover ≥0.5% of the content`);
  for (const note of [...n.notes, ...notes]) L.push(`- ⚠ ${note}`);
  L.push('', '## 2. Palette and ramps', '');
  L.push(`- avg saturation ${m.palette.avgSaturation}; lightness: ${Math.round(m.palette.lightness.dark * 100)}% dark / ${Math.round(m.palette.lightness.mid * 100)}% mid / ${Math.round(m.palette.lightness.light * 100)}% light (5th–95th pct ${m.palette.lightness.p5}–${m.palette.lightness.p95})`);
  L.push('', '| ramp | share | shades | colors (dark → light) | lightness | avg step | shadow leans | highlight leans |', '|---|---|---|---|---|---|---|---|');
  for (const r of m.palette.ramps.slice(0, 16)) L.push(fmtRamp(r));
  L.push('', '## 3. Outline and linework', '');
  if (m.outline.type === 'n/a') L.push('- silhouette outline: n/a (scene mode)');
  else {
    L.push(`- silhouette outline: **${m.outline.type}**${m.outline.color ? ` (${m.outline.color}, ${m.outline.thickness})` : ''}`);
    L.push(`- most common edge color covers ${Math.round(m.outline.dominantShare * 100)}% of the silhouette; ${Math.round(m.outline.edgeDarker * 100)}% of edge pixels are darker than the pixel inside them`);
    if (m.outline.type === 'uniform') L.push(`- ${Math.round(m.outline.interiorLines * 100)}% of outline-colored pixels are interior lines`);
  }
  L.push(`- thin dark lines: ${Math.round(m.lines.share * 1000) / 10}% of content (colors: ${m.lines.topColors.join(' ') || 'none'})`);
  L.push('', '## 4. Light', '');
  L.push(`- light comes from: **${m.light.direction}** (strength ${m.light.strength}: <0.08 weak, 0.08–0.25 clear, >0.25 strong; ${m.light.method === 'regions' ? 'measured from the shading inside each material' : 'no material has more than one shade, so the shading says nothing about light'})`);
  if (m.light.objectVector) L.push(`- per object, brighter half: ${m.light.objectVector.join(', ')} (${direction(m.light.objectVector[0], m.light.objectVector[1])}); this also reflects where light-colored parts sit, so trust the line above`);
  if (m.light.regionVector) L.push(`- per material patch, bright side offset: ${m.light.regionVector.join(', ')} (${direction(m.light.regionVector[0], m.light.regionVector[1])})`);
  L.push(`- next-lighter-shade direction (local texture): ${m.light.rampVector.join(', ')} (${direction(m.light.rampVector[0], m.light.rampVector[1])})`);
  L.push('', '## 5. Shading and texture', '');
  L.push(`- shades per material (median of materials ≥2%): **${m.shading.stepsPerRamp}**`);
  L.push(`- dithering: ${Math.round(m.shading.ditherShare * 1000) / 10}% of pixels (>1% = deliberate dithering)`);
  L.push(`- lone pixels (unlike all 8 neighbors): ${Math.round(m.shading.orphanShare * 1000) / 10}% (high = noisy texture)`);
  L.push(`- translucent pixels: ${Math.round(m.shading.translucentShare * 1000) / 10}% (soft shadows, glows, anti-aliasing)`);
  L.push('', '## 6. Detail density', '');
  L.push(`- mean same-color run: ${m.detail.meanRun} px; mean same-color cluster: **${m.detail.meanCluster} px**; ${m.detail.clustersPer100} clusters per 100 px (higher = busier)`);
  if (m.shapes) {
    L.push('', '## 7. Shapes', '');
    L.push(`- objects: ${m.shapes.objects}; largest: ${m.shapes.sizes.slice(0, 10).map((s) => `${s.w}x${s.h}`).join(', ')}`);
    L.push(`- most common widths/heights: ${m.shapes.commonDims.map((d) => `${d.dim}px ×${d.count}`).join(', ')}`);
  }
  L.push('', '## 8. Grid', '');
  L.push(`- repeating period guess: **${m.tile.guess ? `${m.tile.guess} px` : 'none found'}** (x best: ${m.tile.periodX.map((p) => `${p.p}px ${p.score}`).join(', ') || '-'}; y best: ${m.tile.periodY.map((p) => `${p.p}px ${p.score}`).join(', ') || '-'})`);
  if (motion) {
    L.push('', '## 9. Motion', '');
    L.push(...motionSummary(motion));
    L.push('', motionTable(motion));
    L.push('', '"top third / middle / bottom third" = centroid of each third of the body (roughly head / torso / legs), relative to frame 0.');
  }
  L.push('', '## Images', '');
  L.push('`view.png` (native pixels, zoomed) · `palette.png` · `value.png` (lightness only) · `map.png` (blue edge, red lines, green dither)');
  if (motion) L.push('`film.png` (every frame) · `onion.png` (each frame over the previous one) · `preview.gif` · `dump.txt` (letter grids)');
  L.push('', `Next: answer the checklist in \`references/notes/${ref.id}.md\` (REFERENCES.md step 3).`);
  return L.join('\n') + '\n';
}

const STYLE_CHECKLIST = [
  'Camera / perspective (top-down, 3/4 top-down, side view, isometric, front):',
  'Silhouettes (round, angular, mixed) and how they read at 1x:',
  'Proportions (characters: head-to-body ratio; objects: squat or tall, chunky or thin):',
  'Outline (confirm the measured type; where it breaks, changes color, or is missing):',
  'Shading (shades per material; hard bands or soft; where highlights sit; rim light; cast shadows):',
  'Light (confirm the measured direction; is it consistent across objects?):',
  'Color (saturation and mood; how shadows and highlights shift hue; how accents are used):',
  'Detail density (how much interior detail per tile or object; cluster size):',
  'Texture (dithering, noise, patterns, or clean flats):',
  'Signature moves (2-4 things that make this style itself):',
  'Take / ignore (from refs.json, plus anything else noticed):',
  'Conflicts with other references (and which should win):',
];

const ANIM_CHECKLIST = [
  'Action, frame count, timing (measured fps; holds):',
  'Key poses: which frames are the extremes (contact, passing, anticipation, impact, recovery):',
  'Per body part, per frame: what the head, torso, arms and legs do (use the motion table and dump.txt):',
  'Squash and stretch, anticipation, overshoot, smear frames:',
  'Motion size: what moves 1px, what moves 2px or more:',
  'Ground contact: do the feet stay planted? (bottom dy):',
  'Loop: seamless? (loop seam):',
  'Secondary motion (hair, cloth, tails, effects):',
  'Keep exactly (timing, offsets) vs redraw in our style:',
];

function notesTemplate(ref: RefEntry, motion: boolean): string {
  const L = [
    `# Notes: ${ref.id}`,
    '',
    `Reference: \`references/${ref.file}\` · numbers: \`out/analysis/${ref.id}/report.md\``,
    '',
    'Answer every line after viewing view.png, palette.png, value.png and map.png' + (motion ? ', film.png, onion.png and dump.txt.' : '.'),
    'Quote the measured numbers where they apply. Same questions for every reference, so references stay comparable.',
    '',
    '## Look',
    '',
    ...STYLE_CHECKLIST.map((q, i) => `${i + 1}. ${q}`),
  ];
  if (motion) L.push('', '## Motion', '', ...ANIM_CHECKLIST.map((q, i) => `${i + 1}. ${q}`));
  return L.join('\n') + '\n';
}

interface Done {
  ref: RefEntry;
  n: Native;
  m: Measures;
  motion: Motion | null;
}

function vote<T extends string | number>(items: { v: T; w: number }[]): { v: T; share: number } | null {
  const tally = new Map<T, number>();
  let total = 0;
  for (const { v, w } of items) {
    tally.set(v, (tally.get(v) ?? 0) + w);
    total += w;
  }
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? { v: best[0], share: Math.round((best[1] / total) * 100) / 100 } : null;
}

function median(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function summary(all: Done[]): string {
  const L: string[] = ['# Reference summary', '', 'Generated by `npm run analyze`. Same measurements for every reference.', ''];
  L.push('| id | roles | rights | native | mode | colors | outline | light | shades | dither | cluster px | grid |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const { ref, n, m } of all) {
    L.push(
      `| ${ref.id} | ${ref.roles.join(',')} | ${ref.rights} | ${n.img.w}x${n.img.h} (${n.scale}x) | ${n.mode} | ${m.palette.significant} | ${m.outline.type}${m.outline.color ? ` ${m.outline.color}` : ''} | ${m.light.direction} (${m.light.strength}) | ${m.shading.stepsPerRamp} | ${m.shading.ditherShare > 0.01 ? 'yes' : 'no'} | ${m.detail.meanCluster} | ${m.tile.guess ?? '-'} |`,
    );
  }
  const look = all.filter((d) => d.ref.roles.some((r) => r !== 'animation') && !d.ref.id.startsWith('ours-'));
  const w = (d: Done) => d.ref.weight ?? 1;
  L.push('', '## Decision inputs (weighted across look references)', '');
  if (!look.length) L.push('No style / lighting / palette / subject references yet.');
  else {
    const outline = vote(look.filter((d) => d.m.outline.type !== 'n/a').map((d) => ({ v: d.m.outline.type, w: w(d) })));
    const outlineColor = vote(look.filter((d) => d.m.outline.color).map((d) => ({ v: d.m.outline.color!, w: w(d) })));
    const lightRefs = look.filter((d) => d.ref.roles.includes('lighting') || d.ref.roles.includes('style'));
    const light = vote(lightRefs.filter((d) => d.m.light.strength >= 0.08 && d.m.light.direction !== 'none').map((d) => ({ v: d.m.light.direction, w: w(d) * d.m.light.strength })));
    const temps = (pick: (r: Measures['palette']['ramps'][number]) => string) =>
      vote(look.flatMap((d) => d.m.palette.ramps.filter((r) => r.share >= 0.05 && r.colors.length > 1).map((r) => ({ v: pick(r), w: w(d) * r.share }))));
    const shadowLean = temps((r) => r.shadowTemp);
    const highlightLean = temps((r) => r.highlightTemp);
    L.push(`- outline: ${outline ? `**${outline.v}** (${Math.round(outline.share * 100)}% of weight)` : 'no sprite-mode references'}${outlineColor ? `, most common color ${outlineColor.v}` : ''}`);
    L.push(`- light comes from: ${light ? `**${light.v}** (${Math.round(light.share * 100)}% of weight)` : 'no clear direction in any reference'}`);
    L.push(`- shades per material (median): **${median(look.map((d) => d.m.shading.stepsPerRamp).filter((v) => v > 0)) ?? '-'}**`);
    L.push(`- hue shift: shadows go **${shadowLean?.v ?? 'n/a'}** (${shadowLean ? Math.round(shadowLean.share * 100) : 0}% of weight), highlights go **${highlightLean?.v ?? 'n/a'}** (${highlightLean ? Math.round(highlightLean.share * 100) : 0}%) than the main shade`);
    L.push(`- dithering: ${look.filter((d) => d.m.shading.ditherShare > 0.01).length} of ${look.length} references`);
    L.push(`- translucent pixels: ${look.filter((d) => d.m.shading.translucentShare > 0.01).length} of ${look.length} references`);
    L.push(`- significant colors per image (median): ${median(look.map((d) => d.m.palette.significant))}`);
    L.push(`- avg saturation (median): ${median(look.map((d) => d.m.palette.avgSaturation))}`);
    L.push(`- detail, mean cluster px (median): ${median(look.map((d) => d.m.detail.meanCluster))}`);
    L.push(`- grid / tile size guesses: ${look.map((d) => d.m.tile.guess).filter(Boolean).join(', ') || 'none'}`);
    L.push(`- upscale of the files: ${[...new Set(look.map((d) => d.n.scale))].join(', ')}x (irrelevant to the style; just how they were saved)`);
  }
  const anims = all.filter((d) => d.motion);
  if (anims.length) {
    L.push('', '## Animations', '');
    for (const d of anims) L.push(`### ${d.ref.id}`, '', ...motionSummary(d.motion!), '');
  }
  const ours = all.filter((d) => d.ref.id.startsWith('ours-'));
  if (ours.length) {
    L.push('', '## Ours vs the references', '', 'The `ours-*` rows above are our own sprites, measured the same way. Compare them with the decision inputs: outline type and color, light direction, shades per material, saturation, cluster size. A big gap is a style miss to fix before more art is made.');
  }
  const unknown = all.filter((d) => d.ref.rights === 'unknown');
  if (unknown.length) {
    L.push('', '## ⚠ Rights not set', '', `Ask the user and fill \`rights\` in references/refs.json for: ${unknown.map((d) => d.ref.id).join(', ')}.`);
    L.push('A redraw that follows a reference closely (animation poses, a character) needs `own` or `licensed`. `style-only` references are for looking and measuring only.');
  }
  return L.join('\n') + '\n';
}

// Our own sprites with a tag, laid out on transparent pixels and measured
// exactly like a reference: the self-check against the reference numbers.
function oursEntry(tag: string): Done | null {
  const names = matchNames(`tag:${tag}`);
  if (!names.length) {
    console.warn(`analyze: no sprites tagged '${tag}' (tag them in src/art/registry.ts)`);
    return null;
  }
  const sprites = names.map((n) => renderSprite(n));
  const gap = 3;
  const sheet = new Raster(sprites.reduce((a, r) => a + r.w + gap, gap), Math.max(...sprites.map((r) => r.h)) + gap * 2);
  let x = gap;
  for (const r of sprites) {
    sheet.blit(r, x, gap);
    x += r.w + gap;
  }
  const n = nativize(sheet, { scale: 1, background: 'auto' });
  const ref: RefEntry = { id: `ours-${tag}`, file: `(src/art: sprites tagged '${tag}')`, roles: ['style'], rights: 'own', subject: names.join(', ') };
  return { ref, n, m: measure(n), motion: null };
}

async function main(): Promise<void> {
  const oursIdx = process.argv.indexOf('--ours');
  const oursTag = oursIdx >= 0 ? (process.argv[oursIdx + 1] && !process.argv[oursIdx + 1].startsWith('--') ? process.argv[oursIdx + 1] : 'calibration') : null;
  const want = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--ours');
  const { refs, added } = loadRefs();
  for (const a of added) console.log(`analyze: found new reference ${a.file} → id '${a.id}' (roles: ${a.roles.join(', ')}). Fill in take / ignore / rights in references/refs.json.`);
  const todo = want.length && !want.includes('all') ? refs.filter((r) => want.includes(r.id)) : refs;
  const missing = want.filter((w) => w !== 'all' && !refs.some((r) => r.id === w));
  if (missing.length) throw new Error(`analyze: no reference with id ${missing.join(', ')} (see references/refs.json)`);
  if (!refs.length && !oursTag) {
    console.log('analyze: no references yet. Put images in pixel-art/references/<style|lighting|palette|animation|subject>/ and run again.');
    return;
  }
  mkdirSync(ANALYSIS, { recursive: true });
  mkdirSync(join(REFS, 'notes'), { recursive: true });
  const done: Done[] = [];
  for (const ref of refs) {
    const dir = join(ANALYSIS, ref.id);
    const img = await loadImage(join(REFS, ref.file));
    const n = nativize(img.frames[0], { scale: ref.scale, background: ref.background, noisy: img.format === 'jpeg' });
    const animated = ref.roles.includes('animation') || img.frames.length > 1 || !!ref.frame;
    const maps: MeasureMaps = { edge: new Uint8Array(n.img.w * n.img.h), line: new Uint8Array(n.img.w * n.img.h), dither: new Uint8Array(n.img.w * n.img.h) };
    const m = measure(n, maps);
    let motion: Motion | null = null;
    const notes: string[] = [];
    let frames: ReturnType<typeof sliceFrames> | null = null;
    if (animated) {
      frames = sliceFrames(img.frames, img.delays, { frame: ref.frame, frames: ref.frames, row: ref.row, fps: ref.fps }, n);
      notes.push(...frames.notes);
      if (frames.frames.length > 1) motion = measureMotion(frames);
    }
    done.push({ ref, n, m, motion });
    if (!todo.includes(ref)) continue;

    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const zoom = fitZoom(n.img.w, n.img.h);
    writeFileSync(join(dir, 'native.png'), n.img.toPNG());
    writeFileSync(join(dir, 'view.png'), n.img.scaled(zoom).toPNG());
    writeFileSync(join(dir, 'palette.png'), paletteImage(m).toPNG());
    writeFileSync(join(dir, 'value.png'), valueImage(n, zoom).toPNG());
    writeFileSync(join(dir, 'map.png'), mapImage(n, maps, zoom).toPNG());
    if (frames && motion) {
      const fz = fitZoom(frames.frameW, frames.frameH, 256, 8);
      const clean = frames.frames.map((f, i) => contentOnly(f, frames!.masks[i]));
      writeFileSync(join(dir, 'film.png'), contactSheet(clean.map((r, i) => ({ name: `f${i}`, raster: r })), { zoom: fz, cols: Math.min(clean.length, 8), labelScale: 2 }).toPNG());
      const onion = clean.map((f, i) => {
        const o = new Raster(f.w, f.h);
        if (i > 0) o.blend(clean[i - 1], 0, 0, 0.3);
        o.blit(f, 0, 0);
        return { name: i > 0 ? `f${i - 1}>f${i}` : 'f0', raster: o };
      });
      writeFileSync(join(dir, 'onion.png'), contactSheet(onion, { zoom: fz, cols: Math.min(clean.length, 8), labelScale: 2 }).toPNG());
      writeGif(join(dir, 'preview.gif'), clean, motion.durationsMs ?? 100, { zoom: fz });
      writeFileSync(join(dir, 'dump.txt'), dumpFrames(clean));
      writeFileSync(join(dir, 'motion.json'), JSON.stringify(motion, null, 2));
    }
    writeFileSync(join(dir, 'report.json'), JSON.stringify({ ref, native: { w: n.img.w, h: n.img.h, scale: n.scale, mode: n.mode, background: n.background, notes: [...n.notes, ...notes] }, measures: m, motion }, null, 2));
    writeFileSync(join(dir, 'report.md'), report(ref, n, m, motion, notes));
    const notesFile = join(REFS, 'notes', `${ref.id}.md`);
    if (!existsSync(notesFile)) writeFileSync(notesFile, notesTemplate(ref, !!motion));
    console.log(`analyze: ${ref.id} → out/analysis/${ref.id}/report.md`);
  }
  if (oursTag) {
    const ours = oursEntry(oursTag);
    if (ours) {
      const dir = join(ANALYSIS, ours.ref.id);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const maps: MeasureMaps = { edge: new Uint8Array(ours.n.img.w * ours.n.img.h), line: new Uint8Array(ours.n.img.w * ours.n.img.h), dither: new Uint8Array(ours.n.img.w * ours.n.img.h) };
      measure(ours.n, maps);
      const zoom = fitZoom(ours.n.img.w, ours.n.img.h);
      writeFileSync(join(dir, 'view.png'), ours.n.img.scaled(zoom).toPNG());
      writeFileSync(join(dir, 'palette.png'), paletteImage(ours.m).toPNG());
      writeFileSync(join(dir, 'value.png'), valueImage(ours.n, zoom).toPNG());
      writeFileSync(join(dir, 'map.png'), mapImage(ours.n, maps, zoom).toPNG());
      writeFileSync(join(dir, 'report.md'), report(ours.ref, ours.n, ours.m, null, []));
      writeFileSync(join(dir, 'report.json'), JSON.stringify({ ref: ours.ref, measures: ours.m }, null, 2));
      done.push(ours);
      console.log(`analyze: ours (${oursTag}) → out/analysis/${ours.ref.id}/report.md`);
    }
  }
  writeFileSync(join(ANALYSIS, 'SUMMARY.md'), summary(done));
  // every reference at native pixels, same zoom: the left half of the style board
  const look = done.filter((d) => d.ref.roles.some((r) => r !== 'animation'));
  if (look.length) {
    const maxDim = Math.max(...look.map((d) => Math.max(d.n.img.w, d.n.img.h)));
    const z = fitZoom(maxDim, maxDim, 320, 6);
    writeFileSync(join(ANALYSIS, 'refs-board.png'), contactSheet(look.map((d) => ({ name: d.ref.id, raster: d.n.img })), { zoom: z, labelScale: 2 }).toPNG());
  }
  console.log(`analyze: summary → out/analysis/SUMMARY.md`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
