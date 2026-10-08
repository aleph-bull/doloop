import type { ISODateTime, SleepGap } from './types';

/**
 * Taking time back out of a session, and the sleeps it slept through.
 *
 * A session stores totals (focused, on break), not a minute-by-minute record, so time taken
 * off the end is split between focus and breaks in the proportion the session ran them.
 * That is exactly right for the case this exists for, a session left running while
 * nobody was there: with breaks and work starting on their own, the forgotten tail runs
 * at the session's own mix. A continuous session has no breaks and loses focus one for one.
 *
 * XP follows the focused minutes: the award scales by new minutes over old, so every bonus
 * that was a share of the base comes off in step.
 */

/** A session never shrinks below this, so it always ends after it starts. */
export const MIN_SESSION_SECONDS = 60;

/** A gap between ticks longer than this is the computer asleep, not a slow tab. */
export const SLEEP_MIN_MS = 10 * 60 * 1000;

export interface TrimInput {
  startedAt: ISODateTime;
  endedAt: ISODateTime;
  workSeconds: number;
  breakSeconds: number;
  xpAwarded: number;
}

export interface TrimResult {
  endedAt: ISODateTime;
  workSeconds: number;
  breakSeconds: number;
  xpAwarded: number;
  removedWorkSeconds: number;
  removedBreakSeconds: number;
  /** How far the end moved back. */
  removedWallSeconds: number;
  xpRemoved: number;
}

/** The share of running time that was focus, 0..1. A session with no breaks is all focus. */
function focusShare(t: TrimInput): number {
  const running = t.workSeconds + t.breakSeconds;
  return running > 0 ? t.workSeconds / running : 1;
}

/** XP for the new focused minutes, in proportion to what the old ones earned. */
export function scaledXp(
  xpAwarded: number,
  oldWorkSeconds: number,
  newWorkSeconds: number,
): number {
  const oldMin = Math.floor(oldWorkSeconds / 60);
  const newMin = Math.floor(newWorkSeconds / 60);
  if (oldMin <= 0 || newMin <= 0) return 0;
  if (newMin >= oldMin) return xpAwarded;
  return Math.floor((xpAwarded * newMin) / oldMin);
}

function build(t: TrimInput, wallSeconds: number, workOff: number): TrimResult {
  const breakOff = Math.min(t.breakSeconds, Math.max(0, wallSeconds - workOff));
  const workSeconds = t.workSeconds - workOff;
  const xpAwarded = scaledXp(t.xpAwarded, t.workSeconds, workSeconds);
  return {
    endedAt: new Date(Date.parse(t.endedAt) - wallSeconds * 1000).toISOString(),
    workSeconds,
    breakSeconds: t.breakSeconds - breakOff,
    xpAwarded,
    removedWorkSeconds: workOff,
    removedBreakSeconds: breakOff,
    removedWallSeconds: wallSeconds,
    xpRemoved: t.xpAwarded - xpAwarded,
  };
}

/** The most wall time that can come off: the session keeps its first minute. */
function maxWall(t: TrimInput): number {
  return Math.max(
    0,
    (Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 1000 - MIN_SESSION_SECONDS,
  );
}

/**
 * End the session `wallSeconds` earlier than it did. Used when the user says they stopped
 * at the moment the computer fell asleep. Null when there is nothing to take off.
 */
export function trimByWall(t: TrimInput, wallSeconds: number): TrimResult | null {
  const wall = Math.round(Math.min(Math.max(0, wallSeconds), maxWall(t)));
  if (wall <= 0) return null;
  const workOff = Math.min(
    Math.round(wall * focusShare(t)),
    Math.max(0, t.workSeconds - MIN_SESSION_SECONDS),
  );
  return build(t, wall, workOff);
}

/**
 * Take `focusSeconds` of focus off the end, and the breaks that ran alongside it: the
 * "delete time" the user asks for, from which the new end follows. Null when nothing can
 * come off; capped so at least a minute of focus is left.
 */
export function trimFocus(t: TrimInput, focusSeconds: number): TrimResult | null {
  const want = Math.min(Math.max(0, focusSeconds), t.workSeconds - MIN_SESSION_SECONDS);
  if (want <= 0) return null;
  const share = focusShare(t);
  const wall = Math.min(share > 0 ? want / share : want, maxWall(t));
  const workOff = Math.min(Math.round(wall * share), Math.round(want));
  if (wall <= 0 || workOff <= 0) return null;
  return build(t, Math.round(wall), workOff);
}

/**
 * Add a sleep to a session's log. Gaps that overlap or touch one still waiting for an
 * answer merge into it, so two open tabs waking at once log one sleep, not two.
 */
export function logSleep(
  gaps: readonly SleepGap[],
  gap: { from: ISODateTime; to: ISODateTime },
): SleepGap[] {
  const from = Date.parse(gap.from);
  const to = Date.parse(gap.to);
  if (!(to - from >= SLEEP_MIN_MS)) return [...gaps];
  const out = gaps.map((g) => ({ ...g }));
  for (const g of out) {
    const gf = Date.parse(g.from);
    const gt = Date.parse(g.to);
    if (from <= gt && to >= gf) {
      if (g.answer !== null) return out;
      g.from = new Date(Math.min(gf, from)).toISOString();
      g.to = new Date(Math.max(gt, to)).toISOString();
      return out;
    }
  }
  out.push({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), answer: null });
  return out.sort((a, b) => (a.from < b.from ? -1 : 1));
}

/** The sleep still waiting for "did you keep studying?", if there is one. */
export function pendingSleep(gaps: readonly SleepGap[] | null | undefined): SleepGap | null {
  return gaps?.find((g) => g.answer === null) ?? null;
}

/** Mark the sleep that began at `from` as answered. Others are left alone. */
export function answerSleep(
  gaps: readonly SleepGap[],
  from: ISODateTime,
  answer: 'kept' | 'stopped',
): SleepGap[] {
  return gaps.map((g) => (g.from === from ? { ...g, answer } : { ...g }));
}
