import { describe, expect, it } from 'vitest';
import {
  BADGES,
  badgeByKey,
  evaluateBadges,
  satisfiedBadges,
  sessionDate,
  type BadgeInput,
} from './badges';
import { emptyStreak } from './streak';
import type { PlannedBlock, Session, StudyNode } from './types';

const TZ = 'America/Toronto';
let seq = 0;
const node = (over: Partial<StudyNode> = {}): StudyNode => ({
  id: `n${++seq}`,
  userId: 'u',
  parentId: null,
  title: `N${seq}`,
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
});
const session = (
  nodeId: string,
  startedAt: string,
  workMinutes: number,
  over: Partial<Session> = {},
): Session => ({
  id: `s${++seq}`,
  userId: 'u',
  nodeId,
  routineId: null,
  routineDate: null,
  startedAt,
  endedAt: new Date(Date.parse(startedAt) + workMinutes * 60_000).toISOString(),
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
const focused = (nodeId: string, at: string) =>
  session(nodeId, at, 30, {
    review: {
      skipped: false,
      prepared: null,
      distracted: 'no',
      completedCount: null,
      correctCount: null,
      mood: null,
      extraMinutesAdded: null,
      note: null,
    },
  });
const input = (over: Partial<BadgeInput> = {}): BadgeInput => ({
  nodes: [],
  sessions: [],
  plannedBlocks: [],
  streak: emptyStreak(),
  freezeDates: [],
  timezone: TZ,
  unlocked: [],
  today: '2026-09-20',
  ...over,
});

describe('badges', () => {
  it('catalogue has unique keys and lookups work', () => {
    expect(new Set(BADGES.map((b) => b.key)).size).toBe(BADGES.length);
    expect(badgeByKey('planner')?.name).toBe('Planner');
    expect(badgeByKey('nope')).toBeUndefined();
  });

  it('first-session and first-review', () => {
    const n = node();
    expect(
      evaluateBadges(input({ nodes: [n], sessions: [session(n.id, '2026-09-20T14:00:00Z', 10)] })),
    ).toEqual(['first-session']);
    expect(
      evaluateBadges(input({ nodes: [n], sessions: [focused(n.id, '2026-09-20T14:00:00Z')] })),
    ).toEqual(['first-session', 'first-review']);
    expect(
      evaluateBadges(
        input({
          nodes: [n],
          sessions: [focused(n.id, '2026-09-20T14:00:00Z')],
          unlocked: ['first-session', 'first-review'],
        }),
      ),
    ).toEqual([]);
  });

  it('focus-5 and focus-25 count sessions with no distraction', () => {
    const n = node();
    const five = Array.from({ length: 5 }, (_, i) => focused(n.id, `2026-09-1${i}T14:00:00Z`));
    expect(satisfiedBadges(input({ nodes: [n], sessions: five })).has('focus-5')).toBe(true);
    expect(satisfiedBadges(input({ nodes: [n], sessions: five })).has('focus-25')).toBe(false);
    const twentyFive = Array.from({ length: 25 }, (_, i) =>
      focused(n.id, `2026-08-${String(1 + (i % 28)).padStart(2, '0')}T14:00:00Z`),
    );
    expect(satisfiedBadges(input({ nodes: [n], sessions: twentyFive })).has('focus-25')).toBe(true);
  });

  it('estimate-oracle needs three completed nodes within 10%', () => {
    const mk = (est: number, logged: number) => {
      const n = node({ estimatedMinutes: est, completedAt: '2026-09-20T00:00:00Z' });
      return { n, s: session(n.id, '2026-09-19T14:00:00Z', logged) };
    };
    const a = mk(100, 95),
      b = mk(100, 108),
      c = mk(100, 120),
      d = mk(60, 60);
    const two = input({ nodes: [a.n, b.n, c.n], sessions: [a.s, b.s, c.s] });
    expect(satisfiedBadges(two).has('estimate-oracle')).toBe(false);
    const three = input({ nodes: [a.n, b.n, c.n, d.n], sessions: [a.s, b.s, c.s, d.s] });
    expect(satisfiedBadges(three).has('estimate-oracle')).toBe(true);
  });

  it('early-bird counts sessions starting before 08:00 local', () => {
    const n = node();
    // 11:30Z = 07:30 EDT
    const early = Array.from({ length: 5 }, (_, i) => session(n.id, `2026-09-1${i}T11:30:00Z`, 10));
    const late = Array.from({ length: 5 }, (_, i) => session(n.id, `2026-09-1${i}T12:30:00Z`, 10));
    expect(satisfiedBadges(input({ nodes: [n], sessions: early })).has('early-bird')).toBe(true);
    expect(satisfiedBadges(input({ nodes: [n], sessions: late })).has('early-bird')).toBe(false);
  });

  it('planner counts sessions inside planned blocks for the same node', () => {
    const n = node();
    const other = node();
    const blocks: PlannedBlock[] = Array.from({ length: 10 }, (_, i) => ({
      id: `b${i}`,
      userId: 'u',
      nodeId: n.id,
      startAt: `2026-09-${String(1 + i).padStart(2, '0')}T14:00:00Z`,
      endAt: `2026-09-${String(1 + i).padStart(2, '0')}T15:00:00Z`,
      source: 'app',
      title: null,
      sessionId: null,
      googleEventId: null,
      cancelled: false,
    }));
    const inside = blocks.map((b) => session(n.id, b.startAt, 30));
    expect(
      satisfiedBadges(input({ nodes: [n, other], sessions: inside, plannedBlocks: blocks })).has(
        'planner',
      ),
    ).toBe(true);
    const wrongNode = blocks.map((b) => session(other.id, b.startAt, 30));
    expect(
      satisfiedBadges(input({ nodes: [n, other], sessions: wrongNode, plannedBlocks: blocks })).has(
        'planner',
      ),
    ).toBe(false);
    const cancelled = blocks.map((b) => ({ ...b, cancelled: true }));
    expect(
      satisfiedBadges(input({ nodes: [n], sessions: inside, plannedBlocks: cancelled })).has(
        'planner',
      ),
    ).toBe(false);
  });

  it('streak badges use the best of current and longest', () => {
    expect(
      satisfiedBadges(input({ streak: { ...emptyStreak(), current: 7, longest: 7 } })).has(
        'streak-7',
      ),
    ).toBe(true);
    expect(
      satisfiedBadges(input({ streak: { ...emptyStreak(), current: 2, longest: 30 } })).has(
        'streak-30',
      ),
    ).toBe(true);
    expect(
      satisfiedBadges(input({ streak: { ...emptyStreak(), current: 99, longest: 99 } })).has(
        'streak-100',
      ),
    ).toBe(false);
  });

  it('course-complete needs a completed, non-archived course', () => {
    expect(
      satisfiedBadges(
        input({ nodes: [node({ kind: 'course', completedAt: '2026-09-20T00:00:00Z' })] }),
      ).has('course-complete'),
    ).toBe(true);
    expect(
      satisfiedBadges(
        input({
          nodes: [node({ kind: 'course', completedAt: '2026-09-20T00:00:00Z', archived: true })],
        }),
      ).has('course-complete'),
    ).toBe(false);
    expect(
      satisfiedBadges(
        input({ nodes: [node({ kind: 'task', completedAt: '2026-09-20T00:00:00Z' })] }),
      ).has('course-complete'),
    ).toBe(false);
  });

  it('no-freeze-30 requires a 30-day streak without a freeze in the window', () => {
    const streak = { ...emptyStreak(), current: 30, longest: 30 };
    expect(satisfiedBadges(input({ streak })).has('no-freeze-30')).toBe(true);
    expect(
      satisfiedBadges(input({ streak, freezeDates: ['2026-09-10'] })).has('no-freeze-30'),
    ).toBe(false);
    expect(
      satisfiedBadges(input({ streak, freezeDates: ['2026-08-01'] })).has('no-freeze-30'),
    ).toBe(true);
    expect(
      satisfiedBadges(input({ streak: { ...emptyStreak(), current: 29, longest: 29 } })).has(
        'no-freeze-30',
      ),
    ).toBe(false);
  });

  it('returns new badges in catalogue order', () => {
    const n = node();
    const keys = evaluateBadges(
      input({
        nodes: [n],
        sessions: [focused(n.id, '2026-09-20T14:00:00Z')],
        streak: { ...emptyStreak(), current: 7, longest: 7 },
        unlocked: ['first-session'],
      }),
    );
    expect(keys).toEqual(['first-review', 'streak-7']);
    expect(sessionDate(focused(n.id, '2026-09-21T03:00:00Z'), TZ)).toBe('2026-09-20');
  });
});

describe('badges added 2026-10-17', () => {
  it('counts tasks done and a task finished under its estimate', () => {
    const quick = node({ estimatedMinutes: 60, completedAt: '2026-09-19T15:00:00.000Z' });
    const done = Array.from({ length: 9 }, () => node({ completedAt: '2026-09-19T15:00:00.000Z' }));
    const s = satisfiedBadges(
      input({
        nodes: [quick, ...done],
        sessions: [session(quick.id, '2026-09-19T14:00:00.000Z', 40)],
      }),
    );
    expect(s.has('under-estimate')).toBe(true);
    expect(s.has('tasks-10')).toBe(true);
    expect(s.has('tasks-50')).toBe(false);
  });

  it('needs time logged before a task counts as under its estimate', () => {
    const n = node({ estimatedMinutes: 60, completedAt: '2026-09-19T15:00:00.000Z' });
    expect(satisfiedBadges(input({ nodes: [n] })).has('under-estimate')).toBe(false);
  });

  it('unlocks the longer ladders at their thresholds', () => {
    const n = node();
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session(n.id, `2026-09-${String(10 + i).padStart(2, '0')}T14:00:00.000Z`, 30),
    );
    const s = satisfiedBadges(
      input({
        nodes: [n],
        sessions: [...sessions, session(n.id, '2026-09-01T12:00:00.000Z', 6 * 60)],
        streak: { ...emptyStreak(), current: 14, longest: 14 },
        perfectRoutineWeeks: 4,
      }),
    );
    expect(s.has('sessions-10')).toBe(true);
    expect(s.has('ultramarathon')).toBe(true);
    expect(s.has('streak-14')).toBe(true);
    expect(s.has('routine-perfect-4')).toBe(true);
    expect(s.has('sessions-500')).toBe(false);
    expect(s.has('hours-250')).toBe(false);
  });
});

describe('badge XP', () => {
  it('pays every badge, more for the ones that ask more', async () => {
    const { BADGES, BADGE_XP, badgeXp } = await import('./badges');
    for (const b of BADGES) expect(BADGE_XP[b.key], b.key).toBeGreaterThan(0);
    expect(Object.keys(BADGE_XP).sort()).toEqual(BADGES.map((b) => b.key).sort());
    expect(badgeXp('streak-100')).toBeGreaterThan(badgeXp('streak-30'));
    expect(badgeXp('streak-30')).toBeGreaterThan(badgeXp('streak-7'));
    expect(badgeXp('hours-250')).toBeGreaterThan(badgeXp('hours-10'));
  });
});

describe('Jack mode badges', () => {
  const rolled = (workMinutes: number, rolls: number, startedAt = '2026-09-20T14:00:00.000Z') =>
    session('n', startedAt, workMinutes, {
      mode: 'pomodoro',
      jack: { rolls, wonSeconds: 0, lostSeconds: 0 },
    });

  it('counts rolls across sessions', () => {
    const s = satisfiedBadges(input({ sessions: [rolled(25, 6), rolled(25, 5)] }));
    expect(s.has('gamble-1')).toBe(true);
    expect(s.has('gamble-10')).toBe(true);
    expect(s.has('gamble-25')).toBe(false);
  });

  it('makes a Gambler after more than 45 minutes with Jack mode on', () => {
    const has = (sessions: Session[]) => satisfiedBadges(input({ sessions })).has('gambler');
    expect(has([rolled(45, 1)])).toBe(false);
    expect(has([rolled(25, 1), rolled(21, 0)])).toBe(true);
    // Time without Jack mode doesn't count toward it.
    expect(has([session('n', '2026-09-20T16:00:00.000Z', 120), rolled(20, 1)])).toBe(false);
  });

  it('marks every Jack mode badge, and only those', () => {
    const jack = BADGES.filter((b) => b.jack).map((b) => b.key);
    expect(jack.sort()).toEqual(
      ['gambler', 'gamble-1', 'gamble-10', 'gamble-25', 'gamble-50', 'gamble-100'].sort(),
    );
  });
});
