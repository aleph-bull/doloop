import { describe, expect, it } from 'vitest';
import { fmtHoursWord, getHighlights, splitHighlights, type HighlightsInput } from './highlights';
import { HIGHLIGHT_FALLBACK } from './highlights-thresholds';
import { emptyRestDayPolicy } from './rest-days';
import { emptyStreak } from './streak';
import type { PlannedBlock, Session, SessionReview, StudyNode } from './types';

const TZ = 'America/Toronto';
const WEEK = '2026-09-14'; // Monday
const NOW = '2026-09-20T20:00:00.000Z'; // Sunday 16:00 local

let seq = 0;
const node = (over: Partial<StudyNode> = {}): StudyNode => ({
  id: `n${++seq}`,
  userId: 'u',
  parentId: null,
  title: `Node ${seq}`,
  kind: 'task',
  estimatedMinutes: null,
  dueAt: null,
  completedAt: null,
  sortOrder: seq,
  color: null,
  archived: false,
  countUnit: null,
  countUnitLabel: null,
  outcomeRating: null,
  ...over,
});

const review = (over: Partial<SessionReview> = {}): SessionReview => ({
  skipped: false,
  prepared: null,
  distracted: null,
  completedCount: null,
  correctCount: null,
  mood: null,
  extraMinutesAdded: null,
  note: null,
  ...over,
});

/** Session at local noon (16:00Z) on a date. */
const session = (
  nodeId: string,
  date: string,
  workMinutes: number,
  over: Partial<Session> = {},
): Session => ({
  id: `s${++seq}`,
  userId: 'u',
  nodeId,
  startedAt: `${date}T16:00:00.000Z`,
  endedAt: `${date}T17:00:00.000Z`,
  mode: 'unlimited',
  plannedEndAt: null,
  workSeconds: workMinutes * 60,
  breakSeconds: 0,
  idleSeconds: 0,
  pomodoroConfigSnapshot: null,
  review: null,
  xpAwarded: 20,
  badgesAwarded: [],
  ...over,
});

const input = (over: Partial<HighlightsInput> = {}): HighlightsInput => ({
  nodes: [],
  sessions: [],
  plannedBlocks: [],
  streak: emptyStreak(),
  timezone: TZ,
  policy: emptyRestDayPolicy('u'),
  maxComfortableMinutesPerDay: 240,
  now: NOW,
  weekStart: WEEK,
  ...over,
});

const keys = (i: HighlightsInput) => getHighlights(i).highlights.map((h) => h.key);
const find = (i: HighlightsInput, key: string) =>
  getHighlights(i).highlights.find((h) => h.key === key);

describe('getHighlights basics', () => {
  it('returns the fallback line and no cards for an empty week', () => {
    const r = getHighlights(input());
    expect(r.highlights).toEqual([]);
    expect(r.fallback).toBe(HIGHLIGHT_FALLBACK);
    expect(r.weekEnd).toBe('2026-09-20');
  });

  it('never uses exclamation marks or emoji and sorts by magnitude', () => {
    const n = node({ estimatedMinutes: 120 });
    const r = getHighlights(
      input({
        nodes: [n],
        sessions: [session(n.id, '2026-09-15', 60)],
        streak: { ...emptyStreak(), current: 5, longest: 5 },
      }),
    );
    for (const h of r.highlights) {
      expect(h.headline).not.toMatch(/!/);
      expect(h.headline).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(h.magnitude).toBeGreaterThanOrEqual(0);
      expect(h.magnitude).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < r.highlights.length; i++)
      expect(r.highlights[i - 1]!.magnitude).toBeGreaterThanOrEqual(r.highlights[i]!.magnitude);
    expect(r.fallback).toBeNull();
  });

  it('splits into top cards and more wins', () => {
    const hs = Array.from({ length: 7 }, (_, i) => ({
      key: 'streak' as const,
      headline: '',
      detail: '',
      magnitude: 1 - i / 10,
    }));
    const s = splitHighlights(hs);
    expect(s.top).toHaveLength(5);
    expect(s.more).toHaveLength(2);
  });

  it('formats hours', () => {
    expect(fmtHoursWord(60)).toBe('1 hour');
    expect(fmtHoursWord(570)).toBe('9.5 hours');
    expect(fmtHoursWord(30)).toBe('0.5 hours');
  });
});

