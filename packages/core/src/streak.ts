import { addDays, eachDay, startOfWeekMonday, toLocalDate } from './dates';
import type { ISODate, ISODateTime, Session, StreakState, WeekStreakState } from './types';

export const STREAK_MILESTONES = [7, 14, 30, 60, 100] as const;

/** How many streak days a week may be asked for before it counts toward the weekly streak. */
export const WEEK_STREAK_DAYS = { MIN: 1, MAX: 7 } as const;

/** When a streak day may begin, and how often that may change. */
export const STREAK_DAY_START = { MIN_HOUR: 0, MAX_HOUR: 8, LOCK_HOURS: 24 } as const;

/**
 * The streak day an instant belongs to: its local date, with the day starting at
 * `startHour` instead of midnight. At 4, a session at 1:30am counts for the day before.
 */
export function streakDay(instant: ISODateTime | Date, tz: string, startHour = 0): ISODate {
  const ms =
    (typeof instant === 'string' ? Date.parse(instant) : instant.getTime()) -
    Math.max(0, startHour) * 3_600_000;
  return toLocalDate(new Date(ms), tz);
}

/**
 * When the day-start hour may next change, or null if it may change now. It is held for a
 * day after each change, so a streak can't be saved by moving midnight around.
 */
export function dayStartUnlocksAt(
  changedAt: ISODateTime | null,
  now: ISODateTime,
): ISODateTime | null {
  if (!changedAt) return null;
  const at = Date.parse(changedAt) + STREAK_DAY_START.LOCK_HOURS * 3_600_000;
  return at > Date.parse(now) ? new Date(at).toISOString() : null;
}

export function emptyStreak(): StreakState {
  return {
    current: 0,
    longest: 0,
    lastCountedDate: null,
    freezesHeld: 0,
    breakDaysHeld: 0,
    weeks: emptyWeekStreak(),
  };
}

export function emptyWeekStreak(): WeekStreakState {
  return { current: 0, longest: 0, lastCountedWeek: null };
}

/** The weekly streak's two numbers, zero for a streak saved before it existed. */
export function weekStreakNumbers(state: StreakState): { current: number; longest: number } {
  return { current: state.weeks?.current ?? 0, longest: state.weeks?.longest ?? 0 };
}

export type StreakEventType = 'counted' | 'freeze-used' | 'reset';

export interface StreakEvent {
  type: StreakEventType;
  date: ISODate;
}

export interface StreakEvaluation {
  state: StreakState;
  events: StreakEvent[];
  /** Milestones crossed during this evaluation (for confetti / phrases). */
  milestonesReached: number[];
}

/**
 * Streak days (user tz, starting at `startHour`) with at least one session whose work time
 * meets the minimum. A session is credited to the day it started, even if it ran past the
 * day's end.
 */
export function qualifyingDays(
  sessions: Session[],
  minMinutes: number,
  tz: string,
  startHour = 0,
): Set<ISODate> {
  const out = new Set<ISODate>();
  const minSeconds = Math.max(0, minMinutes) * 60;
  for (const s of sessions) {
    if (s.endedAt === null) continue; // in-progress sessions do not count yet
    if (s.workSeconds >= minSeconds && s.workSeconds > 0)
      out.add(streakDay(s.startedAt, tz, startHour));
  }
  return out;
}

export interface EvaluateStreakInput {
  state: StreakState;
  sessions: Session[];
  minMinutes: number;
  /** Today's streak day in the user's timezone (see streakDay). */
  today: ISODate;
  timezone: string;
  /** The hour the streak day starts; midnight when absent. */
  dayStartHour?: number;
}

/**
 * Lazily bring the streak up to date through `today`. Idempotent for the same inputs:
 * `lastCountedDate` advances through every judged day (counted, frozen, or reset), so
 * re-running on the same day changes nothing. Days before the first ever session are never
 * judged. Today is only judged if it already qualifies; a quiet today is left open. Rest days
 * get no pass: they shape the plan, not the streak, so a quiet one is missed like any other.
 */
