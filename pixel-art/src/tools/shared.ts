import { hex } from '../engine/color.js';
import { applyLighting, type LightOpts } from '../engine/lighting.js';
import type { Raster } from '../engine/raster.js';
import { SPRITES } from '../art/registry.js';
import { STYLE } from '../art/style.js';

// The lighting pass as STYLE configures it (null = this project hand-shades).
export function lightOpts(): LightOpts | null {
  if (!STYLE.lighting) return null;
  const skip = STYLE.lighting.skip.map((h) => hex(h));
  if (STYLE.outline && 'color' in STYLE.outline) skip.push(hex(STYLE.outline.color));
  return { ...STYLE.lighting, skip };
}

// A sprite exactly as the build ships it (minus overrides).
export function renderSprite(name: string): Raster {
  const entry = SPRITES[name];
  if (!entry) throw new Error(`unknown sprite '${name}'`);
  const r = entry.make();
  const light = lightOpts();
  if (light && !entry.texture && entry.lit !== false) applyLighting(r, light);
  return r;
}

// '*' wildcards: 'block-*', '*-stone'
export function matchNames(pattern: string): string[] {
  if (pattern.startsWith('tag:')) {
    const t = pattern.slice(4);
    return Object.keys(SPRITES).filter((n) => SPRITES[n].tags?.includes(t));
  }
  const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return Object.keys(SPRITES).filter((n) => re.test(n));
}
