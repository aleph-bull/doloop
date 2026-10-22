import { timelapseBitrate, timelapseOutputSize } from './timelapse-output';
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

/*
 * A live clip: for a moment the camera is filmed at full speed, every frame kept, and the
 * video plays that stretch at real speed, for showing the camera something. Clips are never
 * thinned, so they are kept short.
 */
/** The most frames a second a live clip films. */
export const LIVE_CLIP_FPS = 30;
/** One live clip stops on its own after this long. */
export const LIVE_CLIP_MAX_SECONDS = 30;
/** The live clips one recording can hold in all. */
export const LIVE_CLIP_TOTAL_SECONDS = 60;

export interface TimelapseOptions {
  lengthMode: TimelapseLengthMode;
  lengthSeconds: number;
  speed: number;
  fps: number;
  /** How big the video is made, in percent of full size; full when absent. */
  resolution?: number;
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

/** Drop every other still, keeping the first. A live clip's stills (`isClip`) are all kept. */
export function thinStills<T>(stills: readonly T[], isClip?: (still: T) => boolean): T[] {
  let n = 0;
  return stills.filter((s) => isClip?.(s) || n++ % 2 === 0);
}

/**
 * The buffer after a still was added: thinned once it holds more than `cap`, or null when
 * it still has room. Thinning one past the cap leaves an odd count, so the still just taken
 * is one of those kept; the caller doubles its interval and times the next still from it,
 * and the spacing stays even. A live clip's stills don't count toward the cap.
 */
export function thinIfFull<T>(
  stills: readonly T[],
  cap: number,
  isClip?: (still: T) => boolean,
): T[] | null {
  const count = isClip ? stills.reduce((n, s) => (isClip(s) ? n : n + 1), 0) : stills.length;
  return count > cap ? thinStills(stills, isClip) : null;
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
  /** For each frame, true when it plays a live clip. Absent when the stills have none. */
  live?: boolean[];
  /** Seconds of the video that are live clips, playing at real speed. */
  liveSeconds: number;
}

/**
 * A still's place in a live clip: which clip (they are numbered from 1) and when it was
 * taken, in ms. Null for an ordinary still.
 */
export type LiveMark = { clip: number; at: number } | null;

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
 *
 * `marks` says which stills belong to a live clip. The ordinary stills are laid out as
 * above, as if the clips weren't there, and each clip goes in where it was filmed, a frame
 * for every 1/fps of it, so it plays at real speed and adds its own length to the video.
 */
export function planTimelapse(
  stillCount: number,
  spanSeconds: number,
  opts: TimelapseOptions,
  marks?: readonly LiveMark[],
): TimelapsePlan {
  const runs = marks ? clipRuns(marks.slice(0, stillCount)) : [];
  if (runs.length === 0) return planOrdinary(stillCount, spanSeconds, opts);
  const at = (i: number) => marks![i]!.at;
  const ordinary: number[] = [];
  for (let i = 0; i < stillCount; i++) if (!marks![i]) ordinary.push(i);
  const clipSeconds = runs.reduce((sum, run) => sum + runSeconds(at, run), 0);
  // A speed counts the focus the ordinary stills stand for; the clips play at 1x.
  let base = planOrdinary(ordinary.length, Math.max(0, spanSeconds - clipSeconds), opts);
  const fpsAsked = clampFps(opts.fps);
  if (base.fps < fpsAsked && base.frames.length > 0) {
    // Speed lowers the rate when the stills are few, which would make a clip stutter; the
    // asked rate shows the ordinary stills a frame or two longer instead.
    const count = Math.max(1, Math.round(base.durationSeconds * fpsAsked));
    base = { ...base, fps: fpsAsked, frames: partition(ordinary.length, count) };
  }
  const fps = base.fps;

  const frames: Array<[number, number]> = [];
  const live: boolean[] = [];
  let next = 0;
  const addClip = (run: [number, number]) => {
    const [from, to] = run;
    const count = Math.max(1, Math.round(runSeconds(at, run) * fps));
    let i = from;
    for (let k = 0; k < count; k++) {
      // The still showing at this moment of the clip: the last one taken by then.
      const t = at(from) + (k * 1000) / fps;
      while (i + 1 < to && at(i + 1) <= t) i++;
      frames.push([i, i + 1]);
      live.push(true);
    }
  };
  for (const [a, b] of base.frames) {
    const from = ordinary[a]!;
    // A clip filmed before this frame's first still plays before it.
    while (next < runs.length && runs[next]![0] < from) addClip(runs[next++]!);
    // A frame never blends across a clip: it stops where the next clip starts.
    const clip = runs[next];
    const to = Math.min(ordinary[b - 1]! + 1, clip ? clip[0] : stillCount);
    frames.push([from, to]);
    live.push(false);
  }
  while (next < runs.length) addClip(runs[next++]!);
  const liveFrames = live.filter(Boolean).length;
  return {
    fps,
    frames,
    durationSeconds: frames.length / fps,
    maxFps: base.maxFps,
    short: ordinary.length > 0 && base.short,
    live,
    liveSeconds: liveFrames / fps,
  };
}

/** Each live clip in the stills, as [first, end): a run of stills of the same clip. */
function clipRuns(marks: readonly LiveMark[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    if (!m) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] === i && marks[i - 1]?.clip === m.clip) last[1] = i + 1;
    else runs.push([i, i + 1]);
  }
  return runs;
}

