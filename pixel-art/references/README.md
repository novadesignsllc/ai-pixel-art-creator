# references/

Your reference images go here, sorted by what they're for:

| folder | for |
|---|---|
| `style/` | the overall look you want |
| `lighting/` | how light and shading should work |
| `palette/` | colors and mood |
| `animation/` | motion to redraw (sheets or GIFs) |
| `subject/` | what one specific thing should look like |

Then run `npm run analyze`. New files are added to `refs.json` automatically;
fill in what each one is for (`take`, `ignore`) and your `rights` to it
(`own`, `licensed`, `style-only`). The whole procedure is in
`../REFERENCES.md`.

- `notes/` holds the checklist answers for each reference (created by the analyzer, filled in by the agent).
- Image files in this folder are git-ignored: references may be licensed to
  you alone and must never be shared or shipped with the art.

## refs.json fields

```json
{
  "references": [
    {
      "id": "cave-tiles",
      "file": "style/cave-tiles.png",
      "roles": ["style", "lighting"],
      "rights": "style-only",
      "take": "chunky 3-shade rocks, dark purple outline",
      "ignore": "the UI and the saturated torches",
      "subject": "cave tileset",
      "weight": 2,
      "scale": "auto",
      "background": "auto"
    },
    {
      "id": "hero-walk",
      "file": "animation/hero-walk.png",
      "roles": ["animation"],
      "rights": "own",
      "frame": [64, 64],
      "fps": 10,
      "row": 0
    }
  ]
}
```

- `frame` is in the file's own pixels (what an image viewer shows), even if
  the file is an upscaled copy. Animated GIFs need no `frame`.
- `scale` / `background`: leave `auto` unless a report's notes say the guess was wrong.
