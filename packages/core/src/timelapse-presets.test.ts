import { describe, expect, it } from 'vitest';
import { withDefaults } from './defaults';
import {
  orientRatio,
  phoneAspectRatio,
  PHONE_SIDEWAYS_ASPECTS,
  PHONE_UPRIGHT_ASPECTS,
  timelapseLook,
} from './timelapse-presets';

describe('phone timelapse shapes', () => {
  it('turns the camera the way the phone is held', () => {
    expect(orientRatio(16 / 9, 'upright')).toBeCloseTo(9 / 16);
    expect(orientRatio(9 / 16, 'upright')).toBeCloseTo(9 / 16);
    expect(orientRatio(3 / 4, 'sideways')).toBeCloseTo(4 / 3);
    // Not seen yet: a phone camera's usual 16:9, turned.
    expect(orientRatio(null, 'upright')).toBeCloseTo(9 / 16);
    expect(orientRatio(null, 'sideways')).toBeCloseTo(16 / 9);
  });

  it('reads a fixed shape as it is and the camera turned', () => {
    expect(phoneAspectRatio('4:5', 'upright', 16 / 9)).toBeCloseTo(0.8);
    expect(phoneAspectRatio('camera', 'upright', 4 / 3)).toBeCloseTo(3 / 4);
    expect(phoneAspectRatio('camera', 'sideways', 3 / 4)).toBeCloseTo(4 / 3);
  });

  it('offers only shapes that suit each way of holding the phone', () => {
    expect(PHONE_UPRIGHT_ASPECTS.every((a) => phoneAspectRatio(a, 'upright') <= 1)).toBe(true);
    expect(PHONE_SIDEWAYS_ASPECTS.every((a) => phoneAspectRatio(a, 'sideways') >= 1)).toBe(true);
  });
});

describe('phone timelapse preset', () => {
  it('starts with a tall layout upright, a wide one sideways, and no screen', () => {
    const p = withDefaults({}).timelapsePhone;
    expect(p.aspect).toBe('camera');
    expect(p.sidewaysAspect).toBe('camera');
    // The tall default puts the task name above the elapsed clock, near the bottom.
    expect(p.layout.title.y).toBeGreaterThan(0.7);
    expect(p.sidewaysLayout.title.align).toBe('right');
    expect(p.layout.screen.visible).toBe(false);
    expect(p.sidewaysLayout.screen.visible).toBe(false);
  });

  it('keeps its own settings apart from the computer’s', () => {
    const s = withDefaults({ timelapsePhone: { fps: 24, recordBreaks: true } });
    expect(s.timelapsePhone.fps).toBe(24);
    expect(s.timelapsePhone.recordBreaks).toBe(true);
    expect(s.timelapse.fps).toBe(30);
    expect(s.timelapse.recordBreaks).toBe(false);
  });

  it('mends a stored phone preset: a screen put in, a shape that doesn’t fit', () => {
    const s = withDefaults({
      timelapsePhone: {
        aspect: '16:9',
        sidewaysAspect: '9:16',
        layout: { screen: { x: 0, y: 0, w: 0.5, h: 0.5, visible: true } },
      },
    });
    expect(s.timelapsePhone.aspect).toBe('camera');
    expect(s.timelapsePhone.sidewaysAspect).toBe('camera');
    expect(s.timelapsePhone.layout.screen.visible).toBe(false);
    expect(s.timelapsePhone.layout.watermark.visible).toBe(true);
  });

  it('asks horizontal or vertical until an answer is remembered', () => {
    expect(withDefaults({}).timelapsePhone.orientation).toBe('ask');
    expect(
      withDefaults({ timelapsePhone: { orientation: 'sideways' } }).timelapsePhone.orientation,
    ).toBe('sideways');
    const odd = { timelapsePhone: { orientation: 'diagonal' } } as unknown as Parameters<
      typeof withDefaults
    >[0];
    expect(withDefaults(odd).timelapsePhone.orientation).toBe('ask');
  });

  it('gives a recording the look of its device and of how the phone started', () => {
    const s = withDefaults({ timelapsePhone: { sidewaysAspect: '4:3' } });
    expect(timelapseLook(s, 'computer')).toBe(s.timelapse);
    expect(timelapseLook(s, 'phone', 'upright').layout).toBe(s.timelapsePhone.layout);
    const sideways = timelapseLook(s, 'phone', 'sideways');
    expect(sideways.aspect).toBe('4:3');
    expect(sideways.layout).toBe(s.timelapsePhone.sidewaysLayout);
    expect(sideways.fps).toBe(s.timelapsePhone.fps);
  });
});
