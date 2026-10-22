import { describe, expect, it } from 'vitest';
import {
  consistency,
  cumulativeHours,
  dailyBySubject,
  dashboardStats,
  focusQuality,
  hoursForecast,
  nextStreakMilestone,
  personalRecords,
  planKept,
  rangeRecap,
  recapSummary,
  sessionHistogram,
  studyPersonality,
  studyVsGrades,
  subjectBreakdown,
  timeOfDayClock,
} from './recap';
import type { PlannedBlock, Session, StreakState, StudyNode } from './types';

const TZ = 'America/Toronto';
// Wednesday 2026-09-23, 18:00 Toronto.
const NOW = '2026-09-23T22:00:00.000Z';

let seq = 0;
/** A finished session starting at a Toronto wall-clock time, `minutes` long. */
function session(localStart: string, minutes: number, over: Partial<Session> = {}): Session {
  seq++;
  // Toronto is UTC-4 in September.
  const start = new Date(`${localStart}:00.000-04:00`);
  return {
    id: `s${seq}`,
    userId: 'u',
    nodeId: null,
    routineId: null,
    routineDate: null,
    startedAt: start.toISOString(),
    endedAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
    mode: 'unlimited',
    plannedEndAt: null,
    workSeconds: minutes * 60,
    breakSeconds: 0,
    idleSeconds: 0,
    pomodoroConfigSnapshot: null,
    review: null,
    xpAwarded: 0,
    badgesAwarded: [],
    sleeps: [],
    ...over,
  };
}

function node(id: string, over: Partial<StudyNode> = {}): StudyNode {
  return {
    id,
    userId: 'u',
    parentId: null,
    title: id,
    kind: 'task',
    estimatedMinutes: null,
    dueAt: null,
    completedAt: null,
    sortOrder: 0,
    color: null,
    archived: false,
    countUnit: null,
    countUnitLabel: null,
    outcomeRating: null,
    gradeMode: null,
    gradeOverall: null,
    gradeCredits: null,
    childDefaults: null,
    ...over,
  };
}

const streak = (current: number, longest = current, last: string | null = null): StreakState => ({
  current,
  longest,
  lastCountedDate: last,
  freezesHeld: 0,
  breakDaysHeld: 0,
});

