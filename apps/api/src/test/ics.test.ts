import { describe, expect, it } from 'vitest';
import type { StudyNode } from '@komogon/core';
import { buildIcs } from '../services/ics';

const node = (over: Partial<StudyNode>): StudyNode => ({
  id: 'n1',
  userId: 'u',
  parentId: null,
  title: 'Midterm',
  kind: 'assessment',
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

describe('buildIcs due dates', () => {
  it('publishes a due date as an all-day event on its local day', () => {
    // 23:30 Toronto on the 22nd is the 23rd in UTC; the feed keeps the user's day.
    const ics = buildIcs({
      blocks: [],
      nodes: [node({ dueAt: '2026-09-23T03:30:00.000Z' })],
      now: '2026-09-22T12:00:00.000Z',
      timezone: 'America/Toronto',
    });
    expect(ics).toContain('UID:due-n1@komogon');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260922');
    expect(ics).toContain('SUMMARY:Midterm');
    expect(ics).not.toContain('DTEND');
  });

  it('prefixes a task with Due, keeps a finished one, and skips archived ones', () => {
    const ics = buildIcs({
      blocks: [],
      nodes: [
        node({ id: 'a', kind: 'task', title: 'Problem set', dueAt: '2026-09-25T12:00:00.000Z' }),
        node({
          id: 'b',
          kind: 'task',
          title: 'Reading',
          dueAt: '2026-09-25T12:00:00.000Z',
          completedAt: '2026-09-24T12:00:00.000Z',
        }),
        node({
          id: 'c',
          kind: 'task',
          title: 'Old',
          dueAt: '2026-09-25T12:00:00.000Z',
          archived: true,
        }),
        node({ id: 'd', kind: 'task', title: 'No date' }),
      ],
      now: '2026-09-22T12:00:00.000Z',
    });
    expect(ics).toContain('SUMMARY:Due: Problem set');
    expect(ics).toContain('UID:due-b@komogon');
    expect(ics).toContain('DESCRIPTION:Done (Komogon)');
    expect(ics).not.toContain('due-c@');
    expect(ics).not.toContain('due-d@');
  });
});
