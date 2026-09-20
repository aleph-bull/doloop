import { hoursBetween, isValidDate, nextMonday, toLocalDate, zonedMidnightUtc } from './dates';
import type { Result } from './economy';
import type { ISODate, ISODateTime, RestDayPolicy, Vacation } from './types';

/** Change-limit constants (spec §6). */
export const REST_LIMITS = {
  MAX_EDITS_PER_ROLLING_7_DAYS: 3,
  VACATION_MIN_LEAD_HOURS: 48,
  /** At least this many study days must remain in the weekly pattern. */
  MIN_STUDY_DAYS_PER_WEEK: 1,
} as const;

/**
 * Edits that count toward the rolling limit. Removals and purchased break days do not:
 * vacations "can be removed anytime" and break days already cost XP.
 */
const COUNTED_PREFIXES = ['weekly:', 'vacation-add:'];

export function countedEditsSince(policy: RestDayPolicy, since: ISODateTime): number {
  const sinceMs = Date.parse(since);
  let n = 0;
  for (const c of policy.changeLog) {
    if (Date.parse(c.at) < sinceMs) continue;
    if (COUNTED_PREFIXES.some((p) => c.what.startsWith(p))) n++;
  }
  return n;
}

export function editsInLast7Days(policy: RestDayPolicy, now: ISODateTime): number {
  const since = new Date(Date.parse(now) - 7 * 86_400_000).toISOString();
  return countedEditsSince(policy, since);
}

export function editsRemaining(policy: RestDayPolicy, now: ISODateTime): number {
  return Math.max(0, REST_LIMITS.MAX_EDITS_PER_ROLLING_7_DAYS - editsInLast7Days(policy, now));
}

function limitReached(policy: RestDayPolicy, now: ISODateTime): string | null {
  if (editsRemaining(policy, now) <= 0)
    return `You can change rest days ${REST_LIMITS.MAX_EDITS_PER_ROLLING_7_DAYS} times per 7 days. Try again later.`;
  return null;
}

function normaliseDays(days: number[]): number[] | null {
  const set = new Set<number>();
  for (const d of days) {
    if (!Number.isInteger(d) || d < 0 || d > 6) return null;
    set.add(d);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Change the weekly rest-day pattern. Takes effect from the following Monday
 * (strictly after today in the user's timezone). Counts toward the edit limit.
 */
export function setWeeklyRestDays(
  policy: RestDayPolicy,
  days: number[],
  now: ISODateTime,
  timezone: string,
): Result<RestDayPolicy> {
  const norm = normaliseDays(days);
  if (!norm) return { ok: false, reason: 'Rest days must be integers from 0 (Sunday) to 6.' };
  if (7 - norm.length < REST_LIMITS.MIN_STUDY_DAYS_PER_WEEK)
    return { ok: false, reason: 'Keep at least one study day per week.' };
  const current = policy.pendingWeeklyRestDays?.days ?? policy.weeklyRestDays;
  if (sameDays(current, norm)) return { ok: true, value: policy }; // no-op, no log
  const limit = limitReached(policy, now);
  if (limit) return { ok: false, reason: limit };
  const today = toLocalDate(now, timezone);
  const effectiveFrom = nextMonday(today);
  return {
    ok: true,
    value: {
      ...policy,
      pendingWeeklyRestDays: { days: norm, effectiveFrom },
      changeLog: [
        ...policy.changeLog,
        { at: now, what: `weekly:${norm.join(',')}@${effectiveFrom}` },
      ],
    },
  };
}

function sameDays(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

/** Promote a pending pattern once its effective date has arrived. Safe to call on every read. */
export function materializePendingRestDays(policy: RestDayPolicy, today: ISODate): RestDayPolicy {
  const p = policy.pendingWeeklyRestDays;
  if (!p || today < p.effectiveFrom) return policy;
  return { ...policy, weeklyRestDays: p.days, pendingWeeklyRestDays: null };
}

/** Add a vacation. Must start at least 48 h from now. Counts toward the edit limit. */
export function addVacation(
  policy: RestDayPolicy,
  vacation: Vacation,
  now: ISODateTime,
  timezone: string,
): Result<RestDayPolicy> {
  if (!isValidDate(vacation.from) || !isValidDate(vacation.to))
    return { ok: false, reason: 'Invalid vacation dates.' };
  if (vacation.to < vacation.from)
    return { ok: false, reason: 'Vacation must end after it starts.' };
  const startsAt = zonedMidnightUtc(vacation.from, timezone);
  if (hoursBetween(now, startsAt) < REST_LIMITS.VACATION_MIN_LEAD_HOURS)
    return {
      ok: false,
      reason: `Vacations must be added at least ${REST_LIMITS.VACATION_MIN_LEAD_HOURS} hours before they start.`,
    };
  if (policy.vacations.some((v) => v.from <= vacation.to && vacation.from <= v.to))
    return { ok: false, reason: 'That overlaps an existing vacation.' };
  const limit = limitReached(policy, now);
  if (limit) return { ok: false, reason: limit };
  const label = vacation.label.trim();
  return {
    ok: true,
    value: {
      ...policy,
      vacations: [...policy.vacations, { ...vacation, label }].sort((a, b) =>
        a.from < b.from ? -1 : 1,
      ),
      changeLog: [
        ...policy.changeLog,
        { at: now, what: `vacation-add:${vacation.from}..${vacation.to}` },
      ],
    },
  };
}

/** Remove a vacation by its start date. Allowed anytime and does not count toward the limit. */
export function removeVacation(
  policy: RestDayPolicy,
  from: ISODate,
  now: ISODateTime,
): Result<RestDayPolicy> {
  const idx = policy.vacations.findIndex((v) => v.from === from);
  if (idx === -1) return { ok: false, reason: 'No vacation starts on that date.' };
  const removed = policy.vacations[idx]!;
  return {
    ok: true,
    value: {
      ...policy,
      vacations: policy.vacations.filter((_, i) => i !== idx),
      changeLog: [
        ...policy.changeLog,
        { at: now, what: `vacation-remove:${removed.from}..${removed.to}` },
      ],
    },
  };
}

/** Number of counted edits in the calendar month of `date` (for the neutral weekly-review line). */
export function countedEditsInMonth(
  policy: RestDayPolicy,
  month: string,
  timezone: string,
): number {
  let n = 0;
  for (const c of policy.changeLog) {
    if (!COUNTED_PREFIXES.some((p) => c.what.startsWith(p))) continue;
    if (toLocalDate(c.at, timezone).slice(0, 7) === month) n++;
  }
  return n;
}
