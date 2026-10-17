# References: the style setup protocol

How a project gets its art style: from the user's reference images, measured
by the same scripts and judged with the same checklist every time. Same
procedure → same quality of result, whatever the style.

Run this protocol:
- when `STYLE.md` says **Status: UNSET** (nothing may be drawn before it), and
- whenever the user adds references or wants the style changed.

Never skip a step, never reorder them, and never invent a style that the
references and the user didn't give you.

---

## What a reference is

Any image that shows something the art should learn from: screenshots of
games, sprite sheets, the user's own sketches, concept art. A reference has
one or more **roles**:

| role | folder | what it teaches |
|---|---|---|
| `style` | `references/style/` | the overall look: shapes, outline, detail, palette feel |
| `lighting` | `references/lighting/` | where light comes from, how shading is built |
| `palette` | `references/palette/` | colors, ramps, saturation, mood |
| `animation` | `references/animation/` | motion: timing, poses, how much moves per frame |
| `subject` | `references/subject/` | what one specific thing should look like (a tree, a hero) |

Formats: PNG (best), GIF (animated is fine), WEBP, JPG (works, but colors
come out approximate). Upscaled screenshots are fine: the analyzer finds the
real pixel grid. Native-size PNGs give the most exact numbers.

### Rights (ask, every time)

Every reference has a `rights` value in `references/refs.json`:

- **`own`**: the user made it.
- **`licensed`**: the user has a license that allows modifying or deriving from it.
- **`style-only`**: anything else. Look at it and measure it; **never trace,
  copy, or redraw it pixel by pixel**, and never follow its poses frame by frame.
- **`unknown`**: not asked yet. Ask before using it for anything beyond measuring.

Learning a general style from art you don't own is normal. Copying its
pixels, or closely redrawing its frames, is not. Animation redraws
(`ANIMATION.md`) follow a reference closely, so they need `own` or `licensed`.
Reference images never ship and are git-ignored by default.

### How many

- Look: at least **2** references with the `style` role (3 to 7 is ideal).
  One reference = a copy of one game; several = a style of your own.
- Animation: **1 per kind of motion** (walk, attack, idle...) before that
  animation is made. See `ANIMATION.md`.

---

## Step 0: intake (one message to the user, all questions at once)

1. **The project**: what is it, what's the camera (top-down, side view,
   isometric...), what platform/engine shows the art?
2. **The references**: please put them in `pixel-art/references/<role>/`
   (or send paths). For each: what do you like about it, and what should we
   NOT take from it?
3. **Rights** for each: your own, licensed (which license), or just inspiration?
4. **Sizes**, if decided: tile size, character height, icon size.
5. **Hard constraints**, if any: a palette limit, 1-bit / black and white,
   a console's color limits, "no outlines", a specific existing palette.
6. **The first things to make**: so the calibration set (step 5) uses real
   subjects from this project.

If the user has no references at all: ask for them. Offer to describe a few
well-known pixel-art looks (with the games that use them) so they can go
find screenshots, but don't start drawing from a description alone.

## Step 1: register

