/**
 * Audio analysis for the focus screen's visualizer.
 *
 * Pure arithmetic over a frequency spectrum, kept out of the canvas component for the same
 * reason the timer lives here: an animation frame only fires while the page is painting,
 * so nothing in a render loop can be verified. The capture (getDisplayMedia, AudioContext,
 * AnalyserNode) and the drawing live in packages/ui; this file owns everything between them.
 *
 *   spectrum (AnalyserNode bytes)
 *     -> low-end energy, 20-140 Hz              bassEnergy()
 *     -> rolling average of the last ~1.5 s     AnalysisState.history
 *     -> relative change / transient detection  analyseFrame()
 *     -> fast attack, exponential release       smooth()
 *     -> AnalysisState, read by the renderer
 */

export interface VisualizerAnalysisConfig {
  /** The kick / sub-bass band, in Hz. Deliberately not the whole spectrum's average. */
  bassRange: readonly [number, number];
  /** Seconds of recent bass history the rolling average is taken over. */
  windowSeconds: number;
  /** Bass energy above `transientRatio` x the rolling average counts as a hit. */
  transientRatio: number;
  /** ...and above `strongRatio` x as a drop, which earns the shockwave. */
  strongRatio: number;
  /** Absolute bass energy (0..1) below which nothing counts as a hit, so hiss stays still. */
  floor: number;
  /** Seconds a hit must wait after the previous one, so one kick is not counted twice. */
  refractorySeconds: number;
  /** Per-second rates for the smoothing: how fast a level rises toward, and falls from, its target. */
  attackPerSecond: number;
  releasePerSecond: number;
  /** Per-second decay of the pulse (a hit) and the shock (a drop). */
  pulseReleasePerSecond: number;
  shockReleasePerSecond: number;
  /** Broadband loudness below this counts as silence, and the idle motion takes over. */
  silenceLevel: number;
}

export const DEFAULT_ANALYSIS: VisualizerAnalysisConfig = {
  bassRange: [20, 140],
  windowSeconds: 1.5,
  transientRatio: 1.4,
  strongRatio: 2.1,
  floor: 0.06,
  refractorySeconds: 0.1,
  attackPerSecond: 40,
  releasePerSecond: 4.5,
  pulseReleasePerSecond: 5,
  shockReleasePerSecond: 2.2,
  silenceLevel: 0.012,
};

/** Upper bound on the history ring: two seconds at 120 Hz is more than any window needs. */
const HISTORY_CAPACITY = 256;

export interface AnalysisState {
  /** Smoothed low-end level, 0..1: what the ribbons and rings breathe with. */
  bass: number;
  /** Unsmoothed low-end level of the latest frame, 0..1, and of the frame before it. */
  bassRaw: number;
  previousRaw: number;
  /** Smoothed broadband loudness, 0..1. */
  energy: number;
  /** Rolling average of the raw bass over the window. */
  average: number;
  /** bassRaw / average for the latest frame; 1 means "nothing changed". */
  ratio: number;
  /** Envelope of the latest hit, 1 at the hit and decaying: the central brightness pulse. */
  pulse: number;
  /** Envelope of the latest drop, 1 at the drop and decaying: bloom and chromatic offset. */
  shock: number;
  /** Seconds since the latest drop, for the expanding ring. Infinity before the first. */
  shockAge: number;
  /** True while nothing audible is coming through. */
  silent: boolean;
  /** Count of hits and drops so far, so a renderer can tell a new one from a decaying one. */
  hits: number;
  drops: number;
  lastHitAt: number;
  lastDropAt: number;
  lastTime: number;
  /* Ring buffer of (energy, time) for the rolling average. Fixed size: nothing allocates per frame. */
  history: Float32Array;
  times: Float32Array;
  head: number;
  count: number;
}

export function createAnalysisState(): AnalysisState {
  return {
    bass: 0,
    bassRaw: 0,
    previousRaw: 0,
    energy: 0,
    average: 0,
    ratio: 1,
    pulse: 0,
    shock: 0,
    shockAge: Infinity,
    silent: true,
    hits: 0,
    drops: 0,
    lastHitAt: -Infinity,
    lastDropAt: -Infinity,
    lastTime: NaN,
    history: new Float32Array(HISTORY_CAPACITY),
    times: new Float32Array(HISTORY_CAPACITY),
    head: 0,
    count: 0,
  };
}

