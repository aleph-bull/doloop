import type { TimelapseLengthMode } from './types';

/**
 * The timelapse's arithmetic: how often a still is taken, how the stills are thinned so a
 * long session stays within memory, how they map onto the frames of the finished video,
 * and how their brightness is evened out. The camera and the encoding live in the portal.
 *
 * The approach is the one phone timelapses use. In auto mode a still is taken every half
 * second to begin with; whenever the stills reach twice the target, every other one is
 * dropped and the interval doubles. However long the session runs, the stills stay between
 * the target and twice it, evenly spaced, and the video lands at about 20-40 seconds.
 */

/** Stills auto mode aims for: 600 at 30 fps is 20 s, and it never holds more than 1200 (40 s). */
export const TIMELAPSE_AUTO_TARGET = 600;
/** Most stills held at once in any mode, about 70-100 MB of JPEGs at the capture size. */
export const TIMELAPSE_MAX_STILLS = 2400;
/** The fastest a still is ever taken. */
export const TIMELAPSE_MIN_INTERVAL_MS = 250;
/** The first interval in auto and length modes, before any thinning. */
export const TIMELAPSE_START_INTERVAL_MS = 500;
/** The highest frame rate a video is made at. */
export const TIMELAPSE_MAX_FPS = 60;

export interface TimelapseOptions {
  lengthMode: TimelapseLengthMode;
  lengthSeconds: number;
  speed: number;
  fps: number;
}

const clampFps = (fps: number) =>
  Math.max(1, Math.min(TIMELAPSE_MAX_FPS, Math.round(Number.isFinite(fps) ? fps : 30)));

/** How many stills the buffer may hold before it is thinned, for these options. */
export function stillCap(opts: TimelapseOptions): number {
  if (opts.lengthMode === 'auto') return TIMELAPSE_AUTO_TARGET * 2;
  if (opts.lengthMode === 'length') {
    // Enough to fill the video at the asked rate, with room to blend, within the ceiling.
    const needed = Math.max(1, Math.round(opts.lengthSeconds)) * clampFps(opts.fps);
    return Math.min(TIMELAPSE_MAX_STILLS, Math.max(TIMELAPSE_AUTO_TARGET, needed * 2));
  }
  return TIMELAPSE_MAX_STILLS;
}

/**
 * The interval to start capturing at. A speed fixes it: at 300x and 30 fps each frame of
 * the video stands for ten seconds of the session. The others start quick and slow down
 * as they thin.
 */
export function startIntervalMs(opts: TimelapseOptions): number {
  if (opts.lengthMode !== 'speed') return TIMELAPSE_START_INTERVAL_MS;
  const ms = (Math.max(1, opts.speed) / clampFps(opts.fps)) * 1000;
  return Math.max(TIMELAPSE_MIN_INTERVAL_MS, Math.round(ms));
}

/** Drop every other still, keeping the first. */
export function thinStills<T>(stills: readonly T[]): T[] {
  return stills.filter((_, i) => i % 2 === 0);
}

/**
 * The buffer after a still was added: thinned once it holds more than `cap`, or null when
 * it still has room. Thinning one past the cap leaves an odd count, so the still just taken
 * is one of those kept; the caller doubles its interval and times the next still from it,
 * and the spacing stays even.
 */
export function thinIfFull<T>(stills: readonly T[], cap: number): T[] | null {
  return stills.length > cap ? thinStills(stills) : null;
}

export interface TimelapsePlan {
  /** Frames per second the video is made at. */
  fps: number;
  /** For each frame of the video, the stills behind it: [first, end). */
  frames: Array<[number, number]>;
  /** The video's length in seconds. */
  durationSeconds: number;
  /** The highest frame rate the stills can fill at this length or speed without repeating. */
  maxFps: number;
  /** True when there are too few stills to reach the asked length, so the video is shorter. */
  short: boolean;
}

/** Split `count` stills across `frames` frames, as evenly as whole stills allow. */
function partition(count: number, frames: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let j = 0; j < frames; j++) {
    const from = Math.floor((j * count) / frames);
    // With more frames than stills a still is shown for several frames in a row.
    const to = Math.max(from + 1, Math.floor(((j + 1) * count) / frames));
    out.push([Math.min(from, count - 1), Math.min(to, count)]);
  }
  return out;
}

/**
 * Lay the stills out as a video. `spanSeconds` is the focused time the stills cover, which
 * a speed needs to know how long the video comes out.
 *
 * - auto: one still per frame at the asked rate.
 * - length: exactly `lengthSeconds` long; spare stills are blended into their frame, and
 *   with too few the video is as long as the stills allow instead.
 * - speed: `spanSeconds / speed` long; the frame rate can only go as high as the stills
 *   reach without showing the same one twice.
 */
export function planTimelapse(
  stillCount: number,
  spanSeconds: number,
  opts: TimelapseOptions,
): TimelapsePlan {
  const fpsAsked = clampFps(opts.fps);
  if (stillCount <= 0)
    return { fps: fpsAsked, frames: [], durationSeconds: 0, maxFps: TIMELAPSE_MAX_FPS, short: true };

  if (opts.lengthMode === 'length') {
    const length = Math.max(1, Math.round(opts.lengthSeconds));
    const maxFps = Math.max(1, Math.min(TIMELAPSE_MAX_FPS, Math.floor(stillCount / length)));
    const wanted = length * fpsAsked;
    if (stillCount >= wanted) {
      return {
        fps: fpsAsked,
        frames: partition(stillCount, wanted),
        durationSeconds: length,
        maxFps,
        short: false,
      };
    }
    return {
      fps: fpsAsked,
      frames: partition(stillCount, stillCount),
      durationSeconds: stillCount / fpsAsked,
      maxFps,
      short: true,
    };
  }

  if (opts.lengthMode === 'speed') {
    const duration = Math.max(0, spanSeconds) / Math.max(1, opts.speed);
    const maxFps =
      duration > 0
        ? Math.max(1, Math.min(TIMELAPSE_MAX_FPS, Math.floor(stillCount / duration)))
        : TIMELAPSE_MAX_FPS;
    const fps = Math.min(fpsAsked, maxFps);
    const count = Math.max(1, Math.round(duration * fps));
    return {
      fps,
      frames: partition(stillCount, count),
      durationSeconds: count / fps,
      maxFps,
      short: false,
    };
  }

  return {
    fps: fpsAsked,
    frames: partition(stillCount, stillCount),
    durationSeconds: stillCount / fpsAsked,
    maxFps: TIMELAPSE_MAX_FPS,
    short: false,
  };
}

/**
 * Brightness corrections that take the flicker out: each still's average brightness is
 * pulled toward the average of the stills around it, so the slow change of daylight stays
 * and the jumps of a webcam's auto exposure go. Gains are clamped so a still that really
 * is darker (a hand over the lens) is not blown out.
 */
export function deflickerGains(lumas: readonly number[], radius = 7): number[] {
  const n = lumas.length;
  const out = new Array<number>(n);
  // A running sum over the window keeps this linear in the number of stills.
  const prefix = new Array<number>(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + (lumas[i] ?? 0);
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - radius);
    const to = Math.min(n, i + radius + 1);
    const target = (prefix[to]! - prefix[from]!) / (to - from);
    const own = lumas[i] ?? 0;
    const gain = own > 0.01 ? target / own : 1;
    out[i] = Math.min(1.35, Math.max(0.75, gain));
  }
  return out;
}

/** "1:23:45" or "23:45": the studied-time clock drawn into the video's corner. */
export function timelapseClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
