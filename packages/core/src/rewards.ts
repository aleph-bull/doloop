import { addDays, diffDays, toLocalDate } from './dates';
import type { Result } from './economy';
import type { ISODate, ISODateTime } from './types';

/**
 * Custom rewards: things the user defines and buys with XP — "an hour of doomscrolling",
 * "the hoodie". Komogon never judges what the reward is; it only enforces that it costs
 * something real, so the XP still has to be earned by studying.
 */
export const REWARDS = {
  /**
   * The default floor on what a reward may cost: roughly an hour of focused work (2 XP/min
   * plus bonuses). Each user sets their own in Settings, between the two bounds below, and
   * may change it once a day.
   */
  MIN_COST_XP: 150,
  LOWEST_MIN_COST_XP: 10,
  HIGHEST_MIN_COST_XP: 5000,
  MIN_COST_LOCK_HOURS: 24,
  MAX_COST_XP: 100_000,
  /** How many rewards a user may keep on the shelf at once. */
  MAX_ACTIVE: 24,
  NAME_MAX: 80,
  NOTE_MAX: 280,
  /** Longest gap a user may put between redemptions of one reward. */
  MAX_COOLDOWN_DAYS: 90,
} as const;

export interface CustomReward {
  id: string;
  userId: string;
  name: string;
  note: string | null;
  /** A single emoji shown on the card, or null for the default icon. */
  emoji: string | null;
  costXp: number;
  /**
   * How the reward is earned: 'xp' is bought with XP; 'task' costs nothing and opens once
   * the linked task or test is marked done, then it can be redeemed once.
   */
  unlock: RewardUnlock;
  /** The task or test a 'task' reward waits on. Null if that task was deleted. */
  unlockNodeId: string | null;
  /** 0 = redeemable whenever it is affordable. */
  cooldownDays: number;
  archived: boolean;
  createdAt: ISODateTime;
  lastRedeemedAt: ISODateTime | null;
  redeemedCount: number;
}

export type RewardUnlock = 'xp' | 'task';

export interface RewardDraft {
  name: string;
  note?: string | null;
  emoji?: string | null;
  /** Ignored (stored as 0) for a 'task' reward. */
  costXp: number;
  cooldownDays?: number;
  unlock?: RewardUnlock;
  unlockNodeId?: string | null;
}

/** The task a 'task' reward is waiting on, as far as the reward needs to know. */
export interface UnlockTask {
  id: string;
  title: string;
  kind: string;
  done: boolean;
}

/** A reward as the client sees it, with the affordability/cooldown verdict resolved. */
export interface RewardView extends CustomReward {
  /** For a 'task' reward: the task it waits on, or null if that task is gone. */
  unlockTask: UnlockTask | null;
  affordable: boolean;
  /** Null when it can be redeemed now, else the date the cooldown lifts. */
  availableOn: ISODate | null;
  redeemable: boolean;
}

/** Trim and bounds-check a draft. Returns the normalised draft, or why it was refused. */
/** When the reward minimum may next change, or null if it may change now. */
export function minCostUnlocksAt(
  changedAt: ISODateTime | null,
  now: ISODateTime,
): ISODateTime | null {
  if (!changedAt) return null;
  const at = Date.parse(changedAt) + REWARDS.MIN_COST_LOCK_HOURS * 3_600_000;
  return at > Date.parse(now) ? new Date(at).toISOString() : null;
}

