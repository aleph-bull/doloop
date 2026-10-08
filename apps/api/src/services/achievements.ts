import { evaluateBadges, satisfiedBadges, toLocalDate, type BadgeInput } from '@komogon/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { achievements, sessions, streakEvents, weeklyReviews, type UserRow } from '../db/schema';
import { listNodes } from './nodes';
import { loadCompletedSessions } from './pace';
import { listBlocks } from './planned-blocks';
import { rewardsRedeemedCount } from './rewards';
import { routineBadgeStats } from './routines';
import { dt } from './sessions-mapper';

/** Everything the badge rules read, loaded once. */
async function badgeInput(
  db: Db,
  user: UserRow,
  now: string,
): Promise<{ input: BadgeInput; have: string[] }> {
  const today = toLocalDate(now, user.timezone);
  const [nodes, completed, blocks, have, freezes, routineStats, rewardsRedeemed, notes] =
    await Promise.all([
      listNodes(db, user.id, true),
      loadCompletedSessions(db, user.id),
      listBlocks(db, user.id),
      db.query.achievements.findMany({ where: eq(achievements.userId, user.id) }),
      db.query.streakEvents.findMany({
        where: and(eq(streakEvents.userId, user.id), eq(streakEvents.type, 'freeze-used')),
      }),
      routineBadgeStats(db, user.id, today),
      rewardsRedeemedCount(db, user.id),
      db.query.weeklyReviews.findMany({
        where: eq(weeklyReviews.userId, user.id),
        columns: { note: true },
      }),
    ]);
  const input: BadgeInput = {
    nodes,
    sessions: completed,
    plannedBlocks: blocks,
    streak: user.streak,
    freezeDates: freezes.map((f) => f.date),
    timezone: user.timezone,
    unlocked: have.map((a) => a.key),
    today,
    routineTicks: routineStats.ticks,
    perfectRoutineWeeks: routineStats.perfectWeeks,
    rewardsRedeemed,
    weeklyNotes: notes.filter((n) => (n.note ?? '').trim().length > 0).length,
  };
  return { input, have: have.map((a) => a.key) };
}

/** Unlock any newly satisfied badges. Returns the new keys, in catalogue order. */
export async function unlockNewBadges(
  db: Db,
  user: UserRow,
  now: string,
  sessionId?: string,
): Promise<string[]> {
  const { input } = await badgeInput(db, user, now);
  const fresh = evaluateBadges(input);
  if (fresh.length === 0) return [];
  await db
    .insert(achievements)
    .values(fresh.map((key) => ({ userId: user.id, key, unlockedAt: dt(now) })))
    .onConflictDoNothing();
  if (sessionId) {
    await db.update(sessions).set({ badgesAwarded: fresh }).where(eq(sessions.id, sessionId));
  }
  return fresh;
}

/**
 * Take back badges that no longer hold after time was deleted from a session. Only the
 * keys given are considered (the ones that session earned), so a badge earned some other
 * way, or one that still holds on other study, stays. Returns the keys taken back.
 */
export async function revokeLapsedBadges(
  db: Db,
  user: UserRow,
  keys: string[],
  now: string,
): Promise<string[]> {
  if (keys.length === 0) return [];
  const { input } = await badgeInput(db, user, now);
  const still = satisfiedBadges(input);
  const lapsed = keys.filter((k) => !still.has(k));
  if (lapsed.length === 0) return [];
  await db
    .delete(achievements)
    .where(and(eq(achievements.userId, user.id), inArray(achievements.key, lapsed)));
  return lapsed;
}

export async function listAchievements(
  db: Db,
  userId: string,
): Promise<Array<{ key: string; unlockedAt: string }>> {
  const rows = await db.query.achievements.findMany({
    where: eq(achievements.userId, userId),
    orderBy: (a, { asc }) => [asc(a.unlockedAt)],
  });
  return rows.map((r) => ({ key: r.key, unlockedAt: r.unlockedAt.toISOString() }));
}