describe('rangeRecap', () => {
  it('sums the week, marks the best day and today, and compares to last week', () => {
    const ss = [
      // Last week: 2 h.
      session('2026-09-15T10:00', 60),
      session('2026-09-17T10:00', 60),
      // This week: 3 h, Tuesday the biggest.
      session('2026-09-21T10:00', 30),
      session('2026-09-22T10:00', 120),
      session('2026-09-23T09:00', 30),
    ];
    const r = rangeRecap({ sessions: ss, timezone: TZ, now: NOW, range: 'week', goalMinutes: 300 });
    expect(r.from).toBe('2026-09-21');
    expect(r.to).toBe('2026-09-27');
    expect(r.minutes).toBe(180);
    expect(r.sessions).toBe(3);
    expect(r.activeDays).toBe(3);
    expect(r.previousMinutes).toBe(120);
    expect(r.change).toBeCloseTo(0.5);
    expect(r.bestDay).toEqual({ date: '2026-09-22', minutes: 120 });
    expect(r.byDay.find((d) => d.best)?.date).toBe('2026-09-22');
    expect(r.byDay.find((d) => d.today)?.date).toBe('2026-09-23');
    expect(r.byDay.filter((d) => d.future).length).toBe(4);
    // Ghost bars: Tuesday against last Tuesday, Monday against a quiet last Monday.
    expect(r.byDay[1]!.previousMinutes).toBe(60);
    expect(r.byDay[0]!.previousMinutes).toBe(0);
    expect(r.byDay.find((d) => d.date === '2026-09-24')!.previousMinutes).toBe(60);
    expect(r.bestEver).toBe(true);
    expect(r.firstTime).toBe(false);
    expect(r.goalRatio).toBeCloseTo(0.6);
    expect(r.summary).toBe('Your best week so far, and Tuesday did the heavy lifting.');
  });

  it('welcomes a first week instead of comparing it to a minute', () => {
    const ss = [session('2026-09-18T10:00', 1), session('2026-09-22T10:00', 170)];
    const r = rangeRecap({ sessions: ss, timezone: TZ, now: NOW, range: 'week' });
    expect(r.firstTime).toBe(true);
    expect(r.change).toBeNull();
    expect(r.summary).toBe("Your first week is on the board. Here's where you started.");
    expect(r.goalRatio).toBeNull();
  });

  it('matches a month in progress against the same stretch of the month before', () => {
    const ss = [
      session('2026-08-05T10:00', 60),
      // After the 23rd of August: not part of the comparison yet.
      session('2026-08-28T10:00', 600),
      session('2026-09-03T10:00', 90),
    ];
    const r = rangeRecap({ sessions: ss, timezone: TZ, now: NOW, range: 'month' });
    expect(r.from).toBe('2026-09-01');
    expect(r.to).toBe('2026-09-30');
    expect(r.previousMinutes).toBe(60);
    expect(r.change).toBeCloseTo(0.5);
    expect(r.bestEver).toBe(false);
  });

  it('has a kind word for a quiet week and for an empty one', () => {
    const ss = [session('2026-09-15T10:00', 300), session('2026-09-22T10:00', 40)];
    const r = rangeRecap({ sessions: ss, timezone: TZ, now: NOW, range: 'week' });
    expect(r.summary).toBe('You completed 1 session this week.');
    const empty = rangeRecap({
      sessions: [session('2026-09-15T10:00', 300)],
      timezone: TZ,
      now: NOW,
      range: 'week',
    });
    expect(empty.summary).toMatch(/^Nothing on the board yet/);
    const none = rangeRecap({ sessions: [], timezone: TZ, now: NOW, range: 'week' });
    expect(none.summary).toBe('Your first session puts this week on the board.');
  });
});

describe('recapSummary', () => {
  it('says up, steady, or never a word about down', () => {
    const base = {
      range: 'week' as const,
      minutes: 200,
      sessions: 4,
      firstTime: false,
      bestEver: false,
      bestDay: { date: '2026-09-27', minutes: 90 },
      historyMinutes: 2000,
    };
    expect(recapSummary({ ...base, change: 0.3 })).toBe(
      'Up on last week, and Sunday did the heavy lifting.',
    );
    expect(recapSummary({ ...base, change: 0.02 })).toMatch(/^Right in step/);
    const low = recapSummary({ ...base, change: -0.7 });
    expect(low).not.toMatch(/less|down|fewer|%/i);
  });

  it('closes a quieter week on the goal, then on how close it came', () => {
    const base = {
      range: 'week' as const,
      minutes: 200,
      sessions: 4,
      firstTime: false,
      bestEver: false,
      bestDay: null,
      historyMinutes: 2000,
    };
    expect(recapSummary({ ...base, change: -0.5, goalMinutes: 180 })).toBe(
      'You completed 4 sessions this week. You hit your goal!',
    );
    expect(recapSummary({ ...base, change: -0.5, goalMinutes: 240 })).toBe(
      'You completed 4 sessions this week. Almost there!',
    );
    expect(recapSummary({ ...base, change: -0.5, goalMinutes: 240, past: true })).toBe(
      'You completed 4 sessions that week.',
    );
    expect(recapSummary({ ...base, change: -0.2 })).toBe(
      'You completed 4 sessions this week. Good work!',
    );
    expect(recapSummary({ ...base, change: -0.6 })).toBe('You completed 4 sessions this week.');
  });
});

