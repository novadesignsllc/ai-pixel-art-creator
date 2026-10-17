import type { RampRule } from '../engine/color.js';
import type { LightOpts } from '../engine/lighting.js';

// The machine-readable half of STYLE.md: the numbers the build enforces.
// STYLE.md says WHY; this file says HOW MUCH. Keep the two in sync: when a
// STYLE.md decision changes a number, change it here in the same edit.
//
// Everything starts unset. The style setup (REFERENCES.md) fills it in from
// the project's references and the user's answers. The build warns while
// `status` is 'unset' and refuses to call the style 'locked' until the user
// has approved the calibration board.

export const STYLE = {
  status: 'unset' as 'unset' | 'draft' | 'locked',

  // sizes in native pixels (null = not decided yet)
  tileSize: null as number | null, // the world grid, e.g. 8, 16, 32
  iconSize: null as number | null, // inventory / UI item icons
  characterFrame: null as [number, number] | null, // animation frame size

  // outline drawn by sprite factories as their last step (see STYLE.md §Outline)
  //   null           = no outline
  //   { color }      = one outline color everywhere
  //   { selective }  = outline darker than the color next to it ("selout"),
  //                    `amount` = how much darker (0..1)
  outline: null as null | { color: string; diagonal?: boolean } | { selective: true; amount: number; diagonal?: boolean },

  // the optional lighting pass (src/engine/lighting.ts); null = sprites are
  // hand-shaded and the build leaves them alone. `skip` holds colors as hex.
  lighting: null as null | (Omit<LightOpts, 'skip'> & { skip: string[] }),

  // how every material ramp is built (src/engine/color.ts ramp())
  ramp: null as RampRule | null,
};
