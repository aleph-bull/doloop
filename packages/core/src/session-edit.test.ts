import { describe, expect, it } from 'vitest';
import {
  answerSleep,
  logSleep,
  pendingSleep,
  scaledXp,
  SLEEP_MIN_MS,
  trimByWall,
  trimFocus,
  type TrimInput,
} from './session-edit';

const H = 3600;
const at = (iso: string, plusSeconds: number) =>
  new Date(Date.parse(iso) + plusSeconds * 1000).toISOString();

// The session that prompted this: 5 h 30 m focused, 2 h 38 m of breaks, left running.
const START = '2026-09-27T12:00:00.000Z';
const forgotten: TrimInput = {
  startedAt: START,
  endedAt: at(START, 5.5 * H + 158 * 60),
  workSeconds: 5.5 * H,
  breakSeconds: 158 * 60,
  xpAwarded: 728,
};

describe('trimFocus', () => {
  it('takes focus off the end with the breaks that ran beside it', () => {
    const r = trimFocus(forgotten, 4 * H)!;
    expect(r.workSeconds).toBe(1.5 * H);
    expect(r.removedWorkSeconds).toBe(4 * H);
    // The tail ran at the session's own mix: 330 focus to 158 break.
    expect(r.removedBreakSeconds).toBeGreaterThan(110 * 60);
    expect(r.breakSeconds).toBe(158 * 60 - r.removedBreakSeconds);
    expect(r.removedWallSeconds).toBe(r.removedWorkSeconds + r.removedBreakSeconds);
    expect(Date.parse(r.endedAt)).toBe(Date.parse(forgotten.endedAt) - r.removedWallSeconds * 1000);
    // XP follows the minutes: 728 × 90 / 330.
    expect(r.xpAwarded).toBe(198);
    expect(r.xpRemoved).toBe(530);
  });

  it('moves the end back one for one on a session with no breaks', () => {
    const plain: TrimInput = {
      startedAt: START,
      endedAt: at(START, 3 * H),
      workSeconds: 3 * H,
      breakSeconds: 0,
      xpAwarded: 360,
    };
    const r = trimFocus(plain, H)!;
    expect(r.endedAt).toBe(at(START, 2 * H));
    expect(r.workSeconds).toBe(2 * H);
    expect(r.xpAwarded).toBe(240);
  });

  it('always leaves a minute, and does nothing for nothing', () => {
    const r = trimFocus(forgotten, 99 * H)!;
    expect(r.workSeconds).toBe(60);
    expect(Date.parse(r.endedAt)).toBeGreaterThan(Date.parse(START));
    expect(trimFocus(forgotten, 0)).toBeNull();
    expect(trimFocus({ ...forgotten, workSeconds: 60, endedAt: at(START, 60) }, 30)).toBeNull();
  });
});

describe('trimByWall', () => {
  it('ends the session earlier and splits the time at the session mix', () => {
    const plain: TrimInput = {
      startedAt: START,
      endedAt: at(START, 4 * H),
      workSeconds: 3 * H,
      breakSeconds: H,
      xpAwarded: 400,
    };
    const r = trimByWall(plain, 2 * H)!;
    expect(r.endedAt).toBe(at(START, 2 * H));
    expect(r.removedWorkSeconds).toBe(1.5 * H);
    expect(r.removedBreakSeconds).toBe(0.5 * H);
    expect(r.xpAwarded).toBe(200);
    expect(trimByWall(plain, 0)).toBeNull();
  });
});

describe('scaledXp', () => {
  it('scales by whole minutes and never adds', () => {
    expect(scaledXp(100, 600, 300)).toBe(50);
    expect(scaledXp(100, 600, 900)).toBe(100);
    expect(scaledXp(100, 600, 30)).toBe(0);
    expect(scaledXp(100, 30, 20)).toBe(0);
  });
});

describe('sleep log', () => {
  const t0 = '2026-09-27T03:00:00.000Z';
  const t = (m: number) => at(t0, m * 60);

  it('logs a sleep of ten minutes or more, and ignores a shorter gap', () => {
    expect(SLEEP_MIN_MS).toBe(600_000);
    expect(logSleep([], { from: t(0), to: t(9) })).toEqual([]);
    expect(logSleep([], { from: t(0), to: t(40) })).toEqual([
      { from: t(0), to: t(40), answer: null },
    ]);
  });

  it('merges two tabs waking to the same sleep, and leaves an answered one alone', () => {
    const one = logSleep([], { from: t(0), to: t(40) });
    const two = logSleep(one, { from: t(0), to: t(41) });
    expect(two).toEqual([{ from: t(0), to: t(41), answer: null }]);
    const answered = answerSleep(two, t(0), 'kept');
    expect(pendingSleep(answered)).toBeNull();
    expect(logSleep(answered, { from: t(1), to: t(41) })).toEqual(answered);
    const later = logSleep(answered, { from: t(100), to: t(200) });
    expect(later).toHaveLength(2);
    expect(pendingSleep(later)?.from).toBe(t(100));
    expect(pendingSleep(null)).toBeNull();
  });
});
