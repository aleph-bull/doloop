import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  advanceRollStats,
  ROLL_BATCHES,
  ROLL_COST,
  ROLL_TICKETS,
  rollBadges,
  rollPayout,
  rollTier,
} from '@komogon/core';
import { and, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { users, xpTransactions } from '../db/schema';
import { badRequest } from '../errors';
import { unlockNewBadges } from '../services/achievements';
import { addXp } from '../services/users';
import { dt } from '../services/sessions-mapper';

const rollBody = z
  .object({
    count: z
      .number()
      .int()
      .refine((n) => (ROLL_BATCHES as readonly number[]).includes(n))
      .default(1),
  })
  .default({ count: 1 });

/**
 * RNG Rolls on Achievements (core rolls.ts): 10 XP a roll, one or a batch at once, drawn
 * here, each paying back a tenth of its denominator. `ticket` is injectable so tests can
 * pick the rarity.
 */
export function rollRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string,
  ticket: () => number = () => randomInt(0, ROLL_TICKETS),
) {
  app.post('/api/rolls', async (req) => {
    const { count } = rollBody.parse(req.body ?? undefined);
    const now = clock();
    const userId = req.user.id;
    const cost = ROLL_COST * count;
    // Paid in one statement, so two quick pulls can't spend the same XP.
    const [paid] = await db
      .update(users)
      .set({ xp: sql`${users.xp} - ${cost}` })
      .where(and(eq(users.id, userId), gte(users.xp, cost)))
      .returning({ xp: users.xp, rollStats: users.rollStats, rollCount: users.rollCount });
    if (!paid) throw badRequest('Not enough XP.');
    const tiers = Array.from({ length: count }, () => rollTier(ticket()));
    const before = { count: paid.rollCount, best: req.user.rollBest, stats: paid.rollStats };
    let stats = paid.rollStats;
    tiers.forEach((tier, i) => (stats = advanceRollStats(stats, tier, paid.rollCount + i)));
    const top = Math.max(...tiers);
    // Each roll pays back a tenth of its denominator (core rollPayout).
    const won = tiers.reduce((sum, tier) => sum + rollPayout(tier), 0);
    const [row] = await db
      .update(users)
      .set({
        rollBest: sql`greatest(${users.rollBest}, ${top})`,
        rollCount: sql`${users.rollCount} + ${count}`,
        rollStats: stats,
      })
      .where(eq(users.id, userId))
      .returning({ rollBest: users.rollBest, rollCount: users.rollCount });
    await db.insert(xpTransactions).values(
      tiers.map((tier) => ({
        userId,
        at: dt(now),
        delta: rollPayout(tier) - ROLL_COST,
        kind: 'roll' as const,
        ref: String(tier),
      })),
    );
    const newBest = top > req.user.rollBest && row!.rollBest === top;
    req.user.xp = paid.xp;
    if (won > 0) {
      const after = await addXp(db, userId, won, { withLevel: true });
      req.user.xp = after.xp;
      req.user.level = after.level;
    }
    req.user.rollBest = row!.rollBest;
    req.user.rollCount = row!.rollCount;
    req.user.rollStats = stats;
    // A badge these rolls earned pays its XP; the rest of the badges are only read when one did.
    const had = rollBadges(before);
    const earned = [...rollBadges({ count: row!.rollCount, best: row!.rollBest, stats })].some(
      (k) => !had.has(k),
    );
    const fresh = earned ? await unlockNewBadges(db, req.user, now) : [];
    return {
      /** Every roll, in the order drawn. */
      tiers,
      /** The rarest of them. */
      tier: top,
      newBest,
      best: row!.rollBest,
      count: row!.rollCount,
      /** What the rolls paid back, all together. */
      won,
      xp: req.user.xp,
      fresh,
    };
  });
}
