import { randomUUID } from 'node:crypto';
import { studyKey, type StudyNode } from '@komogon/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/client';
import { estimateChanges, nodes, type NodeRow } from '../db/schema';
import { badRequest, notFound } from '../errors';
import type { createNodeSchema, importNodesSchema, updateNodeSchema } from '../validation';
import { dt, dtn, toNode } from './sessions-mapper';
import { checkTagIds } from './tags';

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
      gradeMode: input.gradeMode ?? null,
      gradeOverall: input.gradeOverall ?? null,
      gradeCredits: input.gradeCredits ?? null,
      childDefaults: input.childDefaults ?? null,
      tagIds: input.tagIds ? await checkTagIds(db, userId, input.tagIds) : [],
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
    'gradeMode',
    'gradeOverall',
    'gradeCredits',
    'childDefaults',
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
  if (patch.tagIds !== undefined) set.tagIds = await checkTagIds(db, userId, patch.tagIds ?? []);
  const [row] = await db.update(nodes).set(set).where(eq(nodes.id, id)).returning();
  if (set.completedAt !== undefined)
    await cascadeCompletion(db, userId, id, current.completedAt, set.completedAt, now);
  return toNode(row!);
}

/**
 * Carry a node's done state down to everything under it. Done marks every unfinished
 * descendant done at the same moment. Not done reopens only the ones finished with it (same
 * moment), so a subtask finished on its own keeps its date, one unticked since stays
 * unticked, and undoing a tick puts the subtasks back as they were.
 */
export async function cascadeCompletion(
  db: Db,
  userId: string,
  id: string,
  from: Date | null,
  to: Date | null,
  now: string,
): Promise<void> {
  if ((from === null) === (to === null)) return;
  const all = await db.query.nodes.findMany({
    where: and(eq(nodes.userId, userId), eq(nodes.archived, false)),
  });
  const under: NodeRow[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of all) {
      if (n.parentId !== cur || under.includes(n)) continue;
      under.push(n);
      stack.push(n.id);
    }
  }
  const ids = under
    .filter((n) => (to ? !n.completedAt : n.completedAt?.getTime() === from!.getTime()))
    .map((n) => n.id);
  if (!ids.length) return;
  await db
    .update(nodes)
    .set({ completedAt: to, updatedAt: dt(now) })
    .where(inArray(nodes.id, ids));
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
/**
 * Add a pasted list of courses and items in one transaction. A course that already exists
 * at the top level (matched as the calendar import matches, so "ECO 101" is ECO101) gets
 * the new items; an item already under it with the same title and due date is skipped, so
 * pasting the same list twice adds nothing the second time.
 */
export async function importNodes(
  db: Db,
  userId: string,
  input: z.infer<typeof importNodesSchema>,
  now: string,
): Promise<{ courses: number; items: number; skipped: number }> {
  return db.transaction(async (tx) => {
    const live = await tx.query.nodes.findMany({
      where: and(eq(nodes.userId, userId), eq(nodes.archived, false)),
    });
    // A real course wins over a top-level task that happens to share its name.
    const roots = live
      .filter((n) => !n.parentId)
      .sort((a, b) => Number(b.kind === 'course') - Number(a.kind === 'course'));
    const courseIds = new Map<string, string>();
    for (const r of roots) {
      const key = studyKey(r.title);
      if (!courseIds.has(key)) courseIds.set(key, r.id);
    }
    let nextRoot = live.reduce((m, n) => Math.max(m, n.sortOrder), 0) + 1;
    /** Per course: what is already under it (title and due date), and the next sort order. */
    const under = new Map<string, { have: Set<string>; next: number }>();
    const result = { courses: 0, items: 0, skipped: 0 };
    const newNodes: Array<typeof nodes.$inferInsert> = [];
    const estimates: Array<typeof estimateChanges.$inferInsert> = [];

    for (const course of input.courses) {
      let courseId = courseIds.get(studyKey(course.title));
      if (!courseId) {
        courseId = randomUUID();
        courseIds.set(studyKey(course.title), courseId);
        newNodes.push({
          id: courseId,
          userId,
          title: course.title,
          kind: 'course',
          sortOrder: nextRoot++,
          createdAt: dt(now),
          updatedAt: dt(now),
        });
        result.courses++;
      }
      let slot = under.get(courseId);
      if (!slot) {
        const siblings = live.filter((n) => n.parentId === courseId);
        slot = {
          have: new Set(siblings.map((n) => `${studyKey(n.title)}|${toNode(n).dueAt ?? ''}`)),
          next: siblings.reduce((m, n) => Math.max(m, n.sortOrder), 0) + 1,
        };
        under.set(courseId, slot);
      }
      for (const item of course.items) {
        const dueAt = item.dueAt ? new Date(item.dueAt).toISOString() : null;
        const key = `${studyKey(item.title)}|${dueAt ?? ''}`;
        if (slot.have.has(key)) {
          result.skipped++;
          continue;
        }
        slot.have.add(key);
        const id = randomUUID();
        newNodes.push({
          id,
          userId,
          parentId: courseId,
          title: item.title,
          kind: item.kind,
          estimatedMinutes: item.estimatedMinutes ?? null,
          dueAt: dtn(dueAt),
          sortOrder: slot.next++,
          createdAt: dt(now),
          updatedAt: dt(now),
        });
        if (item.estimatedMinutes != null)
          estimates.push({
            userId,
            nodeId: id,
            at: dt(now),
            fromMinutes: null,
            toMinutes: item.estimatedMinutes,
            source: 'edit',
          });
        result.items++;
      }
    }

    // Courses go in ahead of their items, so every parent exists before its children.
    if (newNodes.length) await tx.insert(nodes).values(newNodes);
    if (estimates.length) await tx.insert(estimateChanges).values(estimates);
    return result;
  });
}

export async function deleteNode(db: Db, userId: string, id: string): Promise<void> {
  await getNodeRow(db, userId, id);
  await db.delete(nodes).where(and(eq(nodes.id, id), eq(nodes.userId, userId)));
}
