import type { GradeBand, GradeComponent, GradeMode, StudyNode } from './types';

/**
 * The University of Toronto undergraduate scale (percentage -> letter -> grade point),
 * used as the default because it is the one this app was built for. Every band is
 * editable in settings: a different university, or a school that marks out of 100 with no
 * letters at all, only has to replace this list.
 */
export const UOFT_GRADE_SCALE: GradeBand[] = [
  { minPercent: 90, letter: 'A+', points: 4.0 },
  { minPercent: 85, letter: 'A', points: 4.0 },
  { minPercent: 80, letter: 'A-', points: 3.7 },
  { minPercent: 77, letter: 'B+', points: 3.3 },
  { minPercent: 73, letter: 'B', points: 3.0 },
  { minPercent: 70, letter: 'B-', points: 2.7 },
  { minPercent: 67, letter: 'C+', points: 2.3 },
  { minPercent: 63, letter: 'C', points: 2.0 },
  { minPercent: 60, letter: 'C-', points: 1.7 },
  { minPercent: 57, letter: 'D+', points: 1.3 },
  { minPercent: 53, letter: 'D', points: 1.0 },
  { minPercent: 50, letter: 'D-', points: 0.7 },
  { minPercent: 0, letter: 'F', points: 0.0 },
];

/** Bands sorted highest-first, which is the order every lookup here assumes. */
export function sortScale(scale: GradeBand[]): GradeBand[] {
  return [...scale].sort((a, b) => b.minPercent - a.minPercent);
}

/** The band a percentage falls in, or null for an empty scale. */
export function bandFor(scale: GradeBand[], percent: number): GradeBand | null {
  for (const band of sortScale(scale)) if (percent >= band.minPercent) return band;
  return null;
}

export interface CourseGrade {
  nodeId: string;
  mode: GradeMode;
  /**
   * The mark as it stands: for components, the weighted average of what has been graded,
   * rescaled to the graded weight. Null when there is nothing to compute from.
   */
  percent: number | null;
  /** Percent of the course's weight that has a score. 100 for a finished course. */
  weightGraded: number;
  /** Sum of the component weights, which the user may not have made add to 100 yet. */
  weightTotal: number;
  /**
   * Grade if every remaining component scored the same as the graded ones - i.e. the
   * running mark applied to the whole course. Null until something is graded.
   */
  projectedPercent: number | null;
  letter: string | null;
  points: number | null;
}

export interface CourseGradeInput {
  node: Pick<StudyNode, 'id' | 'gradeMode' | 'gradeOverall'>;
  components: GradeComponent[];
  scale: GradeBand[];
}

/**
 * A course's grade so far.
 *
 * Ungraded components are excluded rather than counted as zero: two weeks into a course,
 * "you have 88% of the 20% that has been marked" is true, and "you have 17.6%" is not.
 * `weightGraded` is returned alongside so the UI can say how much of the course that is.
 */
export function courseGrade(input: CourseGradeInput): CourseGrade {
  const { node, scale } = input;
  const mode: GradeMode = node.gradeMode ?? 'components';

  if (mode === 'off') {
    return {
      nodeId: node.id,
      mode,
      percent: null,
      weightGraded: 0,
      weightTotal: 0,
      projectedPercent: null,
      letter: null,
      points: null,
    };
  }

  if (mode === 'overall') {
    const percent = node.gradeOverall;
    const band = percent === null ? null : bandFor(scale, percent);
    return {
      nodeId: node.id,
      mode,
      percent,
      weightGraded: percent === null ? 0 : 100,
      weightTotal: 100,
      projectedPercent: percent,
      letter: band?.letter ?? null,
      points: band?.points ?? null,
    };
  }

  let weightTotal = 0;
  let weightGraded = 0;
  let earned = 0;
  for (const c of input.components) {
    const weight = Math.max(0, c.weight);
    weightTotal += weight;
    if (c.score === null) continue;
    weightGraded += weight;
    earned += (weight * c.score) / 100;
  }

  const percent = weightGraded > 0 ? (earned / weightGraded) * 100 : null;
  const band = percent === null ? null : bandFor(scale, percent);
  return {
    nodeId: node.id,
    mode,
    percent,
    weightGraded,
    weightTotal,
    projectedPercent: percent,
    letter: band?.letter ?? null,
    points: band?.points ?? null,
  };
}

/**
 * What a component still to be marked has to score for the course to land on `target`.
 * Returns null when nothing is left to mark; the number can exceed 100 (out of reach)
 * or fall below 0 (already safe), which the caller says out loud rather than clamping.
 */
export function neededOnRemaining(grade: CourseGrade, targetPercent: number): number | null {
  const remaining = grade.weightTotal - grade.weightGraded;
  if (remaining <= 0) return null;
  const earned = ((grade.percent ?? 0) * grade.weightGraded) / 100;
  return ((targetPercent * grade.weightTotal) / 100 - earned) / (remaining / 100);
}

export interface GpaInput {
  grades: CourseGrade[];
  /** Weight per course, e.g. credits. Defaults to 1 each. */
  weightOf?: (nodeId: string) => number;
}

export interface Gpa {
  /** Grade-point average over the courses that have a grade, or null when none do. */
  points: number | null;
  courseCount: number;
}

/** Straight average of grade points across courses that have one. Ungraded courses, and
 * courses with grading switched off, contribute nothing. */
export function gpa(input: GpaInput): Gpa {
  let weighted = 0;
  let weight = 0;
  let count = 0;
  for (const g of input.grades) {
    if (g.points === null) continue;
    const w = input.weightOf?.(g.nodeId) ?? 1;
    if (w <= 0) continue;
    weighted += g.points * w;
    weight += w;
    count++;
  }
  return { points: weight > 0 ? weighted / weight : null, courseCount: count };
}