/** How long a clip ran: first still to last, and the last one's own share of a second. */
function runSeconds(at: (i: number) => number, [from, to]: [number, number]): number {
  const n = to - from;
  const step = n > 1 ? (at(to - 1) - at(from)) / (n - 1) : 1000 / LIVE_CLIP_FPS;
  return (at(to - 1) - at(from) + step) / 1000;
}

/** The plan for ordinary stills only, by the length mode. */
function planOrdinary(
  stillCount: number,
  spanSeconds: number,
  opts: TimelapseOptions,
): TimelapsePlan {
  const fpsAsked = clampFps(opts.fps);
  if (stillCount <= 0)
    return {
      fps: fpsAsked,
      frames: [],
      durationSeconds: 0,
      maxFps: TIMELAPSE_MAX_FPS,
      short: true,
      liveSeconds: 0,
    };

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
        liveSeconds: 0,
      };
    }
    return {
      fps: fpsAsked,
      frames: partition(stillCount, stillCount),
      durationSeconds: stillCount / fpsAsked,
      maxFps,
      short: true,
      liveSeconds: 0,
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
      liveSeconds: 0,
    };
  }

  return {
    fps: fpsAsked,
    frames: partition(stillCount, stillCount),
    durationSeconds: stillCount / fpsAsked,
    maxFps: TIMELAPSE_MAX_FPS,
    short: false,
    liveSeconds: 0,
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

/** A still at the capture size before any webcam has been measured: 960 px wide JPEG. */
export const TIMELAPSE_DEFAULT_STILL_BYTES = 90_000;
/** Above this, holding the stills is worth a word before recording starts. */
export const TIMELAPSE_BIG_BYTES = 300_000_000;
/** The session a speed estimate assumes, since its stills grow with the session. */
const ESTIMATE_SESSION_SECONDS = 2 * 3600;

export interface TimelapseSizeEstimate {
  /** Most stills held at once over a long session. */
  peakStills: number;
  /** What those stills take up, in bytes. */
  peakBytes: number;
  /** About how big the finished video is, in bytes. */
  videoBytes: number;
  /** True when the stills alone pass TIMELAPSE_BIG_BYTES. */
  big: boolean;
}

/**
 * How much room a timelapse needs with these options, from the size of one still. The
 * stills sit in the browser (memory, and disk once it spills) until the video is made.
 */
export function timelapseSizeEstimate(
  opts: TimelapseOptions,
  stillBytes: number = TIMELAPSE_DEFAULT_STILL_BYTES,
): TimelapseSizeEstimate {
  const fps = clampFps(opts.fps);
  const cap = stillCap(opts);
  let peakStills: number;
  let videoSeconds: number;
  if (opts.lengthMode === 'speed') {
    const taken = Math.ceil((ESTIMATE_SESSION_SECONDS * 1000) / startIntervalMs(opts));
    peakStills = Math.min(cap, taken);
    videoSeconds = ESTIMATE_SESSION_SECONDS / Math.max(1, opts.speed);
  } else if (opts.lengthMode === 'length') {
    peakStills = cap;
    videoSeconds = Math.max(1, Math.round(opts.lengthSeconds));
  } else {
    peakStills = cap;
    videoSeconds = cap / fps;
  }
  const bytes =
    Number.isFinite(stillBytes) && stillBytes > 0 ? stillBytes : TIMELAPSE_DEFAULT_STILL_BYTES;
  const peakBytes = Math.round(peakStills * bytes);
  // The video's shape isn't known here; the usual 16:9 is near enough for a size.
  const { w, h } = timelapseOutputSize(16 / 9, opts.resolution ?? 100);
  return {
    peakStills,
    peakBytes,
    videoBytes: Math.round((videoSeconds * timelapseBitrate(w, h, fps)) / 8),
    big: peakBytes > TIMELAPSE_BIG_BYTES,
  };
}

/** "45 MB", "1.2 GB": a size for a sentence. */
export function fmtBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/**
 * The stills kept by a trim: those taken between `from` and `to` (seconds into the
 * session, inclusive), as [first, end). A null end is left open, so a trim that was never
 * moved keeps following the recording as it grows. The times are in order.
 */
export function trimIndices(
  times: readonly number[],
  from: number | null,
  to: number | null,
): [number, number] {
  let a = 0;
  let b = times.length;
  if (from !== null) while (a < b && times[a]! < from) a++;
  if (to !== null) while (b > a && times[b - 1]! > to) b--;
  return [a, b];
}
