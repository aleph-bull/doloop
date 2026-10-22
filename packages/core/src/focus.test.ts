import { describe, expect, it } from 'vitest';
import { expectedMinutes, focusContext, focusLabel, focusProgress } from './focus';

const tree = new Map([
  ['course', { title: 'Financial Accounting', parentId: null }],
  ['unit', { title: 'Chapter 3', parentId: 'course' }],
  ['task', { title: 'Adjusting Entries', parentId: 'unit' }],
  ['lone', { title: 'Read the syllabus', parentId: null }],
]);

describe('focusContext', () => {
  it('names the root course and the task under it', () => {
    expect(focusContext(tree, 'task', 'x')).toEqual({
      subject: 'Financial Accounting',
      child: 'Adjusting Entries',
    });
    expect(focusContext(tree, 'unit', 'x')).toEqual({
      subject: 'Financial Accounting',
      child: 'Chapter 3',
    });
  });

  it('gives a root task no child line', () => {
    expect(focusContext(tree, 'lone', 'x')).toEqual({ subject: 'Read the syllabus', child: null });
  });

  it('falls back to the session title for a routine or an unknown node', () => {
    expect(focusContext(tree, null, 'Morning review')).toEqual({
      subject: 'Morning review',
      child: null,
    });
    expect(focusContext(tree, 'missing', 'Something')).toEqual({
      subject: 'Something',
      child: null,
    });
  });
});

describe('focusLabel', () => {
  it('puts the course and the task on one line, skipping the units between', () => {
    expect(focusLabel(focusContext(tree, 'task', 'x'))).toBe(
      'Financial Accounting · Adjusting Entries',
    );
    expect(focusLabel(focusContext(tree, 'lone', 'x'))).toBe('Read the syllabus');
  });
});

describe('focusProgress', () => {
  it('has no bar without an expectation', () => {
    for (const expected of [null, undefined, 0, -5]) {
      const p = focusProgress(763, expected);
      expect(p.fraction).toBeNull();
      expect(p.expectedSeconds).toBeNull();
      expect(p.exceeded).toBe(false);
      expect(p.priorFraction).toBeNull();
      expect(p.totalSeconds).toBe(763);
      expect(p.sessionSeconds).toBe(763);
    }
  });

  it('measures the total against expected and caps the bar', () => {
    expect(focusProgress(750, 25)).toEqual({
      priorSeconds: 0,
      sessionSeconds: 750,
      totalSeconds: 750,
      expectedSeconds: 1500,
      priorFraction: 0,
      fraction: 0.5,
      exceeded: false,
    });
    const over = focusProgress(1800, 25);
    expect(over.fraction).toBe(1);
    expect(over.exceeded).toBe(true);
    expect(focusProgress(1500, 25).exceeded).toBe(false);
  });

  it('never goes negative', () => {
    expect(focusProgress(-10, 25).totalSeconds).toBe(0);
  });

  it('starts from the work already logged on the task, kept apart from this session', () => {
    // 35 minutes logged earlier, 1:16 into this session, against an hour.
    const p = focusProgress(76, 60, 35 * 60);
    expect(p.priorSeconds).toBe(35 * 60);
    expect(p.sessionSeconds).toBe(76);
    expect(p.totalSeconds).toBe(35 * 60 + 76);
    expect(p.priorFraction).toBeCloseTo((35 * 60) / 3600, 5);
    expect(p.fraction).toBeCloseTo((35 * 60 + 76) / 3600, 5);
    expect(focusProgress(0, null, 600).totalSeconds).toBe(600);
    expect(focusProgress(10, 25, -5)).toMatchObject({ priorSeconds: 0, totalSeconds: 10 });
  });

  it('caps both parts of the bar when earlier work alone passes the expectation', () => {
    const p = focusProgress(120, 30, 40 * 60);
    expect(p.priorFraction).toBe(1);
    expect(p.fraction).toBe(1);
    expect(p.exceeded).toBe(true);
  });
});

describe('expectedMinutes', () => {
  const at = { startedAt: '2026-09-22T10:00:00.000Z', plannedEndAt: null };

  it('prefers the task estimate, then the planned length, then the routine', () => {
    expect(
      expectedMinutes({
        ...at,
        nodeEstimatedMinutes: 90,
        routineEstimatedMinutes: 20,
        plannedEndAt: '2026-09-22T11:00:00.000Z',
      }),
    ).toBe(90);
    expect(
      expectedMinutes({
        ...at,
        nodeEstimatedMinutes: null,
        routineEstimatedMinutes: 20,
        plannedEndAt: '2026-09-22T11:00:00.000Z',
      }),
    ).toBe(60);
    expect(
      expectedMinutes({ ...at, nodeEstimatedMinutes: null, routineEstimatedMinutes: 20 }),
    ).toBe(20);
  });

  it('is null when nothing says how long', () => {
    expect(
      expectedMinutes({ ...at, nodeEstimatedMinutes: null, routineEstimatedMinutes: null }),
    ).toBeNull();
    expect(
      expectedMinutes({ ...at, nodeEstimatedMinutes: 0, routineEstimatedMinutes: undefined }),
    ).toBeNull();
    // A planned end in the past is not an expectation either.
    expect(
      expectedMinutes({
        startedAt: '2026-09-22T10:00:00.000Z',
        plannedEndAt: '2026-09-22T09:00:00.000Z',
        nodeEstimatedMinutes: null,
        routineEstimatedMinutes: null,
      }),
    ).toBeNull();
  });
});
