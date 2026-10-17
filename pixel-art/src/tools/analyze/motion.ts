// Animation measurements: slice a reference (sheet or animated GIF) into
// frames, then measure how the body moves frame to frame. The same code
// measures YOUR animation (npm run anim), so the two tables can be compared
// number for number.

import { colorKey, fromKey, toHex } from '../../engine/color.js';
import { Raster } from '../../engine/raster.js';
import { nativize, type Native } from './native.js';

export interface Frames {
  frames: Raster[];
  masks: Uint8Array[];
  frameW: number;
  frameH: number;
  delays: number[] | null; // ms per frame, when known
  notes: string[];
}

export interface SliceSpec {
  frame?: [number, number]; // frame size in the FILE's pixels (as seen in an image viewer)
  frames?: number; // how many frames to take
  row?: number; // which row of a multi-row sheet (0 = top)
  fps?: number;
}

function cropMask(mask: Uint8Array, W: number, x: number, y: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) out[yy * w + xx] = mask[(y + yy) * W + (x + xx)] ?? 0;
  return out;
}

// pages = frames of an animated file (GIF/WEBP); otherwise slice a sheet
export function sliceFrames(pages: Raster[], delays: number[] | null, spec: SliceSpec, base: Native): Frames {
  const notes: string[] = [];
  if (pages.length > 1) {
    const frames: Raster[] = [];
    const masks: Uint8Array[] = [];
    const bg = base.background === 'transparent' ? 'auto' : base.background;
    pages.forEach((p, i) => {
      const n = i === 0 ? base : nativize(p, { scale: base.scale, background: bg });
      frames.push(n.img);
      masks.push(n.mask);
    });
    const take = spec.frames ? Math.min(spec.frames, frames.length) : frames.length;
    return {
      frames: frames.slice(0, take),
      masks: masks.slice(0, take),
      frameW: frames[0].w,
      frameH: frames[0].h,
      delays: delays ? delays.slice(0, take) : spec.fps ? Array(take).fill(Math.round(1000 / spec.fps)) : null,
      notes,
    };
  }
  const img = base.img;
  let fw: number;
  let fh: number;
  if (spec.frame) {
    const [w, h] = spec.frame;
    if (w % base.scale || h % base.scale) {
      notes.push(`frame ${w}x${h} isn't a multiple of the detected ${base.scale}x scale; rounding.`);
    }
    fw = Math.round(w / base.scale);
    fh = Math.round(h / base.scale);
  } else if (img.w % img.h === 0 && img.w / img.h >= 2) {
    fw = img.h;
    fh = img.h;
    notes.push(`no "frame" in refs.json: guessed square ${fw}x${fh} frames (sheet is ${img.w / img.h} frames wide).`);
  } else {
    // split at empty columns; positions are approximate
    const cols: boolean[] = [];
    for (let x = 0; x < img.w; x++) {
      let any = false;
      for (let y = 0; y < img.h && !any; y++) any = base.mask[y * img.w + x] === 1;
      cols.push(any);
    }
    const segs: [number, number][] = [];
    let s = -1;
    cols.forEach((on, x) => {
      if (on && s < 0) s = x;
      if (!on && s >= 0) {
        segs.push([s, x - 1]);
        s = -1;
      }
    });
    if (s >= 0) segs.push([s, img.w - 1]);
    if (segs.length < 2) {
      return { frames: [img], masks: [base.mask], frameW: img.w, frameH: img.h, delays: null, notes: ['one frame only: set "frame" in refs.json to slice it.'] };
    }
    const wmax = Math.max(...segs.map(([a, b]) => b - a + 1)) + 2;
    notes.push(`no "frame" in refs.json: split at empty columns into ${segs.length} frames, centered. Motion dx is approximate; set "frame" for exact numbers.`);
    const frames: Raster[] = [];
    const masks: Uint8Array[] = [];
    for (const [a, b] of segs.slice(0, spec.frames ?? segs.length)) {
      const cx = Math.floor((a + b) / 2) - Math.floor(wmax / 2);
      frames.push(img.crop(cx, 0, wmax, img.h));
      masks.push(cropMask(base.mask, img.w, cx, 0, wmax, img.h));
    }
    return { frames, masks, frameW: wmax, frameH: img.h, delays: spec.fps ? Array(frames.length).fill(Math.round(1000 / spec.fps)) : null, notes };
  }
  const per = Math.floor(img.w / fw);
  const rows = Math.floor(img.h / fh);
  const row = Math.min(spec.row ?? 0, rows - 1);
  const count = Math.min(spec.frames ?? per, per);
  const frames: Raster[] = [];
  const masks: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const f = img.crop(i * fw, row * fh, fw, fh);
    const m = cropMask(base.mask, img.w, i * fw, row * fh, fw, fh);
    // skip trailing empty frames in a padded sheet
    if (!spec.frames && !m.some((v) => v === 1)) break;
    frames.push(f);
    masks.push(m);
  }
  return { frames, masks, frameW: fw, frameH: fh, delays: spec.fps ? Array(frames.length).fill(Math.round(1000 / spec.fps)) : null, notes };
}

