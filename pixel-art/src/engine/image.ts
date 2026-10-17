import { writeFileSync } from 'node:fs';
import gifenc from 'gifenc';
import sharp from 'sharp';
import { Raster } from './raster.js';

// Image I/O beyond plain PNG: reading references in any common format
// (PNG, JPG, WEBP, GIF incl. animated) and writing animated GIF previews.

export interface LoadedImage {
  frames: Raster[]; // one per animation page (a still image = 1)
  delays: number[] | null; // per-frame ms, when the file has timing (GIF/WEBP)
  format: string;
}

export async function loadImage(file: string): Promise<LoadedImage> {
  const meta = await sharp(file, { animated: true }).metadata();
  const pages = meta.pages ?? 1;
  const { data, info } = await sharp(file, { animated: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const pageH = pages > 1 ? (meta.pageHeight ?? info.height / pages) : info.height;
  const frames: Raster[] = [];
  for (let p = 0; p < pages; p++) {
    const r = new Raster(w, pageH);
    r.data.set(data.subarray(p * w * pageH * 4, (p + 1) * w * pageH * 4));
    frames.push(r);
  }
  const delays = pages > 1 && meta.delay ? meta.delay.slice(0, pages) : null;
  return { frames, delays, format: meta.format ?? 'unknown' };
}

// Animated GIF of a sheet's frames, scaled up (nearest) for viewing.
// Transparent pixels show as `bg`.
export function writeGif(
  file: string,
  frames: Raster[],
  delays: number | number[],
  opts: { zoom?: number; bg?: [number, number, number] } = {},
): void {
  const zoom = opts.zoom ?? 4;
  const bg = opts.bg ?? [58, 58, 70];
  const enc = gifenc.GIFEncoder();
  // one shared palette across frames so colors don't flicker
  const scaled = frames.map((f) => {
    const z = f.scaled(zoom);
    const rgba = new Uint8Array(z.data.length);
    for (let i = 0; i < z.data.length; i += 4) {
      const a = z.data[i + 3] / 255;
      rgba[i] = Math.round(z.data[i] * a + bg[0] * (1 - a));
      rgba[i + 1] = Math.round(z.data[i + 1] * a + bg[1] * (1 - a));
      rgba[i + 2] = Math.round(z.data[i + 2] * a + bg[2] * (1 - a));
      rgba[i + 3] = 255;
    }
    return { z, rgba };
  });
  const all = new Uint8Array(scaled.reduce((n, s) => n + s.rgba.length, 0));
  let off = 0;
  for (const s of scaled) {
    all.set(s.rgba, off);
    off += s.rgba.length;
  }
  const palette = gifenc.quantize(all, 256);
  scaled.forEach((s, i) => {
    const index = gifenc.applyPalette(s.rgba, palette);
    const delay = Array.isArray(delays) ? delays[i] : delays;
    enc.writeFrame(index, s.z.w, s.z.h, { palette, delay, repeat: 0 });
  });
  enc.finish();
  writeFileSync(file, enc.bytes());
}