/**
 * The analyser bins that cover a frequency range. Bin i is centred on i * sampleRate / fftSize,
 * so the range is inclusive of every bin whose centre falls inside it, and never empty.
 */
export function binRange(
  sampleRate: number,
  fftSize: number,
  range: readonly [number, number],
): [number, number] {
  const hzPerBin = sampleRate / fftSize;
  const from = Math.max(0, Math.floor(range[0] / hzPerBin));
  const to = Math.max(from + 1, Math.ceil(range[1] / hzPerBin));
  return [from, to];
}

/** RMS of the byte bins in [from, to), as 0..1. RMS rather than mean so a single loud bin counts. */
export function bandEnergy(spectrum: Uint8Array, from: number, to: number): number {
  const end = Math.min(to, spectrum.length);
  if (end <= from) return 0;
  let sum = 0;
  for (let i = from; i < end; i++) {
    const v = spectrum[i]! / 255;
    sum += v * v;
  }
  return Math.sqrt(sum / (end - from));
}

/** Fraction of the gap to close after `dt` seconds at `rate` per second. Exponential, frame-rate independent. */
export function smoothingFactor(rate: number, dt: number): number {
  if (dt <= 0 || rate <= 0) return 0;
  return 1 - Math.exp(-rate * dt);
}

/** value = lerp(value, target, k), with a fast attack and a slow release. */
export function smooth(
  current: number,
  target: number,
  dt: number,
  attackPerSecond: number,
  releasePerSecond: number,
): number {
  const rate = target > current ? attackPerSecond : releasePerSecond;
  return current + (target - current) * smoothingFactor(rate, dt);
}

function pushHistory(state: AnalysisState, energy: number, time: number): void {
  state.history[state.head] = energy;
  state.times[state.head] = time;
  state.head = (state.head + 1) % HISTORY_CAPACITY;
  if (state.count < HISTORY_CAPACITY) state.count++;
}