describe('hours-total', () => {
  it('qualifies with any work and is the anchor', () => {
    const n = node();
    const h = find(
      input({ nodes: [n], sessions: [session(n.id, '2026-09-16', 570)] }),
      'hours-total',
    );
    expect(h?.headline).toBe('You studied 9.5 hours this week');
    expect(h?.magnitude).toBe(1);
  });
  it('does not qualify with no work this week', () => {
    const n = node();
    expect(keys(input({ nodes: [n], sessions: [session(n.id, '2026-09-10', 60)] }))).not.toContain(
      'hours-total',
    );
  });
});

describe('hours-up', () => {
  const n = node();
  it('qualifies at 10% more', () => {
    const h = find(
      input({
        nodes: [n],
        sessions: [session(n.id, '2026-09-10', 100), session(n.id, '2026-09-16', 250)],
      }),
      'hours-up',
    );
    expect(h?.headline).toBe('2.5 hours more than last week');
  });
  it('does not qualify below the ratio', () => {
    expect(
      keys(
        input({
          nodes: [n],
          sessions: [session(n.id, '2026-09-10', 100), session(n.id, '2026-09-16', 105)],
        }),
      ),
    ).not.toContain('hours-up');
  });
  it('needs a session last week as baseline', () => {
    expect(keys(input({ nodes: [n], sessions: [session(n.id, '2026-09-16', 300)] }))).not.toContain(
      'hours-up',
    );
  });
});

describe('sessions-up', () => {
  const n = node();
  const last = [session(n.id, '2026-09-08', 10), session(n.id, '2026-09-09', 10)];
  it('qualifies with 2 more sessions', () => {
    const h = find(
      input({
        nodes: [n],
        sessions: [...last, ...[15, 16, 17, 18].map((d) => session(n.id, `2026-09-${d}`, 10))],
      }),
      'sessions-up',
    );
    expect(h?.headline).toBe('You showed up 4 times, up from 2');
  });
  it('does not qualify with 1 more', () => {
    expect(
      keys(
        input({
          nodes: [n],
          sessions: [...last, ...[15, 16, 17].map((d) => session(n.id, `2026-09-${d}`, 10))],
        }),
      ),
    ).not.toContain('sessions-up');
  });
  it('needs a baseline', () => {
    expect(
      keys(
        input({ nodes: [n], sessions: [15, 16, 17].map((d) => session(n.id, `2026-09-${d}`, 10)) }),
      ),
    ).not.toContain('sessions-up');
  });
});

describe('throughput-up', () => {
  const n = node({ title: 'HW1', countUnit: 'problems' });
  it('qualifies at 15% higher rate', () => {
    const s = [
      session(n.id, '2026-09-10', 60, { review: review({ completedCount: 6 }) }), // 1.0 / 10 min
      session(n.id, '2026-09-16', 60, { review: review({ completedCount: 9 }) }), // 1.5 / 10 min
    ];
    expect(find(input({ nodes: [n], sessions: s }), 'throughput-up')?.headline).toBe(
      '1.5 problems per 10 min, up from 1.0, on HW1',
    );
  });
  it('does not qualify below 15%', () => {
    const s = [
      session(n.id, '2026-09-10', 60, { review: review({ completedCount: 6 }) }),
      session(n.id, '2026-09-16', 60, { review: review({ completedCount: 6 }) }),
    ];
    expect(keys(input({ nodes: [n], sessions: s }))).not.toContain('throughput-up');
  });
  it('needs a previous session with counts', () => {
    const s = [
      session(n.id, '2026-09-10', 60),
      session(n.id, '2026-09-16', 60, { review: review({ completedCount: 9 }) }),
    ];
    expect(keys(input({ nodes: [n], sessions: s }))).not.toContain('throughput-up');
  });
});

