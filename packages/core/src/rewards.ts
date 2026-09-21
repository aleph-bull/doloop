import { addDays, diffDays, toLocalDate } from './dates';
import type { Result } from './economy';
import type { ISODate, ISODateTime } from './types';

/**
 * Custom rewards: things the user defines and buys with XP — "an hour of doomscrolling",
 * "the hoodie". Doloop never judges what the reward is; it only enforces that it costs
 * something real, so the XP still has to be earned by studying.
 */
export const REWARDS = {
  /**
   * The floor on what a reward may cost. Roughly an hour of focused work (2 XP/min plus
   * bonuses), so a reward can never be cheaper than the effort it is supposed to represent.
   */
  MIN_COST_XP: 150,
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
  /** 0 = redeemable whenever it is affordable. */
  cooldownDays: number;
  archived: boolean;
  createdAt: ISODateTime;
  lastRedeemedAt: ISODateTime | null;
  redeemedCount: number;
}

export interface RewardDraft {
  name: string;
  note?: string | null;
  emoji?: string | null;
  costXp: number;
  cooldownDays?: number;
}

/** A reward as the client sees it, with the affordability/cooldown verdict resolved. */
export interface RewardView extends CustomReward {
  affordable: boolean;
  /** Null when it can be redeemed now, else the date the cooldown lifts. */
  availableOn: ISODate | null;
  redeemable: boolean;
}

/** Trim and bounds-check a draft. Returns the normalised draft, or why it was refused. */
export function validateRewardDraft(draft: RewardDraft): Result<Required<RewardDraft>> {
  const name = draft.name.trim();
  if (!name) return { ok: false, reason: 'Give the reward a name.' };
  if (name.length > REWARDS.NAME_MAX)
    return { ok: false, reason: `Names are at most ${REWARDS.NAME_MAX} characters.` };

  const note = (draft.note ?? '').trim();
  if (note.length > REWARDS.NOTE_MAX)
    return { ok: false, reason: `Notes are at most ${REWARDS.NOTE_MAX} characters.` };

  if (!Number.isFinite(draft.costXp) || !Number.isInteger(draft.costXp))
    return { ok: false, reason: 'The price must be a whole number of XP.' };
  if (draft.costXp < REWARDS.MIN_COST_XP)
    return {
      ok: false,
      reason: `The lowest price is ${REWARDS.MIN_COST_XP} XP — about an hour of focused work.`,
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
): RewardView {
  const availableOn = cooldownUntil(reward, now, timezone);
  const affordable = xp >= reward.costXp;
  return {
    ...reward,
    affordable,
    availableOn,
    redeemable: !reward.archived && affordable && availableOn === null,
  };
}

export interface RedeemResult {
  xp: number;
  reward: CustomReward;
}

/** Spend XP on a reward. Refuses when archived, unaffordable, or still cooling down. */
export function redeemReward(
  xp: number,
  reward: CustomReward,
  now: ISODateTime,
  timezone: string,
): Result<RedeemResult> {
  if (reward.archived) return { ok: false, reason: 'That reward is archived.' };
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
