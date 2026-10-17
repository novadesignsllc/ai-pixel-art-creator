import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Every tool resolves paths from the kit folder (pixel-art/), wherever it lives.
export const KIT = fileURLToPath(new URL('../../', import.meta.url));
export const OUT = join(KIT, 'out');
export const REFS = join(KIT, 'references');
export const OVERRIDES = join(KIT, 'overrides');
