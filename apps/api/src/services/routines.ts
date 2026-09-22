import {
  addDays,
  canTick,
  type IcsImportPlan,
  type Routine,
  type RoutineCompletion,
  type RoutineDraft,
  type RoutineOccurrence,
  ROUTINES,
  parseIcs,
  planIcsImport,
  routineAdherence,
  routineAgenda,
  routineXp,
  routinesDue,
  startOfWeekMonday,
  toLocalDate,
  validateRoutineDraft,
} from '@doloop/core';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  routineCompletions,
  routines,
  users,
  xpTransactions,
  type RoutineCompletionRow,
  type RoutineRow,
} from '../db/schema';
import { badRequest, notFound } from '../errors';
import { dt } from './sessions-mapper';

export function toRoutine(row: RoutineRow): Routine {
  return {
    id: row.id,
    userId: row.userId,
    nodeId: row.nodeId,
    title: row.title,
    note: row.note,
    estimatedMinutes: row.estimatedMinutes,
    freq: row.freq,
    interval: row.interval,
    byWeekday: row.byWeekday,
    byMonthday: row.byMonthday,
    startDate: row.startDate,
    endDate: row.endDate,
    source: row.source,
    icsUid: row.icsUid,
    archived: row.archived,
    createdAt: row.createdAt.toISOString(),
  };
}

function toCompletion(row: RoutineCompletionRow): RoutineCompletion {
  return {
    id: row.id,
    routineId: row.routineId,
    date: row.date,
    completedAt: row.completedAt.toISOString(),
    minutes: row.minutes,
    xpAwarded: row.xpAwarded,
  };
}

export async function listRoutines(
  db: Db,
  userId: string,
  includeArchived = false,
): Promise<Routine[]> {
  const rows = await db.query.routines.findMany({
    where: includeArchived
      ? eq(routines.userId, userId)
      : and(eq(routines.userId, userId), eq(routines.archived, false)),
  });
  return rows.map(toRoutine).sort((a, b) => a.title.localeCompare(b.title));
}

async function getRoutineRow(db: Db, userId: string, id: string): Promise<RoutineRow> {
  const row = await db.query.routines.findFirst({
    where: and(eq(routines.id, id), eq(routines.userId, userId)),
  });
  if (!row) throw notFound('Routine not found');
  return row;
}

export async function createRoutine(
  db: Db,
  userId: string,
  draft: RoutineDraft,
  now: string,
  source: 'app' | 'ics' = 'app',
  icsUid: string | null = null,
): Promise<Routine> {
  const valid = validateRoutineDraft(draft);
  if (!valid.ok) throw badRequest(valid.reason);
  const [row] = await db
    .insert(routines)
    .values({ userId, ...valid.value, source, icsUid, updatedAt: dt(now) })
    .returning();
  return toRoutine(row!);
}

export async function updateRoutine(
  db: Db,
  userId: string,
  id: string,
  patch: Partial<RoutineDraft> & { archived?: boolean },
  now: string,
): Promise<Routine> {
  const current = await getRoutineRow(db, userId, id);
  const merged: RoutineDraft = {
    title: patch.title ?? current.title,
    note: patch.note !== undefined ? patch.note : current.note,
    nodeId: patch.nodeId !== undefined ? patch.nodeId : current.nodeId,
    estimatedMinutes: patch.estimatedMinutes ?? current.estimatedMinutes,
    freq: patch.freq ?? current.freq,
    interval: patch.interval ?? current.interval,
    byWeekday: patch.byWeekday ?? current.byWeekday,
    byMonthday: patch.byMonthday ?? current.byMonthday,
    startDate: patch.startDate ?? current.startDate,
    endDate: patch.endDate !== undefined ? patch.endDate : current.endDate,
  };
  // Changing frequency clears the other frequency's selector, which validation enforces.
  if (patch.freq && patch.freq !== current.freq) {
    if (patch.freq !== 'weekly') merged.byWeekday = patch.byWeekday ?? [];
    if (patch.freq !== 'monthly') merged.byMonthday = patch.byMonthday ?? [];
  }
  const valid = validateRoutineDraft(merged);
  if (!valid.ok) throw badRequest(valid.reason);
  const [row] = await db
    .update(routines)
    .set({
      ...valid.value,
      ...(patch.archived === undefined ? {} : { archived: patch.archived }),
      updatedAt: dt(now),
    })
    .where(eq(routines.id, id))
    .returning();
  return toRoutine(row!);
}

