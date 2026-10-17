// Review boards: checkerboards, labeled contact sheets, side-by-side compares.
// These are for LOOKING at art (previews in out/), never shipped.

import { hex, type RGBA } from './color.js';
import { Raster } from './raster.js';

// A tiny 3x5 pixel font for labels on review sheets. Lowercase is drawn as
// uppercase; unknown characters render as '?'.
const GLYPHS: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010',
  '8': '111101111101111', '9': '111101111001110',
  '-': '000000111000000', _: '000000000000111', '.': '000000000000010', ':': '000010000010000',
  '/': '001001010100100', '#': '101111101111101', '+': '000010111010000', '(': '010100100100010',
  ')': '010001001001010', '%': '101001010100101', '@': '010101111100011', '=': '000111000111000',
  '?': '110001010000010', ' ': '000000000000000', ',': '000000000010100', "'": '010010000000000',
  '>': '100010001010100', '~': '000110011000000', '°': '010101010000000', '!': '010010010000010',
  '[': '110100100100110', ']': '011001001001011', '&': '010101010101011', '|': '010010010010010', '<': '001010100010001', '*': '000101010101000',
};

export const TEXT_H = 5;

export function textWidth(s: string): number {
  return s.length === 0 ? 0 : s.length * 4 - 1;
}

export function drawText(r: Raster, x: number, y: number, s: string, c: RGBA): void {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS['?'];
    for (let i = 0; i < 15; i++) if (g[i] === '1') r.set(cx + (i % 3), y + Math.floor(i / 3), c);
    cx += 4;
  }
}

// text drawn at a whole-number scale (labels on zoomed boards)
export function label(s: string, scale: number, c: RGBA = hex('#e6e6f0')): Raster {
  const r = new Raster(Math.max(1, textWidth(s)), TEXT_H);
  drawText(r, 0, 0, s, c);
  return r.scaled(scale);
}

export const BOARD_DARK = hex('#2e2e38');
export const BOARD_LIGHT = hex('#3a3a46');

export function checker(w: number, h: number, a: RGBA = BOARD_LIGHT, b: RGBA = BOARD_DARK, cell = 8): Raster {
  const r = new Raster(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) r.set(x, y, (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? a : b);
  }
  return r;
}

export function solid(w: number, h: number, c: RGBA): Raster {
  const r = new Raster(w, h);
  r.rect(0, 0, w, h, c);
  return r;
}

// Stack rasters vertically (or horizontally) on a checkerboard with padding.
export function stack(parts: Raster[], dir: 'down' | 'right' = 'down', pad = 8, bg?: RGBA): Raster {
  if (parts.length === 0) return checker(pad * 2, pad * 2);
  const along = dir === 'down';
  const w = along ? Math.max(...parts.map((p) => p.w)) + pad * 2 : parts.reduce((a, p) => a + p.w + pad, pad);
  const h = along ? parts.reduce((a, p) => a + p.h + pad, pad) : Math.max(...parts.map((p) => p.h)) + pad * 2;
  const out = bg ? solid(w, h, bg) : checker(w, h);
  let at = pad;
  for (const p of parts) {
    if (along) out.blit(p, pad, at);
    else out.blit(p, at, pad);
    at += (along ? p.h : p.w) + pad;
  }
  return out;
}

// A labeled grid of sprites: each cell = the sprite at `zoom` over its name.
// The workhorse for reviewing a whole family at once.
export function contactSheet(
  items: { name: string; raster: Raster }[],
  opts: { zoom?: number; cols?: number; labelScale?: number; bg?: RGBA } = {},
): Raster {
  const zoom = opts.zoom ?? 4;
  const ls = opts.labelScale ?? 1;
  const pad = 6 + 4 * ls;
  const cellW = Math.max(
    ...items.map((i) => Math.max(i.raster.w * zoom, textWidth(i.name) * ls)),
    16,
  );
  const cellH = Math.max(...items.map((i) => i.raster.h * zoom), 16) + TEXT_H * ls + 4;
  const cols = opts.cols ?? Math.max(1, Math.min(items.length, Math.floor(1600 / (cellW + pad))));
  const rows = Math.ceil(items.length / cols);
  const out = checker(cols * (cellW + pad) + pad, rows * (cellH + pad) + pad, opts.bg ?? BOARD_LIGHT, opts.bg ?? BOARD_DARK);
  items.forEach((it, i) => {
    const cx = pad + (i % cols) * (cellW + pad);
    const cy = pad + Math.floor(i / cols) * (cellH + pad);
    const z = it.raster.scaled(zoom);
    out.blit(z, cx + Math.floor((cellW - z.w) / 2), cy + (cellH - TEXT_H * ls - 4 - z.h));
    out.blit(label(it.name, ls), cx, cy + cellH - TEXT_H * ls);
  });
  return out;
}

// repeat a tile n x n (seam check for textures)
export function tiled(t: Raster, n = 3): Raster {
  const out = new Raster(t.w * n, t.h * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.blit(t, x * t.w, y * t.h);
  return out;
}
