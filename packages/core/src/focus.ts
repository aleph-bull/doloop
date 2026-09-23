import { ancestorTitles } from './tree';

/**
 * What the focus screen says under the clock, and how far along the session is. Pure, so
 * the screen's copy rules are checked here rather than by eye.
 */

export interface FocusContext {
  /** The unit: the root course of the task, or the task itself when it has no parent. */
  subject: string;
  /** The task under the unit, or null when the subject is its own task. */
  child: string | null;
}

/**
 * "Financial Accounting / for Adjusting Entries": the subject is the root of the task's
 * tree and the child is the task. A root task is its own subject and has no child line.
 * An unknown node (a routine session, or a task the list has not loaded yet) falls back
 * to the title the session carries.
 */
export function focusContext(
  byId: ReadonlyMap<string, { title: string; parentId: string | null }>,
  nodeId: string | null,
  fallbackTitle: string,
): FocusContext {
  const node = nodeId ? byId.get(nodeId) : undefined;
  if (!node || !nodeId) return { subject: fallbackTitle, child: null };
  const ancestors = ancestorTitles(byId, nodeId);
  if (ancestors.length === 0) return { subject: node.title, child: null };
  return { subject: ancestors[0]!, child: node.title };
}

export interface FocusProgress {
  elapsedSeconds: number;
  /** Null when nothing says how long the work should take: then there is no bar. */
  expectedSeconds: number | null;
  /** elapsed / expected, capped at 1 for the bar. Null without an expectation. */
  fraction: number | null;
  /** True once elapsed has passed the expectation. */
  exceeded: boolean;
}

/**
 * Progress against an expected length. Nothing is invented: with no expectation the
 * fraction is null, and running over is reported rather than clamped away.
 */
export function focusProgress(
  elapsedSeconds: number,
  expectedMinutes: number | null | undefined,
): FocusProgress {
  const elapsed = Math.max(0, elapsedSeconds);
  if (expectedMinutes === null || expectedMinutes === undefined || expectedMinutes <= 0) {
    return { elapsedSeconds: elapsed, expectedSeconds: null, fraction: null, exceeded: false };
  }
  const expectedSeconds = Math.round(expectedMinutes * 60);
  return {
    elapsedSeconds: elapsed,
    expectedSeconds,
    fraction: Math.min(1, elapsed / expectedSeconds),
    exceeded: elapsed > expectedSeconds,
  };
}

export interface ExpectedMinutesInput {
  /** The task's own estimate, when it is a task session with one. */
  nodeEstimatedMinutes: number | null | undefined;
  /** The routine's estimate, when it is a routine session. */
  routineEstimatedMinutes: number | null | undefined;
  /** The session's planned length, when the user chose one. */
  startedAt: string;
  plannedEndAt: string | null;
}

/**
 * How long the work is expected to take, in minutes, or null. The task's estimate speaks
 * for the task; without one, a length the user chose for the session is still a real
 * expectation; a routine carries its own. Nothing else is guessed at.
 */
export function expectedMinutes(input: ExpectedMinutesInput): number | null {
  if (input.nodeEstimatedMinutes && input.nodeEstimatedMinutes > 0)
    return input.nodeEstimatedMinutes;
  if (input.plannedEndAt) {
    const planned = (Date.parse(input.plannedEndAt) - Date.parse(input.startedAt)) / 60_000;
    if (planned > 0) return Math.round(planned);
  }
  if (input.routineEstimatedMinutes && input.routineEstimatedMinutes > 0)
    return input.routineEstimatedMinutes;
  return null;
}
