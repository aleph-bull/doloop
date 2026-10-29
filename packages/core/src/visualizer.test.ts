import { describe, expect, it } from 'vitest';
import {
  analyseFrame,
  bandEnergy,
  barBins,
  binRange,
  cloudNoise,
  createAnalysisState,
  createBarState,
  customTuning,
  DEFAULT_ANALYSIS,
  DEFAULT_BARS,
  idleBars,
  idleBreath,
  MAX_BARS,
  motionLevel,
  ribbonNoise,
  ringNoise,
  shiftHue,
  smooth,
  smoothingFactor,
  updateBars,
  valueNoise,
  VISUALIZER_PRESETS,
  visualizerPalette,
  visualizerShows,
  visualizerTuning,
  visualizerTurnedOn,
  waveformShape,
  type AnalysisState,
  type BarState,
  type VisualizerAnalysisConfig,
} from './visualizer';

const CUSTOM = {
  sensitivity: 0.5,
  drop: 0.5,
  smoothing: 0.5,
  memory: 0.4,
  bassLow: 20,
  bassHigh: 140,
};
const KNOBS = {
  customSensitivity: 0.5,
  customDrop: 0.5,
  customSmoothing: 0.5,
  customMemory: 0.4,
  customBassLow: 20,
  customBassHigh: 140,
};

const SAMPLE_RATE = 48_000;
const FFT = 2048;
const BINS = FFT / 2;

/** A spectrum with `bass` in the low band and `rest` everywhere else, both as 0..255. */
function spectrum(bass: number, rest = 0): Uint8Array {
  const out = new Uint8Array(BINS);
  const [from, to] = binRange(SAMPLE_RATE, FFT, DEFAULT_ANALYSIS.bassRange);
  out.fill(rest);
  for (let i = from; i < to; i++) out[i] = bass;
  return out;
}

/** Feed `frames` frames of `spec` at 60 fps, starting at `state.lastTime`. */
function run(state: AnalysisState, spec: Uint8Array | null, frames: number, fps = 60): void {
  const start = Number.isNaN(state.lastTime) ? 0 : state.lastTime;
  for (let f = 1; f <= frames; f++) {
    analyseFrame(state, {
      spectrum: spec,
      sampleRate: SAMPLE_RATE,
      fftSize: FFT,
      time: start + f / fps,
    });
  }
}

describe('binRange', () => {
  it('isolates the 20-140 Hz bins and never returns an empty range', () => {
    const [from, to] = binRange(SAMPLE_RATE, FFT, [20, 140]);
    const hzPerBin = SAMPLE_RATE / FFT; // 23.4 Hz
    expect(from).toBe(0);
    expect(to).toBe(Math.ceil(140 / hzPerBin));
    expect(to).toBeGreaterThan(from);
    expect(to * hzPerBin).toBeGreaterThanOrEqual(140);
    // A range narrower than one bin still yields one bin.
    expect(binRange(SAMPLE_RATE, FFT, [30, 31])).toEqual([1, 2]);
  });
});

describe('bandEnergy', () => {
  it('is 0 for silence and 1 for a full band, and clips to the buffer', () => {
    expect(bandEnergy(new Uint8Array(8), 0, 8)).toBe(0);
    expect(bandEnergy(new Uint8Array(8).fill(255), 0, 8)).toBeCloseTo(1);
    expect(bandEnergy(new Uint8Array(4).fill(255), 2, 100)).toBeCloseTo(1);
    expect(bandEnergy(new Uint8Array(4), 6, 8)).toBe(0);
  });

  it('only reads the requested band', () => {
    const s = new Uint8Array(16);
    s[10] = 255;
    expect(bandEnergy(s, 0, 8)).toBe(0);
    expect(bandEnergy(s, 8, 16)).toBeGreaterThan(0);
  });
});

describe('smoothing', () => {
  it('closes more of the gap with more time and never overshoots', () => {
    expect(smoothingFactor(5, 0)).toBe(0);
    expect(smoothingFactor(5, 0.1)).toBeLessThan(smoothingFactor(5, 0.5));
    expect(smoothingFactor(5, 10)).toBeLessThanOrEqual(1);
  });

  it('attacks faster than it releases', () => {
    const up = smooth(0, 1, 1 / 60, 40, 4);
    const down = 1 - smooth(1, 0, 1 / 60, 40, 4);
    expect(up).toBeGreaterThan(down);
    expect(up).toBeGreaterThan(0.4); // most of the way there in one frame
    expect(down).toBeLessThan(0.1); // a small step back
  });
});