describe('accuracy-up', () => {
  const n = node();
  it('qualifies at +5 points with both >= 5 completed', () => {
    const s = [
      session(n.id, '2026-09-10', 30, { review: review({ completedCount: 10, correctCount: 7 }) }),
      session(n.id, '2026-09-16', 30, { review: review({ completedCount: 10, correctCount: 8 }) }),
    ];
    expect(find(input({ nodes: [n], sessions: s }), 'accuracy-up')?.headline).toBe(
      '80% correct, up from 70%',
    );
  });
  it('does not qualify below +5', () => {
    const s = [
      session(n.id, '2026-09-10', 30, {
        review: review({ completedCount: 100, correctCount: 70 }),
      }),
      session(n.id, '2026-09-16', 30, {
        review: review({ completedCount: 100, correctCount: 73 }),
      }),
    ];
    expect(keys(input({ nodes: [n], sessions: s }))).not.toContain('accuracy-up');
  });
  it('needs a baseline with at least 5 completed', () => {
    const s = [
      session(n.id, '2026-09-10', 30, { review: review({ completedCount: 4, correctCount: 1 }) }),
      session(n.id, '2026-09-16', 30, { review: review({ completedCount: 10, correctCount: 9 }) }),
    ];
    expect(keys(input({ nodes: [n], sessions: s }))).not.toContain('accuracy-up');
  });
});

describe('mood-up', () => {
  const n = node();
  it('qualifies when mood rises by 1', () => {
    const s = [
      session(n.id, '2026-09-10', 30, { review: review({ mood: 2 }) }),
      session(n.id, '2026-09-16', 30, { review: review({ mood: 3 }) }),
    ];
    expect(keys(input({ nodes: [n], sessions: s }))).toContain('mood-up');
  });
  it('does not qualify when flat', () => {
    const s = [
      session(n.id, '2026-09-10', 30, { review: review({ mood: 3 }) }),
      session(n.id, '2026-09-16', 30, { review: review({ mood: 3 }) }),
    ];
    expect(keys(input({ nodes: [n], sessions: s }))).not.toContain('mood-up');
  });
  it('needs a previous mood on the same node', () => {
    const other = node();
    const s = [
      session(other.id, '2026-09-10', 30, { review: review({ mood: 1 }) }),
      session(n.id, '2026-09-16', 30, { review: review({ mood: 5 }) }),
    ];
    expect(keys(input({ nodes: [n, other], sessions: s }))).not.toContain('mood-up');
  });
});

describe('preparedness-up', () => {
  const n = node({ kind: 'assessment', title: 'Quiz 1' });
  it('qualifies when the rating rises', () => {
    const s = [
      session(n.id, '2026-09-10', 30, { review: review({ prepared: 3 }) }),
      session(n.id, '2026-09-16', 30, { review: review({ prepared: 4 }) }),
    ];
    expect(find(input({ nodes: [n], sessions: s }), 'preparedness-up')?.headline).toBe(
      'Preparedness for Quiz 1 went 3 to 4',
    );
  });
  it('does not qualify when it falls', () => {
    const s = [
      session(n.id, '2026-09-10', 30, { review: review({ prepared: 4 }) }),
      session(n.id, '2026-09-16', 30, { review: review({ prepared: 3 }) }),
    ];
    expect(keys(input({ nodes: [n], sessions: s }))).not.toContain('preparedness-up');
  });
  it('needs a baseline', () => {
    expect(
      keys(
        input({
          nodes: [n],
          sessions: [session(n.id, '2026-09-16', 30, { review: review({ prepared: 4 }) })],
        }),
      ),
    ).not.toContain('preparedness-up');
  });
});

