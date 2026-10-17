// Where the built art goes and how it's packaged for the app. Set once per
// project (STYLE.md §10 explains the choice).
export const PROJECT = {
  // output folder, relative to this kit folder (pixel-art/). Point it at the
  // app's asset folder, e.g. '../assets/sprites' or '../public/sprites'.
  outDir: 'out/assets',
  // Every exported PNG is enlarged by baseScale (nearest-neighbor), then
  // once more per entry in exportScales:
  //   file `name.png`     = art x baseScale
  //   file `name@2x.png`  = art x baseScale x 2   (only if 2 is listed)
  // Web/game engines: baseScale 1, exportScales [1]; scale in the engine
  // with nearest-neighbor filtering.
  // React Native / native mobile (their image views smooth pixels when they
  // scale): baseScale = how many points one art pixel should cover on screen
  // (e.g. 3), exportScales [1, 2, 3]. The OS picks the @Nx file for the
  // screen density and draws it 1:1, so pixels stay crisp. In the app, size
  // each image at (art width x baseScale) points.
  baseScale: 1,
  exportScales: [1] as number[],
  manifest: 'manifest.json',
};
