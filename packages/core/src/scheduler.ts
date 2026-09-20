import { addDays, toLocalDate, zonedTimeUtc } from './dates';
import { isRestDay } from './rest-days';
import type { ISODateTime, RestDayPolicy } from './types';

/** A half-open interval [start, end) in UTC ISO. */
export interface Interval {
  start: ISODateTime;
  end: ISODateTime;
}

export interface FreeSlotInput {
  /** Search window. */
  from: ISODateTime;
  to: ISODateTime;
  /** Busy intervals (Google free/busy, existing planned blocks, anything else). */
  busy: Interval[];
  /** Minutes the slot must hold. */
  minutes: number;
  timezone: string;
  policy: RestDayPolicy;
  /** Local hours within which to look, e.g. 8..22. */
  dayStartHour?: number;
  dayEndHour?: number;
  /** Return at most this many slots. */
  limit?: number;
}

function mergeBusy(busy: Interval[]): Array<[number, number]> {
  const xs = busy
    .map<[number, number]>((b) => [Date.parse(b.start), Date.parse(b.end)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of xs) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * Free slots of at least `minutes` inside the daily window on study days,
 * skipping busy time. Deterministic and pure; the scheduler suggests the first one.
 */
export function findFreeSlots(input: FreeSlotInput): Interval[] {
  const { timezone: tz, policy } = input;
  const dayStart = input.dayStartHour ?? 8;
  const dayEnd = input.dayEndHour ?? 22;
  const need = input.minutes * 60_000;
  const limit = input.limit ?? 5;
  const fromMs = Date.parse(input.from);
  const toMs = Date.parse(input.to);
  const busy = mergeBusy(input.busy);
  const out: Interval[] = [];

  let day = toLocalDate(input.from, tz);
  const lastDay = toLocalDate(input.to, tz);
  while (day <= lastDay && out.length < limit) {
    if (!isRestDay(policy, day)) {
      const winStart = Math.max(fromMs, zonedTimeUtc(day, dayStart, 0, tz).getTime());
      const winEnd = Math.min(toMs, zonedTimeUtc(day, dayEnd, 0, tz).getTime());
      let cursor = winStart;
      for (const [a, b] of busy) {
        if (b <= cursor) continue;
        if (a >= winEnd) break;
        if (a - cursor >= need) {
          out.push({
            start: new Date(cursor).toISOString(),
            end: new Date(cursor + need).toISOString(),
          });
          if (out.length >= limit) break;
        }
        cursor = Math.max(cursor, b);
      }
      if (out.length < limit && winEnd - cursor >= need) {
        out.push({
          start: new Date(cursor).toISOString(),
          end: new Date(cursor + need).toISOString(),
        });
      }
    }
    day = addDays(day, 1);
  }
  return out.slice(0, limit);
}
