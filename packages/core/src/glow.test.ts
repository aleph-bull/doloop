import { describe, expect, it } from 'vitest';
import {
  advanceLevels,
  ATTACK,
  BAND_COUNT,
  DECAY,
  glowReach,
  isSilent,
  SILENCE_LEVEL,
  type SpectrumLevels,
} from './glow';

const flat = (value: number, count = BAND_COUNT): Float32Array =>
  Float32Array.from({ length: count }, () => value);

const sample = (value: number, level = value): SpectrumLevels => ({
  bands: flat(value),
  level,
});

/** Run the loop for a while and report the band levels. */
function run(
  levels: Float32Array,
  s: SpectrumLevels | null,
  frames: number,
  { still = false, fps = 60 } = {},
): Float32Array {
  for (let f = 0; f < frames; f++) advanceLevels(levels, s, f / fps, still);
  return levels;
}

describe('isSilent', () => {
  it('treats no capture as silence', () => {
    expect(isSilent(null)).toBe(true);
  });

  it('draws the line at the silence threshold', () => {
    expect(isSilent(sample(0.5, SILENCE_LEVEL - 0.001))).toBe(true);
    expect(isSilent(sample(0.5, SILENCE_LEVEL + 0.001))).toBe(false);
  });
});

describe('advanceLevels with audio', () => {
  it('rises toward a loud band fast and settles on it', () => {
    const levels = flat(0);
    advanceLevels(levels, sample(1), 0);
    // One frame of attack, not a jump straight to the target.
    expect(levels[0]).toBeCloseTo(ATTACK, 5);
    expect(levels[0]).toBeLessThan(1);

    run(levels, sample(1), 60);
    expect(levels[0]).toBeGreaterThan(0.99);
  });

  it('falls away more slowly than it rises', () => {
    const rising = flat(0);
    advanceLevels(rising, sample(1), 0);
    const gained = rising[0]!;

    const falling = flat(1);
    advanceLevels(falling, sample(0, 1), 0);
    const lost = 1 - falling[0]!;

    expect(lost).toBeCloseTo(DECAY, 5);
    expect(gained).toBeGreaterThan(lost);
  });

  it('never leaves the 0..1 range', () => {
    const levels = flat(0);
    for (let f = 0; f < 200; f++) {
      advanceLevels(levels, sample(f % 2 === 0 ? 1 : 0, 1), f / 60);
      for (const v of levels) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('follows each band independently', () => {
    const s: SpectrumLevels = {
      bands: Float32Array.from({ length: BAND_COUNT }, (_, i) => (i === 3 ? 1 : 0)),
      level: 0.5,
    };
    const levels = run(flat(0), s, 60);
    expect(levels[3]).toBeGreaterThan(0.99);
    expect(levels[0]).toBeLessThan(0.01);
  });

  it('copes with a sample carrying fewer bands than the buffer', () => {
    const short: SpectrumLevels = { bands: flat(1, 4), level: 1 };
    const levels = flat(0);
    expect(() => run(levels, short, 10)).not.toThrow();
    expect(levels[0]).toBeGreaterThan(0);
    // Bands with no data fall toward zero rather than going undefined.
    expect(Number.isFinite(levels[BAND_COUNT - 1]!)).toBe(true);
  });
});

describe('advanceLevels while silent', () => {
  it('breathes: the resting level keeps moving', () => {
    const levels = flat(0);
    const seen: number[] = [];
    // Two seconds at 60fps; the wave period is about eleven seconds.
    for (let f = 0; f < 120; f++) {
      advanceLevels(levels, null, f / 60);
      if (f % 20 === 0) seen.push(levels[0]!);
    }
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.01);
  });

  it('keeps the resting glow low, never dark and never full', () => {
    const levels = run(flat(0), null, 600);
    for (const v of levels) {
      expect(v).toBeGreaterThan(0.1);
      expect(v).toBeLessThan(0.75);
    }
  });

  it('offsets the bands so the glow does not pulse as one block', () => {
    const levels = run(flat(0), null, 120);
    const spread = Math.max(...levels) - Math.min(...levels);
    expect(spread).toBeGreaterThan(0.01);
  });

  it('falls back to breathing when the capture stops mid-stream', () => {
    const levels = run(flat(0), sample(1), 60);
    expect(levels[0]).toBeGreaterThan(0.99);
    run(levels, null, 300);
    expect(levels[0]).toBeLessThan(0.75);
  });
});

describe('advanceLevels under reduced motion', () => {
  it('snaps to a flat resting level and holds it', () => {
    const levels = flat(0);
    advanceLevels(levels, null, 0, true);
    const first = Array.from(levels);
    // Every band the same: no wave, no drift between them.
    expect(new Set(first).size).toBe(1);
    run(levels, null, 300, { still: true });
    expect(Array.from(levels)).toEqual(first);
  });

  it('still tracks audio, just without smoothing', () => {
    const levels = flat(0);
    advanceLevels(levels, sample(0.8), 0, true);
    expect(levels[0]).toBeCloseTo(0.8, 5);
  });
});

describe('glowReach', () => {
  it('rests near the edge and reaches further when loud', () => {
    expect(glowReach(true, 1)).toBeLessThan(glowReach(false, 1));
  });

  it('scales with intensity', () => {
    expect(glowReach(false, 0)).toBeLessThan(glowReach(false, 0.5));
    expect(glowReach(false, 0.5)).toBeLessThan(glowReach(false, 1));
  });

  it('never reaches the middle of the screen', () => {
    expect(glowReach(false, 1)).toBeLessThan(0.42);
  });

  it('clamps an out-of-range intensity', () => {
    expect(glowReach(false, 5)).toBe(glowReach(false, 1));
    expect(glowReach(false, -5)).toBe(glowReach(false, 0));
  });
});
