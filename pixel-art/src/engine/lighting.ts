// Optional lighting pass: a deterministic post-process that shades every
// sprite the same way, so artists (and agents) can paint flat colors and the
// build adds consistent light. Whether a project uses it at all, and every
// number in it, is a STYLE.md decision (src/art/style.ts `lighting`).
// A project that hand-shades its sprites leaves `lighting: null`.
//
// Model: light comes from a direction (e.g. top-left). Body pixels on the
// silhouette side facing the light get lighter, pixels on the far side get
// darker, and an optional gradient darkens toward the far side. Outline
// colors are never touched.

import { hueDelta, fromHSL, toHSL, sameColor, type RGBA } from './color.js';
import type { Raster } from './raster.js';

export type LightDir = 'top-left' | 'top' | 'top-right' | 'left' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';

export interface LightOpts {
  from: LightDir;
  highlight: number; // 0..1 lightness added on the lit edge
  shade: number; // 0..1 lightness removed on the far edge
  gradient: number; // 0..1 extra darkening across the sprite, away from the light
  // hue drift: highlights toward warmHue, shadows toward coolHue (degrees),
  // by up to hueShift degrees. hueShift 0 = plain lighter/darker.
  warmHue: number;
  coolHue: number;
  hueShift: number;
  // colors the pass must leave alone (the outline, eyes, glowing bits...)
  skip: RGBA[];
}

const DIRS: Record<LightDir, [number, number]> = {
  'top-left': [-1, -1],
  top: [0, -1],
  'top-right': [1, -1],
  left: [-1, 0],
  right: [1, 0],
  'bottom-left': [-1, 1],
  bottom: [0, 1],
  'bottom-right': [1, 1],
};

function shift(c: RGBA, dl: number, opts: LightOpts): RGBA {
  const hsl = toHSL(c);
  const toward = dl > 0 ? opts.warmHue : opts.coolHue;
  let h = hsl.h;
  if (opts.hueShift > 0 && hsl.s > 0.04) {
    const d = hueDelta(h, toward);
    h += Math.sign(d) * Math.min(Math.abs(d), opts.hueShift * Math.min(1, Math.abs(dl) * 4));
  }
  return fromHSL({ h, s: hsl.s, l: Math.max(0, Math.min(1, hsl.l + dl)) }, c[3]);
}

export interface Region {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

export function applyLighting(r: Raster, opts: LightOpts, region?: Region): void {
  const x0 = region?.x0 ?? 0;
  const y0 = region?.y0 ?? 0;
  const x1 = x0 + (region?.w ?? r.w);
  const y1 = y0 + (region?.h ?? r.h);
  const [lx, ly] = DIRS[opts.from];
  const inRegion = (x: number, y: number) => x >= x0 && y >= y0 && x < x1 && y < y1;
  const skipped = (x: number, y: number) => opts.skip.some((s) => sameColor(r.get(x, y), s));
  const isBody = (x: number, y: number) => inRegion(x, y) && r.filled(x, y) && !skipped(x, y);

  // extent along the light axis, for the gradient
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!isBody(x, y)) continue;
      const t = -(x * lx + y * ly); // larger = nearer the light
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
  }
  const span = Math.max(1, hi - lo);

  const edits: [number, number, RGBA][] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!isBody(x, y)) continue;
      // lit edge: open toward the light; shade edge: open away from it
      const lit = (lx !== 0 && !isBody(x + lx, y)) || (ly !== 0 && !isBody(x, y + ly));
      const dark = (lx !== 0 && !isBody(x - lx, y)) || (ly !== 0 && !isBody(x, y - ly));
      let dl = 0;
      if (lit && !dark) dl += opts.highlight * 0.35;
      else if (dark && !lit) dl -= opts.shade * 0.3;
      if (opts.gradient > 0) {
        const t = -(x * lx + y * ly);
        dl -= opts.gradient * 0.3 * ((hi - t) / span);
      }
      if (dl !== 0) edits.push([x, y, shift(r.get(x, y), dl, opts)]);
    }
  }
  for (const [x, y, c] of edits) r.set(x, y, c);
}

// light each frame of a sheet on its own (each frame's silhouette decides
// its own lit and shaded edges)
export function applyLightingToFrames(r: Raster, frameW: number, frameH: number, opts: LightOpts): void {
  for (let y0 = 0; y0 < r.h; y0 += frameH) {
    for (let x0 = 0; x0 < r.w; x0 += frameW) applyLighting(r, opts, { x0, y0, w: frameW, h: frameH });
  }
}
