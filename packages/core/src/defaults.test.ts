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
