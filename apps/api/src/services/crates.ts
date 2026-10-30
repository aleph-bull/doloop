import {
  CRATE_FROM,
  isCrateTier,
  openCrate,
  petInfo,
  ROLL_TIERS_COUNT,
  type CrateWin,
} from '@komogon/core';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { crateOffers, inventoryItems, rollHoldings, users, type UserRow } from '../db/schema';
import { inWorldOf } from './dev-accounts';

export interface CrateOffer {
  id: string;
  tier: number;
}

/** What someone holds: crates by rarity and pets by id, and the crates waiting for a choice. */
export interface Inventory {
  crates: Array<{ tier: number; count: number }>;
  pets: Array<{ id: string; count: number }>;
  offers: CrateOffer[];
  /** How many of each exist across everyone, by "crate:<tier>" and "pet:<id>". */
  global: Record<string, number>;
}

/** A crate offered for each of these rolls that is 1/64 or rarer; the rest are left out. */
export async function offerCrates(
  db: Db,
  userId: string,
  tiers: number[],
  source: 'roll' | 'prestige',
): Promise<CrateOffer[]> {
  const rare = tiers.filter((t) => t >= CRATE_FROM && t <= ROLL_TIERS_COUNT);
  if (!rare.length) return [];
  return db
    .insert(crateOffers)
    .values(rare.map((tier) => ({ userId, tier, source })))
    .returning({ id: crateOffers.id, tier: crateOffers.tier });
}

/** Add to someone's stacks. */
async function stack(
  db: Pick<Db, 'insert'>,
  userId: string,
  items: Array<{ kind: 'crate' | 'pet'; item: string; count: number }>,
): Promise<Array<{ kind: string; item: string; count: number }>> {
  if (!items.length) return [];
  return db
    .insert(inventoryItems)
    .values(items.map((i) => ({ userId, ...i })))
    .onConflictDoUpdate({
      target: [inventoryItems.userId, inventoryItems.kind, inventoryItems.item],
      set: { count: sql`${inventoryItems.count} + excluded.count` },
    })
    .returning({
      kind: inventoryItems.kind,
      item: inventoryItems.item,
      count: inventoryItems.count,
    });
}

/**
 * Settle crate offers: 'crate' trades each offer's roll for its crate, 'title' keeps the roll
 * and lets the crate go. A roll prestiged away since can't be traded any more; its offer just
 * goes. Returns the rarities that became crates.
 */
export async function chooseOffers(
  db: Db,
  userId: string,
  ids: string[],
  choice: 'crate' | 'title',
): Promise<number[]> {
  return db.transaction(async (tx) => {
    const offers = await tx
      .delete(crateOffers)
      .where(and(eq(crateOffers.userId, userId), inArray(crateOffers.id, ids)))
      .returning({ tier: crateOffers.tier });
    if (choice === 'title' || !offers.length) return [];
    const want = new Map<number, number>();
    for (const o of offers) want.set(o.tier, (want.get(o.tier) ?? 0) + 1);
    const held = await tx
      .select({ tier: rollHoldings.tier, held: rollHoldings.held })
      .from(rollHoldings)
      .where(and(eq(rollHoldings.userId, userId), inArray(rollHoldings.tier, [...want.keys()])))
      .for('update');
    const taken: number[] = [];
    for (const h of held) {
      const n = Math.min(want.get(h.tier) ?? 0, h.held);
      if (n <= 0) continue;
      await tx
        .update(rollHoldings)
        .set({ held: sql`${rollHoldings.held} - ${n}` })
        .where(and(eq(rollHoldings.userId, userId), eq(rollHoldings.tier, h.tier)));
      for (let i = 0; i < n; i++) taken.push(h.tier);
    }
    const byTier = new Map<number, number>();
    for (const t of taken) byTier.set(t, (byTier.get(t) ?? 0) + 1);
    await stack(
      tx,
      userId,
      [...byTier].map(([tier, count]) => ({ kind: 'crate' as const, item: String(tier), count })),
    );
    return taken.sort((a, b) => a - b);
  });
}

/** What opening a crate gave, and whether a pet is the first of its kind for them. */
export interface Opened {
  win: CrateWin;
  isNew: boolean;
}

/**
 * Open one crate of `tier`: it leaves the inventory and what it gives goes in (a pet or a
 * crate), in one transaction. XP is the caller's to pay. Null when they have none.
 */
export async function openOne(
  db: Db,
  userId: string,
  tier: number,
  draw: () => number,
): Promise<Opened | null> {
  if (!isCrateTier(tier)) return null;
  return db.transaction(async (tx) => {
    const [had] = await tx
      .update(inventoryItems)
      .set({ count: sql`${inventoryItems.count} - 1` })
      .where(
        and(
          eq(inventoryItems.userId, userId),
          eq(inventoryItems.kind, 'crate'),
          eq(inventoryItems.item, String(tier)),
          gte(inventoryItems.count, 1),
        ),
      )
      .returning({ count: inventoryItems.count });
    if (!had) return null;
    const win = openCrate(tier, draw(), draw())!;
    if (win.kind === 'xp') return { win, isNew: false };
    const [row] = await stack(tx, userId, [
      win.kind === 'pet'
        ? { kind: 'pet', item: win.pet, count: 1 }
        : { kind: 'crate', item: String(win.tier), count: 1 },
    ]);
    return { win, isNew: win.kind === 'pet' && row?.count === 1 };
  });
}

/** Someone's inventory, with how many of each thing exist among the people they can see. */
export async function inventoryOf(
  db: Db,
  user: Pick<UserRow, 'id' | 'devWorld'>,
): Promise<Inventory> {
  const [rows, offers, totals] = await Promise.all([
    db
      .select({ kind: inventoryItems.kind, item: inventoryItems.item, count: inventoryItems.count })
      .from(inventoryItems)
      .where(eq(inventoryItems.userId, user.id)),
    db
      .select({ id: crateOffers.id, tier: crateOffers.tier })
      .from(crateOffers)
      .where(eq(crateOffers.userId, user.id))
      .orderBy(crateOffers.at),
    db
      .select({
        kind: inventoryItems.kind,
        item: inventoryItems.item,
        n: sql<number>`sum(${inventoryItems.count})::int`,
      })
      .from(inventoryItems)
      .innerJoin(users, eq(users.id, inventoryItems.userId))
      .where(inWorldOf(user))
      .groupBy(inventoryItems.kind, inventoryItems.item),
  ]);
  const global: Record<string, number> = {};
  for (const t of totals) if (t.n > 0) global[`${t.kind}:${t.item}`] = Number(t.n);
  return {
    crates: rows
      .filter((r) => r.kind === 'crate' && r.count > 0 && isCrateTier(Number(r.item)))
      .map((r) => ({ tier: Number(r.item), count: r.count })),
    pets: rows
      .filter((r) => r.kind === 'pet' && r.count > 0 && petInfo(r.item))
      .map((r) => ({ id: r.item, count: r.count })),
    offers,
    global,
  };
}
