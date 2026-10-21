import { describe, expect, it } from 'vitest';
import { emptyRestDayPolicy } from './rest-days';
import {
  describeStreakEvents,
  emptyStreak,
  evaluateStreak,
  isStreakMilestone,
  qualifyingDays,
  type EvaluateStreakInput,
} from './streak';
import type { Session, StreakState } from './types';

const TZ = 'America/Toronto';
let seq = 0;
const s = (startedAt: string, workMinutes: number, over: Partial<Session> = {}): Session => ({
  id: `s${++seq}`,
  userId: 'u',
  nodeId: 'n',
  routineId: null,
  routineDate: null,
  startedAt,
  endedAt: startedAt,
  mode: 'unlimited',
  plannedEndAt: null,
  workSeconds: workMinutes * 60,
  breakSeconds: 0,
  idleSeconds: 0,
  pomodoroConfigSnapshot: null,
  review: null,
  xpAwarded: 0,
  badgesAwarded: [],
  sleeps: [],
  ...over,
});
const noon = (d: string) => `${d}T16:00:00.000Z`; // EDT noon

const run = (over: Partial<EvaluateStreakInput>) =>
  evaluateStreak({
    state: emptyStreak(),
    sessions: [],
    policy: emptyRestDayPolicy('u'),
    minMinutes: 15,
    today: '2026-09-20',
    timezone: TZ,
    ...over,
  });

describe('qualifyingDays', () => {
  it('credits a session to the local day it started, honouring the minimum', () => {
    const days = qualifyingDays(
      [
        s('2026-09-21T03:30:00.000Z', 20), // 23:30 Sep 20 local, runs past midnight
        s(noon('2026-09-18'), 10), // too short
        s(noon('2026-09-17'), 15, { endedAt: null }), // in progress
      ],
      15,
      TZ,
    );
    expect([...days]).toEqual(['2026-09-20']);
  });

  it('treats zero minimum as needing any positive work', () => {
    expect(qualifyingDays([s(noon('2026-09-18'), 0)], 0, TZ).size).toBe(0);
    expect(qualifyingDays([s(noon('2026-09-18'), 1)], 0, TZ).size).toBe(1);
  });
});

