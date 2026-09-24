import { cloudNoise } from '@komogon/core';
import type { RGB } from './contrast';

/**
 * A cloud bank as a picture: fractal noise shaped so it is dense at the bottom, thins
 * upward, and ends in a top edge that wanders, with holes and wisps at every scale. Built
 * once per palette and scrolled by the renderer; it tiles horizontally without a seam.
 * The colour runs from the palette's second colour at the base to its first at the top,
 * lightened a little where the noise is dense, which is where a real cloud catches light.
 */
export function makeMistTexture(
  from: RGB,
  to: RGB,
  seed: number,
  width = 768,
  height = 192,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(width, height);
  const d = img.data;
  const aspect = height / width;
  for (let y = 0; y < height; y++) {
    // 0 at the top of the bank, 1 at the screen edge.
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const n = cloudNoise(u, v * aspect, seed);
      // The cutoff climbs with the noise: dense where the noise is high, gone where it is
      // low, and everything is pulled toward nothing as the top is approached.
      const shape = n * 1.2 - (1 - v) * 1.05 - 0.02;
      const dens = Math.min(1, Math.max(0, shape * 2.4));
      const alpha = Math.pow(dens, 1.25) * (0.5 + 0.5 * n);
      const lit = 0.3 * n * n;
      const i = (y * width + x) * 4;
      d[i] = Math.round((from[0] + (to[0] - from[0]) * v) * (1 - lit) + 255 * lit);
      d[i + 1] = Math.round((from[1] + (to[1] - from[1]) * v) * (1 - lit) + 255 * lit);
      d[i + 2] = Math.round((from[2] + (to[2] - from[2]) * v) * (1 - lit) + 255 * lit);
      d[i + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
