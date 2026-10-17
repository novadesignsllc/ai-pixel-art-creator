// Step 2: fixed measurements on native pixels. Each function answers one
// style question with numbers, using the same thresholds every run, so two
// references are always compared on equal terms. The agent then reads these
// numbers and the review images and answers the fixed checklist
// (REFERENCES.md). Numbers inform; the user's taste decides.

import { colorKey, fromKey, hueDelta, luma, toHex, toHSL, type RGBA } from '../../engine/color.js';
import type { Raster } from '../../engine/raster.js';
import { colorCounts, type Native } from './native.js';

const hexRGBA = (h: string): RGBA => {
  const v = parseInt(h.slice(1, 7), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
};

const N4 = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const N8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const;

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export interface ColorInfo {
  hex: string;
  count: number;
  share: number;
  l: number;
  h: number;
  s: number;
}

export interface Ramp {
  name: string; // 'neutral' or a hue family, e.g. 'hue 28'
  colors: ColorInfo[]; // darkest -> lightest
  share: number;
  lightRange: [number, number];
  avgStep: number; // mean lightness gap between neighboring shades
  hueShift: number; // degrees, darkest -> lightest (signed)
  shadowTowards: string; // which way the dark end's hue leans
  highlightTowards: string;
  shadowTemp: 'cooler' | 'warmer' | 'same'; // dark end vs the main shade: toward blue or toward orange
  highlightTemp: 'cooler' | 'warmer' | 'same';
}

export interface Measures {
  size: { w: number; h: number; contentPixels: number };
  palette: {
    colors: number; // distinct content colors
    significant: number; // colors covering >= 0.5% of content
    top: ColorInfo[];
    ramps: Ramp[];
    avgSaturation: number;
    lightness: { dark: number; mid: number; light: number; p5: number; p95: number };
  };
  outline: {
    type: 'uniform' | 'selective' | 'none' | 'n/a';
    color: string | null;
    dominantShare: number;
    edgeDarker: number; // share of silhouette pixels darker than the pixel inside them
    thickness: '1px' | '2px' | 'n/a';
    interiorLines: number; // share of outline-colored pixels inside the silhouette
  };
  lines: { share: number; topColors: string[] }; // thin dark lines anywhere
  light: {
    // the answer to use: per-object offset (sprites) or per-material-region offset
    direction: string;
    strength: number; // <0.08 weak, 0.08-0.25 clear, >0.25 strong
    method: 'regions' | 'none';
    objectVector: [number, number] | null; // sprites: each object's bright side (can reflect material layout, not light)
    regionVector: [number, number] | null; // each patch of one material: its bright side
    rampVector: [number, number]; // local: which way the next lighter shade sits
  };
  shading: {
    stepsPerRamp: number; // median shades per significant material
    ditherShare: number;
    orphanShare: number; // single pixels unlike all 8 neighbors (noise/texture)
    translucentShare: number;
  };
  detail: {
    meanRun: number; // mean same-color horizontal run
    meanCluster: number; // mean same-color region size (px)
    clustersPer100: number; // regions per 100 content px (higher = busier)
  };
  shapes: {
    objects: number;
    sizes: { w: number; h: number; px: number }[]; // largest first, up to 40
    commonDims: { dim: number; count: number }[];
  } | null;
  tile: { periodX: { p: number; score: number }[]; periodY: { p: number; score: number }[]; guess: number | null };
}

function info(k: number, count: number, total: number): ColorInfo {
  const c = fromKey(k);
  const hsl = toHSL(c);
  return { hex: toHex(c), count, share: r3(count / total), l: r2(luma(c)), h: Math.round(hsl.h), s: r2(hsl.s) };
}

const HUE_NAMES: [number, string][] = [
  [15, 'red'], [45, 'orange'], [70, 'yellow'], [160, 'green'], [200, 'cyan'],
  [260, 'blue'], [300, 'purple'], [345, 'magenta'], [360, 'red'],
];
export function hueName(h: number): string {
  for (const [lim, name] of HUE_NAMES) if (h < lim) return name;
  return 'red';
}

// Did the hue move toward blue (cooler) or toward orange (warmer)?
function temp(from: ColorInfo, to: ColorInfo, neutral: boolean): 'cooler' | 'warmer' | 'same' {
  if (neutral || to === from || to.s < 0.06 || from.s < 0.06) return 'same';
  const d = Math.abs(hueDelta(to.h, 230)) - Math.abs(hueDelta(from.h, 230));
  if (d <= -3) return 'cooler';
  if (d >= 3) return 'warmer';
  return 'same';
}

export function direction(vx: number, vy: number): string {
  if (Math.hypot(vx, vy) < 0.05) return 'none';
  const a = (Math.atan2(-vy, vx) * 180) / Math.PI; // 0 = right, 90 = up
  const names = ['right', 'top-right', 'top', 'top-left', 'left', 'bottom-left', 'bottom', 'bottom-right'];
  return names[(Math.round(((a + 360) % 360) / 45) % 8)];
}

// Group colors into material ramps. Two colors are the same material when
// they touch each other a lot AND look related (similar hue, or both
// near-grey). A neutral highlight/shadow joins a colored material only with
// strong contact. The outline color is excluded (it touches everything).
function buildRamps(
  counts: Map<number, number>,
  total: number,
  contacts: Map<string, number>,
  exclude: Set<number>,
): { ramps: Ramp[]; rampOf: Map<number, [number, number]> } {
  const cols = [...counts.entries()]
    .filter(([k, c]) => c / total >= 0.001 && !exclude.has(k))
    .sort((a, b) => a[0] - b[0])
    .map(([k, c]) => {
      const rgb = fromKey(k);
      return { k, info: info(k, c, total), neutral: (Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2])) / 255 < 0.08 };
    });
  const at = new Map(cols.map((c, i) => [c.k, i]));
  // each color's border length: all its contacts with other colors (the
  // outline included). A shade of a material spends much of its border
  // touching that material; a separate material that merely sits next to
  // it (pants under a shirt) doesn't.
  const border = new Map<number, number>();
  for (const [pair, n] of contacts) {
    for (const k of pair.split(':').map(Number)) border.set(k, (border.get(k) ?? 0) + n);
  }
  const parent = cols.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [pair, n] of contacts) {
    const [ka, kb] = pair.split(':').map(Number);
    const ia = at.get(ka);
    const ib = at.get(kb);
    if (ia === undefined || ib === undefined) continue;
    const a = cols[ia];
    const b = cols[ib];
    const small = a.info.count <= b.info.count ? a : b;
    const touch = n / Math.max(1, border.get(small.k) ?? 0); // share of the smaller color's border
    let join = false;
    if (!a.neutral && !b.neutral) join = Math.abs(hueDelta(a.info.h, b.info.h)) <= 40 && touch >= 0.2;
    else if (a.neutral && b.neutral) join = touch >= 0.2;
    else join = touch >= 0.4; // a grey/white/black shade joins a colored material only if mostly inside it
    if (join && n >= 2) parent[find(ia)] = find(ib);
  }
  const groups = new Map<number, typeof cols>();
  cols.forEach((c, i) => {
    const g = find(i);
    groups.set(g, [...(groups.get(g) ?? []), c]);
  });
  const rampOf = new Map<number, [number, number]>();
  const ramps: Ramp[] = [...groups.values()].map((g, gi) => {
    const sorted = [...g].sort((a, b) => a.info.l - b.info.l || a.k - b.k);
    sorted.forEach((c, si) => rampOf.set(c.k, [gi, si]));
    const chromatic = g.filter((c) => !c.neutral);
    const share = g.reduce((acc, c) => acc + c.info.count, 0) / total;
    const isNeutral = chromatic.length === 0;
    // count-weighted circular mean hue of the colored members
    let hx = 0;
    let hy = 0;
    for (const c of chromatic) {
      hx += Math.cos((c.info.h * Math.PI) / 180) * c.info.count;
      hy += Math.sin((c.info.h * Math.PI) / 180) * c.info.count;
    }
    const meanHue = Math.round(((Math.atan2(hy, hx) * 180) / Math.PI + 360) % 360);
    const dark = sorted[0].info;
    const light = sorted[sorted.length - 1].info;
    const mid = [...g].sort((a, b) => b.info.count - a.info.count)[0].info; // the most used shade
    const steps = sorted.map((c) => c.info.l);
    const gaps = steps.slice(1).map((l, i) => l - steps[i]);
    const lean = (from: ColorInfo, to: ColorInfo) =>
      isNeutral || to === from || to.s < 0.06 || Math.abs(hueDelta(from.h, to.h)) < 4
        ? 'none'
        : `${hueName(to.h)} (${hueDelta(from.h, to.h) > 0 ? '+' : ''}${Math.round(hueDelta(from.h, to.h))}°)`;
    return {
      name: isNeutral ? 'neutral' : `${hueName(meanHue)} ~${meanHue}°`,
      colors: sorted.map((c) => c.info),
      share: r3(share),
      lightRange: [dark.l, light.l],
      avgStep: r3(gaps.length ? gaps.reduce((acc, v) => acc + v, 0) / gaps.length : 0),
      hueShift: isNeutral ? 0 : Math.round(hueDelta(dark.h, light.h)),
      shadowTowards: lean(mid, dark),
      highlightTowards: lean(mid, light),
      shadowTemp: temp(mid, dark, isNeutral),
      highlightTemp: temp(mid, light, isNeutral),
    };
  });
  ramps.sort((a, b) => b.share - a.share);
  return { ramps, rampOf };
}

