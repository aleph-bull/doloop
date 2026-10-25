import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ROLL_COST, ROLL_TICKETS, rollBadgeKey, rollTier } from '@komogon/core';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users, xpTransactions } from '../db/schema';
import { badRequest } from '../errors';
import { unlockNewBadges } from '../services/achievements';
import { dt } from '../services/sessions-mapper';

/**
 * Rolls on Achievements (core rolls.ts): 10 XP for a rarity, drawn here. `ticket` is
 * injectable so tests can pick the rarity.
 */
export function rollRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string,
  ticket: () => number = () => randomInt(0, ROLL_TICKETS),
) {
  app.post('/api/rolls', async (req) => {
    const now = clock();
    const userId = req.user.id;
    // Paid in one statement, so two quick pulls can't spend the same 10 XP.
    const [paid] = await db
      .update(users)
      .set({ xp: sql`${users.xp} - ${ROLL_COST}` })
      .where(and(eq(users.id, userId), gte(users.xp, ROLL_COST)))
      .returning({ xp: users.xp });
    if (!paid) throw badRequest('Not enough XP.');
    const tier = rollTier(ticket());
    const [row] = await db
      .update(users)
      .set({
        rollBest: sql`greatest(${users.rollBest}, ${tier})`,
        rollCount: sql`${users.rollCount} + 1`,
      })
      .where(eq(users.id, userId))
      .returning({ rollBest: users.rollBest, rollCount: users.rollCount });
    await db.insert(xpTransactions).values({
      userId,
      at: dt(now),
      delta: -ROLL_COST,
      kind: 'roll',
      ref: String(tier),
    });
    const newBest = tier > req.user.rollBest && row!.rollBest === tier;
    req.user.xp = paid.xp;
    req.user.rollBest = row!.rollBest;
    req.user.rollCount = row!.rollCount;
    // A rarity past 1 in 256 for the first time is a badge, which pays its XP.
    const fresh = newBest && rollBadgeKey(tier) ? await unlockNewBadges(db, req.user, now) : [];
    return {
      tier,
      newBest,
      best: row!.rollBest,
      count: row!.rollCount,
      xp: req.user.xp,
      fresh,
    };
  });
}