describe('focus-streak', () => {
  const n = node();
  const focused = (d: string) => session(n.id, d, 30, { review: review({ distracted: 'no' }) });
  it('qualifies with 3 consecutive focused sessions', () => {
    expect(
      find(
        input({
          nodes: [n],
          sessions: [focused('2026-09-12'), focused('2026-09-15'), focused('2026-09-16')],
        }),
        'focus-streak',
      )?.headline,
    ).toBe('Three focused sessions in a row');
  });
  it('is broken by a distracted session', () => {
    const s = [
      focused('2026-09-12'),
      session(n.id, '2026-09-15', 30, { review: review({ distracted: 'a-lot' }) }),
      focused('2026-09-16'),
      focused('2026-09-17'),
    ];
    expect(keys(input({ nodes: [n], sessions: s }))).not.toContain('focus-streak');
  });
  it('needs an answered session this week', () => {
    expect(
      keys(
        input({
          nodes: [n],
          sessions: [
            focused('2026-09-10'),
            focused('2026-09-11'),
            focused('2026-09-12'),
            session(n.id, '2026-09-16', 30),
          ],
        }),
      ),
    ).not.toContain('focus-streak');
  });
});

describe('distraction-down', () => {
  const n = node();
  const d = (date: string, v: 'no' | 'a-lot') =>
    session(n.id, date, 30, { review: review({ distracted: v }) });
  it('qualifies with a 20 point drop', () => {
    const s = [
      d('2026-09-10', 'a-lot'),
      d('2026-09-11', 'a-lot'),
      d('2026-09-15', 'no'),
      d('2026-09-16', 'no'),
    ];
    expect(find(input({ nodes: [n], sessions: s }), 'distraction-down')?.detail).toBe(
      '0% this week vs 100% last week',
    );
  });
  it('does not qualify with a small drop', () => {
    const s = [
      d('2026-09-10', 'a-lot'),
      d('2026-09-11', 'no'),
      d('2026-09-12', 'no'),
      d('2026-09-13', 'no'),
      d('2026-09-15', 'a-lot'),
      d('2026-09-16', 'no'),
      d('2026-09-17', 'no'),
      d('2026-09-18', 'no'),
    ];
    expect(keys(input({ nodes: [n], sessions: s }))).not.toContain('distraction-down');
  });
  it('needs answered sessions in both weeks', () => {
    expect(keys(input({ nodes: [n], sessions: [d('2026-09-15', 'no')] }))).not.toContain(
      'distraction-down',
    );
  });
});

describe('tasks-all-done / tasks-done-count', () => {
  it('all-done when every node due this week is complete', () => {
    const a = node({ dueAt: '2026-09-17T16:00:00.000Z', completedAt: '2026-09-16T16:00:00.000Z' });
    const b = node({ dueAt: '2026-09-18T16:00:00.000Z', completedAt: '2026-09-17T16:00:00.000Z' });
    const k = keys(input({ nodes: [a, b] }));
    expect(k).toContain('tasks-all-done');
    expect(k).not.toContain('tasks-done-count');
  });
  it('done-count when some due nodes remain', () => {
    const a = node({ dueAt: '2026-09-17T16:00:00.000Z', completedAt: '2026-09-16T16:00:00.000Z' });
    const b = node({ dueAt: '2026-09-18T16:00:00.000Z' });
    const h = find(input({ nodes: [a, b] }), 'tasks-done-count');
    expect(h?.headline).toBe('1 task completed this week');
  });
  it('neither when nothing is due or completed this week', () => {
    const a = node({ dueAt: '2026-09-30T16:00:00.000Z', completedAt: '2026-09-10T16:00:00.000Z' });
    const k = keys(input({ nodes: [a] }));
    expect(k).not.toContain('tasks-all-done');
    expect(k).not.toContain('tasks-done-count');
  });
});

