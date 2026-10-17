import type { Raster } from './raster.js';
import { rng, type Rng } from './rng.js';

// One registered sprite. Adding a sprite to the project = write its factory
// in src/art/sprites/, then add an entry (or a family) to src/art/registry.ts.
export interface SpriteEntry {
  make: () => Raster;
  // where the sprite is "placed", as fractions of its size:
  // 0.5,1 = bottom-center (things standing on the ground), 0,0 = top-left (tiles)
  anchorX: number;
  anchorY: number;
  // tile-seamless texture: the lighting pass skips it (per-sprite light would
  // seam every tile) and previews show it repeated 3x3
  texture?: boolean;
  // false = skip the lighting pass for this one sprite (glows, UI, decals)
  lit?: boolean;
  tags?: string[]; // grouping for contact sheets and previews, e.g. ['block', 'stone']
  meta?: Record<string, unknown>; // copied into the manifest as-is
}

export type SpriteTable = Record<string, SpriteEntry>;

// Merge sprite tables; a duplicate name is an error (a plain object spread
// would silently drop one of them).
export function defineSprites(...tables: SpriteTable[]): SpriteTable {
  const out: SpriteTable = {};
  for (const t of tables) {
    for (const [name, e] of Object.entries(t)) {
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
        throw new Error(`sprite name '${name}': use lowercase letters, digits, '-' and '_' only`);
      }
      if (out[name]) throw new Error(`sprite '${name}' is defined twice`);
      out[name] = e;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Families: the bulk-generation tool ("make 200 blocks like this, named...").
// One generator function + a list of items (inline or from a JSON spec)
// becomes one registry entry per item. Each item gets its own seeded RNG
// (seeded by its full name), so every rebuild is pixel-identical and adding
// an item never changes the others.
// ---------------------------------------------------------------------------
// any object with an id; the rest of its fields are the generator's parameters
export interface FamilyItem {
  id: string;
}

export interface FamilyDef<T extends FamilyItem> {
  prefix?: string; // name = `${prefix}-${id}`, or just `id` without a prefix
  items: readonly T[];
  make: (item: T, rnd: Rng, index: number) => Raster;
  anchorX?: number;
  anchorY?: number;
  texture?: boolean;
  lit?: boolean;
  tags?: string[];
  // per-item manifest data, e.g. (item) => ({ hardness: item.hardness })
  meta?: (item: T) => Record<string, unknown>;
}

export function family<T extends FamilyItem>(def: FamilyDef<T>): SpriteTable {
  const out: SpriteTable = {};
  def.items.forEach((item, index) => {
    const name = def.prefix ? `${def.prefix}-${item.id}` : item.id;
    if (out[name]) throw new Error(`family ${def.prefix ?? ''}: item '${item.id}' appears twice`);
    out[name] = {
      make: () => def.make(item, rng(name), index),
      anchorX: def.anchorX ?? 0.5,
      anchorY: def.anchorY ?? 1,
      texture: def.texture,
      lit: def.lit,
      tags: [...new Set([...(def.tags ?? []), ...(def.prefix ? [def.prefix] : [])])],
      meta: def.meta?.(item),
    };
  });
  return out;
}

// Look-alike variants of one thing (so a wall of 40 rocks doesn't repeat):
// `${name}`, `${name}-2`, ... `${name}-${count}`, each with its own seed.
export function variants(
  name: string,
  count: number,
  make: (rnd: Rng, i: number) => Raster,
  opts: Omit<SpriteEntry, 'make'>,
): SpriteTable {
  const out: SpriteTable = {};
  for (let i = 0; i < count; i++) {
    const n = i === 0 ? name : `${name}-${i + 1}`;
    out[n] = { ...opts, make: () => make(rng(n), i) };
  }
  return out;
}
