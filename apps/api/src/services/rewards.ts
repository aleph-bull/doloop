import {
  type CustomReward,
  type RewardDraft,
  type RewardView,
  redeemReward,
  toRewardView,
  validateRewardDraft,
  REWARDS,
} from '@komogon/core';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { customRewards, users, xpTransactions, type CustomRewardRow } from '../db/schema';
import { badRequest, notFound } from '../errors';
import { dt } from './sessions-mapper';

function toReward(row: CustomRewardRow): CustomReward {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    note: row.note,
    emoji: row.emoji,
    costXp: row.costXp,
    cooldownDays: row.cooldownDays,
    archived: row.archived,
    createdAt: row.createdAt.toISOString(),
    lastRedeemedAt: row.lastRedeemedAt?.toISOString() ?? null,
    redeemedCount: row.redeemedCount,
  };
}

export async function listRewards(
  db: Db,
  userId: string,
  xp: number,
  now: string,
  timezone: string,
  includeArchived = false,
): Promise<RewardView[]> {
  const rows = await db.query.customRewards.findMany({
    where: includeArchived
      ? eq(customRewards.userId, userId)
      : and(eq(customRewards.userId, userId), eq(customRewards.archived, false)),
    orderBy: [desc(customRewards.createdAt)],
  });
  return rows.map((r) => toRewardView(toReward(r), xp, now, timezone));
}

async function getRewardRow(db: Db, userId: string, id: string): Promise<CustomRewardRow> {
  const row = await db.query.customRewards.findFirst({
    where: and(eq(customRewards.id, id), eq(customRewards.userId, userId)),
  });
  if (!row) throw notFound('Reward not found');
  return row;
}

export async function countActiveRewards(db: Db, userId: string): Promise<number> {
  const rows = await db.query.customRewards.findMany({
    where: and(eq(customRewards.userId, userId), eq(customRewards.archived, false)),
    columns: { id: true },
  });
  return rows.length;
}

export async function createReward(
  db: Db,
  userId: string,
  draft: RewardDraft,
): Promise<CustomReward> {
  const valid = validateRewardDraft(draft);
  if (!valid.ok) throw badRequest(valid.reason);
  if ((await countActiveRewards(db, userId)) >= REWARDS.MAX_ACTIVE)
    throw badRequest(`You can keep at most ${REWARDS.MAX_ACTIVE} rewards. Archive one first.`);
  const [row] = await db
    .insert(customRewards)
    .values({ userId, ...valid.value })
    .returning();
  return toReward(row!);
}

export async function updateReward(
  db: Db,
  userId: string,
  id: string,
  patch: Partial<RewardDraft> & { archived?: boolean },
): Promise<CustomReward> {
  const current = await getRewardRow(db, userId, id);
  const merged: RewardDraft = {
    name: patch.name ?? current.name,
    note: patch.note !== undefined ? patch.note : current.note,
    emoji: patch.emoji !== undefined ? patch.emoji : current.emoji,
    costXp: patch.costXp ?? current.costXp,
    cooldownDays: patch.cooldownDays ?? current.cooldownDays,
  };
  const valid = validateRewardDraft(merged);
  if (!valid.ok) throw badRequest(valid.reason);
  if (patch.archived === false && current.archived) {
    if ((await countActiveRewards(db, userId)) >= REWARDS.MAX_ACTIVE)
      throw badRequest(`You can keep at most ${REWARDS.MAX_ACTIVE} rewards. Archive one first.`);
  }
  const [row] = await db
    .update(customRewards)
    .set({ ...valid.value, ...(patch.archived === undefined ? {} : { archived: patch.archived }) })
    .where(eq(customRewards.id, id))
    .returning();
  return toReward(row!);
}

export async function deleteReward(db: Db, userId: string, id: string): Promise<void> {
  await getRewardRow(db, userId, id);
  await db.delete(customRewards).where(eq(customRewards.id, id));
}

export interface RedeemOutcome {
  reward: CustomReward;
  xp: number;
  spent: number;
}

/** Spend XP on a reward, writing the ledger entry that the history and badges read. */
export async function redeem(
  db: Db,
  user: { id: string; xp: number; timezone: string },
  id: string,
  now: string,
): Promise<RedeemOutcome> {
  const reward = toReward(await getRewardRow(db, user.id, id));
  const result = redeemReward(user.xp, reward, now, user.timezone);
  if (!result.ok) throw badRequest(result.reason);
  await db.update(users).set({ xp: result.value.xp }).where(eq(users.id, user.id));
  await db
    .update(customRewards)
    .set({ lastRedeemedAt: dt(now), redeemedCount: reward.redeemedCount + 1 })
    .where(eq(customRewards.id, id));
  await db.insert(xpTransactions).values({
    userId: user.id,
    at: dt(now),
    delta: -reward.costXp,
    kind: 'reward',
    ref: id,
  });
  return { reward: result.value.reward, xp: result.value.xp, spent: reward.costXp };
}

/** How many rewards this user has ever redeemed, for the reward badges. */
export async function rewardsRedeemedCount(db: Db, userId: string): Promise<number> {
  const rows = await db.query.xpTransactions.findMany({
    where: and(eq(xpTransactions.userId, userId), eq(xpTransactions.kind, 'reward')),
    columns: { id: true },
  });
  return rows.length;
}

export interface RedemptionEntry {
  at: string;
  rewardId: string | null;
  name: string;
  emoji: string | null;
  costXp: number;
}

/** Recent redemptions, newest first, resolved against the reward names. */
export async function redemptionHistory(
  db: Db,
  userId: string,
  limit = 20,
): Promise<RedemptionEntry[]> {
  const [txs, rewards] = await Promise.all([
    db.query.xpTransactions.findMany({
      where: and(eq(xpTransactions.userId, userId), eq(xpTransactions.kind, 'reward')),
      orderBy: [desc(xpTransactions.at)],
      limit,
    }),
    db.query.customRewards.findMany({ where: eq(customRewards.userId, userId) }),
  ]);
  const byId = new Map(rewards.map((r) => [r.id, r]));
  return txs.map((t) => {
    const r = t.ref ? byId.get(t.ref) : undefined;
    return {
      at: t.at.toISOString(),
      rewardId: t.ref,
      name: r?.name ?? 'Deleted reward',
      emoji: r?.emoji ?? null,
      costXp: -t.delta,
    };
  });
}