export interface FrameStats {
  frame: number;
  ms: number | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
  pixels: number;
  topDy: number; // top edge vs frame 0 (negative = higher)
  bottomDy: number; // lowest pixel vs frame 0 (feet leaving the ground)
  leftDx: number;
  rightDx: number;
  centerDx: number;
  centerDy: number;
  bands: { dx: number; dy: number }[]; // top / middle / bottom third of the body
  changedVsPrev: number; // pixels that differ from the previous frame
  changedVsFirst: number;
}

export interface Motion {
  frames: number;
  frameW: number;
  frameH: number;
  durationsMs: number[] | null;
  fps: number | null;
  stats: FrameStats[];
  holds: number[][]; // runs of identical frames
  loopSeam: number; // pixels changed from the last frame back to the first
  ranges: { topDy: [number, number]; bottomDy: [number, number]; width: [number, number]; height: [number, number] };
  extremes: { highest: number; lowest: number; widest: number; narrowest: number };
}

function diff(a: Raster, b: Raster): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const ao = a.data[i + 3] > 0;
    const bo = b.data[i + 3] > 0;
    if (ao !== bo) n++;
    else if (ao && (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2])) n++;
  }
  return n;
}

// a frame with only its content (background cleared), for diffs and dumps
export function contentOnly(f: Raster, m: Uint8Array): Raster {
  const out = new Raster(f.w, f.h);
  for (let i = 0; i < f.w * f.h; i++) if (m[i]) out.data.set(f.data.subarray(i * 4, i * 4 + 4), i * 4);
  return out;
}

