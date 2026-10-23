import { describe, expect, it } from 'vitest';
import {
  clampTimelapseResolution,
  minTimelapseResolution,
  TIMELAPSE_FULL_BITRATE,
  TIMELAPSE_MIN_LONG_SIDE,
  TIMELAPSE_MIN_SHORT_SIDE,
  timelapseBitrate,
  timelapseOutputSize,
} from './timelapse-output';

const SHAPES = [16 / 9, 9 / 16, 4 / 3, 3 / 4, 1, 4 / 5, 16 / 10, 21 / 9, 32 / 9];

describe('timelapse resolution', () => {
  it('is full size at 100%', () => {
    expect(timelapseOutputSize(16 / 9, 100)).toEqual({ w: 1280, h: 720 });
    expect(timelapseOutputSize(9 / 16, 100)).toEqual({ w: 720, h: 1280 });
  });

  it('shrinks by the percentage', () => {
    expect(timelapseOutputSize(16 / 9, 75)).toEqual({ w: 960, h: 540 });
    expect(timelapseOutputSize(9 / 16, 75)).toEqual({ w: 540, h: 960 });
  });

  it('stops at 360 on the short side and 640 on the long', () => {
    expect(minTimelapseResolution(16 / 9)).toBe(50);
    expect(minTimelapseResolution(9 / 16)).toBe(50);
    expect(timelapseOutputSize(16 / 9, 10)).toEqual({ w: 640, h: 360 });
    // A square video's short side is long already: the long side is the one that stops it.
    expect(minTimelapseResolution(1)).toBe(50);
    // A very wide screen's short side reaches 360 sooner.
    expect(minTimelapseResolution(32 / 9)).toBe(100);
  });

  it('never makes a side under the floor, in any shape', () => {
    for (const r of SHAPES) {
      const { w, h } = timelapseOutputSize(r, 1);
      expect(Math.min(w, h)).toBeGreaterThanOrEqual(TIMELAPSE_MIN_SHORT_SIDE);
      expect(Math.max(w, h)).toBeGreaterThanOrEqual(TIMELAPSE_MIN_LONG_SIDE);
      expect(w % 2).toBe(0);
      expect(h % 2).toBe(0);
    }
  });

  it('goes down to a smaller camera, never below it', () => {
    const small = { w: 320, h: 240 };
    expect(minTimelapseResolution(16 / 9, small)).toBe(34);
    const { w, h } = timelapseOutputSize(16 / 9, 1, small);
    expect(w).toBeGreaterThanOrEqual(320);
    expect(h).toBeGreaterThanOrEqual(240);
    // An upright phone held the other way round is the same camera.
    expect(minTimelapseResolution(16 / 9, { w: 240, h: 320 })).toBe(34);
  });

  it('keeps the usual floor for a camera that records bigger', () => {
    expect(minTimelapseResolution(16 / 9, { w: 1920, h: 1080 })).toBe(50);
    expect(minTimelapseResolution(16 / 9, null)).toBe(50);
  });

  it('reads a stored percentage back within its range', () => {
    expect(clampTimelapseResolution(120, 16 / 9)).toBe(100);
    expect(clampTimelapseResolution(20, 16 / 9)).toBe(50);
    expect(clampTimelapseResolution(Number.NaN, 16 / 9)).toBe(100);
    expect(clampTimelapseResolution(66.6, 16 / 9)).toBe(67);
  });
});

describe('timelapseBitrate', () => {
  it('compresses a full-size video to the full rate', () => {
    expect(timelapseBitrate(1280, 720)).toBe(TIMELAPSE_FULL_BITRATE);
  });

  it('gives a smaller video less, but more for each pixel', () => {
    const half = timelapseBitrate(640, 360);
    expect(half).toBeLessThan(TIMELAPSE_FULL_BITRATE / 2);
    expect(half).toBeGreaterThan(TIMELAPSE_FULL_BITRATE / 4);
  });

  it('gives a higher frame rate a little more', () => {
    expect(timelapseBitrate(1280, 720, 60)).toBeGreaterThan(TIMELAPSE_FULL_BITRATE);
    expect(timelapseBitrate(1280, 720, 60)).toBeLessThan(TIMELAPSE_FULL_BITRATE * 2);
  });

  it('keeps a tiny video from turning to blocks', () => {
    expect(timelapseBitrate(64, 36)).toBe(300_000);
  });
});
