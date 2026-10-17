# overrides/: hand-painted pixels win

Put a PNG here named after any generated sprite and the next `npm run build`
ships it as-is instead of the generated one (no lighting pass: what you
paint is what ships).

- `crate.png` replaces the sprite `crate`
- `hero-walk.png` replaces the animation sheet `hero-walk` (the whole sheet);
  `hero-walk-s.png` replaces its `s` facing
- `.aseprite` files work too when the Aseprite CLI is installed

The size must match the generated sprite exactly (the build stops if not).
Easiest start: copy the built PNG from the output folder, edit it, save it
here under the same name.

Overrides are also feedback: the sprite-artist agent compares your edit
with the generated version, writes down what you changed as a rule in
`STYLE.md`'s log, and applies it to future art.