describe('goal-progress', () => {
  it('shows the most-progressed unfinished node', () => {
    const a = node({ title: 'A', estimatedMinutes: 100 });
    const b = node({ title: 'B', estimatedMinutes: 100 });
    const s = [session(a.id, '2026-09-15', 20), session(b.id, '2026-09-15', 80)];
    expect(find(input({ nodes: [a, b], sessions: s }), 'goal-progress')?.headline).toBe(
      "You're 20% from finishing B",
    );
  });
  it('does not show for nodes without progress', () => {
    expect(keys(input({ nodes: [node({ estimatedMinutes: 100 })] }))).not.toContain(
      'goal-progress',
    );
  });
  it('skips completed and no-estimate nodes', () => {
    const a = node({ estimatedMinutes: 100, completedAt: NOW });
    const b = node();
    expect(
      keys(
        input({
          nodes: [a, b],
          sessions: [session(a.id, '2026-09-15', 50), session(b.id, '2026-09-15', 50)],
        }),
      ),
    ).not.toContain('goal-progress');
  });
});

describe('on-pace', () => {
  it('qualifies when a node moved from behind to on-track this week', () => {
    // Due Sep 22; at week start (Sep 14) with 200 min remaining over 8 days = 25/day and no recent work -> behind? days 8 > 3 -> on-track. Use critical instead.
    // At week start: remaining 2000 over 8 days = 250/day > 240 -> critical. Now: 1900 logged -> remaining 100 over 2 days -> on-track.
    const n = node({ title: 'Big', estimatedMinutes: 2000, dueAt: '2026-09-22T16:00:00.000Z' });
    const s = [session(n.id, '2026-09-15', 1900)];
    expect(find(input({ nodes: [n], sessions: s }), 'on-pace')?.headline).toBe(
      'Big is back on track',
    );
  });
  it('does not qualify if it was already on track', () => {
    const n = node({ estimatedMinutes: 100, dueAt: '2026-10-22T16:00:00.000Z' });
    expect(keys(input({ nodes: [n], sessions: [session(n.id, '2026-09-15', 50)] }))).not.toContain(
      'on-pace',
    );
  });
  it('does not qualify if still behind', () => {
    const n = node({ estimatedMinutes: 2000, dueAt: '2026-09-22T16:00:00.000Z' });
    expect(keys(input({ nodes: [n], sessions: [session(n.id, '2026-09-15', 100)] }))).not.toContain(
      'on-pace',
    );
  });
});

describe('planned-kept', () => {
  const n = node();
  const block = (date: string, over: Partial<PlannedBlock> = {}): PlannedBlock => ({
    id: `b${++seq}`,
    userId: 'u',
    nodeId: n.id,
    startAt: `${date}T16:00:00.000Z`,
    endAt: `${date}T17:00:00.000Z`,
    source: 'app',
    googleEventId: null,
    cancelled: false,
    ...over,
  });
  it('qualifies at 70% kept', () => {
    const blocks = ['15', '16', '17', '18'].map((d) => block(`2026-09-${d}`));
    const s = [
      session(n.id, '2026-09-15', 30),
      session(n.id, '2026-09-16', 30),
      session(n.id, '2026-09-17', 30),
    ];
    expect(
      find(input({ nodes: [n], plannedBlocks: blocks, sessions: s }), 'planned-kept')?.headline,
    ).toBe('You kept 3 of 4 planned blocks');
  });
  it('does not qualify below 70%', () => {
    const blocks = ['15', '16', '17'].map((d) => block(`2026-09-${d}`));
    expect(
      keys(
        input({ nodes: [n], plannedBlocks: blocks, sessions: [session(n.id, '2026-09-15', 30)] }),
      ),
    ).not.toContain('planned-kept');
  });
  it('ignores cancelled and future blocks', () => {
    const blocks = [block('2026-09-15', { cancelled: true }), block('2026-09-27')];
    expect(
      keys(
        input({ nodes: [n], plannedBlocks: blocks, sessions: [session(n.id, '2026-09-15', 30)] }),
      ),
    ).not.toContain('planned-kept');
  });
});

