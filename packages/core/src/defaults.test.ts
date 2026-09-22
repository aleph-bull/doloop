import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, withDefaults } from './defaults';

describe('withDefaults', () => {
  it('returns a fresh copy of the defaults when given nothing', () => {
    const a = withDefaults(null);
    const b = withDefaults(undefined);
    expect(a).toEqual(DEFAULT_SETTINGS);
    expect(a).not.toBe(DEFAULT_SETTINGS);
    expect(b).toEqual(DEFAULT_SETTINGS);
  });

  it('merges nested partials without dropping sibling keys', () => {
    const s = withDefaults({ pomodoro: { workMin: 50 } });
    expect(s.pomodoro.workMin).toBe(50);
    expect(s.pomodoro.shortBreakMin).toBe(5);
    expect(s.review.mode).toBe('quick');
  });

  it('does not mutate the shared defaults', () => {
    const s = withDefaults({ blocking: { enabled: true, domains: ['x.com'] } });
    s.blocking.domains.push('y.com');
    expect(DEFAULT_SETTINGS.blocking.domains).toEqual([]);
  });
});

describe('withDefaults list repair', () => {
  it('reads a list that was stored as an object back as a list', () => {
    // An older writer spread an array into an object, persisting {"0": "xp"}.
    const s = withDefaults({ dismissed: { 0: 'xp', 1: 'calendar' } } as never);
    expect(s.dismissed).toEqual(['xp', 'calendar']);
  });

  it('falls back to the default scale when grading.scale is not a list', () => {
    const s = withDefaults({ grading: { scale: null } } as never);
    expect(s.grading.scale[0]).toMatchObject({ letter: 'A+', points: 4 });
  });

  it('leaves real lists alone', () => {
    const s = withDefaults({ dismissed: ['xp'], blocking: { domains: ['x.com'] } });
    expect(s.dismissed).toEqual(['xp']);
    expect(s.blocking.domains).toEqual(['x.com']);
  });
});
