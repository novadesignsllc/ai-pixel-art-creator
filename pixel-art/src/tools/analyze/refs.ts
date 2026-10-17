import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import { REFS } from '../paths.js';

// references/refs.json: what each reference is FOR. The analyzer adds any
// new image it finds (roles guessed from its folder); the user or the agent
// fills in what to take from it, what to ignore, and the rights.

export const ROLES = ['style', 'lighting', 'palette', 'animation', 'subject'] as const;
export type Role = (typeof ROLES)[number];

export interface RefEntry {
  id: string;
  file: string; // relative to references/
  roles: Role[];
  // own = you made it; licensed = you have a license that allows modifying /
  // deriving from it; style-only = look and measure only, never redraw or trace
  rights: 'own' | 'licensed' | 'style-only' | 'unknown';
  take?: string; // what to learn from it ("the chunky outlines", "walk timing")
  ignore?: string; // what NOT to take ("the colors", "the UI")
  subject?: string; // what it shows ("hero walk cycle", "cave tileset")
  weight?: number; // how much it counts when references disagree (default 1)
  scale?: number | 'auto'; // upscale factor of the file (auto-detected)
  background?: string; // 'auto' | 'none' | '#hex'
  // animation sheets: frame size in the FILE's pixels, frame count, row, timing
  frame?: [number, number];
  frames?: number;
  row?: number;
  fps?: number;
}

export interface RefsFile {
  references: RefEntry[];
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || name === 'notes') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (IMAGE_EXT.has(extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ref';
}

export function loadRefs(): { refs: RefEntry[]; added: RefEntry[] } {
  mkdirSync(REFS, { recursive: true });
  const file = join(REFS, 'refs.json');
  const data: RefsFile = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { references: [] };
  if (!Array.isArray(data.references)) throw new Error('references/refs.json: expected { "references": [...] }');
  const known = new Set(data.references.map((r) => r.file.split(sep).join('/')));
  const ids = new Set(data.references.map((r) => r.id));
  const added: RefEntry[] = [];
  for (const p of walk(REFS)) {
    const rel = relative(REFS, p).split(sep).join('/');
    if (known.has(rel)) continue;
    const folder = rel.includes('/') ? rel.split('/')[0] : '';
    const role = (ROLES as readonly string[]).includes(folder) ? (folder as Role) : 'style';
    let id = slug(basename(rel, extname(rel)));
    while (ids.has(id)) id += '-2';
    ids.add(id);
    const entry: RefEntry = { id, file: rel, roles: [role], rights: 'unknown', take: '', ignore: '', weight: 1, scale: 'auto', background: 'auto' };
    if (role === 'animation') Object.assign(entry, { frame: undefined, fps: undefined });
    data.references.push(entry);
    added.push(entry);
  }
  for (const r of data.references) {
    if (!existsSync(join(REFS, r.file))) throw new Error(`references/refs.json: '${r.id}' points to missing file ${r.file}`);
    for (const role of r.roles) {
      if (!(ROLES as readonly string[]).includes(role)) throw new Error(`references/refs.json: '${r.id}' has unknown role '${role}' (use ${ROLES.join(', ')})`);
    }
  }
  if (added.length) writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return { refs: data.references, added };
}
