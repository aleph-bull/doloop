import type { PlannedBlock, Session, StudyNode } from '@komogon/core';
import type { NodeRow, PlannedBlockRow, SessionRow } from '../db/schema';

/** ISO string of a Date column, or null. */
export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
/** Date for a required ISO string. */
export const dt = (s: string): Date => new Date(s);
/** Date or null for an optional ISO string. */
export const dtn = (s: string | null | undefined): Date | null => (s ? new Date(s) : null);

export function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.userId,
    nodeId: row.nodeId,
    routineId: row.routineId,
    routineDate: row.routineDate,
    startedAt: row.startedAt.toISOString(),
    endedAt: iso(row.endedAt),
    mode: row.mode,
    plannedEndAt: iso(row.plannedEndAt),
    workSeconds: row.workSeconds,
    breakSeconds: row.breakSeconds,
    idleSeconds: row.idleSeconds,
    pomodoroConfigSnapshot: row.pomodoroConfigSnapshot ?? null,
    review: row.review ?? null,
    xpAwarded: row.xpAwarded,
    badgesAwarded: row.badgesAwarded,
    sleeps: row.sleeps ?? [],
    jack: row.timer.jack
      ? {
          rolls: row.timer.jack.rolls,
          wonSeconds: row.timer.jack.wonSeconds,
          lostSeconds: row.timer.jack.lostSeconds,
        }
      : null,
    counted: row.counted,
  };
}

export function toNode(row: NodeRow): StudyNode {
  return {
    id: row.id,
    userId: row.userId,
    parentId: row.parentId,
    title: row.title,
    kind: row.kind,
    estimatedMinutes: row.estimatedMinutes,
    dueAt: iso(row.dueAt),
    completedAt: iso(row.completedAt),
    sortOrder: row.sortOrder,
    color: row.color,
    archived: row.archived,
    countUnit: row.countUnit,
    countUnitLabel: row.countUnitLabel,
    outcomeRating: row.outcomeRating,
    gradeMode: row.gradeMode,
    gradeOverall: row.gradeOverall,
    gradeCredits: row.gradeCredits,
    childDefaults: row.childDefaults ?? null,
    tagIds: row.tagIds ?? [],
  };
}

export function toPlannedBlock(row: PlannedBlockRow): PlannedBlock {
  return {
    id: row.id,
    userId: row.userId,
    nodeId: row.nodeId,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    source: row.source,
    title: row.title,
    sessionId: row.sessionId,
    googleEventId: row.googleEventId,
    cancelled: row.cancelled,
  };
}
