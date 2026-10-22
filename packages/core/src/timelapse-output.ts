import { TIMELAPSE_LONG_SIDE, videoSize } from './timelapse-layout';

/**
 * How big the finished timelapse is made, and how hard it is compressed. The resolution is a
 * percentage of the full-size video (TIMELAPSE_LONG_SIDE on its long side). It never goes
 * under a floor for the video's shape, so nothing comes out too small to watch: 360 px on
 * the short side and 640 on the long. A camera that records smaller than that lowers the
 * floor to its own size; a camera this browser hasn't seen leaves the floor as it is. The
 * person is never told the rule: the slider just stops there (owner, 2026-10-22).
 */

/** The smallest the video's short side goes, unless the camera itself records smaller. */
export const TIMELAPSE_MIN_SHORT_SIDE = 360;
/** The smallest its long side goes, on the same terms. */
export const TIMELAPSE_MIN_LONG_SIDE = 640;
/** Bits per second at full size, 1280 × 720 at 30 fps. */
export const TIMELAPSE_FULL_BITRATE = 2_500_000;
const FULL_PIXELS = 1280 * 720;
/** Below this even a small video turns to blocks. */
const MIN_BITRATE = 300_000;

/** A camera's picture size in pixels, either way up. */
export interface CameraSize {
  w: number;
  h: number;
}

const sides = (s: CameraSize) => ({ short: Math.min(s.w, s.h), long: Math.max(s.w, s.h) });

/** The lowest resolution, in percent, a video of this shape can be made at with this camera. */
export function minTimelapseResolution(ratio: number, camera?: CameraSize | null): number {
  const full = sides(videoSize(ratio));
  let short = TIMELAPSE_MIN_SHORT_SIDE;
  let long = TIMELAPSE_MIN_LONG_SIDE;
  if (camera && camera.w > 0 && camera.h > 0) {
    const cam = sides(camera);
    short = Math.min(short, cam.short);
    long = Math.min(long, cam.long);
  }
  // A hair under, so 50.000001% from floating point stays 50.
  const pct = Math.ceil(Math.max(short / full.short, long / full.long) * 100 - 1e-6);
  return Math.max(1, Math.min(100, pct));
}

/** The resolution a video is made at: as asked, in whole percents, never under its floor. */
export function clampTimelapseResolution(
  percent: number,
  ratio: number,
  camera?: CameraSize | null,
): number {
  const p = Number.isFinite(percent) ? Math.round(percent) : 100;
  return Math.max(minTimelapseResolution(ratio, camera), Math.min(100, p));
}

/** The video's size in pixels at a resolution; rounded up, so the floor is never crossed. */
export function timelapseOutputSize(
  ratio: number,
  percent = 100,
  camera?: CameraSize | null,
): { w: number; h: number } {
  const p = clampTimelapseResolution(percent, ratio, camera);
  return videoSize(ratio, Math.ceil((TIMELAPSE_LONG_SIDE * p) / 100));
}

/**
 * Bits per second a video of this size is encoded at, so it comes out compressed. Full size
 * gets TIMELAPSE_FULL_BITRATE, about a third of the 8 Mbps it once came out at and hard to
 * tell apart for a timelapse. A smaller picture gets less, though not in step with its pixels,
 * since each pixel of a small picture needs more bits to stay clean; a higher frame rate gets
 * a little more.
 */
export function timelapseBitrate(w: number, h: number, fps = 30): number {
  const pixels = Math.max(1, w * h) / FULL_PIXELS;
  const rate = Math.max(1, Math.min(60, Number.isFinite(fps) ? fps : 30)) / 30;
  return Math.max(
    MIN_BITRATE,
    Math.round(TIMELAPSE_FULL_BITRATE * pixels ** 0.75 * Math.sqrt(rate)),
  );
}
