import { describe, expect, it } from 'vitest';
import {
  ancestorTitles,
  ancestors,
  buildIndex,
  childrenOf,
  descendantIds,
  effectiveColor,
  isUnderAssessment,
  pathLabel,
  rootOf,
  sessionsForSubtree,
} from './tree';
import type { Session, StudyNode } from './types';

const n = (id: string, parentId: string | null, over: Partial<StudyNode> = {}): StudyNode => ({
  id,
  userId: 'u',
  parentId,
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
  ...over,
});

const s = (id: string, nodeId: string): Session => ({
  id,
  userId: 'u',
  nodeId,
  routineId: null,
  routineDate: null,
  startedAt: '2026-09-20T00:00:00Z',
  endedAt: null,
  mode: 'unlimited',
  plannedEndAt: null,
  workSeconds: 60,
  breakSeconds: 0,
  idleSeconds: 0,
  pomodoroConfigSnapshot: null,
  review: null,
  xpAwarded: 0,
  badgesAwarded: [],
});

const nodes = [
  n('course', null, { kind: 'course', color: '#f00' }),
  n('quiz', 'course', { kind: 'assessment', sortOrder: 2 }),
  n('q-review', 'quiz', { sortOrder: 1 }),
  n('hw', 'course', { sortOrder: 1, color: '#0f0' }),
  n('archived', 'course', { archived: true }),
  n('orphan', 'missing-parent'),
];

describe('buildIndex', () => {
  it('indexes roots, sorted children, and skips archived', () => {
    const idx = buildIndex(nodes);
    expect(idx.roots.map((r) => r.id)).toEqual(['course', 'orphan']);
    expect(childrenOf(idx, 'course').map((c) => c.id)).toEqual(['hw', 'quiz']);
    expect(childrenOf(idx, 'nope')).toEqual([]);
  });

  it('walks descendants and ancestors', () => {
    const idx = buildIndex(nodes);
    expect(descendantIds(idx, 'course').sort()).toEqual(['hw', 'q-review', 'quiz']);
    expect(ancestors(idx, 'q-review').map((a) => a.id)).toEqual(['quiz', 'course']);
    expect(ancestors(idx, 'course')).toEqual([]);
    expect(ancestors(idx, 'nope')).toEqual([]);
  });

  it('ancestorTitles/pathLabel run root-first and tolerate cycles and orphans', () => {
    const idx = buildIndex(nodes);
    expect(ancestorTitles(idx.byId, 'q-review')).toEqual([
      idx.byId.get('course')!.title,
      idx.byId.get('quiz')!.title,
    ]);
    expect(pathLabel(idx.byId, 'course')).toBe('');
    expect(pathLabel(idx.byId, 'nope')).toBe('');
    const loop = new Map([
      ['a', { title: 'A', parentId: 'b' }],
      ['b', { title: 'B', parentId: 'a' }],
      ['c', { title: 'C', parentId: 'ghost' }],
    ]);
    expect(ancestorTitles(loop, 'a')).toEqual(['B']);
    expect(ancestorTitles(loop, 'c')).toEqual([]);
    expect(rootOf(idx, 'q-review')?.id).toBe('course');
    expect(rootOf(idx, 'course')?.id).toBe('course');
  });

  it('detects assessment ancestry', () => {
    const idx = buildIndex(nodes);
    expect(isUnderAssessment(idx, 'quiz')).toBe(true);
    expect(isUnderAssessment(idx, 'q-review')).toBe(true);
    expect(isUnderAssessment(idx, 'hw')).toBe(false);
    expect(isUnderAssessment(idx, 'nope')).toBe(false);
  });

  it('collects sessions for a subtree', () => {
    const idx = buildIndex(nodes, [s('a', 'course'), s('b', 'q-review'), s('c', 'orphan')]);
    expect(
      sessionsForSubtree(idx, 'course')
        .map((x) => x.id)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(sessionsForSubtree(idx, 'quiz').map((x) => x.id)).toEqual(['b']);
  });

  it('inherits colour from the nearest ancestor', () => {
    const idx = buildIndex(nodes);
    expect(effectiveColor(idx, 'hw')).toBe('#0f0');
    expect(effectiveColor(idx, 'q-review')).toBe('#f00');
    expect(effectiveColor(idx, 'orphan')).toBeNull();
    expect(effectiveColor(idx, 'nope')).toBeNull();
  });
});
