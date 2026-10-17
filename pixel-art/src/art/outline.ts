import { hex, fromHSL, toHSL, type RGBA } from '../engine/color.js';
import type { Raster } from '../engine/raster.js';
import { STYLE } from './style.js';

// The project's outline, as STYLE.ts defines it. Sprite factories call
// `finish(r)` as their last step so every sprite gets the same outline.
export function finish(r: Raster): Raster {
  const o = STYLE.outline;
  if (!o) return r;
  if ('color' in o) {
    r.outline(hex(o.color), { diagonal: o.diagonal });
  } else {
    const amount = o.amount;
    r.outline((c: RGBA) => {
      const hsl = toHSL(c);
      return fromHSL({ h: hsl.h, s: Math.min(1, hsl.s * 1.1), l: Math.max(0, hsl.l * (1 - amount)) });
    }, { diagonal: o.diagonal });
  }
  return r;
}
