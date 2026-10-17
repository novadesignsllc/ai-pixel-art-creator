import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { sameColor, type RGBA } from './color.js';

// The canvas every sprite is drawn on: a plain RGBA byte buffer plus the
// handful of operations pixel art needs. Out-of-bounds writes are ignored,
// so shapes can hang off the edge safely.
export class Raster {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }

  static fromPNG(file: string): Raster {
    const png = PNG.sync.read(readFileSync(file));
    const r = new Raster(png.width, png.height);
    r.data.set(png.data);
    return r;
  }

  clone(): Raster {
    const r = new Raster(this.w, this.h);
    r.data.set(this.data);
    return r;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  set(x: number, y: number, c: RGBA): void {
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }

  get(x: number, y: number): RGBA {
    if (!this.inside(x, y)) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  filled(x: number, y: number): boolean {
    return this.inside(x, y) && this.data[(y * this.w + x) * 4 + 3] > 0;
  }

  // erase a pixel back to transparent: carve shapes, don't only stack them
  unset(x: number, y: number): void {
    if (!this.inside(x, y)) return;
    this.data.fill(0, (y * this.w + x) * 4, (y * this.w + x) * 4 + 4);
  }

  rect(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }

  // filled ellipse; half-pixel centers give symmetric, pixel-clean blobs
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(x, y, c);
      }
    }
  }

  // 1px Bresenham line (pixel-perfect, no doubled corners)
  line(x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x, y, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  // Outline: color the transparent pixels next to filled ones.
  //   diagonal: also corners (a heavier, rounder outline)
  //   color: a fixed color, or a function of the neighboring fill color
  //   (that's how a "selout" / colored outline is made)
  outline(color: RGBA | ((neighbor: RGBA) => RGBA), opts: { diagonal?: boolean } = {}): void {
    const dirs = opts.diagonal
      ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]
      : [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const edits: [number, number, RGBA][] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.filled(x, y)) continue;
        for (const [ox, oy] of dirs) {
          if (this.filled(x + ox, y + oy)) {
            edits.push([x, y, typeof color === 'function' ? color(this.get(x + ox, y + oy)) : color]);
            break;
          }
        }
      }
    }
    for (const [x, y, c] of edits) this.set(x, y, c);
  }

  // copy src onto this raster at (dx, dy), skipping transparent pixels
  blit(src: Raster, dx: number, dy: number): void {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) if (src.filled(x, y)) this.set(dx + x, dy + y, src.get(x, y));
    }
  }

  // like blit but alpha-blends (previews and onion skins only; shipped art
  // should stay fully opaque or fully clear unless STYLE.md says otherwise)
  blend(src: Raster, dx: number, dy: number, opacity = 1): void {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const s = src.get(x, y);
        const a = (s[3] / 255) * opacity;
        if (a <= 0) continue;
        const d = this.get(dx + x, dy + y);
        const da = d[3] / 255;
        const oa = a + da * (1 - a);
        const ch = (i: number) => Math.round((s[i] * a + d[i] * da * (1 - a)) / (oa || 1));
        this.set(dx + x, dy + y, [ch(0), ch(1), ch(2), Math.round(oa * 255)]);
      }
    }
  }

  crop(x: number, y: number, w: number, h: number): Raster {
    const out = new Raster(w, h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) out.set(xx, yy, this.get(x + xx, y + yy));
    return out;
  }

  mirrorX(): Raster {
    const out = new Raster(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) out.set(this.w - 1 - x, y, this.get(x, y));
    return out;
  }

  mirrorY(): Raster {
    const out = new Raster(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) out.set(x, this.h - 1 - y, this.get(x, y));
    return out;
  }

  // nearest-neighbor scale by a whole number: the only scaling pixel art allows
  scaled(factor: number): Raster {
    if (!Number.isInteger(factor) || factor < 1) throw new Error(`scaled: factor must be a whole number, got ${factor}`);
    const out = new Raster(this.w * factor, this.h * factor);
    for (let y = 0; y < out.h; y++) {
      for (let x = 0; x < out.w; x++) out.set(x, y, this.get(Math.floor(x / factor), Math.floor(y / factor)));
    }
    return out;
  }

  // swap colors by exact match (palette swaps, material variants)
  recolor(map: [from: RGBA, to: RGBA][]): Raster {
    const out = this.clone();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.get(x, y);
        for (const [from, to] of map) {
          if (sameColor(c, from)) {
            out.set(x, y, to);
            break;
          }
        }
      }
    }
    return out;
  }

  // every distinct color in use (opaque or translucent), for palette checks
  colors(): RGBA[] {
    const seen = new Map<string, RGBA>();
    for (let i = 0; i < this.data.length; i += 4) {
      if (this.data[i + 3] === 0) continue;
      const c: RGBA = [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
      seen.set(c.join(','), c);
    }
    return [...seen.values()];
  }

  toPNG(): Buffer {
    const png = new PNG({ width: this.w, height: this.h });
    Buffer.from(this.data).copy(png.data);
    return PNG.sync.write(png);
  }
}

export type Legend = Record<string, RGBA>;

// ASCII-grid authoring: one character per pixel, '.' or ' ' = transparent.
// Throws on unknown characters and ragged rows so mistakes fail at build time.
export function fromGrid(legend: Legend, rows: string[]): Raster {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const r = new Raster(w, h);
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) throw new Error(`fromGrid: row ${y} is ${rows[y].length} chars, expected ${w}`);
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      const c = legend[ch];
      if (!c) throw new Error(`fromGrid: no legend entry for '${ch}' at (${x},${y})`);
      r.set(x, y, c);
    }
  }
  return r;
}

// stamp a grid into an existing raster at (dx, dy)
export function gridInto(r: Raster, dx: number, dy: number, legend: Legend, rows: string[]): void {
  r.blit(fromGrid(legend, rows), dx, dy);
}