describe('timeOfDayClock', () => {
  it('buckets minutes by the local hour they fell in', () => {
    const c = timeOfDayClock(
      [
        session('2026-09-22T22:10', 50),
        session('2026-09-22T22:40', 20),
        session('2026-09-22T08:00', 30),
      ],
      TZ,
    );
    expect(c.hours[22]).toBe(70);
    expect(c.hours[8]).toBe(30);
    expect(c.peakHour).toBe(22);
    expect(c.totalMinutes).toBe(100);
    expect(timeOfDayClock([], TZ).peakHour).toBeNull();
  });

  it('spreads a long session over the hours it ran', () => {
    const c = timeOfDayClock([session('2026-09-22T13:00', 120)], TZ);
    expect(c.hours[13]).toBe(60);
    expect(c.hours[14]).toBe(60);
    expect(c.hours[15]).toBe(0);
    expect(c.totalMinutes).toBe(120);
  });
});

describe('subjects', () => {
  const nodes = [
    node('eco', { title: 'ECO220', kind: 'course', color: '#ff0000' }),
    node('t1', { parentId: 'eco', title: 'Test 1' }),
    node('u1', { parentId: 't1', title: 'Unit 1' }),
    node('rsm', { title: 'RSM222', kind: 'course' }),
  ];
  const ss = [
    session('2026-09-21T10:00', 60, { nodeId: 'u1' }),
    session('2026-09-22T10:00', 30, { nodeId: 'rsm' }),
    session('2026-09-22T12:00', 15),
    session('2026-09-22T13:00', 10, { routineId: 'r' }),
  ];

  it('rolls tasks up to their course and keeps free and routine time apart', () => {
    const b = subjectBreakdown({ nodes, sessions: ss, timezone: TZ });
    expect(b.map((x) => [x.key, x.minutes])).toEqual([
      ['eco', 60],
      ['rsm', 30],
      ['free', 15],
      ['routine', 10],
    ]);
    expect(b[0]!.color).toBe('#ff0000');
    expect(b.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1);
    const folded = subjectBreakdown({ nodes, sessions: ss, timezone: TZ, limit: 2 });
    expect(folded.map((x) => x.key)).toEqual(['eco', 'rsm', 'other']);
    expect(folded[2]!.minutes).toBe(25);
  });

  it('says what each day was made of', () => {
    const days = dailyBySubject({
      nodes,
      sessions: ss,
      timezone: TZ,
      from: '2026-09-21',
      to: '2026-09-22',
    });
    expect(days.length).toBe(2);
    expect(days[1]!.segments.find((s) => s.key === 'rsm')!.minutes).toBe(30);
    expect(days[0]!.segments.find((s) => s.key === 'eco')!.minutes).toBe(60);
  });
});

describe('cumulativeHours', () => {
  it('climbs day by day and marks the milestones passed', () => {
    const c = cumulativeHours(
      [
        session('2026-09-01T10:00', 300),
        session('2026-09-02T10:00', 400),
        session('2026-09-03T10:00', 60),
      ],
      TZ,
    );
    expect(c.points.map((p) => p.minutes)).toEqual([300, 700, 760]);
    expect(c.reached).toEqual([{ hours: 10, date: '2026-09-02' }]);
    expect(c.next).toEqual({ hours: 25, remainingMinutes: 1500 - 760 });
  });
});

describe('sessionHistogram', () => {
  it('bins lengths and names the common one', () => {
    const h = sessionHistogram([
      session('2026-09-21T10:00', 25),
      session('2026-09-21T12:00', 30),
      session('2026-09-21T14:00', 35),
      session('2026-09-21T16:00', 100),
    ]);
    expect(h.buckets.map((b) => b.count)).toEqual([0, 3, 0, 0, 1]);
    expect(h.takeaway).toBe('Most of your sessions are 20 to 40 min.');
    expect(h.medianMinutes).toBe(32.5);
    expect(sessionHistogram([session('2026-09-21T10:00', 25)]).takeaway).toBeNull();
  });
});

