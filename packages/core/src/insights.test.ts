import { describe, expect, it } from 'vitest';
import { zonedTimeUtc } from './dates';
import { fmtDurationWord } from './highlights';
import {
  buildInsights,
  lifetimeStats,
  studyHeatmap,
  timeOfDayProfile,
  weekdayProfile,
} from './insights';
import type { Session } from './types';

const TZ = 'America/Toronto';
const NOW = '2026-09-21T14:00:00.000Z'; // Monday, 10:00 local

let seq = 0;
/** A completed session starting at a local wall-clock time on `date` in TZ. */
const session = (date: string, localHour: number, minutes: number): Session => {
  const startedAt = zonedTimeUtc(date, localHour, 0, TZ).toISOString();
  return {
    id: `s${seq++}`,
    userId: 'u1',
    nodeId: 'n1',
    routineId: null,
    routineDate: null,
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + minutes * 60_000).toISOString(),
    mode: 'pomodoro',
    plannedEndAt: null,
    workSeconds: minutes * 60,
    breakSeconds: 0,
    idleSeconds: 0,
    pomodoroConfigSnapshot: null,
    review: null,
    xpAwarded: 0,
    badgesAwarded: [],
  };
};

describe('lifetimeStats', () => {
  it('reports nothing gracefully for a new account', () => {
    const s = lifetimeStats({
      sessions: [],
      timezone: TZ,
      now: NOW,
      joinedAt: '2026-09-21T10:00:00.000Z',
    });
    expect(s).toMatchObject({
      totalMinutes: 0,
      totalSessions: 0,
      activeDays: 0,
      bestDay: null,
      daysSince: 1,
    });
    expect(s.headline).toContain('No focused work logged yet');
    expect(Number.isFinite(s.avgMinutesPerActiveDay)).toBe(true);
  });

  it('totals hours, days and the best day', () => {
    const s = lifetimeStats({
      sessions: [
        session('2026-09-14', 9, 60),
        session('2026-09-14', 14, 30),
        session('2026-09-18', 9, 120),
        session('2026-09-21', 9, 45),
      ],
      timezone: TZ,
      now: NOW,
      joinedAt: '2026-09-01T10:00:00.000Z',
    });
    expect(s.totalMinutes).toBe(255);
    expect(s.totalSessions).toBe(4);
    expect(s.activeDays).toBe(3);
    expect(s.bestDay).toEqual({ date: '2026-09-18', minutes: 120 });
    expect(s.longestSessionMinutes).toBe(120);
    expect(s.avgMinutesPerActiveDay).toBe(85);
    expect(s.headline).toContain('4.3 hours');
  });

  it('counts the join day, so daysSince is never zero', () => {
    const s = lifetimeStats({
      sessions: [],
      timezone: TZ,
      now: NOW,
      joinedAt: '2026-09-11T10:00:00.000Z',
    });
    expect(s.daysSince).toBe(11);
  });

  it('splits the last 28 days from the 28 before', () => {
    const s = lifetimeStats({
      sessions: [session('2026-09-20', 9, 60), session('2026-08-01', 9, 30)],
      timezone: TZ,
      now: NOW,
      joinedAt: '2026-06-01T10:00:00.000Z',
    });
    expect(s.last28Minutes).toBe(60);
    // The prior window is 2026-07-28 to 2026-08-24, which contains 2026-08-01.
    expect(s.prior28Minutes).toBe(30);
  });

  it('leaves anything older than both windows out', () => {
    const s = lifetimeStats({
      sessions: [session('2026-09-20', 9, 60), session('2026-07-01', 9, 30)],
      timezone: TZ,
      now: NOW,
      joinedAt: '2026-06-01T10:00:00.000Z',
    });
    expect(s.last28Minutes).toBe(60);
    expect(s.prior28Minutes).toBe(0);
    // It still counts toward the lifetime total.
    expect(s.totalMinutes).toBe(90);
  });
});

