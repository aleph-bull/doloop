import type { Distracted, PaceStatus } from './types';

/** All XP constants in one place so they can be tuned (spec §6). */
export const XP = {
  BASE_FLAT: 10,
  BASE_PER_5_MIN: 1,
  REVIEW_SUBMITTED: 5,
  FOCUS_NO: 15,
  FOCUS_A_LITTLE: 5,
  FOCUS_A_LOT: 0,
  PLANNED_BLOCK: 10,
  ON_PACE: 10,
  ESTIMATE_BEAT: 10,
  STREAK_MULT_PER_DAY: 0.01,
  STREAK_MULT_CAP_DAYS: 30,
  LEVEL_DIVISOR: 50,
} as const;

export interface SessionXpInput {
  workMinutes: number;
  reviewSubmitted: boolean;
  distracted: Distracted | null;
  overlapsPlannedBlock: boolean;
  /** Node pace status after this session. */
  statusAfter: PaceStatus;
  /** True if this session completed the node. */
  nodeJustCompleted: boolean;
  loggedWorkMinutesAfter: number;
  estimatedMinutes: number | null;
  streakCurrent: number;
}

export interface SessionXpBreakdown {
  base: number;
  reviewSubmitted: number;
  focus: number;
  plannedBlock: number;
  onPace: number;
  estimateBeat: number;
  subtotal: number;
  streakMult: number;
  total: number;
}

export function streakMultiplier(streakCurrent: number): number {
  const days = Math.max(0, Math.min(streakCurrent, XP.STREAK_MULT_CAP_DAYS));
  return 1 + days * XP.STREAK_MULT_PER_DAY;
}

export function focusXp(distracted: Distracted | null): number {
  if (distracted === 'no') return XP.FOCUS_NO;
  if (distracted === 'a-little') return XP.FOCUS_A_LITTLE;
  return XP.FOCUS_A_LOT;
}

/** XP for one session. All terms are additive and non-negative. */
export function computeSessionXp(input: SessionXpInput): SessionXpBreakdown {
  const workMinutes = Math.max(0, Math.floor(input.workMinutes));
  const base = XP.BASE_FLAT + Math.floor(workMinutes / 5) * XP.BASE_PER_5_MIN;
  const reviewSubmitted = input.reviewSubmitted ? XP.REVIEW_SUBMITTED : 0;
  const focus = focusXp(input.distracted);
  const plannedBlock = input.overlapsPlannedBlock ? XP.PLANNED_BLOCK : 0;
  const onPace = input.statusAfter === 'on-track' || input.statusAfter === 'done' ? XP.ON_PACE : 0;
  const estimateBeat =
    input.nodeJustCompleted &&
    input.estimatedMinutes !== null &&
    input.loggedWorkMinutesAfter <= input.estimatedMinutes
      ? XP.ESTIMATE_BEAT
      : 0;
  const subtotal = base + reviewSubmitted + focus + plannedBlock + onPace + estimateBeat;
  const streakMult = streakMultiplier(input.streakCurrent);
  const total = Math.floor(subtotal * streakMult);
  return {
    base,
    reviewSubmitted,
    focus,
    plannedBlock,
    onPace,
    estimateBeat,
    subtotal,
    streakMult,
    total,
  };
}

/** Level = floor(sqrt(xp / 50)). */
export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / XP.LEVEL_DIVISOR));
}

/** Minimum XP needed to reach `level`. */
export function xpForLevel(level: number): number {
  return Math.max(0, level) ** 2 * XP.LEVEL_DIVISOR;
}

export interface LevelProgress {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  /** XP earned inside the current level. */
  intoLevel: number;
  /** XP still needed for the next level. */
  toNext: number;
  /** 0..1 */
  ratio: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const intoLevel = xp - currentLevelXp;
  const span = nextLevelXp - currentLevelXp;
  return {
    level,
    currentLevelXp,
    nextLevelXp,
    intoLevel,
    toNext: nextLevelXp - xp,
    ratio: span > 0 ? intoLevel / span : 0,
  };
}
