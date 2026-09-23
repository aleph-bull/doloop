import { evaluateBadges, toLocalDate } from '@komodoit/core';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { achievements, sessions, streakEvents, weeklyReviews, type UserRow } from '../db/schema';
import { listNodes } from './nodes';
import { loadCompletedSessions } from './pace';
import { listBlocks } from './planned-blocks';
import { rewardsRedeemedCount } from './rewards';
import { routineBadgeStats } from './routines';
import { dt } from './sessions-mapper';

/** Unlock any newly satisfied badges. Returns the new keys, in catalogue order. */
export async function unlockNewBadges(
  db: Db,
  user: UserRow,
  now: string,
  sessionId?: string,
): Promise<string[]> {
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
  const fresh = evaluateBadges({
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
  });
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