export async function deleteRoutine(db: Db, userId: string, id: string): Promise<void> {
  await getRoutineRow(db, userId, id);
  await db.delete(routines).where(eq(routines.id, id));
}

export async function listCompletions(
  db: Db,
  userId: string,
  from: string,
  to: string,
): Promise<RoutineCompletion[]> {
  const rows = await db.query.routineCompletions.findMany({
    where: and(
      eq(routineCompletions.userId, userId),
      gte(routineCompletions.date, from),
      lte(routineCompletions.date, to),
    ),
  });
  return rows.map(toCompletion);
}

export interface AgendaResult {
  today: string;
  from: string;
  to: string;
  routines: Routine[];
  occurrences: RoutineOccurrence[];
  due: RoutineOccurrence[];
  adherence: { due: number; done: number; rate: number | null };
  /** XP already earned from routine ticks today, and what is left under the daily cap. */
  xpToday: number;
  xpRemainingToday: number;
}

export async function agenda(
  db: Db,
  userId: string,
  now: string,
  timezone: string,
  from?: string,
  to?: string,
): Promise<AgendaResult> {
  const today = toLocalDate(now, timezone);
  const start = from ?? addDays(today, -14);
  const end = to ?? addDays(today, 14);
  const [list, completions] = await Promise.all([
    listRoutines(db, userId),
    // Adherence looks back further than the rendered window, so pull the wider range once.
    listCompletions(db, userId, addDays(start, -30), end),
  ]);
  const input = { routines: list, completions, today };
  const earned = await routineXpEarnedOn(db, userId, today);
  return {
    today,
    from: start,
    to: end,
    routines: list,
    occurrences: routineAgenda({ ...input, from: start, to: end }),
    due: routinesDue(input),
    adherence: routineAdherence({ ...input, from: addDays(today, -27), to: today }),
    xpToday: earned,
    xpRemainingToday: Math.max(0, ROUTINES.MAX_XP_PER_DAY - earned),
  };
}

/** XP already banked from routine ticks on a local date, for the daily cap. */
export async function routineXpEarnedOn(db: Db, userId: string, date: string): Promise<number> {
  const rows = await db.query.routineCompletions.findMany({
    where: and(eq(routineCompletions.userId, userId), eq(routineCompletions.date, date)),
    columns: { xpAwarded: true },
  });
  return rows.reduce((a, r) => a + r.xpAwarded, 0);
}

export interface TickOutcome {
  completion: RoutineCompletion;
  xpAwarded: number;
  xpTotal: number;
  /** True when the daily cap swallowed some or all of the XP. */
  cappedByDailyLimit: boolean;
}

/**
 * Tick one occurrence. Idempotent by (routine, date): a second tick is refused rather than
 * paying out twice, and the XP is banked on the day the occurrence is *for*, not today, so
 * catching up on a backlog cannot bypass the daily cap.
 */
export async function tickRoutine(
  db: Db,
  user: { id: string; xp: number; timezone: string },
  id: string,
  date: string,
  now: string,
): Promise<TickOutcome> {
  const routine = toRoutine(await getRoutineRow(db, user.id, id));
  if (routine.archived) throw badRequest('That routine is archived.');
  const today = toLocalDate(now, user.timezone);
  const allowed = canTick(routine, date, today);
  if (!allowed.ok) throw badRequest(allowed.reason);

  const existing = await db.query.routineCompletions.findFirst({
    where: and(eq(routineCompletions.routineId, id), eq(routineCompletions.date, date)),
  });
  if (existing) throw badRequest('Already ticked off.');

  const earned = await routineXpEarnedOn(db, user.id, date);
  const award = routineXp({ estimatedMinutes: routine.estimatedMinutes, earnedToday: earned });
  const uncapped = Math.min(
    routine.estimatedMinutes * ROUTINES.XP_PER_MINUTE,
    ROUTINES.MAX_XP_PER_TICK,
  );

  const [row] = await db
    .insert(routineCompletions)
    .values({
      userId: user.id,
      routineId: id,
      date,
      completedAt: dt(now),
      minutes: routine.estimatedMinutes,
      xpAwarded: award,
    })
    .returning();

  const xpTotal = user.xp + award;
  if (award > 0) {
    await db.update(users).set({ xp: xpTotal }).where(eq(users.id, user.id));
    await db
      .insert(xpTransactions)
      .values({ userId: user.id, at: dt(now), delta: award, kind: 'routine', ref: row!.id });
  }
  return {
    completion: toCompletion(row!),
    xpAwarded: award,
    xpTotal,
    cappedByDailyLimit: award < uncapped,
  };
}

