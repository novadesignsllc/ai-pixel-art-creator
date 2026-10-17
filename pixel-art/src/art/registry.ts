import { defineAnims, type AnimDef } from '../engine/anim.js';
import { defineSprites } from '../engine/sprites.js';

// THE registry. A sprite or animation exists in the project once it's listed
// here; `npm run build` ships exactly this list.
//
//   SPRITES: single sprites, families (bulk), variants
//     defineSprites(
//       { crate: { make: crate, anchorX: 0.5, anchorY: 1, tags: ['prop'] } },
//       family({ prefix: 'block', items: BLOCKS, make: block, anchorX: 0, anchorY: 0, texture: true }),
//     )
//   ANIMS: frame-by-frame animations (src/art/anims/, see ANIMATION.md)

export const SPRITES = defineSprites();

export const ANIMS: AnimDef[] = defineAnims();