Put each file in its role folder, then run `npm run analyze` once: it adds
every new image to `references/refs.json` with a guessed role. Fill in, per
reference: `take`, `ignore`, `rights`, `subject`, and `weight` (default 1;
2 for "this is the main one"). For animation sheets also `frame` (frame
size in the file's own pixels, as an image viewer shows it), `fps`, and
`row` if the sheet has several rows. `background` and `scale` are detected;
set them only if the report's notes say the guess was wrong.

## Step 2: measure

```
npm run analyze
```

Per reference, `out/analysis/<id>/` gets `report.md` (numbers in a fixed
order) and review images; `out/analysis/SUMMARY.md` lines all references up
and computes the weighted **decision inputs**. Read every `⚠` note in a
report: a wrong scale or background guess spoils every number after it.
Fix it in refs.json and re-run before going on.

What the numbers mean (all on native pixels):

| measure | meaning |
|---|---|
| native size, scale | real pixel size; how much the file was blown up |
| mode | `sprites` (objects on a background) or `scene` (a full picture) |
| ramps | colors grouped into materials (colors that touch and are related), darkest first |
| shadows/highlights go cooler/warmer | hue shift along each ramp |
| outline: uniform / selective / none | one dark color around everything / edges darker than what they border / no outline |
| light comes from | where the lighter shades sit inside each material; strength <0.08 weak, 0.08–0.25 clear, >0.25 strong |
| shades per material | median ramp length |
| dithering, lone pixels | checkerboard blending; single noisy pixels |
| mean cluster px | average same-color patch size: big = chunky and flat, small = detailed and busy |
| grid guess | a repeating period: usually the tile size |
| motion table (animations) | per frame: size, how far the top/bottom/center moved, per third of the body, pixels changed |

## Step 3: look (the fixed checklist)

For **each** reference, open the images in this exact order and answer
**every** line of `references/notes/<id>.md` (the analyzer creates it):

1. `view.png`: the reference at native pixels
2. `palette.png`: its ramps
3. `value.png`: lightness only (how the shading is built, minus color)
4. `map.png`: blue = silhouette edge, red = thin dark lines, green = dither
5. animations also: `film.png`, `onion.png`, `preview.gif`, `dump.txt`

Rules for answering:
- Quote the measured number wherever a question has one. If what you see
  disagrees with a number, say so and say why (e.g. "measured light: none,
  because every material is one flat color; the art relies on outline only").
- Write what you see, not what you expect. "Not visible at this size" is a
  valid answer.
- Same questions, same order, for every reference: that is what makes two
  references comparable and two setups equally good.

## Step 4: decide (fill STYLE.md)

Fill each STYLE.md section from SUMMARY.md's decision inputs and the notes,
with this table. Write the matching numbers into `src/art/style.ts` and
`src/art/palette.ts` in the same edit. Set Status to **DRAFT**.

| STYLE.md | decided from | rule |
|---|---|---|
| §1 Pillars | notes: "signature moves", the user's "what I like" | 3–5 sentences; the user's words where possible |
| §2 Tile size | grid guesses, shapes' common dims, the user's answer | the user's answer wins; else the most common grid guess |
| §2 Proportions, perspective | notes 1–3 | majority of weighted references |
| §3 Palette size | significant colors per image | median; round to a sensible budget |
| §3 Ramp rule | shades per material; avg step; cooler/warmer | `steps` = median shades; `lightSpan` ≈ avg step × (steps − 1); hue shifts follow the vote (none if "same") |
| §3 Materials | ramps of the references | pick base colors that hit the same saturation/mood; never copy a reference's exact palette unless its rights allow and the user asks |
| §4 Outline | outline vote + color | majority by weight; if the vote is under 60%, ask the user |
| §5 Light | light vote | majority by weight; "none" means flat shading. Lighting pass on only if the references' shading is uniform and edge-based; hand-shaded art keeps it off |
| §5 Shades | shades per material | median |
| §6 Detail | mean cluster px; lone pixels | the median; describe it in words too |
| §6 Dithering, translucency | counts out of N references | allowed only if most references use it |
| §7, §8, §9 | notes + the user's needs | write only what the user's project needs |
| §10 Integration | intake answer 1 | see the README's platform notes |

When references disagree: higher weight wins; a tie or a near-tie (within
10%) is the user's call. Ask once, listing the options and which reference
does what.

## Step 5: calibrate (prove it before making real art)

1. Draw the **calibration set**, tagged `calibration` in the registry:
   - a small prop (a crate, a barrel, a sign)
   - a natural object (a rock, a bush, a tree)
   - an item icon at the icon size (a potion, a key, a tool)
   - a ground tile or block texture at the tile size (`texture: true`)
   - a subject from the user's "first things to make" (intake 6)
2. `npm run build`, then `npm run preview -- --board`. Look at
   `out/previews/board.png`: references on top, ours below, same zoom.
3. `npm run analyze -- --ours calibration`. In `SUMMARY.md`, compare the
   `ours-calibration` row with the decision inputs: outline type and color,
   light direction, shades per material, saturation, cluster size. Fix any
   gap bigger than a rounding error, in the shared code (palette, ramp rule,
   outline, lighting settings) before touching single sprites.
4. Show the user the board. Their feedback goes into the log (§12) and the
   rules. Repeat 1–4 until they approve.
5. Approved: set Status to **LOCKED**, log the date. Real art can start.

## Step 6: later changes

- New reference: add it, run steps 1–3 for it, re-run step 4 for the
  sections it affects, re-run step 5 for anything that changed.
- The user's direction ("chunkier", "less saturated", "I love this one"):
  log it first (§12), update the rule and its number, rebuild, check the
  contact sheets of everything affected.
- Hand edits in `overrides/`: diff them against the generated sprite,
  write down what the user changed as a log entry, apply the lesson.
