import {
  nameTier,
  prestigeAll,
  prestigeOnce,
  ROLL_TIERS_COUNT,
  withDefaults,
  type PrestigeResult,
  type UserSettings,
} from '@komogon/core';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { rollHoldings } from '../db/schema';

/** The rolls someone holds of each rarity (index i is tier i + 1): rolled, less prestiged. */
export async function rollCounts(db: Db, userId: string): Promise<number[]> {
  const rows = await db
    .select({ tier: rollHoldings.tier, held: rollHoldings.held })
    .from(rollHoldings)
    .where(eq(rollHoldings.userId, userId));
  const counts = Array.from({ length: ROLL_TIERS_COUNT }, () => 0);
  for (const r of rows) if (r.tier >= 1 && r.tier <= ROLL_TIERS_COUNT) counts[r.tier - 1] = r.held;
  return counts;
}

/** Add rolls to what someone holds: one of each tier listed. */
export async function holdRolls(db: Db, userId: string, tiers: number[]): Promise<void> {
  const byTier = new Map<number, number>();
  for (const t of tiers) byTier.set(t, (byTier.get(t) ?? 0) + 1);
  if (byTier.size === 0) return;
  await db
    .insert(rollHoldings)
    .values([...byTier].map(([tier, held]) => ({ userId, tier, held })))
    .onConflictDoUpdate({
      target: [rollHoldings.userId, rollHoldings.tier],
      set: { held: sql`${rollHoldings.held} + excluded.held` },
    });
}

/**
 * Prestige (core rolls.ts): five of `tier` into one of the next, or with `tier` null
 * everything that can be, commonest first. Read and written in one transaction with the rows
 * locked, so two quick presses can't spend the same five. Null when there aren't enough.
 */
export async function prestige(
  db: Db,
  userId: string,
  tier: number | null,
): Promise<PrestigeResult | null> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ tier: rollHoldings.tier, held: rollHoldings.held })
      .from(rollHoldings)
      .where(eq(rollHoldings.userId, userId))
      .for('update');
    const held = Array.from({ length: ROLL_TIERS_COUNT }, () => 0);
    for (const r of rows) if (r.tier >= 1 && r.tier <= ROLL_TIERS_COUNT) held[r.tier - 1] = r.held;
    const result = tier === null ? prestigeAll(held) : prestigeOnce(held, tier);
    if (!result) return null;
    const changed = result.held
      .map((n, i) => ({ tier: i + 1, held: n }))
      .filter((r) => r.held !== held[r.tier - 1]);
    await tx
      .insert(rollHoldings)
      .values(changed.map((r) => ({ userId, ...r })))
      .onConflictDoUpdate({
        target: [rollHoldings.userId, rollHoldings.tier],
        set: { held: sql`excluded.held` },
      });
    return result;
  });
}

/** The rarity whose style a person's name wears (their choice on Achievements), or null. */
export function nameTierOf(row: {
  rollBest: number;
  settings: Partial<UserSettings>;
}): number | null {
  return nameTier(row.rollBest, withDefaults(row.settings).rolls.name);
}