describe('evaluateStreak', () => {
  it('does nothing with no sessions', () => {
    const r = run({});
    expect(r.state).toEqual(emptyStreak());
    expect(r.events).toEqual([]);
  });

  it('counts consecutive days and records the longest', () => {
    const r = run({
      sessions: [s(noon('2026-09-18'), 20), s(noon('2026-09-19'), 20), s(noon('2026-09-20'), 20)],
    });
    expect(r.state.current).toBe(3);
    expect(r.state.longest).toBe(3);
    expect(r.state.lastCountedDate).toBe('2026-09-20');
    expect(r.events.map((e) => e.type)).toEqual(['counted', 'counted', 'counted']);
  });

  it('leaves a quiet today open instead of resetting', () => {
    const r = run({ sessions: [s(noon('2026-09-19'), 20)] });
    expect(r.state.current).toBe(1);
    expect(r.state.lastCountedDate).toBe('2026-09-19');
  });

  it('resets on a missed study day without freezes', () => {
    const r = run({ sessions: [s(noon('2026-09-17'), 20), s(noon('2026-09-19'), 20)] });
    expect(r.state.current).toBe(1);
    expect(r.state.longest).toBe(1);
    expect(r.events.map((e) => e.type)).toEqual(['counted', 'reset', 'counted']);
    expect(describeStreakEvents(r.events)).toMatch(/Your streak ended/);
  });

  it('skips rest days, vacations, and break days without breaking the streak', () => {
    const policy = {
      ...emptyRestDayPolicy('u'),
      weeklyRestDays: [0, 6], // Sat 19, Sun 20
      vacations: [{ from: '2026-09-16', to: '2026-09-17', label: 'x' }],
      breakDays: ['2026-09-14'],
    };
    const r = run({
      policy,
      sessions: [
        s(noon('2026-09-13'), 20), // Sun 13 is a weekly rest day but studying still counts
        s(noon('2026-09-15'), 20),
        s(noon('2026-09-18'), 20),
      ],
      today: '2026-09-20',
    });
    expect(r.state.current).toBe(3);
    expect(r.events.map((e) => `${e.type}:${e.date}`)).toEqual([
      'counted:2026-09-13',
      'rest:2026-09-14',
      'counted:2026-09-15',
      'rest:2026-09-16',
      'rest:2026-09-17',
      'counted:2026-09-18',
      'rest:2026-09-19',
    ]);
    expect(describeStreakEvents(r.events)).toBeNull();
  });

  it('consumes a freeze automatically on a missed day and tells the user', () => {
    const state: StreakState = { ...emptyStreak(), freezesHeld: 2 };
    const r = run({ state, sessions: [s(noon('2026-09-17'), 20), s(noon('2026-09-19'), 20)] });
    expect(r.state.current).toBe(2);
    expect(r.state.freezesHeld).toBe(1);
    expect(r.events.map((e) => e.type)).toEqual(['counted', 'freeze-used', 'counted']);
    expect(describeStreakEvents(r.events)).toMatch(/freeze covered your streak/);
  });

  it('describes multiple freezes', () => {
    const state: StreakState = { ...emptyStreak(), freezesHeld: 2 };
    const r = run({ state, sessions: [s(noon('2026-09-16'), 20), s(noon('2026-09-19'), 20)] });
    expect(r.state.current).toBe(2);
    expect(r.state.freezesHeld).toBe(0);
    expect(describeStreakEvents(r.events)).toMatch(/freezes covered your streak/);
  });

  it('does not spend a freeze when there is no streak to protect', () => {
    const state: StreakState = { ...emptyStreak(), freezesHeld: 1, lastCountedDate: '2026-09-15' };
    const r = run({ state, sessions: [s(noon('2026-09-19'), 20)] });
    expect(r.state.freezesHeld).toBe(1);
    expect(r.state.current).toBe(1);
    expect(r.events.map((e) => e.type)).toEqual(['counted']);
  });

  it('is idempotent when re-run on the same day', () => {
    const state: StreakState = { ...emptyStreak(), freezesHeld: 1 };
    const sessions = [s(noon('2026-09-17'), 20), s(noon('2026-09-19'), 20)];
    const first = run({ state, sessions });
    const second = run({ state: first.state, sessions });
    expect(second.state).toEqual(first.state);
    expect(second.events).toEqual([]);
  });

  it('continues correctly on later days', () => {
    const sessions = [s(noon('2026-09-18'), 20), s(noon('2026-09-19'), 20)];
    const day1 = run({ sessions, today: '2026-09-19' });
    expect(day1.state.current).toBe(2);
    const day2 = run({
      state: day1.state,
      sessions: [...sessions, s(noon('2026-09-20'), 20)],
      today: '2026-09-20',
    });
    expect(day2.state.current).toBe(3);
    expect(day2.events).toEqual([{ type: 'counted', date: '2026-09-20' }]);
  });

  it('reports milestones crossed', () => {
    const sessions = Array.from({ length: 7 }, (_, i) =>
      s(noon(`2026-09-${String(14 + i).padStart(2, '0')}`), 20),
    );
    const r = run({ sessions });
    expect(r.state.current).toBe(7);
    expect(r.milestonesReached).toEqual([7]);
    expect(isStreakMilestone(7)).toBe(true);
    expect(isStreakMilestone(8)).toBe(false);
  });

  it('handles a session spanning midnight on a DST day in the user timezone', () => {
    // Nov 1 2026 is fall-back in Toronto. 23:30 local Oct 31 = 03:30Z Nov 1 (EDT).
    const r = run({
      sessions: [s('2026-11-01T03:30:00.000Z', 30), s('2026-11-01T17:00:00.000Z', 30)],
      today: '2026-11-01',
    });
    expect(r.state.current).toBe(2);
    expect(r.events.map((e) => e.date)).toEqual(['2026-10-31', '2026-11-01']);
  });
});

describe('the streak day start', () => {
  it('counts a session before the start hour for the day before', async () => {
    const { streakDay } = await import('./streak');
    // 1:30am in Toronto on Sep 21 (EDT, UTC-4).
    expect(streakDay('2026-09-21T05:30:00.000Z', 'America/Toronto', 4)).toBe('2026-09-20');
    expect(streakDay('2026-09-21T05:30:00.000Z', 'America/Toronto', 0)).toBe('2026-09-21');
    // 4:30am is the new day.
    expect(streakDay('2026-09-21T08:30:00.000Z', 'America/Toronto', 4)).toBe('2026-09-21');
  });

  it('holds a change for a day', async () => {
    const { dayStartUnlocksAt } = await import('./streak');
    expect(dayStartUnlocksAt(null, '2026-09-21T12:00:00.000Z')).toBeNull();
    expect(dayStartUnlocksAt('2026-09-21T10:00:00.000Z', '2026-09-21T12:00:00.000Z')).toBe(
      '2026-09-22T10:00:00.000Z',
    );
    expect(dayStartUnlocksAt('2026-09-20T10:00:00.000Z', '2026-09-21T12:00:00.000Z')).toBeNull();
  });
});