export function measureMotion(fr: Frames): Motion {
  const W = fr.frameW;
  const H = fr.frameH;
  const clean = fr.frames.map((f, i) => contentOnly(f, fr.masks[i]));
  const basic = fr.masks.map((m) => {
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    let cx = 0;
    let cy = 0;
    let n = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!m[y * W + x]) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
        cx += x;
        cy += y;
        n++;
      }
    }
    return n ? { x0, y0, x1, y1, cx: cx / n, cy: cy / n, n } : null;
  });
  const first = Math.max(0, basic.findIndex((b) => b));
  const b0 = basic[first] ?? { x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, n: 0 };
  const bands = (i: number) => {
    const b = basic[i];
    const m = fr.masks[i];
    if (!b) return [0, 1, 2].map(() => ({ x: 0, y: 0 }));
    const h = b.y1 - b.y0 + 1;
    const out: { x: number; y: number }[] = [];
    for (let k = 0; k < 3; k++) {
      const ya = b.y0 + Math.floor((h * k) / 3);
      const yb = b.y0 + Math.floor((h * (k + 1)) / 3);
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let y = ya; y < Math.max(yb, ya + 1); y++) {
        for (let x = 0; x < W; x++) {
          if (m[y * W + x]) {
            sx += x;
            sy += y;
            n++;
          }
        }
      }
      out.push(n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 });
    }
    return out;
  };
  const band0 = bands(first);
  const round = (v: number) => Math.round(v * 10) / 10;
  const durations = fr.delays;
  const stats: FrameStats[] = fr.frames.map((_, i) => {
    const b = basic[i];
    const bd = bands(i);
    return {
      frame: i,
      ms: durations ? durations[i] : null,
      bbox: b ? { x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 } : null,
      pixels: b ? b.n : 0,
      topDy: b ? b.y0 - b0.y0 : 0,
      bottomDy: b ? b.y1 - b0.y1 : 0,
      leftDx: b ? b.x0 - b0.x0 : 0,
      rightDx: b ? b.x1 - b0.x1 : 0,
      centerDx: b ? round(b.cx - b0.cx) : 0,
      centerDy: b ? round(b.cy - b0.cy) : 0,
      bands: bd.map((p, k) => ({ dx: round(p.x - band0[k].x), dy: round(p.y - band0[k].y) })),
      changedVsPrev: i === 0 ? 0 : diff(clean[i], clean[i - 1]),
      changedVsFirst: i === 0 ? 0 : diff(clean[i], clean[0]),
    };
  });
  const holds: number[][] = [];
  let run = [0];
  for (let i = 1; i < stats.length; i++) {
    if (stats[i].changedVsPrev === 0) run.push(i);
    else {
      if (run.length > 1) holds.push(run);
      run = [i];
    }
  }
  if (run.length > 1) holds.push(run);
  const vals = (f: (s: FrameStats) => number): [number, number] => {
    const v = stats.map(f);
    return [Math.min(...v), Math.max(...v)];
  };
  const pick = (f: (s: FrameStats) => number, best: (a: number, b: number) => boolean) =>
    stats.reduce((acc, s) => (best(f(s), f(stats[acc])) ? s.frame : acc), 0);
  const avgMs = durations ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  return {
    frames: stats.length,
    frameW: W,
    frameH: H,
    durationsMs: durations,
    fps: avgMs ? Math.round((1000 / avgMs) * 10) / 10 : null,
    stats,
    holds,
    loopSeam: stats.length > 1 ? diff(clean[clean.length - 1], clean[0]) : 0,
    ranges: {
      topDy: vals((s) => s.topDy),
      bottomDy: vals((s) => s.bottomDy),
      width: vals((s) => s.bbox?.w ?? 0),
      height: vals((s) => s.bbox?.h ?? 0),
    },
    extremes: {
      highest: pick((s) => s.topDy, (a, b) => a < b),
      lowest: pick((s) => s.topDy, (a, b) => a > b),
      widest: pick((s) => s.bbox?.w ?? 0, (a, b) => a > b),
      narrowest: pick((s) => s.bbox?.w ?? 0, (a, b) => a < b),
    },
  };
}

export function motionTable(m: Motion): string {
  const lines = [
    `| frame | ms | size | top dy | bottom dy | left/right dx | center dx,dy | top third dx,dy | middle dx,dy | bottom third dx,dy | px changed vs prev |`,
    `|---|---|---|---|---|---|---|---|---|---|---|`,
  ];
  for (const s of m.stats) {
    const b = s.bands.map((p) => `${p.dx},${p.dy}`);
    lines.push(
      `| ${s.frame} | ${s.ms ?? '?'} | ${s.bbox ? `${s.bbox.w}x${s.bbox.h}` : 'empty'} | ${s.topDy} | ${s.bottomDy} | ${s.leftDx}/${s.rightDx} | ${s.centerDx},${s.centerDy} | ${b[0]} | ${b[1]} | ${b[2]} | ${s.changedVsPrev} |`,
    );
  }
  return lines.join('\n');
}

