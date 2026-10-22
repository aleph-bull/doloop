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
  trimIndices,
  fmtBytes,
  TIMELAPSE_DEFAULT_STILL_BYTES,
  type LiveMark,
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

/** Marks for `before` ordinary stills, a clip of `frames` at 30 a second, then `after` more. */
function withClip(before: number, frames: number, after: number): LiveMark[] {
  return [
    ...Array<LiveMark>(before).fill(null),
    ...Array.from({ length: frames }, (_, k) => ({ clip: 1, at: 100_000 + (k * 1000) / 30 })),
    ...Array<LiveMark>(after).fill(null),
  ];
}

describe('live clips', () => {
  it('thinning keeps every frame of a clip and counts only the ordinary stills', () => {
    const isClip = (s: string) => s.startsWith('c');
    expect(thinStills(['a', 'b', 'c1', 'c2', 'c3', 'd', 'e'], isClip)).toEqual([
      'a',
      'c1',
      'c2',
      'c3',
      'd',
    ]);
    // Four ordinary stills and a long clip: not full at a cap of four.
    expect(thinIfFull(['a', 'c1', 'c2', 'c3', 'b', 'd', 'e'], 4, isClip)).toBeNull();
    expect(thinIfFull(['a', 'c1', 'b', 'd', 'e', 'f'], 4, isClip)).toEqual(['a', 'c1', 'd', 'f']);
  });

  it('a clip plays at real speed where it was filmed, after the ordinary stills before it', () => {
    // 300 ordinary stills, a 3 s clip (90 frames at 30 a second), 300 more.
    const marks = withClip(300, 90, 300);
    const p = planTimelapse(690, 3600, AUTO, marks);
    expect(p.liveSeconds).toBe(3);
    // 600 ordinary frames at 30 fps is 20 s, and the clip adds its own 3.
    expect(p.durationSeconds).toBe(23);
    expect(p.frames).toHaveLength(690);
    expect(p.live!.filter(Boolean)).toHaveLength(90);
    // In order: the first 300, then the clip frame by frame, then the rest.
    expect(p.frames[299]).toEqual([299, 300]);
    expect(p.live![299]).toBe(false);
    expect(p.frames[300]).toEqual([300, 301]);
    expect(p.live![300]).toBe(true);
    expect(p.frames[389]).toEqual([389, 390]);
    expect(p.frames[390]).toEqual([390, 391]);
    expect(p.live![390]).toBe(false);
  });

  it('a clip keeps real speed whatever the frame rate, repeating or skipping frames', () => {
    const marks = withClip(0, 90, 0);
    // 60 fps from a 30-a-second clip shows each frame twice.
    const fast = planTimelapse(90, 3, { ...AUTO, fps: 60 }, marks);
    expect(fast.frames).toHaveLength(180);
    expect(fast.frames[0]).toEqual([0, 1]);
    expect(fast.frames[1]).toEqual([0, 1]);
    expect(fast.frames[2]).toEqual([1, 2]);
    // 15 fps skips every other one; still 3 s.
    const slow = planTimelapse(90, 3, { ...AUTO, fps: 15 }, marks);
    expect(slow.durationSeconds).toBe(3);
    expect(slow.frames[1]).toEqual([2, 3]);
  });

  it('a set length is for the ordinary stills, and a blended frame never reaches across a clip', () => {
    // 502 before the clip, so a blended frame would straddle it.
    const marks = withClip(502, 60, 498);
    const p = planTimelapse(
      1060,
      3600,
      { ...AUTO, lengthMode: 'length', lengthSeconds: 10 },
      marks,
    );
    expect(p.durationSeconds).toBe(12);
    for (let j = 0; j < p.frames.length; j++) {
      const [from, to] = p.frames[j]!;
      if (p.live![j]) continue;
      // An ordinary frame holds ordinary stills only.
      for (let i = from; i < to; i++) expect(marks[i]).toBeNull();
    }
  });

  it('a speed counts only the ordinary stills, and keeps the asked rate for the clip', () => {
    // An hour at 300x is 12 s; the 3 s clip is part of that hour but plays at 1x.
    const marks = withClip(90, 90, 90);
    const p = planTimelapse(270, 3603, { ...AUTO, lengthMode: 'speed', fps: 30 }, marks);
    expect(p.fps).toBe(30);
    expect(p.liveSeconds).toBe(3);
    expect(p.durationSeconds).toBe(15);
  });

  it('two clips back to back stay two clips, each at its own times', () => {
    const marks: LiveMark[] = [
      null,
      { clip: 1, at: 0 },
      { clip: 1, at: 1000 },
      { clip: 2, at: 60_000 },
      { clip: 2, at: 61_000 },
      null,
    ];
    const p = planTimelapse(6, 120, { ...AUTO, fps: 1 }, marks);
    expect(p.frames).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
    ]);
    expect(p.liveSeconds).toBe(4);
  });

  it('without clips the plan is what it always was', () => {
    const plain = planTimelapse(900, 3600, AUTO);
    const marked = planTimelapse(900, 3600, AUTO, Array<LiveMark>(900).fill(null));
    expect(marked).toEqual(plain);
    expect(plain.live).toBeUndefined();
    expect(plain.liveSeconds).toBe(0);
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

describe('trimIndices', () => {
  const times = [0, 10, 20, 30, 40, 50];
  it('keeps everything with both ends open', () => {
    expect(trimIndices(times, null, null)).toEqual([0, 6]);
  });
  it('keeps the stills between two moments, inclusive', () => {
    expect(trimIndices(times, 10, 40)).toEqual([1, 5]);
    expect(trimIndices(times, 15, 35)).toEqual([2, 4]);
  });
  it('leaves nothing when the window holds no still', () => {
    const [a, b] = trimIndices(times, 41, 49);
    expect(b - a).toBe(0);
  });
});