// Per-pixel flags for the review map (out/analysis/<id>/map.png).
export interface MeasureMaps {
  edge: Uint8Array; // silhouette edge
  line: Uint8Array; // thin dark line
  dither: Uint8Array; // checkerboard dither
}

export function measure(n: Native, maps?: MeasureMaps): Measures {
  const { img, mask } = n;
  const W = img.w;
  const H = img.h;
  const idx = (x: number, y: number) => y * W + x;
  const content = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && mask[idx(x, y)] === 1;
  const key = (x: number, y: number) => colorKey(img.get(x, y));
  const L = new Float32Array(W * H);
  let total = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      L[idx(x, y)] = luma(img.get(x, y));
      if (content(x, y)) total++;
    }
  }
  const counts = colorCounts(img, mask);
  const sortedCounts = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);

  // lightness distribution (content only)
  const ls: number[] = [];
  let satSum = 0;
  for (const [k, c] of counts) {
    const col = fromKey(k);
    satSum += toHSL(col).s * c;
  }
  for (let i = 0; i < W * H; i++) if (mask[i]) ls.push(L[i]);
  ls.sort((a, b) => a - b);
  const pct = (p: number) => ls[Math.min(ls.length - 1, Math.floor(ls.length * p))] ?? 0;

  // --- silhouette edge + outline (sprites mode) ---
  let outline: Measures['outline'] = { type: 'n/a', color: null, dominantShare: 0, edgeDarker: 0, thickness: 'n/a', interiorLines: 0 };
  const isEdge = new Uint8Array(W * H);
  if (n.mode === 'sprites') {
    const edgeColors = new Map<number, number>();
    let edges = 0;
    let darker = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!content(x, y)) continue;
        let open: readonly [number, number] | null = null;
        for (const d of N4) if (!content(x + d[0], y + d[1])) open = d;
        if (!open) continue;
        isEdge[idx(x, y)] = 1;
        if (maps) maps.edge[idx(x, y)] = 1;
        edges++;
        const k = key(x, y);
        edgeColors.set(k, (edgeColors.get(k) ?? 0) + 1);
        const ix = x - open[0];
        const iy = y - open[1];
        if (content(ix, iy) && L[idx(ix, iy)] - L[idx(x, y)] > 0.08) darker++;
      }
    }
    const [domKey, domCount] = [...edgeColors.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? [0, 0];
    const domShare = edges ? domCount / edges : 0;
    const edgeDarker = edges ? darker / edges : 0;
    const domL = luma(fromKey(domKey));
    let type: Measures['outline']['type'] = 'none';
    if (domShare >= 0.55 && domL < 0.3) type = 'uniform';
    else if (edgeDarker >= 0.6) type = 'selective';
    let thick = 0;
    let thickN = 0;
    let interior = 0;
    let outlineColored = 0;
    if (type === 'uniform') {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!content(x, y) || key(x, y) !== domKey) continue;
          outlineColored++;
          if (!isEdge[idx(x, y)]) interior++;
          else {
            for (const d of N4) {
              if (!content(x + d[0], y + d[1])) {
                const ix = x - d[0];
                const iy = y - d[1];
                if (content(ix, iy)) {
                  thickN++;
                  if (key(ix, iy) === domKey) thick++;
                }
                break;
              }
            }
          }
        }
      }
    }
    outline = {
      type,
      color: type === 'uniform' ? toHex(fromKey(domKey)) : null,
      dominantShare: r2(domShare),
      edgeDarker: r2(edgeDarker),
      thickness: type === 'uniform' ? (thickN && thick / thickN >= 0.5 ? '2px' : '1px') : 'n/a',
      interiorLines: outlineColored ? r2(interior / outlineColored) : 0,
    };
  }

  // --- material ramps (needs the outline color, to leave it out) ---
  const contacts = new Map<string, number>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!content(x, y)) continue;
      const a = key(x, y);
      for (const [qx, qy] of [[x + 1, y], [x, y + 1]]) {
        if (!content(qx, qy)) continue;
        const b = key(qx, qy);
        if (a === b) continue;
        const pair = a < b ? `${a}:${b}` : `${b}:${a}`;
        contacts.set(pair, (contacts.get(pair) ?? 0) + 1);
      }
    }
  }
  const outlineKey = outline.type === 'uniform' && outline.color ? colorKey(hexRGBA(outline.color)) : null;
  const { ramps, rampOf } = buildRamps(counts, Math.max(1, total), contacts, new Set(outlineKey === null ? [] : [outlineKey]));

  // --- thin dark lines anywhere (linework inside scenes and sprites) ---
  const lineColors = new Map<number, number>();
  let lineCount = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!content(x, y)) continue;
      const l = L[idx(x, y)];
      const hLine = content(x - 1, y) && content(x + 1, y) && l + 0.1 < Math.min(L[idx(x - 1, y)], L[idx(x + 1, y)]);
      const vLine = content(x, y - 1) && content(x, y + 1) && l + 0.1 < Math.min(L[idx(x, y - 1)], L[idx(x, y + 1)]);
      if (hLine || vLine) {
        lineCount++;
        if (maps) maps.line[idx(x, y)] = 1;
        const k = key(x, y);
        lineColors.set(k, (lineColors.get(k) ?? 0) + 1);
      }
    }
  }

  // --- light: within each material, which way do lighter shades sit? ---
  let vx = 0;
  let vy = 0;
  let vn = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!content(x, y)) continue;
      const a = rampOf.get(key(x, y));
      if (!a) continue;
      for (const d of N8) {
        const qx = x + d[0];
        const qy = y + d[1];
        if (!content(qx, qy)) continue;
        const b = rampOf.get(key(qx, qy));
        if (!b || b[0] !== a[0] || b[1] <= a[1]) continue;
        const len = Math.hypot(d[0], d[1]);
        vx += d[0] / len;
        vy += d[1] / len;
        vn++;
      }
    }
  }
  const rv: [number, number] = vn ? [r2(vx / vn), r2(vy / vn)] : [0, 0];

  // sprites mode: each object's brightness-weighted center vs its plain center
  let centroid: [number, number] | null = null;
  const comps = n.mode === 'sprites' ? components(W, H, (x, y) => content(x, y)) : [];
  if (n.mode === 'sprites') {
    let cx = 0;
    let cy = 0;
    let wsum = 0;
    for (const comp of comps) {
      const body = comp.pixels.filter((i) => !isEdge[i]);
      if (body.length < 24) continue;
      let gx = 0;
      let gy = 0;
      let lx = 0;
      let ly = 0;
      let lw = 0;
      for (const i of body) {
        const x = i % W;
        const y = Math.floor(i / W);
        gx += x;
        gy += y;
        lx += x * L[i];
        ly += y * L[i];
        lw += L[i];
      }
      if (lw === 0) continue;
      const radius = Math.sqrt(body.length) / 2;
      cx += ((lx / lw - gx / body.length) / radius) * body.length;
      cy += ((ly / lw - gy / body.length) / radius) * body.length;
      wsum += body.length;
    }
    if (wsum) centroid = [r2((cx / wsum) * 4), r2((cy / wsum) * 4)];
  }

  // every patch of one material (4-connected pixels of the same ramp): where
  // do its lighter shades sit relative to the patch's center?
  let region: [number, number] | null = null;
  {
    const rampId = (x: number, y: number) => rampOf.get(key(x, y))?.[0] ?? -1;
    const patches = components(W, H, (x, y) => content(x, y) && !isEdge[idx(x, y)] && rampId(x, y) >= 0, (ax, ay, bx, by) => rampId(ax, ay) === rampId(bx, by), true);
    let rx = 0;
    let ry = 0;
    let rw = 0;
    for (const p of patches) {
      if (p.pixels.length < 12) continue;
      const steps = p.pixels.map((i) => rampOf.get(key(i % W, Math.floor(i / W)))![1]);
      const lo = Math.min(...steps);
      const hi = Math.max(...steps);
      if (hi === lo) continue; // one flat shade: says nothing about light
      let gx = 0;
      let gy = 0;
      let bx = 0;
      let by = 0;
      let bw = 0;
      p.pixels.forEach((i, j) => {
        const x = i % W;
        const y = Math.floor(i / W);
        const t = (steps[j] - lo) / (hi - lo);
        gx += x;
        gy += y;
        bx += x * t;
        by += y * t;
        bw += t;
      });
      if (bw === 0) continue;
      const radius = Math.sqrt(p.pixels.length) / 2;
      rx += ((bx / bw - gx / p.pixels.length) / radius) * p.pixels.length;
      ry += ((by / bw - gy / p.pixels.length) / radius) * p.pixels.length;
      rw += p.pixels.length;
    }
    if (rw) region = [r2(rx / rw), r2(ry / rw)];
  }

  // --- shading texture: dithering, orphans ---
  let dither = 0;
  let orphan = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!content(x, y)) continue;
      const p = key(x, y);
      const o = N4.map((d) => key(x + d[0], y + d[1]));
      const dg = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map((d) => key(x + d[0], y + d[1]));
      if (o.every((k) => k === o[0]) && o[0] !== p && dg.every((k) => k === p)) {
        dither++;
        if (maps) maps.dither[idx(x, y)] = 1;
      }
      if (N8.every((d) => key(x + d[0], y + d[1]) !== p)) orphan++;
    }
  }

  // --- detail: runs and same-color regions ---
  let runSum = 0;
  let runN = 0;
  for (let y = 0; y < H; y++) {
    let len = 0;
    let prev = -1;
    for (let x = 0; x <= W; x++) {
      const k = x < W && content(x, y) ? key(x, y) : -1;
      if (k !== prev || k === -1) {
        if (prev !== -1 && len > 0) {
          runSum += len;
          runN++;
        }
        len = k === -1 ? 0 : 1;
      } else len++;
      prev = k;
    }
  }
  const regions = components(W, H, (x, y) => content(x, y), (ax, ay, bx, by) => key(ax, ay) === key(bx, by), true);

  // --- shapes (sprites mode) ---
  let shapes: Measures['shapes'] = null;
  if (n.mode === 'sprites') {
    const objs = comps.filter((c) => c.pixels.length >= 4).sort((a, b) => b.pixels.length - a.pixels.length);
    const dims = new Map<number, number>();
    for (const o of objs) {
      for (const d of [o.w, o.h]) dims.set(d, (dims.get(d) ?? 0) + 1);
    }
    shapes = {
      objects: objs.length,
      sizes: objs.slice(0, 40).map((o) => ({ w: o.w, h: o.h, px: o.pixels.length })),
      commonDims: [...dims.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 6).map(([dim, count]) => ({ dim, count })),
    };
  }

  // --- repeating tile period (how big are the tiles?) ---
  const period = (axis: 'x' | 'y') => {
    const out: { p: number; score: number }[] = [];
    const len = axis === 'x' ? W : H;
    for (let p = 4; p <= Math.min(64, Math.floor(len / 3)); p++) {
      let same = 0;
      let all = 0;
      for (let y = 0; y < H - (axis === 'y' ? p : 0); y += axis === 'x' ? 1 : 1) {
        for (let x = 0; x < W - (axis === 'x' ? p : 0); x++) {
          const qx = axis === 'x' ? x + p : x;
          const qy = axis === 'y' ? y + p : y;
          if (!content(x, y) || !content(qx, qy)) continue;
          all++;
          if (key(x, y) === key(qx, qy)) same++;
        }
      }
      if (all > 200) out.push({ p, score: r2(same / all) });
    }
    return out;
  };
  const px = period('x');
  const py = period('y');
  const peak = (list: { p: number; score: number }[]) => {
    if (!list.length) return null;
    const scores = list.map((e) => e.score).sort((a, b) => a - b);
    const median = scores[Math.floor(scores.length / 2)];
    // smallest period that clearly stands out from the rest
    for (const e of list) if (e.score >= 0.5 && e.score >= median + 0.15) return e.p;
    return null;
  };
  const gx = peak(px);
  const gy = peak(py);
  const top3 = (list: { p: number; score: number }[]) => [...list].sort((a, b) => b.score - a.score || a.p - b.p).slice(0, 3);

  const rampSteps = ramps.filter((r) => r.share >= 0.02).map((r) => r.colors.length).sort((a, b) => a - b);

  return {
    size: { w: W, h: H, contentPixels: total },
    palette: {
      colors: counts.size,
      significant: sortedCounts.filter(([, c]) => c / Math.max(1, total) >= 0.005).length,
      top: sortedCounts.slice(0, 24).map(([k, c]) => info(k, c, Math.max(1, total))),
      ramps,
      avgSaturation: r2(total ? satSum / total : 0),
      lightness: {
        dark: r2(ls.filter((l) => l < 0.33).length / Math.max(1, ls.length)),
        mid: r2(ls.filter((l) => l >= 0.33 && l <= 0.66).length / Math.max(1, ls.length)),
        light: r2(ls.filter((l) => l > 0.66).length / Math.max(1, ls.length)),
        p5: r2(pct(0.05)),
        p95: r2(pct(0.95)),
      },
    },
    outline,
    lines: {
      share: r3(total ? lineCount / total : 0),
      topColors: [...lineColors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => toHex(fromKey(k))),
    },
    light: (() => {
      // only shading INSIDE one material says where light comes from; a whole
      // object's bright side can just be where its light-colored parts sit
      const primary = region;
      const method = region ? 'regions' : 'none';
      const strength = primary ? r2(Math.hypot(primary[0], primary[1])) : 0;
      return {
        direction: primary && strength >= 0.04 ? direction(primary[0], primary[1]) : 'none',
        strength,
        method,
        objectVector: centroid,
        regionVector: region,
        rampVector: rv,
      } as Measures['light'];
    })(),
    shading: {
      stepsPerRamp: rampSteps.length ? rampSteps[Math.floor(rampSteps.length / 2)] : 0,
      ditherShare: r3(total ? dither / total : 0),
      orphanShare: r3(total ? orphan / total : 0),
      translucentShare: r3(n.translucent),
    },
    detail: {
      meanRun: r2(runN ? runSum / runN : 0),
      meanCluster: r2(regions.length ? total / regions.length : 0),
      clustersPer100: r2(total ? (regions.length / total) * 100 : 0),
    },
    shapes,
    tile: { periodX: top3(px), periodY: top3(py), guess: gx && gy ? (gx === gy ? gx : Math.min(gx, gy)) : (gx ?? gy) },
  };
}