describe('estimate-beat / early-finish', () => {
  it('qualifies for a node completed under estimate and early', () => {
    const n = node({
      title: 'HW',
      estimatedMinutes: 300,
      dueAt: '2026-09-20T16:00:00.000Z',
      completedAt: '2026-09-16T16:00:00.000Z',
    });
    const r = getHighlights(input({ nodes: [n], sessions: [session(n.id, '2026-09-15', 240)] }));
    expect(r.highlights.find((h) => h.key === 'estimate-beat')?.headline).toBe(
      'Finished HW in 4 hours, estimated 5 hours',
    );
    expect(r.highlights.find((h) => h.key === 'early-finish')?.headline).toBe(
      'HW done 4 days early',
    );
  });
  it('does not qualify over estimate or late', () => {
    const n = node({
      estimatedMinutes: 100,
      dueAt: '2026-09-16T16:00:00.000Z',
      completedAt: '2026-09-16T16:00:00.000Z',
    });
    const k = keys(input({ nodes: [n], sessions: [session(n.id, '2026-09-15', 120)] }));
    expect(k).not.toContain('estimate-beat');
    expect(k).not.toContain('early-finish');
  });
  it('needs an estimate and a due date', () => {
    const n = node({ completedAt: '2026-09-16T16:00:00.000Z' });
    const k = keys(input({ nodes: [n], sessions: [session(n.id, '2026-09-15', 10)] }));
    expect(k).not.toContain('estimate-beat');
    expect(k).not.toContain('early-finish');
  });
});

describe('streak', () => {
  it('qualifies at 3 and scales with milestones', () => {
    const a = find(input({ streak: { ...emptyStreak(), current: 3, longest: 3 } }), 'streak');
    const b = find(input({ streak: { ...emptyStreak(), current: 7, longest: 7 } }), 'streak');
    expect(a?.headline).toBe('3-day streak');
    expect(b?.detail).toBe('A milestone');
    expect(b!.magnitude).toBeGreaterThan(a!.magnitude);
  });
  it('does not qualify below 3', () => {
    expect(keys(input({ streak: { ...emptyStreak(), current: 2, longest: 2 } }))).not.toContain(
      'streak',
    );
  });
});

describe('best-day', () => {
  const n = node();
  it('qualifies when a day beats the all-time record', () => {
    const s = [session(n.id, '2026-09-10', 60), session(n.id, '2026-09-15', 90)];
    expect(find(input({ nodes: [n], sessions: s }), 'best-day')?.headline).toBe(
      'Tuesday was your biggest study day yet',
    );
  });
  it('does not qualify when the record stands', () => {
    const s = [session(n.id, '2026-09-10', 120), session(n.id, '2026-09-15', 90)];
    expect(keys(input({ nodes: [n], sessions: s }))).not.toContain('best-day');
  });
  it('needs a previous day as baseline', () => {
    expect(keys(input({ nodes: [n], sessions: [session(n.id, '2026-09-15', 90)] }))).not.toContain(
      'best-day',
    );
  });
});

describe('xp-week', () => {
  const n = node();
  it('qualifies only for a record week', () => {
    const s = [
      session(n.id, '2026-09-08', 30, { xpAwarded: 40 }),
      session(n.id, '2026-09-15', 30, { xpAwarded: 30 }),
      session(n.id, '2026-09-16', 30, { xpAwarded: 30 }),
    ];
    expect(find(input({ nodes: [n], sessions: s }), 'xp-week')?.detail).toBe(
      '60 XP, previous best 40',
    );
  });
  it('does not qualify when a previous week was higher', () => {
    const s = [
      session(n.id, '2026-09-08', 30, { xpAwarded: 100 }),
      session(n.id, '2026-09-15', 30, { xpAwarded: 30 }),
    ];
    expect(keys(input({ nodes: [n], sessions: s }))).not.toContain('xp-week');
  });
  it('needs a previous week', () => {
    expect(
      keys(input({ nodes: [n], sessions: [session(n.id, '2026-09-15', 30, { xpAwarded: 30 })] })),
    ).not.toContain('xp-week');
  });
});