describe('consistency and streak milestones', () => {
  it('counts qualifying days over thirty and dots the week', () => {
    const c = consistency({
      sessions: [
        session('2026-09-21T10:00', 20),
        session('2026-09-22T10:00', 5),
        session('2026-09-10T10:00', 60),
      ],
      timezone: TZ,
      now: NOW,
      minMinutes: 15,
      streak: streak(5),
    });
    expect(c.activeDays30).toBe(2);
    expect(c.ratio30).toBeCloseTo(2 / 30);
    expect(c.weekDots.map((d) => d.studied)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(c.weekDots[2]!.today).toBe(true);
    expect(c.nextMilestone).toEqual({ days: 7, remaining: 2 });
  });

  it('keeps finding a milestone past the last named one', () => {
    expect(nextStreakMilestone(0)).toEqual({ days: 7, remaining: 7 });
    expect(nextStreakMilestone(100)).toEqual({ days: 200, remaining: 100 });
  });
});

describe('personalRecords', () => {
  it('finds each record and flags the ones set this week', () => {
    const ss = [
      session('2026-09-10T06:05', 30),
      session('2026-09-11T23:30', 100),
      session('2026-09-22T10:00', 200),
    ];
    const nodes = [
      node('a', { completedAt: '2026-09-22T15:00:00.000Z' }),
      node('b', { completedAt: '2026-09-23T15:00:00.000Z' }),
      node('c', { completedAt: '2026-09-11T15:00:00.000Z' }),
    ];
    const r = personalRecords({
      sessions: ss,
      nodes,
      timezone: TZ,
      now: NOW,
      weekStart: '2026-09-21',
      streak: streak(3, 3, '2026-09-22'),
    });
    const by = Object.fromEntries(r.map((x) => [x.key, x]));
    expect(by['biggest-day']).toMatchObject({
      display: '3.3 hours',
      when: '2026-09-22',
      isNew: true,
    });
    expect(by['biggest-week']).toMatchObject({ when: '2026-09-21', isNew: true });
    expect(by['longest-session']!.isNew).toBe(true);
    expect(by['longest-streak']).toMatchObject({ display: '3 days', isNew: true });
    expect(by['most-tasks-week']).toMatchObject({ display: '2 tasks', isNew: true });
    expect(by['earliest-start']).toMatchObject({ display: '6:05 am', isNew: false });
    // 23:30 plus 100 minutes finishes at 1:10 the next morning, which counts as late.
    expect(by['latest-finish']).toMatchObject({ display: '1:10 am', when: '2026-09-11' });
  });

  it('finds the month, busiest day, courses, routines and focused-run records', () => {
    const review = (distracted: 'no' | 'a-little') => ({
      skipped: false,
      prepared: null,
      distracted,
      completedCount: null,
      correctCount: null,
      mood: null,
      extraMinutesAdded: null,
      note: null,
    });
    const nodes = [
      node('bio', { kind: 'course' }),
      node('cell', { parentId: 'bio' }),
      node('chem', { kind: 'course' }),
      node('acid', { parentId: 'chem' }),
    ];
    const ss = [
      session('2026-08-05T10:00', 600, { nodeId: 'cell', review: review('no') }),
      session('2026-09-22T09:00', 30, { nodeId: 'cell', review: review('no') }),
      session('2026-09-22T11:00', 30, { nodeId: 'acid', review: review('no') }),
      session('2026-09-22T14:00', 30, { review: review('a-little') }),
      session('2026-09-23T09:00', 30, { nodeId: 'cell', review: review('no') }),
    ];
    const r = personalRecords({
      sessions: ss,
      nodes,
      timezone: TZ,
      now: NOW,
      weekStart: '2026-09-21',
      streak: streak(2, 2, '2026-09-23'),
      routineTicks: [{ date: '2026-09-21' }, { date: '2026-09-22' }, { date: '2026-09-08' }],
    });
    const by = Object.fromEntries(r.map((x) => [x.key, x]));
    expect(by['biggest-month']).toMatchObject({
      when: '2026-08-01',
      display: '10 hours',
      isNew: false,
    });
    expect(by['most-sessions-day']).toMatchObject({
      display: '3 sessions',
      when: '2026-09-22',
      isNew: true,
    });
    expect(by['most-courses-week']).toMatchObject({
      display: '2 courses',
      when: '2026-09-21',
      isNew: true,
    });
    expect(by['most-routines-week']).toMatchObject({
      display: '2 routines',
      when: '2026-09-21',
      isNew: true,
    });
    // Three undistracted in a row, then a distracted one, then one more: the run is three.
    expect(by['most-focused-run']).toMatchObject({ display: '3 sessions', when: '2026-09-22' });
  });

  it('leaves the routines record out without any ticks', () => {
    const r = personalRecords({
      sessions: [session('2026-09-22T09:00', 30)],
      nodes: [],
      timezone: TZ,
      now: NOW,
      weekStart: '2026-09-21',
      streak: streak(1),
    });
    expect(r.map((x) => x.key)).not.toContain('most-routines-week');
    expect(r.map((x) => x.key)).not.toContain('most-focused-run');
  });

  it('waits for three sessions before naming an earliest start or latest finish', () => {
    const r = personalRecords({
      sessions: [session('2026-09-22T21:27', 30), session('2026-09-23T10:00', 20)],
      nodes: [],
      timezone: TZ,
      now: NOW,
      weekStart: '2026-09-21',
      streak: streak(2),
    });
    expect(r.map((x) => x.key)).not.toContain('earliest-start');
    expect(r.map((x) => x.key)).not.toContain('latest-finish');
  });

  it('leaves out a session left running for half a day when reading the clock', () => {
    const r = personalRecords({
      sessions: [
        session('2026-09-10T08:00', 30),
        session('2026-09-11T09:00', 30),
        session('2026-09-12T10:00', 30),
        // Left running from 4:30 one morning to the evening after next.
        session('2026-09-14T04:30', 60 * 40),
      ],
      nodes: [],
      timezone: TZ,
      now: NOW,
      weekStart: '2026-09-21',
      streak: streak(0),
    });
    const by = Object.fromEntries(r.map((x) => [x.key, x]));
    expect(by['earliest-start']).toMatchObject({ display: '8:00 am', when: '2026-09-10' });
    expect(by['latest-finish']).toMatchObject({ display: '10:30 am', when: '2026-09-12' });
  });

  it('shows nothing for nothing', () => {
    expect(
      personalRecords({
        sessions: [],
        nodes: [],
        timezone: TZ,
        now: NOW,
        weekStart: '2026-09-21',
        streak: streak(0),
      }),
    ).toEqual([]);
  });
});

describe('studyPersonality', () => {
  const many = (time: string, minutes: number, n: number, day = 14) =>
    Array.from({ length: n }, (_, i) =>
      session(`2026-09-${String(day + i).padStart(2, '0')}T${time}`, minutes),
    );

  it('waits for enough history before naming anything', () => {
    expect(studyPersonality({ sessions: many('22:00', 60, 3), timezone: TZ, now: NOW })).toBeNull();
  });

  it('reads night owls, early birds, deep divers and sprinters', () => {
    expect(studyPersonality({ sessions: many('22:00', 40, 6), timezone: TZ, now: NOW })?.id).toBe(
      'night-owl',
    );
    expect(studyPersonality({ sessions: many('06:30', 40, 6), timezone: TZ, now: NOW })?.id).toBe(
      'early-bird',
    );
    expect(studyPersonality({ sessions: many('14:00', 90, 5), timezone: TZ, now: NOW })?.id).toBe(
      'deep-diver',
    );
    const bursts = [...many('10:00', 15, 5), ...many('14:00', 15, 5), ...many('16:00', 15, 5)];
    expect(studyPersonality({ sessions: bursts, timezone: TZ, now: NOW })?.id).toBe('sprinter');
  });

  it('calls a steady month a consistent climb', () => {
    const month = Array.from({ length: 20 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 8, 3 + i));
      return session(`${d.toISOString().slice(0, 10)}T14:00`, 40);
    });
    expect(studyPersonality({ sessions: month, timezone: TZ, now: NOW })?.id).toBe(
      'consistent-climber',
    );
  });
});

