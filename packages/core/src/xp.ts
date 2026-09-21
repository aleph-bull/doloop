import type { Distracted, PaceStatus } from './types';

/**
 * XP constants, all in one place so they can be tuned.
 *
 * Everything scales with focused time: the base is per work minute and every bonus is a
 * percentage of that base. The streak bonus is a fixed amount per streak day. A session
 * cancelled before its first work interval (pomodoro) or planned end (scheduled) earns nothing.
 */
export const XP = {
  /** XP per focused minute. */
  PER_MINUTE: 2,
  /** Bonus percentages applied to the base. */
  REVIEW_SUBMITTED_PCT: 10,
  FOCUS_NO_PCT: 20,
  FOCUS_A_LITTLE_PCT: 5,
  FOCUS_A_LOT_PCT: 0,
  PLANNED_BLOCK_PCT: 10,
  ON_PACE_PCT: 10,
  ESTIMATE_BEAT_PCT: 20,
  /** Flat XP per streak day, capped. */
  STREAK_PER_DAY: 1,
  STREAK_CAP_DAYS: 30,
  /** Level = floor(sqrt(xp / LEVEL_DIVISOR)). */
  LEVEL_DIVISOR: 100,
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
  /** True when the session was cancelled early (see `isEndedEarly`). No XP at all. */
  endedEarly?: boolean;
}

export interface SessionXpBreakdown {
  /** XP from focused minutes. */
  base: number;
  reviewSubmitted: number;
  focus: number;
  plannedBlock: number;
  onPace: number;
  estimateBeat: number;
  /** Flat streak bonus. */
  streakBonus: number;
  total: number;
  /** True when nothing was awarded because the session ended early. */
  withheld: boolean;
}

export function streakBonus(streakCurrent: number): number {
  return Math.max(0, Math.min(streakCurrent, XP.STREAK_CAP_DAYS)) * XP.STREAK_PER_DAY;
}

export function focusPct(distracted: Distracted | null): number {
  if (distracted === 'no') return XP.FOCUS_NO_PCT;
  if (distracted === 'a-little') return XP.FOCUS_A_LITTLE_PCT;
  return XP.FOCUS_A_LOT_PCT;
}

const pct = (base: number, p: number) => Math.floor((base * p) / 100);

/** XP for one session. Every term is non-negative and proportional to focused time. */
export function computeSessionXp(input: SessionXpInput): SessionXpBreakdown {
  const zero: SessionXpBreakdown = {
    base: 0,
    reviewSubmitted: 0,
    focus: 0,
    plannedBlock: 0,
    onPace: 0,
    estimateBeat: 0,
    streakBonus: 0,
    total: 0,
    withheld: false,
  };
  if (input.endedEarly) return { ...zero, withheld: true };
  const minutes = Math.max(0, Math.floor(input.workMinutes));
  if (minutes === 0) return zero;
  const base = minutes * XP.PER_MINUTE;
  const reviewSubmitted = input.reviewSubmitted ? pct(base, XP.REVIEW_SUBMITTED_PCT) : 0;
  const focus = pct(base, focusPct(input.distracted));
  const plannedBlock = input.overlapsPlannedBlock ? pct(base, XP.PLANNED_BLOCK_PCT) : 0;
  const onPace =
    input.statusAfter === 'on-track' || input.statusAfter === 'done'
      ? pct(base, XP.ON_PACE_PCT)
      : 0;
  const estimateBeat =
    input.nodeJustCompleted &&
    input.estimatedMinutes !== null &&
    input.loggedWorkMinutesAfter <= input.estimatedMinutes
      ? pct(base, XP.ESTIMATE_BEAT_PCT)
      : 0;
  const streak = streakBonus(input.streakCurrent);
  return {
    base,
    reviewSubmitted,
    focus,
    plannedBlock,
    onPace,
    estimateBeat,
    streakBonus: streak,
    total: base + reviewSubmitted + focus + plannedBlock + onPace + estimateBeat + streak,
    withheld: false,
  };
}

export interface EndedEarlyInput {
  mode: 'pomodoro' | 'unlimited' | 'scheduled';
  /** Completed work intervals (pomodoro). */
  cycle: number;
  /** Scheduled: ended by the timer rather than the user. */
  autoEnded: boolean;
  endedAt: string | null;
  plannedEndAt: string | null;
}

/**
 * A pomodoro cancelled before its first work interval completes, or a scheduled session
 * stopped before its planned end, counts as ended early. Unlimited sessions never do.
 */
export function isEndedEarly(t: EndedEarlyInput): boolean {
  // A planned end is the promise that was made, whichever style the session ran in.
  if (t.plannedEndAt) {
    if (t.autoEnded || !t.endedAt) return false;
    return Date.parse(t.endedAt) < Date.parse(t.plannedEndAt);
  }
  // An open-ended pomodoro instead promises one work interval.
  if (t.mode === 'pomodoro') return t.cycle < 1;
  return false;
}

/** Level = floor(sqrt(xp / LEVEL_DIVISOR)). */
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
