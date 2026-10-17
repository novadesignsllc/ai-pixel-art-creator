import type { RGBA } from './color.js';
import { Raster, type Legend } from './raster.js';

// Frame-by-frame animation, the letter-grid way (see ANIMATION.md).
//
// A character (or mob, or effect) is split into PARTS: letter grids keyed by
// ABSOLUTE frame row, with column 0 of each string sitting at x = part.x0.
// An animation draws the parts into each frame with small per-frame offsets
// (a bob table, a sway table) and swaps in redrawn parts only where the shape
// really changes (legs mid-step, an arm mid-swing). Motion numbers come from
// the reference animation, measured by the analyzer.

export interface Part {
  x0: number; // frame x of string index 0
  rows: Record<number, string>; // frame y -> one letter per pixel ('.' = leave as is)
}

export function part(x0: number, rows: Record<number, string>): Part {
  const widths = new Set(Object.values(rows).map((r) => r.length));
  if (widths.size > 1) throw new Error(`part at x0=${x0}: rows have different lengths (${[...widths].join(', ')})`);
  return { x0, rows };
}

// the same part moved (positive dy = down)
export function shiftPart(p: Part, dx: number, dy: number): Part {
  const rows: Record<number, string> = {};
  for (const [y, row] of Object.entries(p.rows)) rows[Number(y) + dy] = row;
  return { x0: p.x0 + dx, rows };
}

// the same part with some rows replaced (derive a pose instead of redrawing)
export function patch(p: Part, rows: Record<number, string>): Part {
  return part(p.x0, { ...p.rows, ...rows });
}

export class Sheet {
  readonly frameW: number;
  readonly frameH: number;
  readonly frames: number;
  readonly raster: Raster;
  // every legend color drawn, for the off-palette check
  readonly used = new Set<string>();

  constructor(frameW: number, frameH: number, frames: number) {
    this.frameW = frameW;
    this.frameH = frameH;
    this.frames = frames;
    this.raster = new Raster(frameW * frames, frameH);
  }

  // paint a part into one frame, offset by (dx, dy); '.' and ' ' leave pixels
  draw(frame: number, legend: Legend, p: Part | Part[], dx = 0, dy = 0): void {
    for (const one of Array.isArray(p) ? p : [p]) {
      for (const [ys, row] of Object.entries(one.rows)) {
        const y = Number(ys) + dy;
        for (let j = 0; j < row.length; j++) {
          const ch = row[j];
          if (ch === '.' || ch === ' ') continue;
          const c = legend[ch];
          if (!c) throw new Error(`Sheet.draw: no legend entry for '${ch}' (frame ${frame}, row ${ys})`);
          this.set(frame, one.x0 + j + dx, y, c);
        }
      }
    }
  }

  // a single pixel inside a frame ('x' / 'y' are frame coordinates)
  set(frame: number, x: number, y: number, c: RGBA): void {
    if (x < 0 || y < 0 || x >= this.frameW || y >= this.frameH) return;
    this.raster.set(frame * this.frameW + x, y, c);
    this.used.add(c.join(','));
  }

  erase(frame: number, x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.frameW || y >= this.frameH) return;
    this.raster.unset(frame * this.frameW + x, y);
  }

  // stamp a whole Raster into a frame (e.g. a procedurally drawn effect)
  put(frame: number, r: Raster, dx = 0, dy = 0): void {
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) if (r.filled(x, y)) this.set(frame, dx + x, dy + y, r.get(x, y));
    }
  }

  // copy one frame onto another (holds, or a start pose to edit)
  copyFrame(from: number, to: number): void {
    for (let y = 0; y < this.frameH; y++) {
      for (let x = 0; x < this.frameW; x++) {
        const c = this.raster.get(from * this.frameW + x, y);
        this.raster.set(to * this.frameW + x, y, c);
      }
    }
  }

  frame(i: number): Raster {
    return this.raster.crop(i * this.frameW, 0, this.frameW, this.frameH);
  }
}

export interface AnimDef {
  name: string; // file + manifest key, e.g. 'hero-walk'
  frameW: number;
  frameH: number;
  fps: number;
  durations?: number[]; // optional per-frame ms (holds); overrides fps timing
  loop: boolean;
  // the feet / pivot inside a frame, as fractions (0.5, 1 = bottom-center)
  anchorX: number;
  anchorY: number;
  build: () => Sheet; // the base facing
  baseFacing?: string; // what the base sheet faces, e.g. 'e' or 'right' (manifest only)
  facings?: Record<string, () => Sheet>; // extra drawn facings, same frame count
  mirror?: Record<string, string>; // facings the app makes by mirroring, e.g. { w: 'e' }
  lit?: boolean; // false = skip the lighting pass
  tags?: string[];
  // the reference this animation follows: a refs.json id (+ which frames)
  reference?: { ref: string; frames?: number[]; facing?: string };
}

export function defineAnims(...anims: AnimDef[]): AnimDef[] {
  const seen = new Set<string>();
  for (const a of anims) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(a.name)) throw new Error(`anim name '${a.name}': lowercase, digits, '-', '_' only`);
    if (seen.has(a.name)) throw new Error(`anim '${a.name}' is defined twice`);
    seen.add(a.name);
    if (a.durations) {
      const n = a.build().frames;
      if (a.durations.length !== n) throw new Error(`anim '${a.name}': ${a.durations.length} durations for ${n} frames`);
    }
  }
  return anims;
}