export function evaluateStreak(input: EvaluateStreakInput): StreakEvaluation {
  const { today, timezone } = input;
  const days = qualifyingDays(input.sessions, input.minMinutes, timezone, input.dayStartHour ?? 0);
  const state: StreakState = { ...input.state };
  const events: StreakEvent[] = [];
  const milestonesReached: number[] = [];

  let start: ISODate;
  if (state.lastCountedDate === null) {
    let earliest: ISODate | null = null;
    for (const d of days) if (earliest === null || d < earliest) earliest = d;
    if (earliest === null) return { state, events, milestonesReached };
    start = earliest;
  } else {
    start = addDays(state.lastCountedDate, 1);
  }

  for (const d of eachDay(start, today)) {
    if (days.has(d)) {
      const before = state.current;
      state.current += 1;
      state.longest = Math.max(state.longest, state.current);
      state.lastCountedDate = d;
      events.push({ type: 'counted', date: d });
      for (const m of STREAK_MILESTONES)
        if (before < m && state.current >= m) milestonesReached.push(m);
      continue;
    }
    if (d === today) break; // the day is not over
    if (state.current === 0) {
      // Nothing to protect; just move on without spending a freeze.
      state.lastCountedDate = d;
      continue;
    }
    if (state.freezesHeld > 0) {
      state.freezesHeld -= 1;
      state.lastCountedDate = d;
      events.push({ type: 'freeze-used', date: d });
      continue;
    }
    state.current = 0;
    state.lastCountedDate = d;
    events.push({ type: 'reset', date: d });
  }

  return { state, events, milestonesReached };
}

export interface EvaluateWeekStreakInput {
  /** Absent on a streak saved before weekly streaks; judged from the first session then. */
  state: WeekStreakState | undefined;
  sessions: Session[];
  minMinutes: number;
  /** Streak days a week needs to count (see WEEK_STREAK_DAYS). */
  daysPerWeek: number;
  /** Today's streak day in the user's timezone (see streakDay). */
  today: ISODate;
  timezone: string;
  dayStartHour?: number;
}

/**
 * The weekly streak: Monday-to-Sunday weeks in a row with at least `daysPerWeek` streak
 * days, the days judged exactly as the daily streak judges them. Lazy and idempotent like
 * evaluateStreak: `lastCountedWeek` (a Monday) advances through every judged week. This week
 * counts as soon as it has enough days and is otherwise left open until it ends. Freezes are
 * the daily streak's; a week short of its days ends the weekly one.
 */
export function evaluateWeekStreak(input: EvaluateWeekStreakInput): WeekStreakState {
  const days = qualifyingDays(
    input.sessions,
    input.minMinutes,
    input.timezone,
    input.dayStartHour ?? 0,
  );
  const state: WeekStreakState = { ...(input.state ?? emptyWeekStreak()) };
  const need = Math.min(WEEK_STREAK_DAYS.MAX, Math.max(WEEK_STREAK_DAYS.MIN, input.daysPerWeek));
  const thisWeek = startOfWeekMonday(input.today);

  let week: ISODate;
  if (state.lastCountedWeek === null) {
    let earliest: ISODate | null = null;
    for (const d of days) if (earliest === null || d < earliest) earliest = d;
    if (earliest === null) return state;
    week = startOfWeekMonday(earliest);
  } else {
    week = addDays(state.lastCountedWeek, 7);
  }

  for (; week <= thisWeek; week = addDays(week, 7)) {
    let studied = 0;
    for (const d of eachDay(week, addDays(week, 6))) if (days.has(d)) studied += 1;
    if (studied >= need) {
      state.current += 1;
      state.longest = Math.max(state.longest, state.current);
      state.lastCountedWeek = week;
      continue;
    }
    if (week === thisWeek) break; // the week is not over
    state.current = 0;
    state.lastCountedWeek = week;
  }
  return state;
}

/** True if `count` is exactly a milestone value. */
export function isStreakMilestone(count: number): boolean {
  return (STREAK_MILESTONES as readonly number[]).includes(count);
}

/** Human summary of what happened, for the "tell the user which happened" requirement. */
export function describeStreakEvents(events: StreakEvent[]): string | null {
  const freezes = events.filter((e) => e.type === 'freeze-used');
  const reset = events.find((e) => e.type === 'reset');
  if (reset) return "Your streak ended. Don't worry, you can begin another one today!";
  if (freezes.length === 1) return "A streak freeze covered your streak. Let's continue working!";
  if (freezes.length > 1) return "Streak freezes covered your streak. Let's continue working!";
  return null;
}
