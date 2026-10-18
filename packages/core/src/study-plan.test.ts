import { describe, expect, it } from 'vitest';
import {
  parseOutline,
  planPacing,
  planStreak,
  planTopics,
  planWeeks,
  rebalanceOptions,
  recentAccuracy,
  roundAccuracy,
  scheduleItem,
  type DrillItem,
  type DrillRound,
  type PlanTopic,
} from './study-plan';

const topic = (
  id: string,
  sortOrder: number,
  plannedMinutes: number,
  extra: Partial<PlanTopic> = {},
): PlanTopic => ({
  id,
  planId: 'p',
  title: id,
  plannedMinutes,
  sortOrder,
  resource: null,
  practice: true,
  completedAt: null,
  ...extra,
});

const round = (
  topicId: string,
  date: string,
  ok: number,
  shaky: number,
  miss: number,
): DrillRound => ({
  id: `${topicId}-${date}-${ok}`,
  topicId,
  sessionId: null,
  date,
  ok,
  shaky,
  miss,
  createdAt: `${date}T12:00:00.000Z`,
});

const item = (topicId: string, dueOn: string, extra: Partial<DrillItem> = {}): DrillItem => ({
  id: `${topicId}-${dueOn}`,
  topicId,
  prompt: 'Walk me through a DCF',
  lastResult: 'miss',
  dueOn,
  box: 0,
  attempts: 1,
  retired: false,
  createdAt: '2026-10-01T12:00:00.000Z',
  ...extra,
});

describe('accuracy', () => {
  it('counts shaky as half', () => {
    expect(roundAccuracy({ ok: 6, shaky: 2, miss: 2 })).toBeCloseTo(0.7);
    expect(roundAccuracy({ ok: 0, shaky: 0, miss: 0 })).toBeNull();
  });

  it('pools only the most recent rounds', () => {
    const rounds = [
      round('a', '2026-10-01', 0, 0, 10),
      round('a', '2026-10-02', 9, 0, 1),
      round('a', '2026-10-03', 10, 0, 0),
    ];
    expect(recentAccuracy(rounds)).toBeCloseTo(0.95);
  });
});

describe('scheduleItem', () => {
  it('brings a miss or a wobble back tomorrow, from box 0', () => {
    expect(scheduleItem({ box: 2, attempts: 3 }, 'miss', '2026-10-08')).toMatchObject({
      box: 0,
      dueOn: '2026-10-09',
      retired: false,
      attempts: 4,
    });
    expect(scheduleItem({ box: 1, attempts: 1 }, 'shaky', '2026-10-08').dueOn).toBe('2026-10-09');
  });

  it('spaces clean answers out and retires after three in a row', () => {
    let s = { box: 0, attempts: 1 };
    const a = scheduleItem(s, 'ok', '2026-10-08');
    expect(a).toMatchObject({ box: 1, dueOn: '2026-10-09', retired: false });
    s = a;
    const b = scheduleItem(s, 'ok', '2026-10-09');
    expect(b).toMatchObject({ box: 2, dueOn: '2026-10-12', retired: false });
    const c = scheduleItem(b, 'ok', '2026-10-12');
    expect(c).toMatchObject({ box: 3, retired: true });
  });
});

describe('planTopics', () => {
  const today = '2026-10-08';

  it('marks the first untouched topic up next, in order', () => {
    const topics = [
      topic('b', 2, 300),
      topic('a', 1, 480, { completedAt: '2026-10-05T00:00:00Z' }),
    ];
    const out = planTopics(topics, new Map(), [], [], 0.85, today);
    expect(out.map((t) => [t.topic.id, t.state])).toEqual([
      ['a', 'mastered'],
      ['b', 'up-next'],
    ]);
  });

  it('needs two strong rounds and an empty queue for mastery', () => {
    const t = [topic('a', 1, 480)];
    const one = planTopics(
      t,
      new Map([['a', 120]]),
      [round('a', today, 10, 0, 0)],
      [],
      0.85,
      today,
    );
    expect(one[0]!.meetsMastery).toBe(false);
    const rounds = [round('a', '2026-10-07', 9, 1, 0), round('a', today, 10, 0, 0)];
    const two = planTopics(t, new Map([['a', 120]]), rounds, [], 0.85, today);
    expect(two[0]!.meetsMastery).toBe(true);
    expect(two[0]!.state).toBe('drilling');
    const queued = planTopics(t, new Map(), rounds, [item('a', today)], 0.85, today);
    expect(queued[0]!.meetsMastery).toBe(false);
    expect(queued[0]!.dueItems).toBe(1);
  });

  it('never calls a hours-only topic mastered on its own', () => {
    const t = [topic('a', 1, 60, { practice: false })];
    const out = planTopics(t, new Map([['a', 600]]), [], [], 0.85, today);
    expect(out[0]!.meetsMastery).toBe(false);
    expect(out[0]!.hoursShare).toBe(10);
  });
});