/** `minCostXp` is the user's own floor; it defaults to REWARDS.MIN_COST_XP. */
export function validateRewardDraft(
  draft: RewardDraft,
  minCostXp: number = REWARDS.MIN_COST_XP,
): Result<Required<RewardDraft>> {
  const name = draft.name.trim();
  if (!name) return { ok: false, reason: 'Give the reward a name.' };
  if (name.length > REWARDS.NAME_MAX)
    return { ok: false, reason: `Names are at most ${REWARDS.NAME_MAX} characters.` };

  const note = (draft.note ?? '').trim();
  if (note.length > REWARDS.NOTE_MAX)
    return { ok: false, reason: `Notes are at most ${REWARDS.NOTE_MAX} characters.` };

  const unlock = draft.unlock ?? 'xp';
  if (unlock === 'task') {
    if (!draft.unlockNodeId) return { ok: false, reason: 'Pick the task that unlocks it.' };
    const emoji = (draft.emoji ?? '').trim();
    return {
      ok: true,
      value: {
        name,
        note: note || null,
        emoji: emoji ? [...emoji][0]! : null,
        costXp: 0,
        cooldownDays: 0,
        unlock,
        unlockNodeId: draft.unlockNodeId,
      },
    };
  }

  if (!Number.isFinite(draft.costXp) || !Number.isInteger(draft.costXp))
    return { ok: false, reason: 'The price must be a whole number of XP.' };
  if (draft.costXp < minCostXp)
    return {
      ok: false,
      reason: `The current minimum is ${minCostXp} XP. You can change this in Settings.`,
    };
  if (draft.costXp > REWARDS.MAX_COST_XP)
    return { ok: false, reason: `The highest price is ${REWARDS.MAX_COST_XP} XP.` };

  const cooldownDays = draft.cooldownDays ?? 0;
  if (!Number.isInteger(cooldownDays) || cooldownDays < 0)
    return { ok: false, reason: 'The cooldown must be a whole number of days.' };
  if (cooldownDays > REWARDS.MAX_COOLDOWN_DAYS)
    return { ok: false, reason: `The longest cooldown is ${REWARDS.MAX_COOLDOWN_DAYS} days.` };

  const emoji = (draft.emoji ?? '').trim();
  return {
    ok: true,
    value: {
      name,
      note: note || null,
      // One grapheme at most; anything longer is almost certainly not an emoji.
      emoji: emoji ? [...emoji][0]! : null,
      costXp: draft.costXp,
      cooldownDays,
      unlock,
      unlockNodeId: null,
    },
  };
}

/** The date a reward's cooldown lifts, or null when it is available now. */
export function cooldownUntil(
  reward: Pick<CustomReward, 'cooldownDays' | 'lastRedeemedAt'>,
  now: ISODateTime,
  timezone: string,
): ISODate | null {
  if (reward.cooldownDays <= 0 || !reward.lastRedeemedAt) return null;
  const last = toLocalDate(reward.lastRedeemedAt, timezone);
  const today = toLocalDate(now, timezone);
  const elapsed = diffDays(last, today);
  if (elapsed >= reward.cooldownDays) return null;
  // Calendar-day arithmetic, so the wait is a whole number of local days.
  return addDays(last, reward.cooldownDays);
}

export function toRewardView(
  reward: CustomReward,
  xp: number,
  now: ISODateTime,
  timezone: string,
  unlockTask: UnlockTask | null = null,
): RewardView {
  if (reward.unlock === 'task') {
    // One-off: finishing the task opens it, and redeeming it once closes it for good.
    return {
      ...reward,
      unlockTask,
      affordable: true,
      availableOn: null,
      redeemable: !reward.archived && !!unlockTask?.done && reward.redeemedCount === 0,
    };
  }
  const availableOn = cooldownUntil(reward, now, timezone);
  const affordable = xp >= reward.costXp;
  return {
    ...reward,
    unlockTask: null,
    affordable,
    availableOn,
    redeemable: !reward.archived && affordable && availableOn === null,
  };
}

export interface RedeemResult {
  xp: number;
  reward: CustomReward;
}

/**
 * Spend XP on a reward, or open a task reward. Refuses when archived, unaffordable, still
 * cooling down, or (for a task reward) when the task isn't done or it was already redeemed.
 */
export function redeemReward(
  xp: number,
  reward: CustomReward,
  now: ISODateTime,
  timezone: string,
  unlockTask: UnlockTask | null = null,
): Result<RedeemResult> {
  if (reward.archived) return { ok: false, reason: 'That reward is archived.' };
  if (reward.unlock === 'task') {
    if (reward.redeemedCount > 0) return { ok: false, reason: 'Already redeemed.' };
    if (!unlockTask) return { ok: false, reason: 'The task for this reward was deleted.' };
    if (!unlockTask.done)
      return { ok: false, reason: `Finish ${unlockTask.title} first, then it's yours.` };
    return {
      ok: true,
      value: {
        xp,
        reward: { ...reward, lastRedeemedAt: now, redeemedCount: reward.redeemedCount + 1 },
      },
    };
  }
  if (xp < reward.costXp) {
    const short = reward.costXp - xp;
    return { ok: false, reason: `${short} XP short — ${reward.name} costs ${reward.costXp} XP.` };
  }
  const until = cooldownUntil(reward, now, timezone);
  if (until) return { ok: false, reason: `On cooldown until ${until}.` };
  return {
    ok: true,
    value: {
      xp: xp - reward.costXp,
      reward: {
        ...reward,
        lastRedeemedAt: now,
        redeemedCount: reward.redeemedCount + 1,
      },
    },
  };
}