/**
 * The routine a session is about to be started for, checked the way a tick would be: a
 * session for a day that cannot be ticked would have nothing to tick at the end.
 * `date` defaults to today.
 */
export async function routineForSession(
  db: Db,
  user: { id: string; timezone: string },
  id: string,
  date: string | undefined,
  now: string,
): Promise<{ routine: Routine; date: string }> {
  const routine = toRoutine(await getRoutineRow(db, user.id, id));
  if (routine.archived) throw badRequest('That routine is archived.');
  const today = toLocalDate(now, user.timezone);
  const day = date ?? today;
  const allowed = canTick(routine, day, today);
  if (!allowed.ok) throw badRequest(allowed.reason);
  return { routine, date: day };
}

/**
 * Tick an occurrence off at the end of a session spent on it.
 *
 * The session has already paid for its minutes, so the tick only tops up to what a plain
 * tick would have paid: doing a routine under the timer is never worth less than ticking it,
 * and never paid twice. The top-up is logged here; the caller adds it to the user's total
 * alongside the session's own XP, so the level is worked out once.
 *
 * Returns ticked: false instead of throwing when the occurrence cannot be ticked any more
 * (archived meanwhile, already ticked) — the session itself must still finish.
 */
export async function tickFromSession(
  db: Db,
  user: { id: string; timezone: string },
  routineId: string,
  date: string,
  opts: { minutes: number; sessionXp: number },
  now: string,
): Promise<{ ticked: boolean; xpAwarded: number }> {
  const row = await db.query.routines.findFirst({
    where: and(eq(routines.id, routineId), eq(routines.userId, user.id)),
  });
  if (!row || row.archived) return { ticked: false, xpAwarded: 0 };
  const routine = toRoutine(row);
  if (!canTick(routine, date, toLocalDate(now, user.timezone)).ok)
    return { ticked: false, xpAwarded: 0 };

  const earned = await routineXpEarnedOn(db, user.id, date);
  const plainTick = routineXp({ estimatedMinutes: routine.estimatedMinutes, earnedToday: earned });
  const award = Math.max(0, plainTick - opts.sessionXp);

  const [inserted] = await db
    .insert(routineCompletions)
    .values({
      userId: user.id,
      routineId,
      date,
      completedAt: dt(now),
      minutes: opts.minutes,
      xpAwarded: award,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted) return { ticked: false, xpAwarded: 0 };
  if (award > 0) {
    await db
      .insert(xpTransactions)
      .values({ userId: user.id, at: dt(now), delta: award, kind: 'routine', ref: inserted.id });
  }
  return { ticked: true, xpAwarded: award };
}

/** Undo a tick, taking back exactly the XP that was paid for it. */
export async function untickRoutine(
  db: Db,
  user: { id: string; xp: number },
  id: string,
  date: string,
  now: string,
): Promise<{ xpTotal: number; xpRemoved: number }> {
  const row = await db.query.routineCompletions.findFirst({
    where: and(
      eq(routineCompletions.routineId, id),
      eq(routineCompletions.date, date),
      eq(routineCompletions.userId, user.id),
    ),
  });
  if (!row) throw notFound('That day is not ticked off.');
  await db.delete(routineCompletions).where(eq(routineCompletions.id, row.id));
  const xpTotal = Math.max(0, user.xp - row.xpAwarded);
  if (row.xpAwarded > 0) {
    await db.update(users).set({ xp: xpTotal }).where(eq(users.id, user.id));
    await db.insert(xpTransactions).values({
      userId: user.id,
      at: dt(now),
      delta: -row.xpAwarded,
      kind: 'routine',
      ref: row.id,
    });
  }
  return { xpTotal, xpRemoved: row.xpAwarded };
}

/* ---------- ICS import ---------- */

export interface ImportOutcome {
  created: Routine[];
  updated: Routine[];
  skipped: IcsImportPlan['skipped'];
}

/**
 * Import recurring events from an .ics document. Events are matched on their UID, so
 * re-importing the same calendar updates the routines it already created instead of
 * duplicating them. Non-recurring events are reported, never silently dropped.
 */
export async function importIcsRoutines(
  db: Db,
  userId: string,
  text: string,
  now: string,
  opts: { defaultEstimate?: number } = {},
): Promise<ImportOutcome> {
  const plan = planIcsImport(parseIcs(text), opts.defaultEstimate ?? 30);
  if (plan.candidates.length === 0 && plan.skipped.length === 0)
    throw badRequest('No calendar events found in that file.');

  const uids = plan.candidates.map((c) => c.uid).filter((u): u is string => !!u);
  const existing = uids.length
    ? await db.query.routines.findMany({
        where: and(eq(routines.userId, userId), inArray(routines.icsUid, uids)),
      })
    : [];
  const byUid = new Map(existing.map((r) => [r.icsUid!, r]));

  const created: Routine[] = [];
  const updated: Routine[] = [];
  const skipped = [...plan.skipped];
  for (const candidate of plan.candidates) {
    const valid = validateRoutineDraft(candidate.draft);
    if (!valid.ok) {
      skipped.push({ summary: candidate.summary, reason: valid.reason });
      continue;
    }
    const prior = candidate.uid ? byUid.get(candidate.uid) : undefined;
    if (prior) {
      const [row] = await db
        .update(routines)
        .set({ ...valid.value, archived: false, updatedAt: dt(now) })
        .where(eq(routines.id, prior.id))
        .returning();
      updated.push(toRoutine(row!));
    } else {
      const [row] = await db
        .insert(routines)
        .values({
          userId,
          ...valid.value,
          source: 'ics',
          icsUid: candidate.uid,
          updatedAt: dt(now),
        })
        .returning();
      created.push(toRoutine(row!));
    }
  }
  return { created, updated, skipped };
}

/* ---------- badge inputs ---------- */

export interface RoutineBadgeStats {
  ticks: Array<{ date: string }>;
  perfectWeeks: number;
}

/**
 * Everything the habit badges need: every tick, and how many calendar weeks had all their
 * due occurrences ticked. Only weeks that actually had something due count.
 */
export async function routineBadgeStats(
  db: Db,
  userId: string,
  today: string,
): Promise<RoutineBadgeStats> {
  const [list, rows] = await Promise.all([
    listRoutines(db, userId, true),
    db.query.routineCompletions.findMany({
      where: eq(routineCompletions.userId, userId),
      columns: { date: true, routineId: true, id: true, xpAwarded: true, minutes: true },
    }),
  ]);
  const ticks = rows.map((r) => ({ date: r.date }));
  if (list.length === 0 || rows.length === 0) return { ticks, perfectWeeks: 0 };

  const completions: RoutineCompletion[] = rows.map((r) => ({
    id: r.id,
    routineId: r.routineId,
    date: r.date,
    completedAt: today,
    minutes: r.minutes,
    xpAwarded: r.xpAwarded,
  }));
  const weeks = new Set(rows.map((r) => startOfWeekMonday(r.date)));
  let perfectWeeks = 0;
  for (const weekStart of weeks) {
    const weekEnd = addDays(weekStart, 6);
    // A week in progress is not judged: only count weeks that have finished.
    if (weekEnd >= today) continue;
    const a = routineAdherence({
      routines: list,
      completions,
      from: weekStart,
      to: weekEnd,
      today,
    });
    if (a.due > 0 && a.done === a.due) perfectWeeks++;
  }
  return { ticks, perfectWeeks };
}
