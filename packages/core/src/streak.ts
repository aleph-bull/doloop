import { addDays, eachDay, toLocalDate } from './dates';
import { isRestDay } from './rest-days';
import type { ISODate, RestDayPolicy, Session, StreakState } from './types';

export const STREAK_MILESTONES = [7, 14, 30, 60, 100] as const;

export function emptyStreak(): StreakState {
  return { current: 0, longest: 0, lastCountedDate: null, freezesHeld: 0, breakDaysHeld: 0 };
}

export type StreakEventType = 'counted' | 'rest' | 'freeze-used' | 'reset';

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
 * Calendar days (user tz) with at least one session whose work time meets the minimum.
 * A session is credited to the local day it started, even if it ran past midnight.
 */
export function qualifyingDays(sessions: Session[], minMinutes: number, tz: string): Set<ISODate> {
  const out = new Set<ISODate>();
  const minSeconds = Math.max(0, minMinutes) * 60;
  for (const s of sessions) {
    if (s.endedAt === null) continue; // in-progress sessions do not count yet
    if (s.workSeconds >= minSeconds && s.workSeconds > 0) out.add(toLocalDate(s.startedAt, tz));
  }
  return out;
}

export interface EvaluateStreakInput {
  state: StreakState;
  sessions: Session[];
  policy: RestDayPolicy;
  minMinutes: number;
  /** Today's calendar date in the user's timezone. */
  today: ISODate;
  timezone: string;
}

/**
 * Lazily bring the streak up to date through `today`. Idempotent for the same inputs:
 * `lastCountedDate` advances through every judged day (counted, rest, frozen, or reset),
 * so re-running on the same day changes nothing. Days before the first ever session are
 * never judged. Today is only judged if it already qualifies; a quiet today is left open.
 */
export function evaluateStreak(input: EvaluateStreakInput): StreakEvaluation {
  const { policy, today, timezone } = input;
  const days = qualifyingDays(input.sessions, input.minMinutes, timezone);
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
    if (isRestDay(policy, d)) {
      state.lastCountedDate = d;
      events.push({ type: 'rest', date: d });
      continue;
    }
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

/** True if `count` is exactly a milestone value. */
export function isStreakMilestone(count: number): boolean {
  return (STREAK_MILESTONES as readonly number[]).includes(count);
}

/** Human summary of what happened, for the "tell the user which happened" requirement. */
export function describeStreakEvents(events: StreakEvent[]): string | null {
  const freezes = events.filter((e) => e.type === 'freeze-used');
  const reset = events.find((e) => e.type === 'reset');
  if (reset) return `Your streak reset on ${reset.date}. A new one starts with your next session.`;
  if (freezes.length === 1)
    return `A streak freeze covered ${freezes[0]!.date}. Your streak is intact.`;
  if (freezes.length > 1)
    return `Streak freezes covered ${freezes.length} missed days. Your streak is intact.`;
  return null;
}
