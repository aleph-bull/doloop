import { toLocalDate, trackerWidgets, type Tracker, type TrackerEntry } from '@komodoit/core';
import { and, desc, eq, gte } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  trackerEntries,
  trackers,
  type TrackerEntryRow,
  type TrackerRow,
  type UserRow,
} from '../db/schema';
import { notFound } from '../errors';
import type { logTrackerSchema, trackerSchema, updateTrackerSchema } from '../validation';
import type { z } from 'zod';
import { dt } from './sessions-mapper';

export function toTracker(row: TrackerRow): Tracker {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    unitLabel: row.unitLabel,
    dailyGoal: row.dailyGoal,
    color: row.color,
    sortOrder: row.sortOrder,
    archived: row.archived,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toTrackerEntry(row: TrackerEntryRow): TrackerEntry {
  return {
    id: row.id,
    userId: row.userId,
    trackerId: row.trackerId,
    date: row.date,
    amount: row.amount,
    note: row.note,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listTrackers(db: Db, userId: string, includeArchived = false) {
  const rows = await db.query.trackers.findMany({
    where: includeArchived
      ? eq(trackers.userId, userId)
      : and(eq(trackers.userId, userId), eq(trackers.archived, false)),
    orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)],
  });
  return rows.map(toTracker);
}

async function getTrackerRow(db: Db, userId: string, id: string): Promise<TrackerRow> {
  const row = await db.query.trackers.findFirst({
    where: and(eq(trackers.id, id), eq(trackers.userId, userId)),
  });
  if (!row) throw notFound('Tracker not found');
  return row;
}

export async function createTracker(
  db: Db,
  userId: string,
  input: z.infer<typeof trackerSchema>,
  now: string,
): Promise<Tracker> {
  // New trackers go to the end of the board rather than jumping the queue.
  const last = await db.query.trackers.findFirst({
    where: eq(trackers.userId, userId),
    orderBy: (t, { desc: d }) => [d(t.sortOrder)],
    columns: { sortOrder: true },
  });
  const [row] = await db
    .insert(trackers)
    .values({
      userId,
      title: input.title,
      unitLabel: input.unitLabel,
      dailyGoal: input.dailyGoal ?? null,
      color: input.color ?? null,
      sortOrder: input.sortOrder ?? (last?.sortOrder ?? 0) + 1,
      createdAt: dt(now),
      updatedAt: dt(now),
    })
    .returning();
  return toTracker(row!);
}

export async function updateTracker(
  db: Db,
  userId: string,
  id: string,
  patch: z.infer<typeof updateTrackerSchema>,
  now: string,
): Promise<Tracker> {
  await getTrackerRow(db, userId, id);
  const [row] = await db
    .update(trackers)
    .set({ ...patch, updatedAt: dt(now) })
    .where(and(eq(trackers.id, id), eq(trackers.userId, userId)))
    .returning();
  return toTracker(row!);
}

export async function deleteTracker(db: Db, userId: string, id: string): Promise<void> {
  await getTrackerRow(db, userId, id);
  // Entries cascade with the tracker: a deleted tracker leaves no orphan history.
  await db.delete(trackers).where(and(eq(trackers.id, id), eq(trackers.userId, userId)));
}

/**
 * Record an amount for one day. One row per tracker per day: `set` replaces the day's
 * total (the field on the widget shows today's value and writes it back), `add` bumps it,
 * which is what a quick "+10 pages" button wants.
 */
export async function logTracker(
  db: Db,
  user: UserRow,
  id: string,
  input: z.infer<typeof logTrackerSchema>,
  now: string,
): Promise<TrackerEntry | null> {
  await getTrackerRow(db, user.id, id);
  const date = input.date ?? toLocalDate(now, user.timezone);
  const existing = await db.query.trackerEntries.findFirst({
    where: and(eq(trackerEntries.trackerId, id), eq(trackerEntries.date, date)),
  });
  const next = input.mode === 'add' ? (existing?.amount ?? 0) + input.amount : input.amount;

  // Zeroing a day removes it, so an empty day is empty rather than a 0 that still reads
  // as "logged" in the grid's active-day count.
  if (next <= 0) {
    if (existing) await db.delete(trackerEntries).where(eq(trackerEntries.id, existing.id));
    return null;
  }

  if (existing) {
    const [row] = await db
      .update(trackerEntries)
      .set({ amount: next, note: input.note ?? existing.note, updatedAt: dt(now) })
      .where(eq(trackerEntries.id, existing.id))
      .returning();
    return toTrackerEntry(row!);
  }
  const [row] = await db
    .insert(trackerEntries)
    .values({
      userId: user.id,
      trackerId: id,
      date,
      amount: next,
      note: input.note ?? null,
      updatedAt: dt(now),
    })
    .returning();
  return toTrackerEntry(row!);
}

export async function listEntries(db: Db, userId: string, from?: string): Promise<TrackerEntry[]> {
  const rows = await db.query.trackerEntries.findMany({
    where: from
      ? and(eq(trackerEntries.userId, userId), gte(trackerEntries.date, from))
      : eq(trackerEntries.userId, userId),
    orderBy: [desc(trackerEntries.date)],
  });
  return rows.map(toTrackerEntry);
}

/** Everything the dashboard needs: one widget per tracker, grids already built. */
export async function trackerBoard(db: Db, user: UserRow, now: string, weeks = 53) {
  const [list, entries] = await Promise.all([listTrackers(db, user.id), listEntries(db, user.id)]);
  return {
    trackers: list,
    widgets: trackerWidgets({
      trackers: list,
      entries,
      now,
      timezone: user.timezone,
      weeks,
    }),
  };
}