/** Mean of the history entries no older than `windowSeconds`. */
function rollingAverage(state: AnalysisState, time: number, windowSeconds: number): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < state.count; i++) {
    const idx = (state.head - 1 - i + HISTORY_CAPACITY) % HISTORY_CAPACITY;
    if (time - state.times[idx]! > windowSeconds) break;
    sum += state.history[idx]!;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

export interface FrameInput {
  /** The analyser's byte frequency data, or null when nothing is being captured. */
  spectrum: Uint8Array | null;
  sampleRate: number;
  fftSize: number;
  /** Seconds. Any monotonic clock. */
  time: number;
}

/**
 * Advance the analysis by one frame, in place, and return the same state.
 *
 * Loudness alone never drives the visuals: a brickwalled track sits at a high, flat level,
 * and the response comes from how the low end moves against its own recent average.
 */
export function analyseFrame(
  state: AnalysisState,
  input: FrameInput,
  cfg: VisualizerAnalysisConfig = DEFAULT_ANALYSIS,
): AnalysisState {
  // The first frame, and any frame after a long stall (a throttled background tab), gets a
  // nominal step rather than a huge one that would snap every envelope to zero.
  const dt = Number.isNaN(state.lastTime) ? 1 / 60 : Math.min(0.1, input.time - state.lastTime);
  state.lastTime = input.time;

  let bassRaw = 0;
  let broadband = 0;
  if (input.spectrum) {
    const [from, to] = binRange(input.sampleRate, input.fftSize, cfg.bassRange);
    bassRaw = bandEnergy(input.spectrum, from, to);
    // Everything up to ~8 kHz: the audible body of the mix, without the near-empty top bins.
    const [, upper] = binRange(input.sampleRate, input.fftSize, [0, 8000]);
    broadband = bandEnergy(input.spectrum, 0, upper);
  }

  state.previousRaw = state.bassRaw;
  state.bassRaw = bassRaw;
  state.silent = !input.spectrum || broadband < cfg.silenceLevel;
  state.energy = smooth(state.energy, broadband, dt, cfg.attackPerSecond, cfg.releasePerSecond);
  state.bass = smooth(state.bass, bassRaw, dt, cfg.attackPerSecond, cfg.releasePerSecond);

  // The average is taken *before* this frame joins it, so a hit is judged against the past.
  const average = rollingAverage(state, input.time, cfg.windowSeconds);
  pushHistory(state, bassRaw, input.time);
  state.average = average;
  state.ratio = average > 0 ? bassRaw / average : 1;

  // Transients: the low end jumping well above where it has been sitting. It also has to
  // be *rising* this frame, so a kick that sustains is one hit, not one per refractory
  // period until the average catches up.
  const armed = input.time - state.lastHitAt >= cfg.refractorySeconds;
  const rising = bassRaw > state.previousRaw * 1.02 + 0.004;
  const isHit =
    !state.silent &&
    armed &&
    rising &&
    bassRaw >= cfg.floor &&
    average > 0 &&
    state.ratio >= cfg.transientRatio;
  if (isHit) {
    state.hits++;
    state.lastHitAt = input.time;
    // How far past the threshold, scaled so a drop lands at 1.
    const strength = Math.min(
      1,
      (state.ratio - cfg.transientRatio) / (cfg.strongRatio - cfg.transientRatio),
    );
    state.pulse = Math.max(state.pulse, 0.35 + 0.65 * strength);
    if (state.ratio >= cfg.strongRatio) {
      state.drops++;
      state.lastDropAt = input.time;
      state.shock = 1;
    }
  }

  // Envelopes fall exponentially: nothing ever snaps back to the baseline.
  state.pulse *= Math.exp(-cfg.pulseReleasePerSecond * dt);
  if (state.pulse < 0.001) state.pulse = 0;
  state.shock *= Math.exp(-cfg.shockReleasePerSecond * dt);
  if (state.shock < 0.001) state.shock = 0;
  state.shockAge = input.time - state.lastDropAt;

  return state;
}

/* ---------- idle motion ---------- */

/**
 * A slow breath for when nothing is playing: three harmonics that never line up, so the
 * motion drifts instead of pulsing. 0..1, centred a little below the middle.
 */
export function idleBreath(seconds: number): number {
  const a = Math.sin(seconds * 0.45);
  const b = Math.sin(seconds * 1.1 + 1.7);
  const c = Math.sin(seconds * 2.3 + 0.4);
  return 0.5 + 0.45 * (0.55 * a + 0.3 * b + 0.15 * c);
}

/**
 * Cheap one-dimensional procedural noise over (x, t): a few incommensurate sines. Smooth,
 * periodic only over very long spans, and allocation-free. -1..1.
 */
export function ribbonNoise(x: number, seconds: number): number {
  return (
    0.5 * Math.sin(x * 1.3 + seconds * 0.7) +
    0.3 * Math.sin(x * 2.9 - seconds * 1.1 + 2.0) +
    0.2 * Math.sin(x * 5.1 + seconds * 1.9 + 4.0)
  );
}

/**
 * Noise around a circle: the same idea with whole-number harmonics of the angle, so the
 * value at 2π is the value at 0 and a ring closes without a seam. -1..1.
 */
export function ringNoise(angle: number, seconds: number): number {
  return (
    0.5 * Math.sin(2 * angle + seconds * 0.7) +
    0.3 * Math.sin(3 * angle - seconds * 1.1 + 2.0) +
    0.2 * Math.sin(5 * angle + seconds * 1.9 + 4.0)
  );
}

/**
 * The single amplitude the renderer scales its motion by: the smoothed bass when there is
 * audio, the breath when there is not, with the shift between them eased so a track
 * starting or stopping does not jump the picture.
 */
export function motionLevel(state: AnalysisState, seconds: number): number {
  const idle = idleBreath(seconds) * 0.35;
  if (state.silent) return idle;
  // Under audio the floor is still the breath, so a quiet passage never freezes.
  return Math.max(idle * 0.6, state.bass);
}

/* ---------- colour ---------- */

export interface VisualizerColorInput {
  colorMode: 'accent' | 'custom' | 'gradient';
  /** Hex, used by 'custom'. */
  color: string;
  /** The app accent as hex, resolved by the caller from the theme. */
  accentHex: string;
}

/** The two hex colours the renderer paints with. Both are the same for a single colour. */
export function visualizerPalette(input: VisualizerColorInput): { from: string; to: string } {
  const base = input.colorMode === 'custom' && isHex(input.color) ? input.color : input.accentHex;
  if (input.colorMode !== 'gradient') return { from: base, to: base };
  return { from: base, to: shiftHue(base, 70) };
}

function isHex(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

/** Rotate a hex colour's hue by `degrees`, keeping saturation and lightness. */
export function shiftHue(hex: string, degrees: number): string {
  if (!isHex(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  h = ((((h * 360 + degrees) % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const toHex = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(channel(h + 1 / 3))}${toHex(channel(h))}${toHex(channel(h - 1 / 3))}`;
}
