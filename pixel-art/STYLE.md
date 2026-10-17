# Art Style

> **Status: UNSET** (UNSET → DRAFT → LOCKED)
>
> The authority for every pixel in this project. Every agent reads this file
> before drawing anything. While the status is UNSET, nobody draws: run the
> style setup in `REFERENCES.md` first.
>
> How this file changes:
> - The user's art direction lands in the log (§12) first, word for word,
>   then gets distilled into the sections above. Never change a rule without
>   a log entry saying which direction caused it.
> - Every number here has a twin in `src/art/style.ts` or `src/art/palette.ts`.
>   Change both in the same edit.
> - DRAFT = filled in from the references, not yet approved. LOCKED = the
>   user approved the calibration board (REFERENCES.md step 5). Changing a
>   LOCKED rule needs the user's go-ahead.

The only fixed rule, for every project: **this is pixel art.** Every pixel is
placed on purpose; no blur, no anti-aliasing from filters, no smooth scaling,
no painted gradients unless §6 allows a dither. Everything else below is this
project's choice.

## 0. References

_Filled by the style setup. One row per reference, from
`out/analysis/SUMMARY.md` and `references/notes/<id>.md`._

| id | roles | what it contributes | what we ignore | weight |
|---|---|---|---|---|
| | | | | |

## 1. Pillars

_3 to 5 short sentences that define the look, in the user's words where
possible. When two rules below conflict, the pillars decide._

- _unset_

## 2. Camera, scale, proportions

- Perspective: _unset_ (top-down, 3/4 top-down, side view, isometric, front)
- Tile size: _unset_ px (`STYLE.tileSize`)
- Icon size: _unset_ px (`STYLE.iconSize`)
- Characters: _unset_ px tall in a _unset_ frame (`STYLE.characterFrame`)
- Proportions: _unset_ (e.g. head ≈ 40% of height, chunky limbs)
- How big things are relative to the tile: _unset_

## 3. Palette

- Palette size: _unset_ (total colors in the project; colors per sprite)
- Ramp rule: _unset_ shades per material, lightness span _unset_,
  shadows shift _unset_ (cooler / warmer / none) by _unset_°,
  highlights shift _unset_ (`STYLE.ramp`)
- Saturation and mood: _unset_
- Materials (each a ramp in `palette.ts` `RAMPS`):

| material | base color | notes |
|---|---|---|
| | | |

- Accents: _unset_ (how many per sprite, what they're for)
- Never: inline hex in sprite code. A new color = a new named swatch or ramp in `palette.ts`.

## 4. Outline

- Type: _unset_ (none / one color everywhere / selective "selout" darker than the color it borders)
- Color: _unset_ (`STYLE.outline`)
- Thickness and corners: _unset_ (1 px; diagonal corners filled or not)
- Interior lines: _unset_ (are details separated by lines, or by color only?)
- Exceptions: _unset_ (textures, effects, UI, ground contact)

## 5. Light and shading

- Light comes from: _unset_
- Shading is: _unset_ (hand-placed in the art / the build's lighting pass /
  both). Lighting pass on or off: `STYLE.lighting`
- Shades per material: _unset_ (cel bands, how many)
- Highlights: _unset_ (where, how big, specular dots?)
- Shadows: _unset_ (cast shadows? a ground ellipse? none?)
- Rim light / ambient occlusion in corners: _unset_

## 6. Texture and detail

- Detail density: _unset_ (typical same-color cluster ≈ _unset_ px; how much
  interior detail per tile)
- Dithering: _unset_ (never / for gradients only / as a texture)
- Noise and single pixels: _unset_
- Anti-aliasing: _unset_ (default: never; hand-placed AA on long curves only if the references do it)
- Translucency: _unset_ (default: opaque pixels only)

## 7. Shapes, silhouettes, variants

- Silhouettes: _unset_ (round / angular / mixed); must read at 1x
- Variants of one thing (tiers, species, rock 1-2-3): _unset_ (change shape
  first? color first? both?)

## 8. Category specs

_One block per kind of art this project needs. Delete the ones it doesn't._

### Tiles and block textures
- size, tileable?, outline?, lighting pass?, how top vs side faces differ: _unset_

### Props and objects (trees, rocks, furniture)
- size range, anchor (usually bottom-center), outline, lighting: _unset_

### Items and icons
- size, angle (e.g. weapons on the lower-left → upper-right diagonal), padding: _unset_

### Characters
- size, frame, facings drawn vs mirrored, base palette letters: _unset_

### Mobs / creatures
- _unset_

### Effects (hits, sparks, magic)
- _unset_

### UI
- _unset_

## 9. Animation

- Frame rates: _unset_ (e.g. idle 6-8 fps, walk 10-12, attacks 12-24)
- Facings: _unset_ (which are drawn, which mirrored)
- Motion size: _unset_ (e.g. bob 1-2 px; nothing jumps more than N px per frame)
- Rules: _unset_ (e.g. the first frame of every action equals the idle's first frame, so transitions don't pop)
- Detail: `ANIMATION.md`

## 10. Integration

- Output folder: _unset_ (`PROJECT.outDir` in `src/art/project.ts`)
- Export scales: _unset_ (`PROJECT.exportScales`; e.g. [1, 2, 3] for React Native)
- How the app loads art: _unset_ (reads `manifest.json`; names; anchors)
- Naming: _unset_ (e.g. `block-<material>`, `icon-<item>`, `<character>-<anim>`)

## 11. Review checklist

_Every new sprite passes these before it ships. The setup adds
project-specific lines; these defaults stay._

- [ ] Reads at 1x: the silhouette alone says what it is.
- [ ] Only palette colors (`PAL` / `RAMPS`); no stray near-duplicates.
- [ ] Outline follows §4 exactly (type, color, closed, exceptions).
- [ ] Shading follows §5 (light side, number of shades).
- [ ] Detail density matches §6 (not busier or emptier than its neighbors).
- [ ] Size and anchor follow §8.
- [ ] Looks like it belongs next to the existing art (check the contact sheet, not just the sprite alone).
- [ ] _project-specific lines here_

## 12. Art direction log (append-only, newest last)

Format: `- YYYY-MM-DD: "the user's words" → rule: <distilled rule> → applied to: §<section>`

- _(empty)_
