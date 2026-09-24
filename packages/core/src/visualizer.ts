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
 *
 * The bars and the mirrored line have their own small pieces here too: `updateBars` turns
 * the spectrum into log-spaced bands, and `waveformShape` resamples the time-domain
 * waveform into the points the line is drawn through.
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
  /**
   * Absolute bass energy a drop needs on top of its ratio. Quiet singing sits on a near-empty
   * low end, where a soft note or a breath is many times the average without being loud.
   */
  dropFloor: number;
  /** The rolling average is never taken as lower than this when judging the ratio. */
  averageFloor: number;
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
  dropFloor: 0.24,
  averageFloor: 0.04,
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
 * and the response comes from how the low end moves against its own recent average. The
 * one exception is the drop, which also has to be loud outright, so a voice alone over a
 * near-empty low end can earn a hit but never the shockwave.
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
  // Against a floored average: over near-silence the raw ratio says nothing.
  state.ratio = average > 0 ? bassRaw / Math.max(average, cfg.averageFloor) : 1;

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
    if (state.ratio >= cfg.strongRatio && bassRaw >= cfg.dropFloor) {
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

/** A deterministic 0..1 for a lattice point, so the same seed always gives the same cloud. */
function lattice(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Value noise on a lattice `period` cells wide that wraps in x, so a texture built from it
 * tiles without a seam. `x` in 0..1 covers one period; `y` is in the same units. 0..1.
 */
export function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xf = x * period;
  const yf = y * period;
  const x0 = Math.floor(xf);
  const y0 = Math.floor(yf);
  const tx = fade(xf - x0);
  const ty = fade(yf - y0);
  const px = ((x0 % period) + period) % period;
  const px1 = (px + 1) % period;
  const a = lattice(px, y0, seed);
  const b = lattice(px1, y0, seed);
  const c = lattice(px, y0 + 1, seed);
  const d = lattice(px1, y0 + 1, seed);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/**
 * Fractal cloud noise: octaves of value noise, each twice as fine and half as strong, so
 * there is shape at every scale from a bank down to a wisp. Periodic in x over 0..1. 0..1.
 */
export function cloudNoise(x: number, y: number, seed: number, octaves = 5, period = 6): number {
  let sum = 0;
  let strength = 0.5;
  let total = 0;
  let p = period;
  for (let o = 0; o < octaves; o++) {
    sum += strength * valueNoise(x, y, p, seed + o * 101);
    total += strength;
    strength *= 0.5;
    p *= 2;
  }
  return sum / total;
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

/* ---------- bars ---------- */

export interface BarsConfig {
  /**
   * The frequencies the bars span, in Hz, divided logarithmically so an octave is the
   * same number of bars wherever it sits and the low end is not squeezed into one bar.
   */
  range: readonly [number, number];
  /** Per-second rates, as for `smooth()`: how fast a bar rises and how fast it falls. */
  attackPerSecond: number;
  releasePerSecond: number;
  /** Lift for the top bars, since byte spectra roll off toward the treble. 0 leaves them be. */
  tilt: number;
}

export const DEFAULT_BARS: BarsConfig = {
  range: [35, 14_000],
  attackPerSecond: 30,
  releasePerSecond: 6,
  tilt: 0.8,
};

/** The most bars a renderer can ask for; the state is sized once, for this. */
export const MAX_BARS = 128;

export interface BarState {
  /** Smoothed level per bar, 0..1. Only the first `count` entries mean anything. */
  levels: Float32Array;
  count: number;
  lastTime: number;
}

export function createBarState(): BarState {
  return { levels: new Float32Array(MAX_BARS), count: 0, lastTime: NaN };
}

/**
 * The analyser bins for bar `index` of `count`, over the log-spaced range. Bands only ever
 * move up the spectrum with the index; a bar too narrow for a whole bin (the lowest few, at
 * ~23 Hz per bin) shares its neighbour's, so the row is never empty there.
 */
export function barBins(
  sampleRate: number,
  fftSize: number,
  count: number,
  index: number,
  range: readonly [number, number] = DEFAULT_BARS.range,
): [number, number] {
  const hzPerBin = sampleRate / fftSize;
  const top = Math.min(range[1], sampleRate / 2);
  const ratio = top / range[0];
  const lo = range[0] * Math.pow(ratio, index / count);
  const hi = range[0] * Math.pow(ratio, (index + 1) / count);
  const from = Math.max(0, Math.floor(lo / hzPerBin));
  const to = Math.max(from + 1, Math.floor(hi / hzPerBin));
  return [from, to];
}

/**
 * Advance the bars by one frame, in place. Each bar is the loudest bin in its band (a peak,
 * so a single tone lights a single bar rather than smearing), tilted up toward the treble,
 * then smoothed with a fast attack and a slower release. In silence, or with nothing
 * captured, the bars breathe with the idle motion instead of dropping to nothing.
 */
export function updateBars(
  state: BarState,
  input: FrameInput,
  silent: boolean,
  count: number,
  cfg: BarsConfig = DEFAULT_BARS,
): BarState {
  const n = Math.max(1, Math.min(MAX_BARS, Math.round(count)));
  const dt = Number.isNaN(state.lastTime) ? 1 / 60 : Math.min(0.1, input.time - state.lastTime);
  state.lastTime = input.time;
  // A change of count restarts those bars from the floor rather than from stale levels.
  if (state.count !== n) {
    state.levels.fill(0);
    state.count = n;
  }
  const spectrum = silent ? null : input.spectrum;
  for (let i = 0; i < n; i++) {
    let target: number;
    if (spectrum) {
      const [from, to] = barBins(input.sampleRate, input.fftSize, n, i, cfg.range);
      const end = Math.min(to, spectrum.length);
      let peak = 0;
      for (let b = from; b < end; b++) if (spectrum[b]! > peak) peak = spectrum[b]!;
      const lift = 1 + cfg.tilt * (i / Math.max(1, n - 1));
      target = Math.min(1, (peak / 255) * lift);
    } else {
      target = idleBars(i, n, input.time);
    }
    state.levels[i] = smooth(
      state.levels[i]!,
      target,
      dt,
      cfg.attackPerSecond,
      cfg.releasePerSecond,
    );
  }
  return state;
}

/**
 * The resting height of bar `index` of `count` at `seconds`: a low skyline that wanders
 * along the row and swells with the breath, never quite flat. 0..1.
 */
export function idleBars(index: number, count: number, seconds: number): number {
  const u = count > 1 ? index / (count - 1) : 0.5;
  const wander = 0.5 + 0.5 * ribbonNoise(u * 4 + 1, seconds * 0.6);
  return 0.05 + 0.08 * wander + idleBreath(seconds) * (0.04 + 0.16 * wander);
}

/* ---------- waveform ---------- */

/**
 * The mirrored line's shape: `out.length` values in -1..1 across the width, resampled from
 * the analyser's byte waveform (128 is silence). Each point is the mean of its window and
 * is then softened with its neighbours, so the line flows rather than jags. With no samples,
 * or in silence, the line drifts on the idle noise instead of lying flat.
 */
export function waveformShape(
  samples: Uint8Array | null,
  silent: boolean,
  seconds: number,
  out: Float32Array,
): Float32Array {
  const n = out.length;
  if (n === 0) return out;
  if (!samples || silent || samples.length === 0) {
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 0.5;
      out[i] = 0.3 * ribbonNoise(u * 4.5, seconds * 0.9) * (0.6 + 0.4 * idleBreath(seconds));
    }
    return out;
  }
  const window = samples.length / n;
  let prev = 0;
  let before = 0;
  for (let i = 0; i < n; i++) {
    const from = Math.floor(i * window);
    const to = Math.max(from + 1, Math.floor((i + 1) * window));
    let sum = 0;
    for (let s = from; s < to && s < samples.length; s++) sum += samples[s]! - 128;
    const v = sum / (Math.min(to, samples.length) - from) / 128;
    // A three-tap blur, written back one point behind so it reads only unblurred values.
    if (i >= 1) out[i - 1] = i >= 2 ? 0.25 * before + 0.5 * prev + 0.25 * v : 0.5 * prev + 0.5 * v;
    before = prev;
    prev = v;
  }
  out[n - 1] = n >= 2 ? 0.5 * before + 0.5 * prev : prev;
  return out;
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
