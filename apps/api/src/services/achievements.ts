import {
  badgeXp,
  evaluateBadges,
  satisfiedBadges,
  toLocalDate,
  type BadgeInput,
} from '@komogon/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  achievements,
  sessions,
  streakEvents,
  users,
  weeklyReviews,
  xpTransactions,
  type UserRow,
} from '../db/schema';
import { listNodes } from './nodes';
import { loadCompletedSessions } from './pace';
import { listBlocks } from './planned-blocks';
import { rewardsRedeemedCount } from './rewards';
import { routineBadgeStats } from './routines';
import { dt } from './sessions-mapper';
import { addXp } from './users';

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

/**
 * Pay (sign 1) or take back (sign -1) the XP of these badges, with a ledger line each. The
 * user row passed in is brought up to date, so whatever the caller reports afterwards is
 * the real total.
 */
async function payBadges(db: Db, user: UserRow, keys: string[], now: string, sign: 1 | -1) {
  if (keys.length === 0) return;
  const userId = user.id;
  const total = keys.reduce((sum, k) => sum + badgeXp(k), 0);
  const after = await addXp(db, userId, sign * total, { withLevel: true });
  user.xp = after.xp;
  user.level = after.level;
  await db.insert(xpTransactions).values(
    keys.map((key) => ({
      userId,
      at: dt(now),
      delta: sign * badgeXp(key),
      kind: 'badge' as const,
      ref: key,
    })),
  );
}

/** Unlock any newly satisfied badges, paying each one's XP. Returns the new keys. */
export async function unlockNewBadges(
  db: Db,
  user: UserRow,
  now: string,
  sessionId?: string,
): Promise<string[]> {
  const { input } = await badgeInput(db, user, now);
  const fresh = evaluateBadges(input);
  if (fresh.length === 0) return [];
  // Only the badges this call actually inserted are paid, so a race can't pay one twice.
  const inserted = await db
    .insert(achievements)
    .values(fresh.map((key) => ({ userId: user.id, key, unlockedAt: dt(now) })))
    .onConflictDoNothing()
    .returning({ key: achievements.key });
  await payBadges(
    db,
    user,
    inserted.map((r) => r.key),
    now,
    1,
  );
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
  const removed = await db
    .delete(achievements)
    .where(and(eq(achievements.userId, user.id), inArray(achievements.key, lapsed)))
    .returning({ key: achievements.key });
  // The badge's XP goes with it.
  await payBadges(
    db,
    user,
    removed.map((r) => r.key),
    now,
    -1,
  );
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

/**
 * Pay the XP of any badge a user holds but was never paid for: the ones unlocked before
 * badges paid XP. A badge counts as paid while its ledger lines sum above zero, so this is
 * safe to run on every start; it pays each badge once and does nothing after. Returns how
 * many badges were paid, across everyone.
 */
export async function backPayBadges(db: Db, now: string): Promise<number> {
  const held = await db.query.achievements.findMany({ columns: { userId: true, key: true } });
  if (held.length === 0) return 0;
  const ledger = await db.query.xpTransactions.findMany({
    where: eq(xpTransactions.kind, 'badge'),
    columns: { userId: true, ref: true, delta: true },
  });
  const paid = new Map<string, number>();
  for (const l of ledger) {
    const k = `${l.userId}:${l.ref}`;
    paid.set(k, (paid.get(k) ?? 0) + l.delta);
  }
  const owed = new Map<string, string[]>();
  for (const a of held) {
    if ((paid.get(`${a.userId}:${a.key}`) ?? 0) > 0) continue;
    owed.set(a.userId, [...(owed.get(a.userId) ?? []), a.key]);
  }
  let count = 0;
  for (const [userId, keys] of owed) {
    const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!row) continue;
    await payBadges(db, row, keys, now, 1);
    count += keys.length;
  }
  return count;
}
