import { nextTagColor, type Tag } from '@komogon/core';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/client';
import { nodes, tags, type TagRow } from '../db/schema';
import { badRequest, notFound } from '../errors';
import type { createTagSchema, updateTagSchema } from '../validation';
import { dt } from './sessions-mapper';

const toTag = (row: TagRow): Tag => ({
  id: row.id,
  name: row.name,
  color: row.color,
  sortOrder: row.sortOrder,
});

export async function listTags(db: Db, userId: string): Promise<Tag[]> {
  const rows = await db.query.tags.findMany({
    where: eq(tags.userId, userId),
    orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)],
  });
  return rows.map(toTag);
}

/** Names are unique per person, ignoring case, so "Econ" and "econ" can't both exist. */
async function assertNameFree(db: Db, userId: string, name: string, selfId?: string) {
  const all = await db.query.tags.findMany({ where: eq(tags.userId, userId) });
  const taken = all.find((t) => t.id !== selfId && t.name.toLowerCase() === name.toLowerCase());
  if (taken) throw badRequest(`There's already a tag called ${taken.name}`);
}

export async function createTag(
  db: Db,
  userId: string,
  input: z.infer<typeof createTagSchema>,
  now: string,
): Promise<Tag> {
  await assertNameFree(db, userId, input.name);
  const existing = await listTags(db, userId);
  const [row] = await db
    .insert(tags)
    .values({
      userId,
      name: input.name,
      color: input.color ?? nextTagColor(existing),
      sortOrder: existing.reduce((m, t) => Math.max(m, t.sortOrder), 0) + 1,
      createdAt: dt(now),
    })
    .returning();
  return toTag(row!);
}

export async function updateTag(
  db: Db,
  userId: string,
  id: string,
  patch: z.infer<typeof updateTagSchema>,
): Promise<Tag> {
  if (patch.name !== undefined) await assertNameFree(db, userId, patch.name, id);
  const [row] = await db
    .update(tags)
    .set(patch)
    .where(and(eq(tags.id, id), eq(tags.userId, userId)))
    .returning();
  if (!row) throw notFound('Tag not found');
  return toTag(row);
}

/** Deletes the tag and takes it off every task that had it. */
export async function deleteTag(db: Db, userId: string, id: string): Promise<void> {
  const [row] = await db
    .delete(tags)
    .where(and(eq(tags.id, id), eq(tags.userId, userId)))
    .returning();
  if (!row) throw notFound('Tag not found');
  await db
    .update(nodes)
    .set({ tagIds: sql`${nodes.tagIds} - ${id}::text` })
    .where(and(eq(nodes.userId, userId), sql`${nodes.tagIds} @> ${JSON.stringify([id])}::jsonb`));
}

/** A node's new tag list, checked: only this person's tags, each once, order kept. */
export async function checkTagIds(db: Db, userId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const mine = new Set((await listTags(db, userId)).map((t) => t.id));
  const unknown = unique.find((id) => !mine.has(id));
  if (unknown) throw badRequest('That tag no longer exists');
  return unique;
}
