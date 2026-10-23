import { describe, expect, it } from 'vitest';
import { withDefaults } from './defaults';
import {
  CAMERA_BOX,
  TIMELAPSE_ELEMENT_LABELS,
  TIMELAPSE_ELEMENTS,
  alignBox,
  aspectRatio,
  canHideElement,
  clampBox,
  defaultTimelapseLayout,
  fitBoxToRatio,
  normalizeTimelapseLayout,
  videoSize,
} from './timelapse-layout';

describe('timelapse shape', () => {
  it('reads a ratio, and follows the camera or the screen once known', () => {
    expect(aspectRatio('16:9')).toBeCloseTo(16 / 9);
    expect(aspectRatio('9:16')).toBeCloseTo(9 / 16);
    expect(aspectRatio('camera', 4 / 3)).toBeCloseTo(4 / 3);
    expect(aspectRatio('camera', null)).toBeCloseTo(16 / 9);
    expect(aspectRatio('screen', 4 / 3, 16 / 10)).toBeCloseTo(1.6);
    expect(aspectRatio('screen', 4 / 3, null)).toBeCloseTo(16 / 9);
  });

  it('sizes the video with the long side fixed and even sides', () => {
    expect(videoSize(16 / 9)).toEqual({ w: 1280, h: 720 });
    expect(videoSize(9 / 16)).toEqual({ w: 720, h: 1280 });
    expect(videoSize(1)).toEqual({ w: 1280, h: 1280 });
    const odd = videoSize(4 / 3.01);
    expect(odd.w % 2).toBe(0);
    expect(odd.h % 2).toBe(0);
  });
});