describe('hoursForecast', () => {
  it('lands the next milestone at the current pace', () => {
    const f = hoursForecast({ totalMinutes: 540, last28Minutes: 28 * 30, now: NOW, timezone: TZ });
    // 60 minutes to 10 h at 30 a day: two days out.
    expect(f).toMatchObject({ hours: 10, date: '2026-09-25' });
    expect(f!.text).toBe("At this pace you'll hit 10 hours by September 25 🎯");
    expect(
      hoursForecast({ totalMinutes: 540, last28Minutes: 0, now: NOW, timezone: TZ }),
    ).toBeNull();
  });
});

describe('focusQuality, planKept, studyVsGrades', () => {
  it('reads the share of distraction-free sessions', () => {
    const r = (d: 'no' | 'a-lot' | null) => ({
      skipped: false,
      prepared: null,
      distracted: d,
      completedCount: null,
      correctCount: null,
      mood: null,
      extraMinutesAdded: null,
      note: null,
    });
    const q = focusQuality([
      session('2026-09-21T10:00', 30, { review: r('no') }),
      session('2026-09-21T11:00', 30, { review: r('a-lot') }),
      session('2026-09-21T12:00', 30, { review: r(null) }),
      session('2026-09-21T13:00', 30),
    ]);
    expect(q).toEqual({ answered: 2, ratio: 0.5 });
    expect(focusQuality([]).ratio).toBeNull();
  });

  it('counts past planned blocks that had a session in them', () => {
    const block = (start: string, end: string, over: Partial<PlannedBlock> = {}): PlannedBlock => ({
      id: start,
      userId: 'u',
      nodeId: null,
      startAt: new Date(`${start}:00.000-04:00`).toISOString(),
      endAt: new Date(`${end}:00.000-04:00`).toISOString(),
      source: 'app',
      title: null,
      sessionId: null,
      googleEventId: null,
      cancelled: false,
      ...over,
    });
    const k = planKept(
      [
        block('2026-09-21T10:00', '2026-09-21T11:00'),
        block('2026-09-22T10:00', '2026-09-22T11:00'),
        block('2026-09-22T12:00', '2026-09-22T13:00', { source: 'google' }),
        block('2026-09-25T10:00', '2026-09-25T11:00'),
      ],
      [session('2026-09-21T10:30', 20)],
      '2026-09-21',
      '2026-09-27',
      TZ,
      NOW,
    );
    expect(k).toEqual({ planned: 2, kept: 1 });
  });

  it('pairs study with marks only once three courses have both', () => {
    const two = [
      { nodeId: 'a', title: 'A', minutes: 100, percent: 80 },
      { nodeId: 'b', title: 'B', minutes: 50, percent: 90 },
    ];
    expect(studyVsGrades(two)).toBeNull();
    const three = studyVsGrades([...two, { nodeId: 'c', title: 'C', minutes: 30, percent: 70 }]);
    expect(three!.note).toBe('A gets the most of your time; B holds your highest mark.');
  });
});

describe('dashboardStats', () => {
  it('gives the total, the week against the goal, and a seven-day line', () => {
    const d = dashboardStats({
      sessions: [session('2026-09-10T10:00', 120), session('2026-09-22T10:00', 90)],
      timezone: TZ,
      now: NOW,
      goalMinutes: 300,
      streak: { ...streak(4, 9), weeks: { current: 2, longest: 5, lastCountedWeek: '2026-09-21' } },
    });
    expect(d.totalMinutes).toBe(210);
    expect(d.weekMinutes).toBe(90);
    expect(d.goalRatio).toBeCloseTo(0.3);
    expect(d.sparkline.length).toBe(7);
    expect(d.sparkline[6]!.date).toBe('2026-09-23');
    expect(d.sparkline[5]!.minutes).toBe(90);
    expect(d.streak).toEqual({ current: 4, longest: 9, weeks: { current: 2, longest: 5 } });
  });

  it('reads a streak saved before weekly streaks as no weeks yet', () => {
    const d = dashboardStats({
      sessions: [],
      timezone: TZ,
      now: NOW,
      goalMinutes: 300,
      streak: streak(4, 9),
    });
    expect(d.streak.weeks).toEqual({ current: 0, longest: 0 });
  });
});