describe('studyHeatmap', () => {
  const sessions = [
    session('2026-09-21', 9, 120),
    session('2026-09-20', 9, 30),
    session('2026-09-19', 9, 60),
    session('2026-09-18', 9, 90),
  ];

  it('lays out whole Monday-first weeks ending with the current one', () => {
    const h = studyHeatmap({ sessions, timezone: TZ, now: NOW, weeks: 4 });
    expect(h.weeks).toHaveLength(4);
    expect(h.weeks.every((w) => w.length === 7)).toBe(true);
    expect(h.to).toBe('2026-09-27');
    expect(h.from).toBe('2026-08-31');
    // The final column starts on the Monday that is today.
    expect(h.weeks[3]![0]!.date).toBe('2026-09-21');
  });

  it('marks days after today as future, not as empty study days', () => {
    const h = studyHeatmap({ sessions, timezone: TZ, now: NOW, weeks: 2 });
    const last = h.weeks[h.weeks.length - 1]!;
    expect(last[0]).toMatchObject({ date: '2026-09-21', future: false });
    expect(last[1]).toMatchObject({ date: '2026-09-22', future: true });
    expect(last[6]).toMatchObject({ date: '2026-09-27', future: true });
  });

  it('ramps levels off the quartiles of studied days only', () => {
    const h = studyHeatmap({ sessions, timezone: TZ, now: NOW, weeks: 4 });
    const at = (d: string) => h.weeks.flat().find((c) => c.date === d)!;
    expect(at('2026-09-17').level).toBe(0); // no session
    expect(at('2026-09-20').level).toBe(1); // 30 min, the smallest
    expect(at('2026-09-21').level).toBe(4); // 120 min, the largest
    expect(at('2026-09-20').level).toBeLessThan(at('2026-09-21').level);
  });

  it('totals the window and finds the longest unbroken run', () => {
    const h = studyHeatmap({ sessions, timezone: TZ, now: NOW, weeks: 4 });
    expect(h.totalMinutes).toBe(300);
    expect(h.activeDays).toBe(4);
    expect(h.longestRun).toBe(4); // 18th to 21st
  });

  it('labels the first column of each month', () => {
    const h = studyHeatmap({ sessions: [], timezone: TZ, now: NOW, weeks: 8 });
    expect(h.monthLabels.length).toBeGreaterThan(0);
    expect(h.monthLabels[0]!.column).toBe(0);
    expect(h.monthLabels.map((m) => m.label)).toContain('Sep');
  });

  it('survives an empty history', () => {
    const h = studyHeatmap({ sessions: [], timezone: TZ, now: NOW, weeks: 4 });
    expect(h.totalMinutes).toBe(0);
    expect(h.activeDays).toBe(0);
    expect(h.longestRun).toBe(0);
    expect(h.weeks.flat().every((c) => c.level === 0)).toBe(true);
  });

  it('clamps an absurd range', () => {
    expect(studyHeatmap({ sessions: [], timezone: TZ, now: NOW, weeks: 9999 }).weeks).toHaveLength(
      106,
    );
  });
});

describe('rhythm profiles', () => {
  it('buckets minutes by time of day and finds the peak', () => {
    const p = timeOfDayProfile(
      [session('2026-09-21', 9, 60), session('2026-09-20', 10, 30), session('2026-09-19', 22, 20)],
      TZ,
    );
    expect(p.totalMinutes).toBe(110);
    expect(p.peak?.label).toBe('Morning (9-12)');
    expect(p.buckets.find((b) => b.label === 'Night (21-5)')?.minutes).toBe(20);
    expect(p.buckets.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1);
  });

  it('buckets minutes by weekday, Monday first', () => {
    const p = weekdayProfile([session('2026-09-21', 9, 60), session('2026-09-19', 9, 30)], TZ);
    expect(p.buckets[0]!.label).toBe('Monday');
    expect(p.buckets[6]!.label).toBe('Sunday');
    expect(p.peak?.label).toBe('Monday');
    expect(p.buckets.find((b) => b.label === 'Saturday')?.minutes).toBe(30);
  });

  it('has no peak and no NaN shares when there is nothing logged', () => {
    const p = weekdayProfile([], TZ);
    expect(p.peak).toBeNull();
    expect(p.buckets.every((b) => b.share === 0)).toBe(true);
  });
});

