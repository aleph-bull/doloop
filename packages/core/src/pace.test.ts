import { describe, expect, it } from 'vitest';
import {
  computePace,
  getDailyPlan,
  recentAveragePerStudyDay,
  studyDaysRemaining,
  worstStatus,
  type PaceContext,
} from './pace';
import { emptyRestDayPolicy } from './rest-days';
import type { Session, StudyNode } from './types';

const TZ = 'America/Toronto';
// Sunday 2026-09-20, 14:00 local (18:00Z)
const NOW = '2026-09-20T18:00:00.000Z';

const ctx = (over: Partial<PaceContext> = {}): PaceContext => ({
  now: NOW,
  timezone: TZ,
  policy: emptyRestDayPolicy('u1'),
  maxComfortableMinutesPerDay: 240,
  ...over,
});

let seq = 0;
const node = (over: Partial<StudyNode> = {}): StudyNode => ({
  id: `n${++seq}`,
  userId: 'u1',
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

const session = (
  nodeId: string,
  workMinutes: number,
  startedAt = NOW,
  over: Partial<Session> = {},
): Session => ({
  id: `s${++seq}`,
  userId: 'u1',
  nodeId,
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
  ...over,
});

/** Local noon on a date, as UTC ISO (EDT = -4). */
const localNoon = (date: string) => `${date}T16:00:00.000Z`;

describe('studyDaysRemaining', () => {
  const policy = { ...emptyRestDayPolicy('u1'), weeklyRestDays: [0, 6] };

  it('counts days from today through the day before due, excluding rest days', () => {
    // Sun 20 (rest) .. due Fri 25 -> Mon..Thu = 4 study days
    expect(studyDaysRemaining('2026-09-20', '2026-09-25', policy)).toBe(4);
    // No rest days: 5 days
    expect(studyDaysRemaining('2026-09-20', '2026-09-25', emptyRestDayPolicy('u1'))).toBe(5);
  });

  it('excludes today if today is a rest day', () => {
    expect(studyDaysRemaining('2026-09-20', '2026-09-21', policy)).toBe(0);
    expect(studyDaysRemaining('2026-09-21', '2026-09-22', policy)).toBe(1);
  });

  it('returns 0 when due today or in the past', () => {
    expect(studyDaysRemaining('2026-09-21', '2026-09-21', policy)).toBe(0);
    expect(studyDaysRemaining('2026-09-21', '2026-09-10', policy)).toBe(0);
  });

  it('excludes vacation days, including a vacation spanning the due date', () => {
    const p = {
      ...emptyRestDayPolicy('u1'),
      vacations: [{ from: '2026-09-23', to: '2026-09-30', label: 'trip' }],
    };
    // Mon 21 .. due Fri 25: 21, 22 study; 23, 24 vacation -> 2
    expect(studyDaysRemaining('2026-09-21', '2026-09-25', p)).toBe(2);
  });

  it('excludes purchased break days', () => {
    const p = { ...emptyRestDayPolicy('u1'), breakDays: ['2026-09-22'] };
    expect(studyDaysRemaining('2026-09-21', '2026-09-24', p)).toBe(2);
  });
});

describe('computePace leaf statuses', () => {
  it('reports no-estimate for a node without an estimate', () => {
    const n = node({ dueAt: localNoon('2026-09-30') });
    const p = computePace([n], [], ctx()).get(n.id)!;
    expect(p.status).toBe('no-estimate');
    expect(p.progress).toBeNull();
    expect(p.remainingMinutes).toBeNull();
    expect(p.requiredPerDay).toBeNull();
    expect(p.studyDaysRemaining).toBe(10);
  });

  it('a no-estimate node can still log time and become overdue or done', () => {
    const n = node({ dueAt: localNoon('2026-09-10') });
    const s = session(n.id, 30);
    let p = computePace([n], [s], ctx()).get(n.id)!;
    expect(p.loggedWorkMinutes).toBe(30);
    expect(p.status).toBe('overdue');
    p = computePace([{ ...n, completedAt: NOW }], [s], ctx()).get(n.id)!;
    expect(p.status).toBe('done');
  });

  it('is on-track with an estimate but no due date', () => {
    const n = node({ estimatedMinutes: 120 });
    const p = computePace([n], [session(n.id, 30)], ctx()).get(n.id)!;
    expect(p.status).toBe('on-track');
    expect(p.remainingMinutes).toBe(90);
    expect(p.progress).toBeCloseTo(0.25);
    expect(p.requiredPerDay).toBeNull();
    expect(p.dueDate).toBeNull();
  });

  it('is done when remaining hits zero, and caps progress at 1 while keeping the raw ratio', () => {
    const n = node({ estimatedMinutes: 60, dueAt: localNoon('2026-09-30') });
    const p = computePace([n], [session(n.id, 90)], ctx()).get(n.id)!;
    expect(p.status).toBe('done');
    expect(p.remainingMinutes).toBe(0);
    expect(p.progress).toBe(1);
    expect(p.rawProgress).toBeCloseTo(1.5);
    expect(p.requiredPerDay).toBeNull();
  });

  it('is done when completedAt is set even with time remaining', () => {
    const n = node({ estimatedMinutes: 60, dueAt: localNoon('2026-09-30'), completedAt: NOW });
    const p = computePace([n], [session(n.id, 10)], ctx()).get(n.id)!;
    expect(p.status).toBe('done');
    expect(p.remainingMinutes).toBe(0);
    expect(p.progress).toBe(1);
  });

  it('is overdue when due in the past with work remaining', () => {
    const n = node({ estimatedMinutes: 60, dueAt: localNoon('2026-09-19') });
    const p = computePace([n], [], ctx()).get(n.id)!;
    expect(p.status).toBe('overdue');
    expect(p.studyDaysRemaining).toBe(0);
    expect(p.requiredPerDay).toBe(60);
  });

  it('handles due today: zero study days, required equals remaining', () => {
    // due 20:00 local today (after now)
    const n = node({ estimatedMinutes: 100, dueAt: '2026-09-21T00:00:00.000Z' });
    const p = computePace([n], [], ctx()).get(n.id)!;
    expect(p.dueDate).toBe('2026-09-20');
    expect(p.studyDaysRemaining).toBe(0);
    expect(p.requiredPerDay).toBe(100);
    // Nothing studied recently and the deadline is within 3 study days -> behind, not critical.
    expect(p.status).toBe('behind');
  });

  it('marks behind when required exceeds 1.25x recent average and deadline is within 3 study days', () => {
    // due in 2 days, need 200 minutes, studied 40/day recently
    const n = node({ estimatedMinutes: 300, dueAt: localNoon('2026-09-22') });
    const sessions = [
      session(n.id, 40, localNoon('2026-09-18')),
      session(n.id, 60, localNoon('2026-09-19')),
    ];
    // recent avg over 7 study days = 100 / 7 = 14.3; required = 200 / 2 = 100 -> behind
    const p = computePace([n], sessions, ctx()).get(n.id)!;
    expect(p.requiredPerDay).toBe(100);
    expect(p.status).toBe('behind');
  });

  it('is not behind when the deadline is far, even if required exceeds the average', () => {
    const n = node({ estimatedMinutes: 300, dueAt: localNoon('2026-10-20') });
    const p = computePace([n], [], ctx()).get(n.id)!;
    expect(p.status).toBe('on-track');
  });

  it('is not behind when the recent average is high enough', () => {
    const n = node({ estimatedMinutes: 300, dueAt: localNoon('2026-09-22') });
    const sessions = Array.from({ length: 7 }, (_, i) =>
      session(n.id, 100, localNoon(`2026-09-${14 + i}`)),
    );
    // logged 700 -> remaining 0 -> done. Make estimate bigger.
    const p = computePace([{ ...n, estimatedMinutes: 900 }], sessions, ctx()).get(n.id)!;
    // remaining 200, 2 days -> 100/day; avg = 100/day -> 100 > 125? no -> on-track
    expect(p.status).toBe('on-track');
  });

  it('marks critical when required exceeds the comfortable daily maximum', () => {
    const n = node({ estimatedMinutes: 1000, dueAt: localNoon('2026-09-22') });
    const p = computePace([n], [], ctx()).get(n.id)!;
    expect(p.requiredPerDay).toBe(500);
    expect(p.status).toBe('critical');
  });

  it('respects rest days inside the window when computing required per day', () => {
    const policy = { ...emptyRestDayPolicy('u1'), weeklyRestDays: [0, 6] };
    // today Sun 20 (rest); due Sat 26 -> Mon..Fri = 5 study days
    const n = node({ estimatedMinutes: 500, dueAt: localNoon('2026-09-26') });
    const p = computePace([n], [], ctx({ policy })).get(n.id)!;
    expect(p.studyDaysRemaining).toBe(5);
    expect(p.requiredPerDay).toBe(100);
  });

  it('treats a vacation spanning the due date as zero study days (required = remaining)', () => {
    const policy = {
      ...emptyRestDayPolicy('u1'),
      vacations: [{ from: '2026-09-20', to: '2026-09-30', label: 'away' }],
    };
    const n = node({ estimatedMinutes: 120, dueAt: localNoon('2026-09-25') });
    const p = computePace([n], [], ctx({ policy })).get(n.id)!;
    expect(p.studyDaysRemaining).toBe(0);
    expect(p.requiredPerDay).toBe(120);
  });

  it('separates cumulative desk time from work', () => {
    const n = node({ estimatedMinutes: 60 });
    const s = session(n.id, 20, NOW, { breakSeconds: 300, idleSeconds: 120 });
    const p = computePace([n], [s], ctx()).get(n.id)!;
    expect(p.loggedWorkMinutes).toBe(20);
    expect(p.cumulativeMinutes).toBe(27);
  });

  it('ignores archived nodes', () => {
    const n = node({ estimatedMinutes: 60, archived: true });
    expect(computePace([n], [], ctx()).has(n.id)).toBe(false);
  });
});

describe('computePace aggregation', () => {
  it('rolls up a child with an estimate under a parent without one', () => {
    const course = node({ kind: 'course', title: 'EAS101' });
    const hw = node({ parentId: course.id, estimatedMinutes: 300, dueAt: localNoon('2026-09-25') });
    const quiz = node({
      parentId: course.id,
      kind: 'assessment',
      estimatedMinutes: 120,
      dueAt: localNoon('2026-09-22'),
    });
    const sessions = [session(hw.id, 60), session(quiz.id, 30)];
    const paces = computePace([course, hw, quiz], sessions, ctx());
    const c = paces.get(course.id)!;
    expect(c.aggregated).toBe(true);
    expect(c.contributingChildren.sort()).toEqual([hw.id, quiz.id].sort());
    expect(c.estimatedMinutes).toBe(420);
    expect(c.remainingMinutes).toBe(330);
    expect(c.loggedWorkMinutes).toBe(90);
    // hw: 240 / 5 days = 48; quiz: 90 / 2 = 45 -> sum 93
    expect(c.requiredPerDay).toBeCloseTo(93);
    expect(c.progress).toBeCloseTo(90 / 420);
  });

  it('uses the worst child status', () => {
    const course = node({ kind: 'course' });
    const a = node({ parentId: course.id, estimatedMinutes: 60, dueAt: localNoon('2026-09-10') });
    const b = node({ parentId: course.id, estimatedMinutes: 60, dueAt: localNoon('2026-10-10') });
    const paces = computePace([course, a, b], [], ctx());
    expect(paces.get(a.id)!.status).toBe('overdue');
    expect(paces.get(b.id)!.status).toBe('on-track');
    expect(paces.get(course.id)!.status).toBe('overdue');
  });

  it('counts descendant sessions toward the parent and grandparent', () => {
    const course = node({ kind: 'course' });
    const unit = node({ parentId: course.id });
    const task = node({ parentId: unit.id, estimatedMinutes: 100 });
    const paces = computePace([course, unit, task], [session(task.id, 25)], ctx());
    expect(paces.get(unit.id)!.loggedWorkMinutes).toBe(25);
    expect(paces.get(course.id)!.loggedWorkMinutes).toBe(25);
    expect(paces.get(course.id)!.aggregated).toBe(true);
    expect(paces.get(unit.id)!.aggregated).toBe(true);
  });

  it('leaves a parent as a leaf when no child carries an estimate', () => {
    const course = node({ kind: 'course', estimatedMinutes: 200, dueAt: localNoon('2026-09-30') });
    const note = node({ parentId: course.id });
    const paces = computePace([course, note], [session(note.id, 50)], ctx());
    const c = paces.get(course.id)!;
    expect(c.aggregated).toBe(false);
    expect(c.loggedWorkMinutes).toBe(50);
    expect(c.remainingMinutes).toBe(150);
  });

  it("keeps the parent's own estimate when a child is estimated too", () => {
    // The reported bug: estimating one unit at 1 h rewrote the 16 h test above it.
    const course = node({ kind: 'course', title: 'ECO220' });
    const test1 = node({
      parentId: course.id,
      kind: 'assessment',
      title: 'Test 1',
      estimatedMinutes: 960,
    });
    const unit1 = node({ parentId: test1.id, title: 'Unit 1', estimatedMinutes: 60 });
    const paces = computePace([course, test1, unit1], [session(unit1.id, 30)], ctx());

    const t = paces.get(test1.id)!;
    expect(t.estimatedMinutes).toBe(960);
    expect(t.aggregated).toBe(false);
    expect(t.contributingChildren).toEqual([unit1.id]);
    expect(t.loggedWorkMinutes).toBe(30);
    expect(t.remainingMinutes).toBe(930);
    expect(t.progress).toBeCloseTo(30 / 960);

    // The course has no estimate of its own, so it takes the sum of its direct children.
    const c = paces.get(course.id)!;
    expect(c.aggregated).toBe(true);
    expect(c.estimatedMinutes).toBe(960);
    expect(c.progress).toBeCloseTo(30 / 960);
  });

  it('still surfaces a struggling child on a parent that has its own estimate', () => {
    const test1 = node({ estimatedMinutes: 960, dueAt: localNoon('2026-10-30') });
    const unit1 = node({
      parentId: test1.id,
      estimatedMinutes: 60,
      dueAt: localNoon('2026-09-10'),
    });
    const paces = computePace([test1, unit1], [], ctx());
    expect(paces.get(unit1.id)!.status).toBe('overdue');
    expect(paces.get(test1.id)!.status).toBe('overdue');
    expect(paces.get(test1.id)!.estimatedMinutes).toBe(960);
  });

  it('gives a node with no estimate anywhere in its subtree hours but no percentage', () => {
    const course = node({ kind: 'course' });
    const note = node({ parentId: course.id });
    const paces = computePace([course, note], [session(note.id, 45)], ctx());
    const c = paces.get(course.id)!;
    expect(c.estimatedMinutes).toBeNull();
    expect(c.progress).toBeNull();
    expect(c.loggedWorkMinutes).toBe(45);
    expect(c.status).toBe('no-estimate');
  });

  it('sums only the direct children, not every descendant', () => {
    // Test 1 (16 h) breaks down into two units; the course must see 16 h, not 16 h + 3 h.
    const course = node({ kind: 'course' });
    const test1 = node({ parentId: course.id, estimatedMinutes: 960 });
    const unitA = node({ parentId: test1.id, estimatedMinutes: 60 });
    const unitB = node({ parentId: test1.id, estimatedMinutes: 120 });
    const paces = computePace([course, test1, unitA, unitB], [], ctx());
    expect(paces.get(course.id)!.estimatedMinutes).toBe(960);
    expect(paces.get(course.id)!.contributingChildren).toEqual([test1.id]);
  });

  it('marks a completed parent done regardless of children', () => {
    const course = node({ kind: 'course', completedAt: NOW });
    const a = node({ parentId: course.id, estimatedMinutes: 60, dueAt: localNoon('2026-09-10') });
    const paces = computePace([course, a], [], ctx());
    expect(paces.get(course.id)!.status).toBe('done');
    expect(paces.get(course.id)!.remainingMinutes).toBe(0);
  });

  it('worstStatus orders correctly', () => {
    expect(worstStatus(['done', 'on-track'])).toBe('on-track');
    expect(worstStatus(['behind', 'critical'])).toBe('critical');
    expect(worstStatus(['critical', 'overdue'])).toBe('overdue');
    expect(worstStatus([])).toBe('done');
    expect(worstStatus(['no-estimate', 'done'])).toBe('no-estimate');
  });
});

describe('recentAveragePerStudyDay', () => {
  it('divides by study days in the window, not calendar days', () => {
    const policy = { ...emptyRestDayPolicy('u1'), weeklyRestDays: [0, 6] };
    const sessions = [
      session('n', 50, localNoon('2026-09-15')),
      session('n', 50, localNoon('2026-09-16')),
    ];
    // window Sep 14..20: Mon-Fri = 5 study days -> 100 / 5 = 20
    expect(recentAveragePerStudyDay(sessions, '2026-09-20', ctx({ policy }))).toBe(20);
    // outside window
    expect(
      recentAveragePerStudyDay([session('n', 50, localNoon('2026-09-01'))], '2026-09-20', ctx()),
    ).toBe(0);
  });
});

describe('getDailyPlan', () => {
  it('orders by urgency with overdue first and suggests minutes', () => {
    const course = node({ kind: 'course' });
    const late = node({
      parentId: course.id,
      title: 'Late',
      estimatedMinutes: 60,
      dueAt: localNoon('2026-09-10'),
    });
    const soon = node({
      parentId: course.id,
      title: 'Soon',
      estimatedMinutes: 200,
      dueAt: localNoon('2026-09-22'),
    });
    const far = node({
      parentId: course.id,
      title: 'Far',
      estimatedMinutes: 600,
      dueAt: localNoon('2026-10-20'),
    });
    const noDue = node({ parentId: course.id, title: 'NoDue', estimatedMinutes: 90 });
    const done = node({
      parentId: course.id,
      title: 'Done',
      estimatedMinutes: 10,
      completedAt: NOW,
    });
    const noEst = node({ parentId: course.id, title: 'NoEst' });
    const plan = getDailyPlan([course, late, soon, far, noDue, done, noEst], [], ctx());
    expect(plan.map((p) => p.title)).toEqual(['Late', 'Soon', 'Far', 'NoDue']);
    const [l, s, f, n] = plan;
    expect(l!.suggestedMinutes).toBe(60);
    expect(s!.suggestedMinutes).toBe(100);
    expect(f!.suggestedMinutes).toBe(20); // 600/30 = 20
    expect(n!.suggestedMinutes).toBe(60); // default
    expect(l!.urgency).toBe(1);
  });

  it('caps suggestions at the comfortable maximum and never below 5', () => {
    const big = node({ estimatedMinutes: 2000, dueAt: localNoon('2026-09-21') });
    const tiny = node({ estimatedMinutes: 3, dueAt: localNoon('2026-09-30') });
    const plan = getDailyPlan([big, tiny], [], ctx());
    expect(plan.find((p) => p.nodeId === big.id)!.suggestedMinutes).toBe(240);
    expect(plan.find((p) => p.nodeId === tiny.id)!.suggestedMinutes).toBe(5);
  });

  it('breaks ties by due date then title', () => {
    const a = node({ title: 'B', estimatedMinutes: 100, dueAt: localNoon('2026-09-25') });
    const b = node({ title: 'A', estimatedMinutes: 100, dueAt: localNoon('2026-09-25') });
    const c = node({ title: 'C', estimatedMinutes: 100 });
    const d = node({ title: 'D', estimatedMinutes: 100 });
    const plan = getDailyPlan([a, b, c, d], [], ctx());
    expect(plan.map((p) => p.title)).toEqual(['A', 'B', 'C', 'D']);
  });
});
