// Seeded randomness. Every "random" choice in a sprite must come from here,
// seeded by the sprite's name, so a rebuild produces the exact same pixels.

export type Rng = {
  next(): number; // 0 <= x < 1
  int(min: number, max: number): number; // inclusive
  pick<T>(list: readonly T[]): T;
  chance(p: number): boolean;
};

// FNV-1a: a stable 32-bit hash for seeding from a name
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32
export function rng(seed: number | string): Rng {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
  };
}

// Tileable value noise on a w x h torus (for textures that must repeat
// without seams). Returns 0..1 per pixel, row-major.
export function tileNoise(w: number, h: number, cell: number, seed: number | string): Float32Array {
  const r = rng(seed);
  const gw = Math.max(1, Math.round(w / cell));
  const gh = Math.max(1, Math.round(h / cell));
  const grid = new Float32Array(gw * gh).map(() => r.next());
  const at = (gx: number, gy: number) => grid[(((gy % gh) + gh) % gh) * gw + (((gx % gw) + gw) % gw)];
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * gw;
      const fy = (y / h) * gh;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
      const bot = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
      out[y * w + x] = top * (1 - sy) + bot * sy;
    }
  }
  return out;
}
