import { describe, expect, it } from 'vitest';
import {
  bandFor,
  courseGrade,
  gpa,
  neededOnRemaining,
  UOFT_GRADE_SCALE,
  type CourseGrade,
} from './grades';
import type { GradeComponent } from './types';

const node = (over: Partial<Parameters<typeof courseGrade>[0]['node']> = {}) => ({
  id: 'c1',
  gradeMode: 'components' as const,
  gradeOverall: null,
  ...over,
});

let seq = 0;
const comp = (weight: number, score: number | null): GradeComponent => ({
  id: `g${++seq}`,
  userId: 'u1',
  nodeId: 'c1',
  title: `Component ${seq}`,
  weight,
  score,
  sortOrder: seq,
});

describe('bandFor', () => {
  it('maps the U of T bands', () => {
    expect(bandFor(UOFT_GRADE_SCALE, 91)!.letter).toBe('A+');
    expect(bandFor(UOFT_GRADE_SCALE, 85)!.letter).toBe('A');
    expect(bandFor(UOFT_GRADE_SCALE, 84.9)!.letter).toBe('A-');
    expect(bandFor(UOFT_GRADE_SCALE, 73)!.points).toBe(3.0);
    expect(bandFor(UOFT_GRADE_SCALE, 49)!.letter).toBe('F');
    expect(bandFor(UOFT_GRADE_SCALE, 0)!.points).toBe(0);
  });

  it('is inclusive at the bottom of a band', () => {
    expect(bandFor(UOFT_GRADE_SCALE, 80)!.letter).toBe('A-');
    expect(bandFor(UOFT_GRADE_SCALE, 79.99)!.letter).toBe('B+');
  });

  it('returns null for an empty scale', () => {
    expect(bandFor([], 90)).toBeNull();
  });

  it('does not care what order the bands are given in', () => {
    const shuffled = [...UOFT_GRADE_SCALE].reverse();
    expect(bandFor(shuffled, 91)!.letter).toBe('A+');
  });
});

describe('courseGrade', () => {
  it('rescales to the weight graded so far', () => {
    // 20% of the course is marked, at 88%. The running grade is 88, not 17.6.
    const g = courseGrade({
      node: node(),
      components: [comp(20, 88), comp(30, null), comp(50, null)],
      scale: UOFT_GRADE_SCALE,
    });
    expect(g.percent).toBeCloseTo(88);
    expect(g.weightGraded).toBe(20);
    expect(g.weightTotal).toBe(100);
    expect(g.letter).toBe('A');
  });

  it('weights components against each other', () => {
    const g = courseGrade({
      node: node(),
      components: [comp(25, 60), comp(75, 80)],
      scale: UOFT_GRADE_SCALE,
    });
    expect(g.percent).toBeCloseTo(75);
    expect(g.letter).toBe('B');
  });

  it('has no grade before anything is marked', () => {
    const g = courseGrade({
      node: node(),
      components: [comp(50, null), comp(50, null)],
      scale: UOFT_GRADE_SCALE,
    });
    expect(g.percent).toBeNull();
    expect(g.letter).toBeNull();
    expect(g.weightGraded).toBe(0);
  });

  it('reports weights that do not add to 100 rather than normalising them', () => {
    const g = courseGrade({
      node: node(),
      components: [comp(30, 90), comp(40, null)],
      scale: UOFT_GRADE_SCALE,
    });
    expect(g.weightTotal).toBe(70);
    expect(g.percent).toBeCloseTo(90);
  });

  it('takes a single overall mark', () => {
    const g = courseGrade({
      node: node({ gradeMode: 'overall', gradeOverall: 78 }),
      components: [],
      scale: UOFT_GRADE_SCALE,
    });
    expect(g.percent).toBe(78);
    expect(g.letter).toBe('B+');
    expect(g.weightGraded).toBe(100);
  });

  it('treats an overall course with no mark as ungraded', () => {
    const g = courseGrade({
      node: node({ gradeMode: 'overall' }),
      components: [comp(100, 90)],
      scale: UOFT_GRADE_SCALE,
    });
    expect(g.percent).toBeNull();
    expect(g.weightGraded).toBe(0);
  });
});

describe('neededOnRemaining', () => {
  const graded = (over: Partial<CourseGrade> = {}): CourseGrade => ({
    nodeId: 'c1',
    mode: 'components',
    percent: 70,
    weightGraded: 40,
    weightTotal: 100,
    projectedPercent: 70,
    letter: 'B-',
    points: 2.7,
    ...over,
  });

  it('says what the rest has to average', () => {
    // 28 of 100 points banked; 85 overall needs 57 more from the remaining 60% -> 95%.
    expect(neededOnRemaining(graded(), 85)).toBeCloseTo(95);
  });

  it('returns null when nothing is left to mark', () => {
    expect(neededOnRemaining(graded({ weightGraded: 100 }), 85)).toBeNull();
  });

  it('can exceed 100 when a target is out of reach', () => {
    expect(neededOnRemaining(graded({ percent: 40 }), 90)!).toBeGreaterThan(100);
  });

  it('counts weights not entered yet as part of the rest', () => {
    // 91.7% on the only item entered, worth 10%: the other 90% has to average about 89.8.
    const g = graded({ percent: 91.7, weightGraded: 10, weightTotal: 10 });
    expect(neededOnRemaining(g, 90)).toBeCloseTo((90 - 9.17) / 0.9);
  });

  it('goes negative when the target is already banked', () => {
    // 40 of 100 points earned already, and the target only needs 30.
    expect(neededOnRemaining(graded({ percent: 100 }), 30)!).toBeLessThan(0);
  });
});

describe('gpa', () => {
  const g = (nodeId: string, points: number | null): CourseGrade => ({
    nodeId,
    mode: 'components',
    percent: 80,
    weightGraded: 100,
    weightTotal: 100,
    projectedPercent: 80,
    letter: 'A-',
    points,
  });

  it('averages the courses that have a grade', () => {
    expect(gpa({ grades: [g('a', 4), g('b', 3)] }).points).toBeCloseTo(3.5);
  });

  it('ignores ungraded courses', () => {
    const out = gpa({ grades: [g('a', 4), g('b', null)] });
    expect(out.points).toBeCloseTo(4);
    expect(out.courseCount).toBe(1);
  });

  it('weights by credits when asked', () => {
    const out = gpa({
      grades: [g('full', 4), g('half', 2)],
      weightOf: (id) => (id === 'full' ? 1 : 0.5),
    });
    expect(out.points).toBeCloseTo((4 * 1 + 2 * 0.5) / 1.5);
  });

  it('has no average with nothing graded', () => {
    expect(gpa({ grades: [g('a', null)] }).points).toBeNull();
  });
});
