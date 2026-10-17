import { hex, ramp, type RGBA } from '../engine/color.js';
import { STYLE } from './style.js';

// The project palette. Every sprite picks colors from here, never inline hex,
// so the whole project stays one palette. Empty until the style setup
// (REFERENCES.md) decides the colors.
//
// Two ways to add colors:
//   1. fixed swatches:  PAL.outline = hex('#1a1424')
//   2. material ramps built by the STYLE ramp rule, so every material is
//      shaded the same way:  RAMPS.stone = rampOf('#7c7f8a')
//      -> RAMPS.stone[0] is the darkest shade, RAMPS.stone.at(-1) the lightest

export const PAL: Record<string, RGBA> = {
  // outline: hex('#......'),
};

export function rampOf(base: string): RGBA[] {
  if (!STYLE.ramp) throw new Error('palette: STYLE.ramp is not set yet (src/art/style.ts). Run the style setup first.');
  return ramp(hex(base), STYLE.ramp);
}

export const RAMPS: Record<string, RGBA[]> = {
  // stone: rampOf('#7c7f8a'),
};