describe('analyseFrame', () => {
  it('reports silence and stays at rest with no spectrum', () => {
    const s = createAnalysisState();
    run(s, null, 30);
    expect(s.silent).toBe(true);
    expect(s.bass).toBe(0);
    expect(s.pulse).toBe(0);
    expect(s.hits).toBe(0);
  });

  it('does not treat a loud, steady track as a stream of hits', () => {
    const s = createAnalysisState();
    // Brickwalled: bass pinned at full scale for three seconds.
    run(s, spectrum(240, 200), 180);
    expect(s.silent).toBe(false);
    expect(s.bass).toBeGreaterThan(0.85);
    // The first frame or two can register while the average is still forming; after
    // that the ratio sits at 1 and nothing fires.
    expect(s.hits).toBeLessThanOrEqual(1);
    expect(s.ratio).toBeCloseTo(1, 1);
    expect(s.pulse).toBeLessThan(0.05);
  });

  it('fires on a jump above the rolling average, then decays', () => {
    const s = createAnalysisState();
    run(s, spectrum(60, 40), 90); // a quiet bed for 1.5 s
    const hitsBefore = s.hits;
    run(s, spectrum(240, 40), 1); // a kick
    expect(s.hits).toBe(hitsBefore + 1);
    expect(s.ratio).toBeGreaterThan(DEFAULT_ANALYSIS.transientRatio);
    const peak = s.pulse;
    expect(peak).toBeGreaterThan(0.3);
    run(s, spectrum(240, 40), 6); // the kick sustains, but it is no longer a change
    expect(s.hits).toBe(hitsBefore + 1);
    expect(s.pulse).toBeLessThan(peak);
    expect(s.pulse).toBeGreaterThan(0);
  });

  it('reserves the shock for a big jump, and the refractory period stops double counting', () => {
    const s = createAnalysisState();
    run(s, spectrum(50, 40), 90);
    run(s, spectrum(80, 40), 1); // 1.6x: a hit, not a drop
    expect(s.hits).toBe(1);
    expect(s.drops).toBe(0);
    expect(s.shock).toBe(0);

    const t = createAnalysisState();
    run(t, spectrum(50, 40), 90);
    run(t, spectrum(250, 40), 1); // 5x: a drop
    expect(t.drops).toBe(1);
    expect(t.shock).toBeGreaterThan(0.9);
    expect(t.shockAge).toBe(0);
    // Two frames later the bass is still far above the (slowly rising) average, but the
    // refractory period keeps the same kick from firing again.
    run(t, spectrum(250, 40), 2);
    expect(t.hits).toBe(1);
    expect(t.shockAge).toBeCloseTo(2 / 60, 5);
  });

  it('quiet singing: a soft swell over a near-empty low end is a hit at most, never a drop', () => {
    const s = createAnalysisState();
    run(s, spectrum(4, 30), 90); // a voice alone: almost nothing under 140 Hz
    run(s, spectrum(30, 60), 1); // a low note lands: many times the average, but not loud
    expect(s.hits).toBe(1);
    expect(s.drops).toBe(0);
    expect(s.shock).toBe(0);
    // The same jump, loud enough outright, is still a drop.
    const t = createAnalysisState();
    run(t, spectrum(4, 30), 90);
    run(t, spectrum(80, 60), 1);
    expect(t.drops).toBe(1);
  });

  it('ignores hiss: a jump below the floor is not a hit', () => {
    const s = createAnalysisState();
    run(s, spectrum(2, 6), 90);
    run(s, spectrum(10, 6), 1); // 5x relative, but nowhere near audible
    expect(s.hits).toBe(0);
  });

  it('holds the smoothing steady across a stalled frame', () => {
    const s = createAnalysisState();
    run(s, spectrum(200, 100), 60);
    const level = s.bass;
    // A ten-second gap, as when a background tab stops painting.
    analyseFrame(s, {
      spectrum: spectrum(0, 0),
      sampleRate: SAMPLE_RATE,
      fftSize: FFT,
      time: s.lastTime + 10,
    });
    // The step is clamped, so the level eases down rather than snapping to zero.
    expect(s.bass).toBeGreaterThan(level * 0.5);
  });

  it('is frame-rate independent in its release', () => {
    const at60 = createAnalysisState();
    const at30 = createAnalysisState();
    run(at60, spectrum(240, 100), 60);
    run(at30, spectrum(240, 100), 30, 30);
    run(at60, spectrum(0, 0), 60);
    run(at30, spectrum(0, 0), 30, 30);
    expect(at60.bass).toBeCloseTo(at30.bass, 1);
  });

  it('never allocates: the history buffers are the same objects throughout', () => {
    const s = createAnalysisState();
    const history = s.history;
    run(s, spectrum(100, 50), 400); // more frames than the ring holds
    expect(s.history).toBe(history);
    expect(s.count).toBe(s.history.length);
  });
});

