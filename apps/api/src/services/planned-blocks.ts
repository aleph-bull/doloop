import type { PlannedBlock } from '@komogon/core';
import { and, eq, gte, lt, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { plannedBlocks, type PlannedBlockRow } from '../db/schema';
import { badRequest, notFound } from '../errors';
import { getNodeRow } from './nodes';
import { dt, toPlannedBlock } from './sessions-mapper';

export async function listBlocks(
  db: Db,
  userId: string,
  from?: string,
  to?: string,
): Promise<PlannedBlock[]> {
  const conds = [eq(plannedBlocks.userId, userId)];
  if (from) conds.push(gte(plannedBlocks.endAt, dt(from)));
  if (to) conds.push(lte(plannedBlocks.startAt, dt(to)));
  const rows = await db.query.plannedBlocks.findMany({
    where: and(...conds),
    orderBy: (b, { asc }) => [asc(b.startAt)],
  });
  return rows.map(toPlannedBlock);
}

export async function getBlockRow(db: Db, userId: string, id: string): Promise<PlannedBlockRow> {
  const row = await db.query.plannedBlocks.findFirst({
    where: and(eq(plannedBlocks.id, id), eq(plannedBlocks.userId, userId)),
  });
  if (!row) throw notFound('Block not found');
  return row;
}

export async function createBlock(
  db: Db,
  userId: string,
  input: { nodeId?: string | null; startAt: string; endAt: string },
  now: string,
): Promise<PlannedBlock> {
  if (Date.parse(input.endAt) <= Date.parse(input.startAt))
    throw badRequest('Block must end after it starts');
  if (input.nodeId) await getNodeRow(db, userId, input.nodeId);
  const [row] = await db
    .insert(plannedBlocks)
    .values({
      userId,
      nodeId: input.nodeId ?? null,
      startAt: dt(input.startAt),
      endAt: dt(input.endAt),
      source: 'app',
      createdAt: dt(now),
      updatedAt: dt(now),
    })
    .returning();
  return toPlannedBlock(row!);
}

export async function updateBlock(
  db: Db,
  userId: string,
  id: string,
  patch: { nodeId?: string | null; startAt?: string; endAt?: string; cancelled?: boolean },
  now: string,
): Promise<PlannedBlock> {
  const row = await db.query.plannedBlocks.findFirst({
    where: and(eq(plannedBlocks.id, id), eq(plannedBlocks.userId, userId)),
  });
  if (!row) throw notFound('Block not found');
  // An imported commitment stays a commitment. Attaching a task to it would quietly turn
  // "I have a lecture at two" into "I plan to study at two", which is not what importing a
  // calendar means. Study time is something the user schedules here.
  if ((row.source === 'google' || row.source === 'outlook') && patch.nodeId)
    throw badRequest('Imported events are commitments, not study time. Plan a block instead.');
  const startAt = patch.startAt ? dt(patch.startAt) : row.startAt;
  const endAt = patch.endAt ? dt(patch.endAt) : row.endAt;
  if (endAt.getTime() <= startAt.getTime()) throw badRequest('Block must end after it starts');
  if (patch.nodeId) await getNodeRow(db, userId, patch.nodeId);
  const [updated] = await db
    .update(plannedBlocks)
    .set({
      nodeId: patch.nodeId === undefined ? row.nodeId : patch.nodeId,
      startAt,
      endAt,
      cancelled: patch.cancelled ?? row.cancelled,
      updatedAt: dt(now),
    })
    .where(eq(plannedBlocks.id, id))
    .returning();
  return toPlannedBlock(updated!);
}

export async function deleteBlock(db: Db, userId: string, id: string): Promise<void> {
  const res = await db
    .delete(plannedBlocks)
    .where(and(eq(plannedBlocks.id, id), eq(plannedBlocks.userId, userId)))
    .returning({ id: plannedBlocks.id });
  if (res.length === 0) throw notFound('Block not found');
}

/** True if any non-cancelled block for this node overlaps [startAt, endAt]. */
export async function overlapsPlannedBlock(
  db: Db,
  userId: string,
  nodeId: string,
  startAt: string,
  endAt: string,
): Promise<boolean> {
  const rows = await db.query.plannedBlocks.findMany({
    where: and(
      eq(plannedBlocks.userId, userId),
      eq(plannedBlocks.nodeId, nodeId),
      // Only time the user set aside for this counts as "kept to the plan". A commitment
      // imported from their calendar is the opposite of a plan to study.
      eq(plannedBlocks.source, 'app'),
      eq(plannedBlocks.cancelled, false),
      lt(plannedBlocks.startAt, dt(endAt)),
      gte(plannedBlocks.endAt, dt(startAt)),
    ),
    limit: 1,
  });
  return rows.length > 0;
}

/**
 * Record a finished session on the calendar.
 *
 * The block is what happened, not a plan: it carries the session id, so re-finalising the
 * same session updates its block instead of stacking duplicates. Returns null when the
 * session was too short to be worth a mark on the grid.
 */
export async function logSessionBlock(
  db: Db,
  userId: string,
  session: {
    id: string;
    nodeId: string | null;
    /** Names the block when there is no node to, as for a routine session. */
    title?: string | null;
    startedAt: Date;
    endedAt: Date | null;
  },
  now: string,
  minMinutes = 1,
): Promise<PlannedBlockRow | null> {
  const endedAt = session.endedAt ?? new Date(Date.parse(now));
  const minutes = (endedAt.getTime() - session.startedAt.getTime()) / 60_000;
  if (minutes < minMinutes) return null;

  const existing = await db.query.plannedBlocks.findFirst({
    where: and(eq(plannedBlocks.userId, userId), eq(plannedBlocks.sessionId, session.id)),
  });
  if (existing) {
    const [updated] = await db
      .update(plannedBlocks)
      .set({ startAt: session.startedAt, endAt: endedAt, updatedAt: dt(now) })
      .where(eq(plannedBlocks.id, existing.id))
      .returning();
    return updated!;
  }
  const [row] = await db
    .insert(plannedBlocks)
    .values({
      userId,
      nodeId: session.nodeId,
      title: session.title ?? null,
      startAt: session.startedAt,
      endAt: endedAt,
      source: 'session',
      sessionId: session.id,
      createdAt: dt(now),
      updatedAt: dt(now),
    })
    .returning();
  return row!;
}