describe('timelapse layout', () => {
  it('starts every shape inside the frame, camera full, screen waiting to be added', () => {
    for (const r of [16 / 9, 1, 4 / 5, 9 / 16]) {
      const l = defaultTimelapseLayout(r);
      expect(l.camera).toEqual(CAMERA_BOX);
      expect(l.screen.visible).toBe(false);
      for (const id of TIMELAPSE_ELEMENTS) {
        const b = l[id];
        expect(b.x + b.w).toBeLessThanOrEqual(1 + 1e-9);
        expect(b.y + b.h).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it("starts the screen's box at the screen's shape", () => {
    const l = defaultTimelapseLayout(16 / 9, 16 / 10);
    // Pixels: width × 16 over height × 9 is the screen's 1.6.
    expect((l.screen.w * 16) / (l.screen.h * 9)).toBeCloseTo(1.6);
  });

  it('fits a box to a shape, shrinking it to stay in the frame', () => {
    const b = fitBoxToRatio({ x: 0.5, y: 0.1, w: 0.4, h: 0.1, visible: true }, 16 / 9, 16 / 9);
    expect(b.h).toBeCloseTo(0.4);
    const tall = fitBoxToRatio({ x: 0.1, y: 0.1, w: 0.9, h: 0.1, visible: true }, 9 / 16, 0.2);
    expect(tall.h).toBeLessThanOrEqual(1);
    expect((tall.w * 9) / (tall.h * 16)).toBeCloseTo(0.2);
    expect(tall.y + tall.h).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('keeps a box inside the frame and no smaller than its piece allows', () => {
    expect(clampBox('screen', { x: 0.9, y: -0.2, w: 0.3, h: 0.001, visible: true })).toEqual({
      x: 0.7,
      y: 0,
      w: 0.3,
      h: 0.04,
      visible: true,
    });
    // The progress bar may be thin; the camera always fills the frame.
    expect(clampBox('progress', { x: 0, y: 0.99, w: 1, h: 0.01, visible: true }).h).toBe(0.01);
    expect(clampBox('camera', { x: 0.3, y: 0.3, w: 0.2, h: 0.2, visible: false })).toEqual(
      CAMERA_BOX,
    );
  });

  it('mends a stored layout: missing pieces, junk values, a moved camera, the mark', () => {
    const l = normalizeTimelapseLayout({
      camera: { x: 0.5, y: 0.5, w: 0.2, h: 0.2, visible: false },
      title: { x: 'left', y: 0.5, w: 0.4, h: 0.1, visible: true },
      watermark: { visible: false },
    });
    expect(l.camera).toEqual(CAMERA_BOX);
    expect(l.title.x).toBe(defaultTimelapseLayout().title.x);
    expect(l.title.y).toBe(0.5);
    expect(l.watermark.visible).toBe(true);
    expect(l.clock).toEqual(defaultTimelapseLayout().clock);
    expect(normalizeTimelapseLayout('nonsense')).toEqual(defaultTimelapseLayout());
  });

  it('never lets the camera or the mark be taken out', () => {
    expect(canHideElement('camera')).toBe(false);
    expect(canHideElement('watermark')).toBe(false);
    expect(canHideElement('screen')).toBe(true);
    expect(canHideElement('clock')).toBe(true);
  });
});

describe('timelapse layout in saved settings', () => {
  it('seeds the clocks from the old switches when a row has no layout yet', () => {
    const s = withDefaults({ timelapse: { showTimer: false, showClockTime: true } });
    expect(s.timelapse.layout.elapsed.visible).toBe(false);
    expect(s.timelapse.layout.clock.visible).toBe(true);
    expect(s.timelapse.aspect).toBe('camera');
  });

  it('keeps a saved layout over the old switches', () => {
    const layout = defaultTimelapseLayout();
    layout.elapsed.visible = true;
    layout.title.x = 0.2;
    const s = withDefaults({ timelapse: { showTimer: false, layout } });
    expect(s.timelapse.layout.elapsed.visible).toBe(true);
    expect(s.timelapse.layout.title.x).toBe(0.2);
  });
});

describe('lining pieces up', () => {
  const b = { x: 0.3, y: 0.5, w: 0.2, h: 0.1, visible: true };
  it('puts a box against the left, in the middle, or against the right', () => {
    expect(alignBox(b, 'left').x).toBeCloseTo(0.04);
    expect(alignBox(b, 'center').x).toBeCloseTo(0.4);
    expect(alignBox(b, 'right').x).toBeCloseTo(0.76);
    expect(alignBox(b, 'right').y).toBe(0.5);
  });
  it('lines a full-width piece up against the edge itself', () => {
    expect(alignBox({ ...b, w: 1 }, 'right').x).toBe(0);
  });
  it('keeps a text piece’s side through a save, and drops it from other pieces', () => {
    const l = normalizeTimelapseLayout({
      title: { x: 0.5, y: 0.7, w: 0.3, h: 0.08, visible: true, align: 'right' },
      screen: { x: 0.1, y: 0.1, w: 0.3, h: 0.2, visible: true, align: 'right' },
    });
    expect(l.title.align).toBe('right');
    expect(l.screen.align).toBeUndefined();
  });
});

describe('the time elapsed, start and end pieces', () => {
  it('wait out of the video until added, in every shape', () => {
    for (const ratio of [16 / 9, 1, 9 / 16]) {
      const l = defaultTimelapseLayout(ratio);
      for (const id of ['total', 'start', 'end'] as const) expect(l[id].visible).toBe(false);
    }
  });

  it('come back hidden on a layout saved before them', () => {
    const old = { ...defaultTimelapseLayout() } as Record<string, unknown>;
    delete old.total;
    delete old.start;
    delete old.end;
    const l = normalizeTimelapseLayout(old);
    expect([l.total.visible, l.start.visible, l.end.visible]).toEqual([false, false, false]);
  });

  it('are named plainly, the focus clock as focus', () => {
    expect(TIMELAPSE_ELEMENT_LABELS.elapsed).toBe('Focus time');
    expect(TIMELAPSE_ELEMENT_LABELS.total).toBe('Time elapsed');
    expect(TIMELAPSE_ELEMENT_LABELS.start).toBe('Start time');
    expect(TIMELAPSE_ELEMENT_LABELS.end).toBe('End time');
  });
});