export function motionSummary(m: Motion): string[] {
  return [
    `- frames: ${m.frames} at ${m.frameW}x${m.frameH}; timing: ${m.fps ? `~${m.fps} fps` : 'unknown (set "fps" in refs.json)'}${m.durationsMs && new Set(m.durationsMs).size > 1 ? ` (per-frame ms: ${m.durationsMs.join(', ')})` : ''}`,
    `- top edge moves ${m.ranges.topDy[0]}..${m.ranges.topDy[1]} px (bob); bottom edge ${m.ranges.bottomDy[0]}..${m.ranges.bottomDy[1]} px (lift off the ground)`,
    `- width ${m.ranges.width[0]}..${m.ranges.width[1]} px, height ${m.ranges.height[0]}..${m.ranges.height[1]} px (squash/stretch, limbs reaching out)`,
    `- highest frame ${m.extremes.highest}, lowest ${m.extremes.lowest}, widest ${m.extremes.widest}, narrowest ${m.extremes.narrowest}`,
    `- holds (identical frames in a row): ${m.holds.length ? m.holds.map((h) => h.join('=')).join('; ') : 'none'}`,
    `- loop seam: ${m.loopSeam} px change from the last frame back to frame 0${m.loopSeam === 0 ? ' (last frame repeats the first: probably not meant to loop, or a hold)' : ''}`,
  ];
}

// ---------------------------------------------------------------------------
// Letter-grid dump: every frame as text, one letter per color, with rulers.
// This is how a reference pose is read pixel by pixel before redrawing it.
// ---------------------------------------------------------------------------
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+=?@!^~';

export function autoLegend(frames: Raster[]): Map<number, string> {
  const counts = new Map<number, number>();
  for (const f of frames) {
    for (let i = 0; i < f.data.length; i += 4) {
      if (f.data[i + 3] === 0) continue;
      const k = colorKey([f.data[i], f.data[i + 1], f.data[i + 2], f.data[i + 3]]);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const order = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const legend = new Map<number, string>();
  order.forEach(([k], i) => legend.set(k, LETTERS[i] ?? '?'));
  return legend;
}

export function dumpFrames(
  frames: Raster[],
  opts: { region?: [number, number, number, number]; perRow?: number; legend?: Map<number, string>; labels?: number[] } = {},
): string {
  const legend = opts.legend ?? autoLegend(frames);
  const [x0, y0, x1, y1] = opts.region ?? [0, 0, frames[0].w, frames[0].h];
  const perRow = opts.perRow ?? Math.max(1, Math.floor(160 / (x1 - x0 + 2)));
  const blocks: string[] = [];
  for (let start = 0; start < frames.length; start += perRow) {
    const group = frames.slice(start, start + perRow).map((f, gi) => {
      const rows = [`f${opts.labels?.[start + gi] ?? start + gi}`.padEnd(x1 - x0), ''.padEnd(x1 - x0, ' ').split('').map((_, j) => String(Math.floor((x0 + j) / 10) % 10)).join(''), ''.padEnd(x1 - x0, ' ').split('').map((_, j) => String((x0 + j) % 10)).join('')];
      for (let y = y0; y < y1; y++) {
        let line = '';
        for (let x = x0; x < x1; x++) {
          const c = f.get(x, y);
          line += c[3] === 0 ? '.' : (legend.get(colorKey(c)) ?? '?');
        }
        rows.push(line);
      }
      return rows;
    });
    const labels = ['   ', '   ', '   ', ...Array.from({ length: y1 - y0 }, (_, i) => String(y0 + i).padStart(3))];
    blocks.push(labels.map((l, i) => `${l} ${group.map((g) => g[i]).join('  ')}`).join('\n'));
  }
  const key = [...legend.entries()].map(([k, ch]) => `${ch}=${toHex(fromKey(k), true)}`).join('  ');
  return `legend: ${key}\n('.' = empty; rows are labeled with y, rulers show x)\n\n${blocks.join('\n\n')}\n`;
}
