import { describe, expect, it } from 'vitest';
import {
  TIMELAPSE_AUTO_TARGET,
  TIMELAPSE_MAX_STILLS,
  deflickerGains,
  planTimelapse,
  startIntervalMs,
  stillCap,
  thinIfFull,
  thinStills,
  timelapseClock,
  timelapseSizeEstimate,
  fmtBytes,
  TIMELAPSE_DEFAULT_STILL_BYTES,
  type TimelapseOptions,
} from './timelapse';

const AUTO: TimelapseOptions = { lengthMode: 'auto', lengthSeconds: 30, speed: 300, fps: 30 };

describe('capturing', () => {
  it('starts quick in auto and length modes, and at the speed in speed mode', () => {
    expect(startIntervalMs(AUTO)).toBe(500);
    expect(startIntervalMs({ ...AUTO, lengthMode: 'length' })).toBe(500);
    // 300x at 30 fps: each frame stands for ten seconds.
    expect(startIntervalMs({ ...AUTO, lengthMode: 'speed' })).toBe(10_000);
    // Never faster than four a second, however low the speed.
    expect(startIntervalMs({ ...AUTO, lengthMode: 'speed', speed: 2, fps: 60 })).toBe(250);
  });

  it('caps the buffer at twice the target, within the ceiling', () => {
    expect(stillCap(AUTO)).toBe(TIMELAPSE_AUTO_TARGET * 2);
    expect(stillCap({ ...AUTO, lengthMode: 'length', lengthSeconds: 10, fps: 30 })).toBe(600);
    expect(stillCap({ ...AUTO, lengthMode: 'length', lengthSeconds: 120, fps: 60 })).toBe(
      TIMELAPSE_MAX_STILLS,
    );
    expect(stillCap({ ...AUTO, lengthMode: 'speed' })).toBe(TIMELAPSE_MAX_STILLS);
  });

  it('thins by keeping every other still, first included', () => {
    expect(thinStills([0, 1, 2, 3, 4])).toEqual([0, 2, 4]);
  });

  it('keeps an auto session between the target and twice it, however long it runs', () => {
    let stills: number[] = [];
    let interval = 500;
    let t = 0;
    const cap = stillCap(AUTO);
    // Five hours of capturing.
    while (t < 5 * 3600 * 1000) {
      stills.push(t);
      const thinned = thinIfFull(stills, cap);
      if (thinned) {
        stills = thinned;
        interval *= 2;
      }
      t += interval;
    }
    expect(stills.length).toBeGreaterThanOrEqual(TIMELAPSE_AUTO_TARGET);
    expect(stills.length).toBeLessThanOrEqual(cap);
    // Evenly spaced after all that thinning.
    const gaps = new Set(stills.slice(1).map((s, i) => s - stills[i]!));
    expect(gaps.size).toBe(1);
  });
});

describe('planning the video', () => {
  it('auto plays one still per frame', () => {
    const p = planTimelapse(900, 3600, AUTO);
    expect(p.frames).toHaveLength(900);
    expect(p.durationSeconds).toBe(30);
    expect(p.frames[0]).toEqual([0, 1]);
  });

  it('a set length blends spare stills and comes out exactly that long', () => {
    const p = planTimelapse(1000, 3600, { ...AUTO, lengthMode: 'length', lengthSeconds: 10 });
    expect(p.frames).toHaveLength(300);
    expect(p.durationSeconds).toBe(10);
    expect(p.short).toBe(false);
    // Every still is used once, in order.
    expect(p.frames[0]![0]).toBe(0);
    expect(p.frames.at(-1)![1]).toBe(1000);
    for (let i = 1; i < p.frames.length; i++) expect(p.frames[i]![0]).toBe(p.frames[i - 1]![1]);
    // The most it could run at for ten seconds: 100 stills a second, capped at 60.
    expect(p.maxFps).toBe(60);
  });

  it('a set length with too few stills comes out shorter, and says so', () => {
    const p = planTimelapse(120, 600, { ...AUTO, lengthMode: 'length', lengthSeconds: 10 });
    expect(p.short).toBe(true);
    expect(p.durationSeconds).toBe(4);
    expect(p.maxFps).toBe(12);
  });

  it('a speed sets the length, and the frame rate can only go as high as the stills reach', () => {
    // One hour at 300x is 12 s. 180 stills over 12 s support 15 fps.
    const p = planTimelapse(180, 3600, { ...AUTO, lengthMode: 'speed', fps: 30 });
    expect(p.maxFps).toBe(15);
    expect(p.fps).toBe(15);
    expect(p.durationSeconds).toBe(12);
    expect(p.frames).toHaveLength(180);
  });

  it('handles nothing captured', () => {
    expect(planTimelapse(0, 0, AUTO).frames).toEqual([]);
  });
});

describe('deflicker', () => {
  it('pulls a lone bright still back toward its neighbours and leaves a steady run alone', () => {
    const lumas = [0.5, 0.5, 0.5, 0.7, 0.5, 0.5, 0.5];
    const g = deflickerGains(lumas, 3);
    expect(g[3]).toBeLessThan(1);
    expect(g[0]).toBeGreaterThan(0.95);
    for (const v of deflickerGains([0.4, 0.4, 0.4], 1)) expect(v).toBeCloseTo(1, 9);
  });

  it('never boosts or cuts past its limits', () => {
    const g = deflickerGains([0.9, 0.05, 0.9], 1);
    expect(g[1]).toBe(1.35);
    expect(Math.min(...g)).toBeGreaterThanOrEqual(0.75);
  });
});

it('formats the studied-time clock', () => {
  expect(timelapseClock(65)).toBe('01:05');
  expect(timelapseClock(3725)).toBe('1:02:05');
});

describe('timelapseSizeEstimate', () => {
  const base: TimelapseOptions = { lengthMode: 'auto', lengthSeconds: 30, speed: 300, fps: 30 };

  it('sizes auto mode from its cap', () => {
    const e = timelapseSizeEstimate(base, 100_000);
    expect(e.peakStills).toBe(TIMELAPSE_AUTO_TARGET * 2);
    expect(e.peakBytes).toBe(120_000_000);
    expect(e.big).toBe(false);
  });

  it('flags a long set length with heavy stills', () => {
    const e = timelapseSizeEstimate({ ...base, lengthMode: 'length', lengthSeconds: 180 }, 150_000);
    expect(e.peakStills).toBe(TIMELAPSE_MAX_STILLS);
    expect(e.big).toBe(true);
    expect(e.videoBytes).toBe(180_000_000);
  });

  it('falls back to the default still size', () => {
    expect(timelapseSizeEstimate(base, 0).peakBytes).toBe(1200 * TIMELAPSE_DEFAULT_STILL_BYTES);
  });

  it('formats sizes', () => {
    expect(fmtBytes(45_000_000)).toBe('45 MB');
    expect(fmtBytes(1_234_000_000)).toBe('1.2 GB');
  });
});