describe('planPacing', () => {
  const plan = { weeklyMinutes: 22 * 60, startedOn: '2026-10-05', targetDate: '2026-10-23' };
  const topics = (logged: number) =>
    planTopics([topic('a', 1, 49 * 60)], new Map([['a', logged]]), [], [], 0.85, '2026-10-08');

  it('is on track when the budget covers what is left', () => {
    const p = planPacing({
      plan,
      topics: topics(9 * 60),
      minutesByDay: new Map([['2026-10-06', 540]]),
      today: '2026-10-08',
    });
    expect(p.remainingMinutes).toBe(40 * 60);
    expect(p.thisWeekMinutes).toBe(540);
    expect(p.week).toBe(1);
    expect(p.weeksTotal).toBe(3);
    expect(p.status).toBe('on-track');
  });

  it('is behind, with both ways back offered, when it is not', () => {
    const p = planPacing({ plan, topics: topics(0), minutesByDay: new Map(), today: '2026-10-15' });
    expect(p.status).toBe('behind');
    const r = rebalanceOptions(p);
    expect(r.raiseWeeklyTo).toBeGreaterThan(plan.weeklyMinutes);
    expect(r.raiseWeeklyTo! % 15).toBe(0);
    expect(r.moveTargetTo! > plan.targetDate).toBe(true);
  });

  it('is done when every topic is mastered', () => {
    const t = planTopics(
      [topic('a', 1, 60, { completedAt: '2026-10-07T00:00:00Z' })],
      new Map(),
      [],
      [],
      0.85,
      '2026-10-08',
    );
    expect(
      planPacing({ plan, topics: t, minutesByDay: new Map(), today: '2026-10-08' }).status,
    ).toBe('done');
  });
});

describe('recap helpers', () => {
  it('splits minutes and accuracy by week', () => {
    const weeks = planWeeks(
      '2026-10-01',
      '2026-10-08',
      new Map([
        ['2026-10-02', 60],
        ['2026-10-07', 90],
      ]),
      [round('a', '2026-10-07', 8, 0, 2)],
    );
    expect(weeks).toEqual([
      { weekStart: '2026-09-28', minutes: 60, accuracy: null, rounds: 0 },
      { weekStart: '2026-10-05', minutes: 90, accuracy: 0.8, rounds: 1 },
    ]);
  });

  it('counts a streak that is still alive from yesterday', () => {
    const days = new Set(['2026-10-05', '2026-10-06', '2026-10-07']);
    expect(planStreak(days, '2026-10-08')).toBe(3);
    expect(planStreak(days, '2026-10-09')).toBe(0);
  });
});

describe('parseOutline', () => {
  it('reads a pasted markdown table', () => {
    const text = `| # | Topic | Hours | Resource |
|---|---|---|---|
| 1 | Accounting / 3 statements | 8 | BIWS Mod 2–4 |
| 2 | Equity Value & Enterprise Value | 5 | BIWS Mod 6 |`;
    expect(parseOutline(text)).toEqual([
      { title: 'Accounting / 3 statements', minutes: 480, resource: 'BIWS Mod 2–4' },
      { title: 'Equity Value & Enterprise Value', minutes: 300, resource: 'BIWS Mod 6' },
    ]);
  });

  it('reads dashes, bullets, minutes and bare titles', () => {
    expect(parseOutline('1. LBO - 7h - BIWS Mod 11\n- Mock drills\n* Warm-up — 45 min')).toEqual([
      { title: 'LBO', minutes: 420, resource: 'BIWS Mod 11' },
      { title: 'Mock drills', minutes: null, resource: null },
      { title: 'Warm-up', minutes: 45, resource: null },
    ]);
  });
});
