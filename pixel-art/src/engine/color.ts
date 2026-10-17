// Colors: RGBA tuples, hex in/out, perceptual helpers, and a ramp builder.
// The engine never decides what colors a project uses. That lives in
// src/art/palette.ts, built from the rules in STYLE.md.

export type RGBA = [number, number, number, number];

export function hex(h: string, a = 255): RGBA {
  const s = h.replace('#', '');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) throw new Error(`hex: bad color '${h}'`);
  const v = parseInt(s.slice(0, 6), 16);
  const alpha = s.length === 8 ? parseInt(s.slice(6, 8), 16) : a;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, alpha];
}

export function toHex(c: RGBA, withAlpha = false): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}${withAlpha && c[3] !== 255 ? h(c[3]) : ''}`;
}

export function sameColor(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

export function colorKey(c: RGBA): number {
  // packed 32-bit key (unsigned) for maps and sets
  return ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3]) >>> 0;
}

export function fromKey(k: number): RGBA {
  return [(k >>> 24) & 255, (k >>> 16) & 255, (k >>> 8) & 255, k & 255];
}

const clamp8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

// Perceived lightness 0..1 (Rec. 709 luma on sRGB values; good enough for
// comparing pixel-art shades, and stable, which matters more).
export function luma(c: RGBA): number {
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
}

export interface HSL {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

export function toHSL(c: RGBA): HSL {
  const r = c[0] / 255;
  const g = c[1] / 255;
  const b = c[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function fromHSL({ h, s, l }: HSL, a = 255): RGBA {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [clamp8(l * 255), clamp8(l * 255), clamp8(l * 255), a];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [clamp8(f(hue + 1 / 3) * 255), clamp8(f(hue) * 255), clamp8(f(hue - 1 / 3) * 255), a];
}

// Signed shortest hue distance a -> b in degrees (-180..180).
export function hueDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

export function colorDistance(a: RGBA, b: RGBA): number {
  // weighted RGB distance ("redmean"), 0..~765; cheap and monotonic enough
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    clamp8(a[0] + (b[0] - a[0]) * t),
    clamp8(a[1] + (b[1] - a[1]) * t),
    clamp8(a[2] + (b[2] - a[2]) * t),
    clamp8(a[3] + (b[3] - a[3]) * t),
  ];
}

// ---------------------------------------------------------------------------
// Ramp builder. A ramp is one material's shades, darkest first. Building
// every ramp with the same rule (the numbers come from STYLE.md) is what
// keeps 1,000 generated materials looking like one game.
// ---------------------------------------------------------------------------
export interface RampRule {
  steps: number; // shades per material, e.g. 3 (dark/base/light) or 5
  lightSpan: number; // total lightness range across the ramp, e.g. 0.36
  // hue drift toward these hues (degrees) at the dark/light ends; null = none
  shadowHue: number | null; // e.g. 250 (blue-violet shadows)
  highlightHue: number | null; // e.g. 55 (warm highlights)
  hueShift: number; // max degrees of drift at each end, e.g. 12
  shadowSat: number; // saturation multiplier at the dark end, e.g. 1.1
  highlightSat: number; // saturation multiplier at the light end, e.g. 0.85
}

// Ramp around a base color: the base sits in the middle step (rounded down
// for even step counts). Returns darkest -> lightest.
export function ramp(base: RGBA | string, rule: RampRule): RGBA[] {
  const b = typeof base === 'string' ? hex(base) : base;
  const hsl = toHSL(b);
  const mid = Math.floor((rule.steps - 1) / 2);
  const out: RGBA[] = [];
  for (let i = 0; i < rule.steps; i++) {
    const t = rule.steps === 1 ? 0 : (i - mid) / (rule.steps - 1); // <0 dark, >0 light
    const l = Math.max(0.02, Math.min(0.98, hsl.l + t * rule.lightSpan));
    let h = hsl.h;
    const toward = t < 0 ? rule.shadowHue : rule.highlightHue;
    if (toward !== null && t !== 0 && hsl.s > 0.04) {
      const d = hueDelta(h, toward);
      const amt = Math.min(Math.abs(d), rule.hueShift * Math.abs(t) * 2);
      h += Math.sign(d) * amt;
    }
    const satMul = t < 0 ? 1 + (rule.shadowSat - 1) * Math.abs(t) * 2 : 1 + (rule.highlightSat - 1) * t * 2;
    const s = Math.max(0, Math.min(1, hsl.s * satMul));
    out.push(i === mid ? b : fromHSL({ h, s, l }, b[3]));
  }
  return out;
}
