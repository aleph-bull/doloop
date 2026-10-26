import { nameTier, ROLL_TIERS_COUNT, withDefaults, type UserSettings } from '@komogon/core';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { xpTransactions } from '../db/schema';

/** How many of someone's rolls landed on each rarity, read from the XP ledger. */
export async function rollCounts(db: Db, userId: string): Promise<number[]> {
  const rows = await db
    .select({ ref: xpTransactions.ref, n: sql<number>`count(*)::int` })
    .from(xpTransactions)
    .where(and(eq(xpTransactions.userId, userId), eq(xpTransactions.kind, 'roll')))
    .groupBy(xpTransactions.ref);
  const counts = Array.from({ length: ROLL_TIERS_COUNT }, () => 0);
  for (const r of rows) {
    const tier = Number(r.ref);
    if (tier >= 1 && tier <= ROLL_TIERS_COUNT) counts[tier - 1] = Number(r.n);
  }
  return counts;
}

/** The rarity whose style a person's name wears (their choice on Achievements), or null. */
export function nameTierOf(row: {
  rollBest: number;
  settings: Partial<UserSettings>;
}): number | null {
  return nameTier(row.rollBest, withDefaults(row.settings).rolls.name);
}
