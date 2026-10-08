import { describe, expect, it } from 'vitest';
import {
  courseAnalytics,
  estimateAccuracy,
  nodeAnalytics,
  pendingFollowUps,
  weeklyReview,
  type AnalyticsInput,
} from './analytics';
import { emptyRestDayPolicy } from './rest-days';
import { emptyStreak } from './streak';
import type { PlannedBlock, Session, StudyNode } from './types';

const TZ = 'America/Toronto';
const NOW = '2026-09-20T20:00:00.000Z';
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
  gradeMode: null,
  gradeOverall: null,
  gradeCredits: null,
  childDefaults: null,
  ...over,
});
const session = (
  nodeId: string,
  date: string,
  workMinutes: number,
  over: Partial<Session> = {},
): Session => ({
  id: `s${++seq}`,
  userId: 'u',
  nodeId,
  routineId: null,
  routineDate: null,
  startedAt: `${date}T16:00:00.000Z`,
  endedAt: `${date}T17:00:00.000Z`,
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
const block = (
  nodeId: string | null,
  date: string,
  hours: number,
  over: Partial<PlannedBlock> = {},
): PlannedBlock => ({
  id: `b${++seq}`,
  userId: 'u',
  nodeId,
  startAt: `${date}T16:00:00.000Z`,
  endAt: `${date}T${16 + hours}:00:00.000Z`,
  source: 'app',
  title: null,
  sessionId: null,
  googleEventId: null,
  cancelled: false,
  ...over,
});
const ctx = {
  now: NOW,
  timezone: TZ,
  policy: emptyRestDayPolicy('u'),
  maxComfortableMinutesPerDay: 240,
};
const input = (over: Partial<AnalyticsInput> = {}): AnalyticsInput => ({
  nodes: [],
  sessions: [],
  plannedBlocks: [],
  ctx,
  ...over,
});

describe('nodeAnalytics', () => {
  it('collects sessions, planned vs needed, preparedness, distraction rate', () => {
    const course = node({ kind: 'course' });
    const quiz = node({ kind: 'assessment', parentId: course.id, estimatedMinutes: 300 });
    const sub = node({ parentId: quiz.id });
    const sessions = [
      session(quiz.id, '2026-09-10', 60, {
        review: {
          skipped: false,
          prepared: 2,
          distracted: 'a-lot',
          completedCount: null,
          correctCount: null,
          mood: null,
          extraMinutesAdded: null,
          note: null,
        },
      }),
      session(sub.id, '2026-09-15', 60, {
        review: {
          skipped: false,
          prepared: 4,
          distracted: 'no',
          completedCount: null,
          correctCount: null,
          mood: null,
          extraMinutesAdded: null,
          note: null,
        },
      }),
    ];
    const blocks = [
      block(quiz.id, '2026-09-25', 2),
      block(sub.id, '2026-09-26', 1),
      block(quiz.id, '2026-09-01', 3),
      block(quiz.id, '2026-09-27', 1, { cancelled: true }),
    ];
    const a = nodeAnalytics(
      input({ nodes: [course, quiz, sub], sessions, plannedBlocks: blocks }),
      quiz.id,
    )!;
    expect(a.sessions).toHaveLength(2);
    expect(a.sessions[0]!.startedAt > a.sessions[1]!.startedAt).toBe(true);
    expect(a.plannedMinutes).toBe(180);
    expect(a.neededMinutes).toBe(180);
    expect(a.preparedness.map((p) => p.value)).toEqual([2, 4]);
    expect(a.distractionRate).toBe(0.5);
    expect(nodeAnalytics(input(), 'missing')).toBeNull();
  });
  it('reports null distraction rate with no answers', () => {
    const n = node();
    expect(
      nodeAnalytics(input({ nodes: [n], sessions: [session(n.id, '2026-09-15', 10)] }), n.id)!
        .distractionRate,
    ).toBeNull();
  });
});

describe('courseAnalytics', () => {
  it('stacks hours by child for this week and last week', () => {
    const course = node({ kind: 'course', title: 'C' });
    const a = node({ parentId: course.id, title: 'A' });
    const b = node({ parentId: course.id, title: 'B' });
    const deep = node({ parentId: b.id });
    const sessions = [
      session(a.id, '2026-09-15', 60),
      session(deep.id, '2026-09-16', 30),
      session(b.id, '2026-09-09', 45),
      session(course.id, '2026-09-17', 15),
    ];
    const [c] = courseAnalytics(input({ nodes: [course, a, b, deep], sessions }), '2026-09-14');
    expect(c!.children.map((x) => [x.title, x.thisWeek, x.lastWeek])).toEqual([
      ['A', 60, 0],
      ['B', 30, 45],
      ['C (direct)', 15, 0],
    ]);
    expect(c!.thisWeekTotal).toBe(105);
    expect(c!.lastWeekTotal).toBe(45);
  });
});

describe('estimateAccuracy', () => {
  it('computes ratios and an underestimate insight', () => {
    const hw1 = node({ estimatedMinutes: 100, completedAt: NOW });
    const hw2 = node({ estimatedMinutes: 100, completedAt: NOW });
    const open = node({ estimatedMinutes: 100 });
    const sessions = [
      session(hw1.id, '2026-09-10', 130),
      session(hw2.id, '2026-09-11', 140),
      session(open.id, '2026-09-12', 50),
    ];
    const e = estimateAccuracy(input({ nodes: [hw1, hw2, open], sessions }));
    expect(e.samples.map((s) => s.ratio)).toEqual([1.3, 1.4]);
    expect(e.byKind).toEqual([{ kind: 'task', median: 1.35, count: 2 }]);
    expect(e.insight).toBe('You typically underestimate homework by ~35%');
  });
  it('reports overestimates and accurate estimates', () => {
    const a = node({ kind: 'assessment', estimatedMinutes: 100, completedAt: NOW });
    const b = node({ kind: 'assessment', estimatedMinutes: 100, completedAt: NOW });
    const over = estimateAccuracy(
      input({
        nodes: [a, b],
        sessions: [session(a.id, '2026-09-10', 60), session(b.id, '2026-09-11', 70)],
      }),
    );
    expect(over.insight).toBe('You typically overestimate assessment prep by ~35%');
    const close = estimateAccuracy(
      input({
        nodes: [a, b],
        sessions: [session(a.id, '2026-09-10', 98), session(b.id, '2026-09-11', 104)],
      }),
    );
    expect(close.insight).toMatch(/close to actual/);
    expect(estimateAccuracy(input()).insight).toBeNull();
  });
});

describe('weeklyReview', () => {
  it('summarises planned vs actual, distraction days, freezes, edits', () => {
    const n = node();
    const sessions = [
      session(n.id, '2026-09-15', 60, {
        review: {
          skipped: false,
          prepared: null,
          distracted: 'a-lot',
          completedCount: null,
          correctCount: null,
          mood: null,
          extraMinutesAdded: null,
          note: null,
        },
      }),
      session(n.id, '2026-09-15', 30, {
        review: {
          skipped: false,
          prepared: null,
          distracted: 'a-lot',
          completedCount: null,
          correctCount: null,
          mood: null,
          extraMinutesAdded: null,
          note: null,
        },
      }),
      session(n.id, '2026-09-17', 30, {
        review: {
          skipped: false,
          prepared: null,
          distracted: 'a-lot',
          completedCount: null,
          correctCount: null,
          mood: null,
          extraMinutesAdded: null,
          note: null,
        },
      }),
      session(n.id, '2026-09-08', 30),
    ];
    const blocks = [
      block(n.id, '2026-09-16', 2),
      block(n.id, '2026-09-30', 2),
      block(n.id, '2026-09-18', 1, { cancelled: true }),
    ];
    const policy = {
      ...emptyRestDayPolicy('u'),
      changeLog: [
        { at: '2026-09-02T10:00:00.000Z', what: 'weekly:1@2026-09-07' },
        { at: '2026-08-20T10:00:00.000Z', what: 'weekly:2@2026-08-24' },
      ],
    };
    const r = weeklyReview({
      ...input({ nodes: [n], sessions, plannedBlocks: blocks }),
      weekStart: '2026-09-14',
      streak: { ...emptyStreak(), current: 4, longest: 4 },
      freezeDates: ['2026-09-16', '2026-09-01'],
      policy,
    });
    expect(r.weekEnd).toBe('2026-09-20');
    expect(r.plannedMinutes).toBe(120);
    expect(r.actualMinutes).toBe(120);
    expect(r.sessions).toBe(3);
    expect(r.freezesUsed).toBe(1);
    expect(r.topDistractionDays).toEqual([
      { date: '2026-09-15', count: 2 },
      { date: '2026-09-17', count: 1 },
    ]);
    expect(r.restDayEditsThisMonth).toBe(1);
    expect(r.hoursByDay).toHaveLength(7);
    expect(r.hoursByDay.find((d) => d.date === '2026-09-15')?.minutes).toBe(90);
  });
});

describe('pendingFollowUps', () => {
  it('returns assessments due at least a day ago without an outcome', () => {
    const due = node({ kind: 'assessment', dueAt: '2026-09-18T16:00:00.000Z' });
    const yesterday = node({ kind: 'assessment', dueAt: '2026-09-19T16:00:00.000Z' });
    const today = node({ kind: 'assessment', dueAt: '2026-09-20T16:00:00.000Z' });
    const rated = node({ kind: 'assessment', dueAt: '2026-09-10T16:00:00.000Z', outcomeRating: 4 });
    const task = node({ dueAt: '2026-09-10T16:00:00.000Z' });
    expect(
      pendingFollowUps([due, yesterday, today, rated, task], NOW, TZ).map((n) => n.id),
    ).toEqual([due.id, yesterday.id]);
  });
});
