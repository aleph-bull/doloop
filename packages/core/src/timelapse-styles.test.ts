import { describe, expect, it } from 'vitest';
import { withDefaults } from './defaults';
import { defaultTimelapseLayout, normalizeTimelapseLayout } from './timelapse-layout';
import {
  applyTimelapseStyle,
  cleanEndText,
  endCardFrames,
  matchTimelapseStyle,
  TIMELAPSE_END_TEXT_MAX,
  TIMELAPSE_STYLES,
} from './timelapse-styles';

const SHAPES = [16 / 9, 4 / 3, 1, 4 / 5, 9 / 16];

describe('timelapse looks', () => {
  it('starts out in Classic, the default layout, in every shape', () => {
    for (const r of SHAPES)
      expect(matchTimelapseStyle(defaultTimelapseLayout(r), r)).toBe('classic');
  });

  it('reads each look back as itself, and as no other', () => {
    for (const r of SHAPES)
      for (const s of TIMELAPSE_STYLES) {
        const layout = applyTimelapseStyle(s.id, r, defaultTimelapseLayout(r));
        expect(matchTimelapseStyle(layout, r)).toBe(s.id);
      }
  });

  it('keeps every piece inside the frame, and survives being saved and read back', () => {
    for (const r of SHAPES)
      for (const s of TIMELAPSE_STYLES) {
        const layout = applyTimelapseStyle(s.id, r, defaultTimelapseLayout(r));
        for (const b of Object.values(layout)) {
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.y).toBeGreaterThanOrEqual(0);
          expect(b.x + b.w).toBeLessThanOrEqual(1 + 1e-9);
          expect(b.y + b.h).toBeLessThanOrEqual(1 + 1e-9);
        }
        expect(matchTimelapseStyle(normalizeTimelapseLayout(layout), r)).toBe(s.id);
      }
  });

  it('leaves the screen where it was, shown or not', () => {
    const current = defaultTimelapseLayout(16 / 9);
    current.screen = { x: 0.1, y: 0.2, w: 0.3, h: 0.3, visible: true };
    const big = applyTimelapseStyle('big-timer', 16 / 9, current);
    expect(big.screen).toEqual(current.screen);
    expect(big.camera).toEqual(current.camera);
  });

  it('always keeps the mark', () => {
    for (const s of TIMELAPSE_STYLES)
      expect(applyTimelapseStyle(s.id, 1, defaultTimelapseLayout(1)).watermark.visible).toBe(true);
  });

  it('still knows a look once a text piece is stored where it was drawn', () => {
    const r = 16 / 9;
    const layout = applyTimelapseStyle('big-timer', r, defaultTimelapseLayout(r));
    // Saved: the centred timer's box shrinks to its pill, around the same middle.
    const e = layout.elapsed;
    const mid = e.x + e.w / 2;
    layout.elapsed = { ...e, x: mid - 0.1, w: 0.2 };
    expect(matchTimelapseStyle(layout, r)).toBe('big-timer');
  });

  it('calls a layout arranged by hand no look at all', () => {
    const layout = defaultTimelapseLayout(16 / 9);
    layout.clock = { ...layout.clock, y: layout.clock.y + 0.1 };
    expect(matchTimelapseStyle(layout, 16 / 9)).toBeNull();
  });
});

describe('the words at the end', () => {
  it('are one line, trimmed and cut to length', () => {
    expect(cleanEndText('  Day 12\n of   finals ')).toBe('Day 12 of finals');
    expect(cleanEndText('x'.repeat(400))).toHaveLength(TIMELAPSE_END_TEXT_MAX);
    expect(cleanEndText(42)).toBe('');
    expect(cleanEndText(undefined)).toBe('');
  });

  it('add a card only when there is something to say', () => {
    expect(endCardFrames('', 30)).toBe(0);
    expect(endCardFrames('   ', 30)).toBe(0);
    expect(endCardFrames(undefined, 30)).toBe(0);
    expect(endCardFrames('Done for today', 30)).toBe(90);
    expect(endCardFrames('Done for today', 1)).toBe(3);
  });

  it('start empty on both presets and come back clean', () => {
    const fresh = withDefaults({});
    expect(fresh.timelapse.endText).toBe('');
    expect(fresh.timelapsePhone.endText).toBe('');
    const saved = withDefaults({
      timelapse: { endText: '  Week 3 ' },
      timelapsePhone: { endText: 7 as unknown as string },
    });
    expect(saved.timelapse.endText).toBe('Week 3');
    expect(saved.timelapsePhone.endText).toBe('');
  });
});