describe('buildInsights', () => {
  const build = (sessions: Session[], joinedAt = '2026-06-01T10:00:00.000Z') => {
    const lifetime = lifetimeStats({ sessions, timezone: TZ, now: NOW, joinedAt });
    const heatmap = studyHeatmap({ sessions, timezone: TZ, now: NOW, weeks: 53 });
    return buildInsights({
      lifetime,
      heatmap,
      timeOfDay: timeOfDayProfile(sessions, TZ),
      weekday: weekdayProfile(sessions, TZ),
      sessions,
      timezone: TZ,
    });
  };

  it('says nothing at all without history', () => {
    expect(build([])).toEqual([]);
  });

  it('always leads with the lifetime total', () => {
    const insights = build([session('2026-09-20', 9, 60)]);
    expect(insights[0]!.key).toBe('lifetime');
    expect(insights[0]!.headline).toContain('since you started using Doloop');
    expect(insights[0]!.evidence).toContain('1 session');
  });

  it('gives every insight a headline and its evidence', () => {
    const insights = build([session('2026-09-20', 9, 60), session('2026-09-19', 9, 30)]);
    expect(insights.every((i) => i.headline.length > 0 && i.evidence.length > 0)).toBe(true);
  });

  it('reads a rise in workload as momentum', () => {
    const sessions = [
      ...Array.from({ length: 4 }, (_, i) => session(`2026-09-${14 + i}`, 9, 120)),
      session('2026-08-10', 9, 30),
    ];
    const momentum = build(sessions).find((i) => i.key === 'momentum');
    expect(momentum?.tone).toBe('good');
    expect(momentum?.headline).toContain('more than');
  });

  it('reads a fall as something to watch, not a telling-off', () => {
    const sessions = [
      session('2026-09-20', 9, 30),
      ...Array.from({ length: 4 }, (_, i) => session(`2026-08-${10 + i}`, 9, 120)),
    ];
    const momentum = build(sessions).find((i) => i.key === 'momentum');
    expect(momentum?.tone).toBe('watch');
    expect(momentum?.headline).toContain('less than');
    expect(momentum?.headline).not.toMatch(/should|must|need to/i);
  });

  it('only claims a time-of-day preference when it is pronounced', () => {
    // Spread evenly across bands: no band clears the 35% share bar.
    const spread = [
      session('2026-09-14', 6, 60),
      session('2026-09-15', 10, 60),
      session('2026-09-16', 14, 60),
      session('2026-09-17', 18, 60),
      session('2026-09-18', 22, 60),
    ];
    expect(build(spread).find((i) => i.key === 'time-of-day')).toBeUndefined();

    const concentrated = Array.from({ length: 5 }, (_, i) => session(`2026-09-${14 + i}`, 9, 60));
    expect(build(concentrated).find((i) => i.key === 'time-of-day')).toBeDefined();
  });

  it('reports the longest run only once there is one worth naming', () => {
    expect(
      build([session('2026-09-20', 9, 60)]).find((i) => i.key === 'longest-run'),
    ).toBeUndefined();
    const run = build([
      session('2026-09-18', 9, 60),
      session('2026-09-19', 9, 60),
      session('2026-09-20', 9, 60),
    ]).find((i) => i.key === 'longest-run');
    expect(run?.headline).toContain('3 days');
  });

  it('holds back the cadence line until there is a fortnight to judge', () => {
    const fresh = build([session('2026-09-20', 9, 60)], '2026-09-18T10:00:00.000Z');
    expect(fresh.find((i) => i.key === 'cadence')).toBeUndefined();
    const older = build([session('2026-09-20', 9, 60)], '2026-06-01T10:00:00.000Z');
    expect(older.find((i) => i.key === 'cadence')?.evidence).toContain('Rest days count');
  });
});

describe('fmtDurationWord', () => {
  it('reads short histories in minutes rather than "0 hours"', () => {
    expect(fmtDurationWord(0.35)).toBe('1 minute');
    expect(fmtDurationWord(20)).toBe('20 minutes');
    expect(fmtDurationWord(59)).toBe('59 minutes');
  });

  it('switches to hours at an hour', () => {
    expect(fmtDurationWord(60)).toBe('1 hour');
    expect(fmtDurationWord(255)).toBe('4.3 hours');
  });

  it('says nothing odd for zero', () => {
    expect(fmtDurationWord(0)).toBe('0 hours');
  });
});
