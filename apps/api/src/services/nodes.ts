import type { StudyNode } from '@doloop/core';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/client';
import { estimateChanges, nodes, type NodeRow } from '../db/schema';
import { badRequest, notFound } from '../errors';
import type { createNodeSchema, updateNodeSchema } from '../validation';
import { dt, dtn, toNode } from './sessions-mapper';

export async function listNodes(
  db: Db,
  userId: string,
  includeArchived = false,
): Promise<StudyNode[]> {
  const rows = await db.query.nodes.findMany({
    where: includeArchived
      ? eq(nodes.userId, userId)
      : and(eq(nodes.userId, userId), eq(nodes.archived, false)),
    orderBy: (n, { asc }) => [asc(n.sortOrder), asc(n.createdAt)],
  });
  return rows.map(toNode);
}

export async function getNodeRow(db: Db, userId: string, id: string): Promise<NodeRow> {
  const row = await db.query.nodes.findFirst({
    where: and(eq(nodes.id, id), eq(nodes.userId, userId)),
  });
  if (!row) throw notFound('Node not found');
  return row;
}

async function assertParent(
  db: Db,
  userId: string,
  parentId: string | null | undefined,
  selfId?: string,
) {
  if (!parentId) return;
  if (parentId === selfId) throw badRequest('A node cannot be its own parent');
  const parent = await getNodeRow(db, userId, parentId);
  if (selfId) {
    // Walk up from the proposed parent; if we reach selfId there is a cycle.
    let cur: NodeRow | undefined = parent;
    const seen = new Set<string>();
    while (cur?.parentId && !seen.has(cur.parentId)) {
      if (cur.parentId === selfId) throw badRequest('That would create a cycle');
      seen.add(cur.parentId);
      cur = await db.query.nodes.findFirst({ where: eq(nodes.id, cur.parentId) });
    }
  }
}

export async function createNode(
  db: Db,
  userId: string,
  input: z.infer<typeof createNodeSchema>,
  now: string,
): Promise<StudyNode> {
  await assertParent(db, userId, input.parentId);
  let sortOrder = input.sortOrder;
  if (sortOrder === undefined) {
    const siblings = await db.query.nodes.findMany({
      where: and(
        eq(nodes.userId, userId),
        input.parentId ? eq(nodes.parentId, input.parentId) : eq(nodes.archived, false),
      ),
    });
    sortOrder = siblings.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 1;
  }
  const [row] = await db
    .insert(nodes)
    .values({
      userId,
      parentId: input.parentId ?? null,
      title: input.title,
      kind: input.kind,
      estimatedMinutes: input.estimatedMinutes ?? null,
      dueAt: dtn(input.dueAt),
      sortOrder,
      color: input.color ?? null,
      countUnit: input.countUnit ?? null,
      countUnitLabel: input.countUnitLabel ?? null,
      createdAt: dt(now),
      updatedAt: dt(now),
    })
    .returning();
  if (input.estimatedMinutes != null) {
    await db.insert(estimateChanges).values({
      userId,
      nodeId: row!.id,
      at: dt(now),
      fromMinutes: null,
      toMinutes: input.estimatedMinutes,
      source: 'edit',
    });
  }
  return toNode(row!);
}

export async function updateNode(
  db: Db,
  userId: string,
  id: string,
  patch: z.infer<typeof updateNodeSchema>,
  now: string,
): Promise<StudyNode> {
  const current = await getNodeRow(db, userId, id);
  if (patch.parentId !== undefined) await assertParent(db, userId, patch.parentId, id);
  const set: Partial<NodeRow> = { updatedAt: dt(now) };
  for (const key of [
    'parentId',
    'title',
    'kind',
    'estimatedMinutes',
    'dueAt',
    'completedAt',
    'sortOrder',
    'color',
    'archived',
    'countUnit',
    'countUnitLabel',
    'outcomeRating',
  ] as const) {
    if (patch[key] === undefined) continue;
    const v = patch[key];
    (set as Record<string, unknown>)[key] =
      key === 'dueAt' || key === 'completedAt' ? dtn(v as string | null) : v;
  }
  if (patch.estimatedMinutes !== undefined && patch.estimatedMinutes !== current.estimatedMinutes) {
    await db.insert(estimateChanges).values({
      userId,
      nodeId: id,
      at: dt(now),
      fromMinutes: current.estimatedMinutes,
      toMinutes: patch.estimatedMinutes,
      source: 'edit',
    });
  }
  if (patch.outcomeRating !== undefined && patch.outcomeRating !== null)
    set.outcomeAskedAt = dt(now);
  const [row] = await db.update(nodes).set(set).where(eq(nodes.id, id)).returning();
  return toNode(row!);
}

/** Archive a node and its descendants (soft delete). */
export async function archiveNode(
  db: Db,
  userId: string,
  id: string,
  now: string,
): Promise<string[]> {
  await getNodeRow(db, userId, id);
  const all = await db.query.nodes.findMany({ where: eq(nodes.userId, userId) });
  const ids = [id];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of all) {
      if (n.parentId === cur && !ids.includes(n.id)) {
        ids.push(n.id);
        stack.push(n.id);
      }
    }
  }
  for (const nid of ids) {
    await db
      .update(nodes)
      .set({ archived: true, updatedAt: dt(now) })
      .where(eq(nodes.id, nid));
  }
  return ids;
}

/** Hard delete (sessions cascade). Only for nodes the user explicitly wants gone. */
export async function deleteNode(db: Db, userId: string, id: string): Promise<void> {
  await getNodeRow(db, userId, id);
  await db.delete(nodes).where(and(eq(nodes.id, id), eq(nodes.userId, userId)));
}