describe('idle motion', () => {
  it('breathes within 0..1 and keeps moving', () => {
    let min = 1;
    let max = 0;
    for (let t = 0; t < 60; t += 0.05) {
      const v = idleBreath(t);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(0.4);
    expect(idleBreath(1)).not.toBe(idleBreath(2));
  });

  it('ribbon noise is bounded and continuous', () => {
    for (let x = 0; x < 10; x += 0.3) {
      const v = ribbonNoise(x, 3);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(ribbonNoise(x + 0.001, 3) - v)).toBeLessThan(0.02);
    }
  });

  it('cloud noise is bounded, seamless across its period, and different per seed', () => {
    let min = 1;
    let max = 0;
    for (let y = 0; y < 0.25; y += 0.013) {
      for (let x = 0; x < 1; x += 0.017) {
        const v = cloudNoise(x, y, 3);
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      expect(cloudNoise(0, y, 3)).toBeCloseTo(cloudNoise(1, y, 3), 9);
      expect(valueNoise(0, y, 6, 1)).toBeCloseTo(valueNoise(1, y, 6, 1), 9);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(0.3);
    expect(cloudNoise(0.3, 0.1, 3)).not.toBeCloseTo(cloudNoise(0.3, 0.1, 4), 3);
    // Smooth: a tiny step is a tiny change.
    expect(Math.abs(cloudNoise(0.3, 0.1, 3) - cloudNoise(0.3005, 0.1, 3))).toBeLessThan(0.02);
  });

  it('ring noise closes: the value at a full turn is the value at zero', () => {
    for (let t = 0; t < 20; t += 1.7) {
      expect(ringNoise(0, t)).toBeCloseTo(ringNoise(Math.PI * 2, t), 6);
      expect(Math.abs(ringNoise(1.3, t))).toBeLessThanOrEqual(1);
    }
  });

  it('motion follows the breath in silence and the bass under audio', () => {
    const s = createAnalysisState();
    expect(motionLevel(s, 1)).toBeCloseTo(idleBreath(1) * 0.35, 5);
    run(s, spectrum(240, 200), 60);
    expect(motionLevel(s, 1)).toBeCloseTo(s.bass, 5);
    expect(motionLevel(s, 1)).toBeGreaterThan(0.5);
  });
});

describe('bars', () => {
  it('bands are log-spaced, climb with the index, never empty and never past the spectrum', () => {
    const count = 32;
    let lastFrom = -1;
    let lastTo = 0;
    let firstWidth = 0;
    for (let i = 0; i < count; i++) {
      const [from, to] = barBins(SAMPLE_RATE, FFT, count, i);
      expect(to).toBeGreaterThan(from);
      expect(from).toBeGreaterThanOrEqual(lastFrom);
      expect(to).toBeGreaterThanOrEqual(lastTo);
      expect(to).toBeLessThanOrEqual(BINS);
      if (i === 0) firstWidth = to - from;
      lastFrom = from;
      lastTo = to;
    }
    // Above the first octave or so the bands stop sharing bins.
    for (let i = 8; i < count; i++) {
      expect(barBins(SAMPLE_RATE, FFT, count, i)[0]).toBeGreaterThanOrEqual(
        barBins(SAMPLE_RATE, FFT, count, i - 1)[1],
      );
    }
    // Octaves take the same number of bars, so the top band spans far more bins than the first.
    const [topFrom, topTo] = barBins(SAMPLE_RATE, FFT, count, count - 1);
    expect(topTo - topFrom).toBeGreaterThan(firstWidth * 20);
    // A range above Nyquist is clipped rather than pointing past the last bin.
    const [, clipped] = barBins(SAMPLE_RATE, FFT, 8, 7, [35, 100_000]);
    expect(clipped).toBeLessThanOrEqual(BINS);
  });

  function feed(state: BarState, spec: Uint8Array | null, frames: number, count = 24): void {
    const start = Number.isNaN(state.lastTime) ? 0 : state.lastTime;
    for (let f = 1; f <= frames; f++) {
      updateBars(
        state,
        { spectrum: spec, sampleRate: SAMPLE_RATE, fftSize: FFT, time: start + f / 60 },
        spec === null,
        count,
      );
    }
  }

  it('a single tone lights the one bar whose band holds it', () => {
    const spec = new Uint8Array(BINS);
    // 1 kHz sits in bin 42-43 at 23.4 Hz per bin.
    spec[43] = 255;
    const state = createBarState();
    feed(state, spec, 30);
    const lit = [...state.levels.subarray(0, 24)]
      .map((v, i) => [v, i] as const)
      .filter(([v]) => v > 0.05);
    expect(lit.length).toBe(1);
    const [from, to] = barBins(SAMPLE_RATE, FFT, 24, lit[0]![1]);
    expect(43).toBeGreaterThanOrEqual(from);
    expect(43).toBeLessThan(to);
  });

  it('rises fast, falls slowly, and the tilt lifts the treble', () => {
    const flat = new Uint8Array(BINS).fill(128);
    const state = createBarState();
    feed(state, flat, 3);
    // After three frames at 30/s attack the bars are well on their way up.
    expect(state.levels[0]).toBeGreaterThan(0.3);
    feed(state, flat, 60);
    const low = state.levels[0]!;
    const high = state.levels[23]!;
    expect(low).toBeCloseTo(128 / 255, 1);
    expect(high).toBeCloseTo(Math.min(1, (128 / 255) * (1 + DEFAULT_BARS.tilt)), 1);
    // Silence: the bars release toward the breath rather than snapping.
    feed(state, null, 1);
    expect(state.levels[0]).toBeGreaterThan(low * 0.8);
    feed(state, null, 120);
    expect(state.levels[0]).toBeLessThan(0.3);
  });

  it('a change of count restarts the row, and the count is clamped', () => {
    const state = createBarState();
    feed(state, new Uint8Array(BINS).fill(200), 30, 16);
    expect(state.count).toBe(16);
    feed(state, new Uint8Array(BINS).fill(200), 1, 8);
    expect(state.count).toBe(8);
    expect(state.levels[0]).toBeLessThan(0.5);
    feed(state, null, 1, 10_000);
    expect(state.count).toBe(MAX_BARS);
  });

  it('idle bars stay low, bounded and different along the row', () => {
    for (let t = 0; t < 30; t += 0.7) {
      for (let i = 0; i < 24; i++) {
        const v = idleBars(i, 24, t);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(0.3);
      }
    }
    expect(idleBars(0, 24, 5)).not.toBe(idleBars(23, 24, 5));
  });
});

describe('waveform', () => {
  it('resamples a byte waveform into -1..1 around silence at 128', () => {
    const samples = new Uint8Array(FFT);
    for (let i = 0; i < FFT; i++)
      samples[i] = Math.round(128 + 100 * Math.sin((i / FFT) * Math.PI * 4));
    const out = waveformShape(samples, false, 0, new Float32Array(64));
    let max = -Infinity;
    let min = Infinity;
    for (const v of out) {
      max = Math.max(max, v);
      min = Math.min(min, v);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    expect(max).toBeGreaterThan(0.6);
    expect(min).toBeLessThan(-0.6);
    // Two full cycles across the width: the line returns to zero in the middle.
    expect(Math.abs(out[32]!)).toBeLessThan(0.15);
    // A flat waveform is a flat line.
    const flat = waveformShape(new Uint8Array(FFT).fill(128), false, 0, new Float32Array(64));
    for (const v of flat) expect(v).toBe(0);
  });

  it('softens a spike across its neighbours', () => {
    const samples = new Uint8Array(64).fill(128);
    samples[32] = 255;
    const out = waveformShape(samples, false, 0, new Float32Array(64));
    expect(out[32]).toBeGreaterThan(0.4);
    expect(out[31]).toBeGreaterThan(0.1);
    expect(out[33]).toBeGreaterThan(0.1);
    expect(out[30]).toBe(0);
  });

  it('drifts on the idle noise in silence or with nothing captured', () => {
    const a = waveformShape(null, false, 1, new Float32Array(32));
    const b = waveformShape(new Uint8Array(FFT).fill(200), true, 1, new Float32Array(32));
    expect([...a]).toEqual([...b]);
    expect(a.some((v) => v !== 0)).toBe(true);
    for (const v of a) expect(Math.abs(v)).toBeLessThanOrEqual(0.3);
    const later = waveformShape(null, false, 2, new Float32Array(32));
    expect([...later]).not.toEqual([...a]);
  });
});

describe('on or off', () => {
  it('is off on a Minimalist theme until turned on there', () => {
    const was = { enabled: true, onMinimalist: false };
    expect(visualizerShows(was, false)).toBe(true);
    expect(visualizerShows(was, true)).toBe(false);
    const turned = { ...was, ...visualizerTurnedOn(true) };
    expect(visualizerShows(turned, true)).toBe(true);
    // Turned off again, it stays off; on again, it comes straight back.
    expect(visualizerShows({ ...turned, enabled: false }, true)).toBe(false);
    expect(visualizerShows({ enabled: false, onMinimalist: false }, false)).toBe(false);
  });

  it('only remembers the Minimalist choice when made on one', () => {
    expect(visualizerTurnedOn(false)).toEqual({ enabled: true });
    expect(visualizerTurnedOn(true)).toEqual({ enabled: true, onMinimalist: true });
  });
});

describe('colour', () => {
  it('follows the accent, a custom hex, or a hue sweep from the base', () => {
    expect(
      visualizerPalette({ colorMode: 'accent', color: '#ff0000', accentHex: '#6366f1' }),
    ).toEqual({
      from: '#6366f1',
      to: '#6366f1',
    });
    expect(
      visualizerPalette({ colorMode: 'custom', color: '#ff0000', accentHex: '#6366f1' }),
    ).toEqual({
      from: '#ff0000',
      to: '#ff0000',
    });
    // An unusable custom value falls back to the accent rather than painting nothing.
    expect(
      visualizerPalette({ colorMode: 'custom', color: 'red', accentHex: '#6366f1' }).from,
    ).toBe('#6366f1');
    const g = visualizerPalette({ colorMode: 'gradient', color: '', accentHex: '#6366f1' });
    expect(g.from).toBe('#6366f1');
    expect(g.to).not.toBe('#6366f1');
    expect(g.to).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('shifts hue and comes back around', () => {
    expect(shiftHue('#ff0000', 120)).toBe('#00ff00');
    expect(shiftHue('#ff0000', 360)).toBe('#ff0000');
    expect(shiftHue('#808080', 90)).toBe('#808080'); // grey has no hue to move
    expect(shiftHue('nope', 90)).toBe('nope');
  });
});

describe('presets', () => {
  it('bass is the original analysis, and the others listen wider and settle slower', () => {
    expect(visualizerTuning({ ...KNOBS, preset: 'bass' }).analysis).toBe(DEFAULT_ANALYSIS);
    expect(visualizerTuning({ ...KNOBS, preset: 'bass' }).bars).toBe(DEFAULT_BARS);
    const balanced = VISUALIZER_PRESETS.balanced.tuning.analysis;
    const mellow = VISUALIZER_PRESETS.mellow.tuning.analysis;
    expect(balanced.bassRange[1]).toBeGreaterThan(DEFAULT_ANALYSIS.bassRange[1]);
    expect(mellow.bassRange[1]).toBeGreaterThan(balanced.bassRange[1]);
    expect(mellow.transientRatio).toBeLessThan(balanced.transientRatio);
    expect(balanced.transientRatio).toBeLessThan(DEFAULT_ANALYSIS.transientRatio);
    expect(mellow.releasePerSecond).toBeLessThan(DEFAULT_ANALYSIS.releasePerSecond);
    expect(mellow.dropFloor).toBeLessThan(DEFAULT_ANALYSIS.dropFloor);
    for (const p of Object.values(VISUALIZER_PRESETS)) {
      expect(p.tuning.analysis.strongRatio).toBeGreaterThan(p.tuning.analysis.transientRatio);
      expect(p.label.length).toBeGreaterThan(0);
    }
    // An unknown preset in a saved row falls back to bass rather than throwing.
    expect(visualizerTuning({ ...KNOBS, preset: 'nope' as unknown as 'bass' }).analysis).toBe(
      DEFAULT_ANALYSIS,
    );
  });

  it('a soft song moves the mellow preset where the bass preset stays still', () => {
    // A gentle swell: the low end lifts by a quarter, which is a beat only to a preset
    // that listens for small moves.
    const quiet = spectrum(30, 10);
    const swell = spectrum(38, 12);
    const hits = (cfg: VisualizerAnalysisConfig) => {
      const st = createAnalysisState();
      for (let f = 1; f <= 90; f++)
        analyseFrame(
          st,
          { spectrum: quiet, sampleRate: SAMPLE_RATE, fftSize: FFT, time: f / 60 },
          cfg,
        );
      for (let f = 91; f <= 100; f++)
        analyseFrame(
          st,
          { spectrum: swell, sampleRate: SAMPLE_RATE, fftSize: FFT, time: f / 60 },
          cfg,
        );
      return st.hits;
    };
    expect(hits(VISUALIZER_PRESETS.bass.tuning.analysis)).toBe(0);
    expect(hits(VISUALIZER_PRESETS.mellow.tuning.analysis)).toBeGreaterThan(0);
  });

  it('the custom sliders move the right knobs, and the ring always needs more than a beat', () => {
    const calm = customTuning({ ...CUSTOM, sensitivity: 0, drop: 0, smoothing: 1, memory: 1 });
    const eager = customTuning({ ...CUSTOM, sensitivity: 1, drop: 1, smoothing: 0, memory: 0 });
    expect(eager.analysis.transientRatio).toBeLessThan(calm.analysis.transientRatio);
    expect(eager.analysis.floor).toBeLessThan(calm.analysis.floor);
    expect(eager.analysis.dropFloor).toBeLessThan(calm.analysis.dropFloor);
    expect(eager.analysis.strongRatio).toBeLessThan(calm.analysis.strongRatio);
    expect(eager.analysis.releasePerSecond).toBeGreaterThan(calm.analysis.releasePerSecond);
    expect(eager.bars.releasePerSecond).toBeGreaterThan(calm.bars.releasePerSecond);
    expect(eager.analysis.windowSeconds).toBeLessThan(calm.analysis.windowSeconds);
    for (const t of [calm, eager, customTuning({ ...CUSTOM, sensitivity: 1, drop: 0 })])
      expect(t.analysis.strongRatio).toBeGreaterThan(t.analysis.transientRatio);
    // The middle of every slider lands between the named presets' values.
    const mid = customTuning(CUSTOM).analysis;
    expect(mid.transientRatio).toBeGreaterThan(
      VISUALIZER_PRESETS.mellow.tuning.analysis.transientRatio,
    );
    expect(mid.transientRatio).toBeLessThan(DEFAULT_ANALYSIS.transientRatio + 0.2);
  });

  it('keeps the custom band inside its limits and at least 10 Hz wide', () => {
    expect(customTuning({ ...CUSTOM, bassLow: 5, bassHigh: 2000 }).analysis.bassRange).toEqual([
      20, 500,
    ]);
    expect(customTuning({ ...CUSTOM, bassLow: 200, bassHigh: 100 }).analysis.bassRange).toEqual([
      200, 210,
    ]);
    expect(customTuning({ ...CUSTOM, bassLow: 60, bassHigh: 180 }).analysis.bassRange).toEqual([
      60, 180,
    ]);
    // Garbage in a saved row reads as the middle of each slider, not NaN.
    const t = customTuning({
      sensitivity: NaN,
      drop: NaN,
      smoothing: NaN,
      memory: NaN,
      bassLow: NaN,
      bassHigh: NaN,
    });
    expect(Number.isFinite(t.analysis.transientRatio)).toBe(true);
    expect(t.analysis.bassRange).toEqual([20, 140]);
  });
});
