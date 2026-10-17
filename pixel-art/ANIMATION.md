# Animation: the redraw method

How frame-by-frame animation is made in this kit. It is a method, not a
generator: a person animated the reference, and we redraw that motion,
frame by frame, in this project's style.

**Why a reference is required.** Characters drawn and animated from a text
description alone come out stiff and lifeless: good motion (weight, timing,
overlap, what moves 1 px and what moves 3) is the hard part, and it doesn't
come from words. What works is reading a hand-animated reference pixel by
pixel and redrawing it on the same frame grid with the same motion. So:

- **No new animation, and no new character, without a reference** in
  `references/animation/` (or `references/subject/` for a character's look).
- **Rights:** following a reference's poses frame by frame needs `own` or
  `licensed` in refs.json. `style-only` references can inform general feel
  (e.g. "snappy, 8 frames") but are not redrawn.
- **STYLE.md must not be UNSET**: the redraw uses the project's palette,
  outline and shading, never the reference's.

Good references: the user's own rough animation (even stick figures with the
right poses), a licensed or free-to-modify sprite pack, commissioned art. A
GIF or a sheet. Ideally at the size the project's characters will be.

---

## The model

A character is a set of **parts**: letter grids, one letter per pixel,
keyed by absolute frame row (`src/engine/anim.ts`):

```ts
const PAL = { O: OUTLINE, S: SKIN, s: SKIN_SHADE, B: SHIRT, b: SHIRT_SHADE, P: PANTS };

const HEAD = part(8, {          // string index 0 sits at frame x = 8
  5:  '.OOOOOO.',
  6:  'OSSSSSSO',
  // ...
});
```

An animation draws parts into each frame with **offsets taken from the
reference's motion table**, and swaps in a **redrawn part** only where the
shape really changes (a leg mid-step, an arm mid-swing):

```ts
const BOB = [0, 0, 1, 2, 2, 1];           // measured: reference top edge dy per frame

export const heroIdle: AnimDef = {
  name: 'hero-idle', frameW: 32, frameH: 32, fps: 7, loop: true,
  anchorX: 0.5, anchorY: 28 / 32,          // the feet
  reference: { ref: 'my-idle' },           // refs.json id: compare + motion check
  build: () => {
    const s = new Sheet(32, 32, BOB.length);
    BOB.forEach((dy, i) => {
      s.draw(i, PAL, TORSO, 0, dy);        // torso rides the bob
      s.draw(i, PAL, LEGS);                // legs stay planted
      s.draw(i, PAL, HEAD, 0, dy);         // head last: it paints over the neck
    });
    return s;
  },
};
```

Register it in `ANIMS` (`src/art/registry.ts`). Drawing order matters:
later parts paint over earlier ones, which is how a chest "compresses" when
the head dips over it.

Helpers: `shiftPart(p, dx, dy)` moves a part; `patch(p, { 12: '...' })`
derives a pose by replacing a few rows instead of redrawing;
`sheet.copyFrame(a, b)` for holds; `sheet.put(i, raster)` for procedural
effects; `facings: { s: () => ... }` for extra drawn directions (same frame
count); `mirror: { w: 'e' }` tells the app which facings it mirrors.

---

## Lane A: a new character (look first, then motion)

1. **Analyze the reference(s)**: `npm run analyze`. Read the character's
   report and notes (REFERENCES.md step 3).
2. **Read frame 0 pixel by pixel**: `npm run dump -- <ref-id> --frames 0`.
   Note the proportions (head/body/legs heights), the silhouette, where the
   reference puts light and shadow.
3. **Plan, as a table**: what to KEEP from the reference (frame grid size,
   where the feet stand, proportions, the motion later) and what to REPLACE
   (every color → this project's palette; outline → STYLE §4; shading →
   STYLE §5; costume, hair, gear → what the user asked for).
4. **Draw the rest pose as parts** (head, torso, arms, legs, plus anything
   that moves on its own) in `src/art/anims/<character>.ts`, with a
   character legend built from `PAL`/`RAMPS`. Make it a 1-frame `idle` first.
5. **Approve the look**: `npm run anim -- <name>`; show the user
   `out/anims/<name>/film.png` and the reference's `view.png` side by side.
   Fix until they're happy. This is the character's canonical look: every
   animation reuses these parts.

## Lane B: a new animation for an existing character

1. **Measure the motion**: `npm run analyze -- <ref-id>`. Open
   `out/analysis/<ref-id>/report.md` §9 (the motion table), `film.png`,
   `onion.png`, `dump.txt`. Answer the motion checklist in the notes.
2. **Write the offset tables** from the motion table: top-third dy → head
   bob, middle → torso, bottom → legs; left/right dx → sway and reach.
   Keep the reference's frame count and timing (fps or per-frame `durations`).
3. **Redraw the parts that change shape**, frame by frame, reading the
   reference's pose in `dump.txt` (`npm run dump -- <ref-id> --frames 2,3
   --region x0,y0,x1,y1` for a close look). Reuse the canonical parts
   everywhere else.
4. **If our character is a different size than the reference**: scale the
   offsets by the height ratio and round; keep the timing; keep the ground
   line fixed.
5. **Check**: `npm run anim -- <name>`. Look at `compare.png` (reference
   above, ours below, same zoom) and `motion.md` (our motion table next to
   the reference's: the same measurements). The bob, the holds, the
   ground contact and the widest/narrowest frames should line up. Fix any
   `CHECK:` line. At most two fix passes, then show the user.
6. **Ship**: `npm run anim -- <name> --ship` (or `npm run build`).

## Lane C: a tweak (≤ 5 minutes)

Find the part or frame (each anim file's comments say what every frame
does), edit the letters, `npm run anim -- <name>`, look at one image
(film.png or compare.png), done. No re-analysis, no review rounds.

---

## Rules that keep animation looking right

- Colors only from the character legend (built from `PAL`/`RAMPS`); the
  outline exactly as STYLE §4 says.
- **Pop-free transitions**: frame 0 of every action (attack, hurt, jump)
  equals the idle's frame 0, unless the reference clearly starts elsewhere.
- **Same frame count across facings**, so turning mid-animation keeps the frame index.
- **The ground line never moves** unless the character leaves the ground
  (a jump). Planted feet stay planted (bottom dy = 0 in the motion table).
- **Limbs at least 2 px thick** where they must read at 1x: a 1 px dark limb disappears into the outline.
- **Comment every frame** in the anim file (what the pose is, what moved),
  like a docstring. The next tweak depends on it.
- Lighting: an anim gets the build's lighting pass unless `lit: false`. Hand-shaded characters set `lit: false`.
- The reference never ships, and never gets traced into a sprite that isn't
  this redraw process.
