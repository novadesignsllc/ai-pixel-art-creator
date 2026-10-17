// Step 1 of every analysis: turn whatever image the user dropped in (an
// upscaled screenshot, a JPG, a sprite sheet on a colored background) into
// clean native-resolution pixels plus a mask of what is "content".
// Every later measurement runs on this, so it must behave the same way
// every time: fixed thresholds, no randomness.

import { colorDistance, colorKey, fromKey, toHex, type RGBA } from '../../engine/color.js';
import { Raster } from '../../engine/raster.js';

export interface ScaleGuess {
  scale: number;
  phase: number;
  score: number; // share of color edges that land on the detected pixel grid
  edges: number;
}

function differs(a: RGBA, b: RGBA): boolean {
  if (a[3] < 128 !== b[3] < 128) return true;
  if (a[3] < 128) return false;
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) > 20;
}

// Find the upscale factor along one axis: the largest s for which (almost)
// every color change sits on a multiple of s (plus a phase offset).
function scaleAxis(r: Raster, axis: 'x' | 'y'): ScaleGuess {
  const MAX = 24;
  const hist: Uint32Array[] = [];
  for (let s = 0; s <= MAX; s++) hist.push(new Uint32Array(Math.max(1, s)));
  let n = 0;
  const outer = axis === 'x' ? r.h : r.w;
  const inner = axis === 'x' ? r.w : r.h;
  for (let o = 0; o < outer; o++) {
    let prev = axis === 'x' ? r.get(0, o) : r.get(o, 0);
    for (let i = 1; i < inner; i++) {
      const c = axis === 'x' ? r.get(i, o) : r.get(o, i);
      if (differs(prev, c)) {
        n++;
        for (let s = 2; s <= MAX; s++) hist[s][i % s]++;
      }
      prev = c;
    }
  }
  if (n < 40) return { scale: 1, phase: 0, score: 1, edges: n };
  for (let s = MAX; s >= 2; s--) {
    let best = 0;
    let phase = 0;
    for (let p = 0; p < s; p++) {
      if (hist[s][p] > best) {
        best = hist[s][p];
        phase = p;
      }
    }
    const score = best / n;
    if (score >= 0.85) return { scale: s, phase, score, edges: n };
  }
  return { scale: 1, phase: 0, score: 1, edges: n };
}

// median length of same-color runs along rows (a hint when no clean scale fits)
function medianRun(r: Raster): number {
  const runs: number[] = [];
  for (let y = 0; y < r.h; y += Math.max(1, Math.floor(r.h / 200))) {
    let len = 1;
    for (let x = 1; x < r.w; x++) {
      if (differs(r.get(x - 1, y), r.get(x, y))) {
        runs.push(len);
        len = 1;
      } else len++;
    }
    runs.push(len);
  }
  runs.sort((a, b) => a - b);
  return runs[Math.floor(runs.length / 2)] ?? 1;
}

// Downsample by whole cells: each native pixel = the most common color in its cell.
function downsample(r: Raster, sx: number, px: number, sy: number, py: number): Raster {
  const startX = px > 0 ? px - sx : 0;
  const startY = py > 0 ? py - sy : 0;
  const nw = Math.ceil((r.w - startX) / sx);
  const nh = Math.ceil((r.h - startY) / sy);
  const out = new Raster(nw, nh);
  for (let cy = 0; cy < nh; cy++) {
    for (let cx = 0; cx < nw; cx++) {
      const counts = new Map<number, number>();
      let best = 0;
      let bestKey = 0;
      for (let y = startY + cy * sy; y < startY + (cy + 1) * sy; y++) {
        for (let x = startX + cx * sx; x < startX + (cx + 1) * sx; x++) {
          if (!r.inside(x, y)) continue;
          const c = r.get(x, y);
          const k = c[3] < 128 ? 0 : colorKey([c[0], c[1], c[2], 255]);
          const v = (counts.get(k) ?? 0) + 1;
          counts.set(k, v);
          if (v > best) {
            best = v;
            bestKey = k;
          }
        }
      }
      if (bestKey !== 0) out.set(cx, cy, fromKey(bestKey));
    }
  }
  return out;
}