export interface Component {
  pixels: number[];
  x0: number;
  y0: number;
  w: number;
  h: number;
}

// connected regions (8-way, or 4-way when `four`); `same` decides whether two
// neighboring included pixels belong together (default: any)
export function components(
  W: number,
  H: number,
  include: (x: number, y: number) => boolean,
  same?: (ax: number, ay: number, bx: number, by: number) => boolean,
  four = false,
): Component[] {
  const seen = new Uint8Array(W * H);
  const out: Component[] = [];
  const dirs = four ? N4 : N8;
  for (let start = 0; start < W * H; start++) {
    if (seen[start]) continue;
    const sx = start % W;
    const sy = Math.floor(start / W);
    if (!include(sx, sy)) continue;
    const pixels: number[] = [];
    const stack = [start];
    seen[start] = 1;
    let x0 = sx;
    let x1 = sx;
    let y0 = sy;
    let y1 = sy;
    while (stack.length) {
      const i = stack.pop()!;
      pixels.push(i);
      const x = i % W;
      const y = Math.floor(i / W);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const d of dirs) {
        const qx = x + d[0];
        const qy = y + d[1];
        if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
        const q = qy * W + qx;
        if (seen[q] || !include(qx, qy)) continue;
        if (same && !same(x, y, qx, qy)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    out.push({ pixels, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  return out;
}

export function rgbaOf(r: Raster, i: number): RGBA {
  return [r.data[i * 4], r.data[i * 4 + 1], r.data[i * 4 + 2], r.data[i * 4 + 3]];
}
