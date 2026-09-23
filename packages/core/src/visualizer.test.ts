import { describe, expect, it } from 'vitest';
import {
  analyseFrame,
  bandEnergy,
  binRange,
  createAnalysisState,
  DEFAULT_ANALYSIS,
  idleBreath,
  motionLevel,
  ribbonNoise,
  ringNoise,
  shiftHue,
  smooth,
  smoothingFactor,
  visualizerPalette,
  type AnalysisState,
} from './visualizer';

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