export function colorCounts(r: Raster, mask?: Uint8Array): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < r.w * r.h; i++) {
    if (mask && !mask[i]) continue;
    if (r.data[i * 4 + 3] === 0) continue;
    const k = colorKey([r.data[i * 4], r.data[i * 4 + 1], r.data[i * 4 + 2], r.data[i * 4 + 3]]);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

// Merge near-identical colors (JPEG noise, filtering). Only used when an
// image clearly isn't clean pixel art. Greedy by frequency, fixed threshold.
function mergeColors(r: Raster, threshold: number): number {
  const counts = [...colorCounts(r).entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const centers: RGBA[] = [];
  const map = new Map<number, RGBA>();
  for (const [k] of counts) {
    const c = fromKey(k);
    let hit: RGBA | null = null;
    for (const ctr of centers) {
      if (colorDistance(c, ctr) <= threshold) {
        hit = ctr;
        break;
      }
    }
    if (!hit) {
      centers.push(c);
      hit = c;
    }
    map.set(k, hit);
  }
  for (let i = 0; i < r.w * r.h; i++) {
    if (r.data[i * 4 + 3] === 0) continue;
    const k = colorKey([r.data[i * 4], r.data[i * 4 + 1], r.data[i * 4 + 2], r.data[i * 4 + 3]]);
    const c = map.get(k)!;
    r.data.set(c, i * 4);
  }
  return centers.length;
}

export interface Native {
  img: Raster; // native-resolution pixels
  mask: Uint8Array; // 1 = content (not background)
  scaleX: ScaleGuess;
  scaleY: ScaleGuess;
  scale: number; // the scale used for both axes
  mode: 'sprites' | 'scene'; // sprites = objects on a background; scene = full picture
  background: string; // 'transparent' | '#hex' | 'none'
  colorsRaw: number;
  colorsClean: number;
  translucent: number; // share of content pixels with partial alpha
  notes: string[];
}

export interface NativeOpts {
  scale?: number | 'auto';
  background?: string; // 'auto' | 'none' | '#hex'
  noisy?: boolean; // lossy source (JPEG): always merge near-identical colors
}

// share of colors that have a near-twin (distance <= 16): high in JPEGs and
// filtered screenshots, ~0 in clean pixel art
function nearTwinShare(r: Raster): number {
  const cols = [...colorCounts(r).keys()].slice(0, 600).map(fromKey);
  if (cols.length < 8) return 0;
  let twins = 0;
  for (let i = 0; i < cols.length; i++) {
    for (let j = 0; j < cols.length; j++) {
      if (i !== j && colorDistance(cols[i], cols[j]) <= 16) {
        twins++;
        break;
      }
    }
  }
  return twins / cols.length;
}

export function nativize(src: Raster, opts: NativeOpts = {}): Native {
  const notes: string[] = [];
  let sx: ScaleGuess;
  let sy: ScaleGuess;
  if (typeof opts.scale === 'number') {
    sx = { scale: opts.scale, phase: 0, score: 1, edges: 0 };
    sy = { ...sx };
    notes.push(`scale set by refs.json: ${opts.scale}x`);
  } else {
    sx = scaleAxis(src, 'x');
    sy = scaleAxis(src, 'y');
  }
  let scale = Math.min(sx.scale, sy.scale);
  if (sx.scale !== sy.scale && sx.scale > 1 && sy.scale > 1) {
    notes.push(`x and y scales disagree (${sx.scale} vs ${sy.scale}); using ${scale}. Set "scale" in refs.json if wrong.`);
  }
  if (scale === 1) {
    const mr = medianRun(src);
    if (mr >= 3) {
      notes.push(
        `no whole-number pixel grid found, but colors come in runs of ~${mr}px: the image is probably scaled by a non-whole factor or filtered. Measurements are approximate. A native-size PNG works best.`,
      );
    }
  }
  const img = scale > 1 ? downsample(src, scale, sx.scale === scale ? sx.phase : 0, scale, sy.scale === scale ? sy.phase : 0) : src.clone();

  // translucent pixels (soft shadows, anti-aliasing, glows)
  let partial = 0;
  let opaque = 0;
  for (let i = 0; i < img.w * img.h; i++) {
    const a = img.data[i * 4 + 3];
    if (a > 0) opaque++;
    if (a > 0 && a < 255) partial++;
  }

  const colorsRaw = colorCounts(img).size;
  let colorsClean = colorsRaw;
  const twins = nearTwinShare(img);
  if (opts.noisy || colorsRaw > 96 || twins > 0.3) {
    colorsClean = mergeColors(img, 26);
    const why = opts.noisy ? 'lossy file (JPEG)' : colorsRaw > 96 ? `${colorsRaw} distinct colors` : `${Math.round(twins * 100)}% of colors have a near-identical twin`;
    notes.push(`${why}: not clean pixel art (compression, filtering, or painted). Near-identical colors were merged to ${colorsClean} for measuring; exact hex values are approximate. A native-size PNG is better.`);
  } else {
    colorsClean = mergeColors(img, 6); // only true duplicates (off by a few RGB units)
  }

  // background
  const n = img.w * img.h;
  const mask = new Uint8Array(n).fill(1);
  let background = 'none';
  const transparentCount = n - opaque;
  const bgOpt = opts.background ?? 'auto';
  if (bgOpt === 'none') {
    background = 'none';
  } else if (bgOpt.startsWith('#')) {
    const bg = hexToRGBA(bgOpt);
    for (let i = 0; i < n; i++) if (colorDistance(img.get(i % img.w, Math.floor(i / img.w)), bg) <= 12) mask[i] = 0;
    for (let i = 0; i < n; i++) if (img.data[i * 4 + 3] === 0) mask[i] = 0;
    background = bgOpt;
  } else if (transparentCount / n > 0.02) {
    for (let i = 0; i < n; i++) if (img.data[i * 4 + 3] === 0) mask[i] = 0;
    background = 'transparent';
  } else {
    // a solid backdrop: the border is mostly one color
    const border = new Map<number, number>();
    let bn = 0;
    const add = (x: number, y: number) => {
      const k = colorKey(img.get(x, y));
      border.set(k, (border.get(k) ?? 0) + 1);
      bn++;
    };
    for (let x = 0; x < img.w; x++) {
      add(x, 0);
      add(x, img.h - 1);
    }
    for (let y = 1; y < img.h - 1; y++) {
      add(0, y);
      add(img.w - 1, y);
    }
    const [topKey, topCount] = [...border.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
    // a backdrop frames everything: it must cover nearly all of the border
    // (a scene's most common color doesn't). Override with "background".
    if (topCount / bn >= 0.85) {
      const bg = fromKey(topKey);
      let cleared = 0;
      for (let i = 0; i < n; i++) {
        if (colorDistance(img.get(i % img.w, Math.floor(i / img.w)), bg) <= 12) {
          mask[i] = 0;
          cleared++;
        }
      }
      // a "backdrop" covering almost nothing or almost everything isn't one
      if (cleared / n > 0.15 && cleared / n < 0.97) {
        background = toHex(bg);
        notes.push(`background guessed as ${background} (it fills the border). If that's wrong, set "background": "none" in refs.json.`);
      } else mask.fill(1);
    }
  }
  const mode = background === 'none' ? 'scene' : 'sprites';
  if (mode === 'scene') notes.push('no background found: measured as a full scene (silhouette/outline stats skipped).');

  return {
    img,
    mask,
    scaleX: sx,
    scaleY: sy,
    scale,
    mode,
    background,
    colorsRaw,
    colorsClean,
    translucent: opaque ? partial / opaque : 0,
    notes,
  };
}

function hexToRGBA(h: string): RGBA {
  const v = parseInt(h.replace('#', '').slice(0, 6), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
}
