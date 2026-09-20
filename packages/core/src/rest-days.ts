import { dayOfWeek, isBetween } from './dates';
import type { ISODate, RestDayPolicy } from './types';

export function emptyRestDayPolicy(userId: string): RestDayPolicy {
  return {
    userId,
    weeklyRestDays: [],
    pendingWeeklyRestDays: null,
    vacations: [],
    breakDays: [],
    changeLog: [],
  };
}

/** Weekly rest-day pattern in force on `date`, honouring a pending change that starts on a Monday. */
export function effectiveWeeklyRestDays(policy: RestDayPolicy, date: ISODate): number[] {
  const pending = policy.pendingWeeklyRestDays;
  if (pending && date >= pending.effectiveFrom) return pending.days;
  return policy.weeklyRestDays;
}

export function isWeeklyRestDay(policy: RestDayPolicy, date: ISODate): boolean {
  return effectiveWeeklyRestDays(policy, date).includes(dayOfWeek(date));
}

export function isVacationDay(policy: RestDayPolicy, date: ISODate): boolean {
  return policy.vacations.some((v) => isBetween(date, v.from, v.to));
}

export function isBreakDay(policy: RestDayPolicy, date: ISODate): boolean {
  return policy.breakDays.includes(date);
}

/** Any day on which study is not expected: weekly rest, vacation, or purchased break day. */
export function isRestDay(policy: RestDayPolicy, date: ISODate): boolean {
  return isWeeklyRestDay(policy, date) || isVacationDay(policy, date) || isBreakDay(policy, date);
}

export type RestReason = 'weekly' | 'vacation' | 'break' | null;

export function restReason(policy: RestDayPolicy, date: ISODate): RestReason {
  if (isVacationDay(policy, date)) return 'vacation';
  if (isBreakDay(policy, date)) return 'break';
  if (isWeeklyRestDay(policy, date)) return 'weekly';
  return null;
}
