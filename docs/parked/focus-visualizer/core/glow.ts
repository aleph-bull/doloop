/**
 * Motion for the focus screen's ambient glow.
 *
 * Kept here, away from the canvas, because it is ordinary arithmetic and because an
 * animation frame only fires when the page is actually being painted — which makes the
 * behaviour impossible to check from a component. Capture and drawing live in packages/ui.
 */

/** How many bands the glow is drawn from: enough to read as a spectrum, few enough to stay smooth. */
export const BAND_COUNT = 28;

/** Below this the source counts as silent and the glow falls back to breathing. */
export const SILENCE_LEVEL = 0.012;

/** Asymmetric smoothing: jump toward a peak, ease back down, so motion reads as fluid. */
export const ATTACK = 0.34;
export const DECAY = 0.075;

/** Resting band level when nothing is playing, before the breathing wobble. */
const REST_BASE = 0.25;
const REST_SWING = 0.35;

export interface SpectrumLevels {
  /** Per-band amplitudes, 0..1, low frequency first. */
  bands: Float32Array;
  /** Overall loudness 0..1, used to decide whether anything is playing. */
  level: number;
}

export function isSilent(levels: SpectrumLevels | null): boolean {
  return !levels || levels.level < SILENCE_LEVEL;
}

/**
 * Advance the smoothed band levels by one frame, in place.
 *
 * `levels` is reused across frames rather than reallocated sixty times a second, so this
 * mutates it and returns it for convenience.
 *
 * With no audio the bands breathe: a slow wave, phase-shifted per band, so the resting
 * glow moves like light rather than pulsing as one block. When `still` (reduced motion)
 * every band snaps to a flat resting level and stays there.
 */
export function advanceLevels(
  levels: Float32Array,
  sample: SpectrumLevels | null,
  seconds: number,
  still = false,
): Float32Array {
  const quiet = isSilent(sample);
  for (let i = 0; i < levels.length; i++) {
    let target: number;
    if (quiet) {
      const wave = still ? 0 : Math.sin(seconds * 0.55 + i * 0.22) * 0.5 + 0.5;
      target = REST_BASE + wave * REST_SWING;
    } else {
      target = sample!.bands[i] ?? 0;
    }
    if (still) {
      levels[i] = target;
      continue;
    }
    const current = levels[i] ?? 0;
    levels[i] = current + (target - current) * (target > current ? ATTACK : DECAY);
  }
  return levels;
}

/**
 * How far the glow reaches into the screen, as a fraction of viewport width.
 * Quiet audio rests near the edge; the intensity setting scales how far a loud passage goes.
 */
export function glowReach(quiet: boolean, intensity: number): number {
  const amount = Math.min(1, Math.max(0, intensity));
  return quiet ? RESTING_REACH * (0.5 + amount) : RESTING_REACH + MAX_REACH * amount;
}

/** Reach when nothing is playing, before the breathing wobble. */
const RESTING_REACH = 0.05;
/** Reach at full amplitude and full intensity. */
const MAX_REACH = 0.34;
