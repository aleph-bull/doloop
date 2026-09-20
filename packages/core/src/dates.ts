import type { ISODate, ISODateTime } from './types';

/**
 * Calendar-day helpers that are safe across DST. Calendar days are ISODate strings
 * ("YYYY-MM-DD") in the user's timezone. Instants are ISODateTime strings in UTC.
 * Day arithmetic is done on UTC-midnight timestamps of the date string, which never
 * cross a DST boundary, so adding one day is always exactly one calendar day.
 */

const DAY_MS = 86_400_000;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(tz: string): Intl.DateTimeFormat {
  let f = dateFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateFormatters.set(tz, f);
  }
  return f;
}

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Calendar date of an instant in the given timezone. */
export function toLocalDate(instant: ISODateTime | Date, tz: string): ISODate {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  return dateFormatter(tz).format(d);
}

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

/** Wall-clock parts of an instant in the given timezone. */
export function toLocalParts(instant: ISODateTime | Date, tz: string): LocalParts {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(d)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? 0,
    month: out.month ?? 0,
    day: out.day ?? 0,
    // Some ICU builds render midnight as "24" with hourCycle h23 quirks; normalise.
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** Local hour (0-23) of an instant. Used for the late-night phrase bucket. */
export function localHour(instant: ISODateTime | Date, tz: string): number {
  return toLocalParts(instant, tz).hour;
}

function utcMsOfDate(date: ISODate): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return Date.UTC(y, m - 1, d);
}

function dateOfUtcMs(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return dateOfUtcMs(utcMsOfDate(date)) === date;
}

export function addDays(date: ISODate, n: number): ISODate {
  return dateOfUtcMs(utcMsOfDate(date) + n * DAY_MS);
}

/** Whole days from `a` to `b` (b - a). Negative if b is before a. */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((utcMsOfDate(b) - utcMsOfDate(a)) / DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday */
export function dayOfWeek(date: ISODate): number {
  return new Date(utcMsOfDate(date)).getUTCDay();
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

/** Inclusive range check. */
export function isBetween(date: ISODate, from: ISODate, to: ISODate): boolean {
  return date >= from && date <= to;
}

/** The Monday on or before `date`. */
export function startOfWeekMonday(date: ISODate): ISODate {
  const dow = dayOfWeek(date);
  const back = (dow + 6) % 7; // Mon=0 ... Sun=6
  return addDays(date, -back);
}

/** The first Monday strictly after `date`. */
export function nextMonday(date: ISODate): ISODate {
  const dow = dayOfWeek(date);
  const forward = (8 - dow) % 7 || 7;
  return addDays(date, forward);
}

/** Iterate calendar days from `from` to `to` inclusive. */
export function* eachDay(from: ISODate, to: ISODate): Generator<ISODate> {
  let ms = utcMsOfDate(from);
  const end = utcMsOfDate(to);
  while (ms <= end) {
    yield dateOfUtcMs(ms);
    ms += DAY_MS;
  }
}

/** First day of the month containing `date`. */
export function startOfMonth(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}

/**
 * Offset in minutes between wall-clock time in `tz` and UTC at instant `ms`.
 * Positive east of UTC (e.g. +120 for CEST).
 */
export function tzOffsetMinutes(ms: number, tz: string): number {
  const p = toLocalParts(new Date(ms), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - ms) / 60_000);
}

/**
 * UTC instant of local midnight at the start of `date` in `tz`.
 * Two-pass correction handles DST transitions on that day.
 */
export function zonedMidnightUtc(date: ISODate, tz: string): Date {
  const base = utcMsOfDate(date);
  let guess = base;
  for (let i = 0; i < 2; i++) {
    guess = base - tzOffsetMinutes(guess, tz) * 60_000;
  }
  // If midnight itself does not exist (spring-forward at 00:00), Intl rolls to 01:00;
  // that is the first valid instant of the day, which is what callers want.
  return new Date(guess);
}

/** UTC instant of a local wall-clock time on `date` in `tz`. */
export function zonedTimeUtc(date: ISODate, hour: number, minute: number, tz: string): Date {
  const base = utcMsOfDate(date) + hour * 3_600_000 + minute * 60_000;
  let guess = base;
  for (let i = 0; i < 2; i++) {
    guess = base - tzOffsetMinutes(guess, tz) * 60_000;
  }
  return new Date(guess);
}

/** Hours between two instants (b - a). */
export function hoursBetween(a: ISODateTime | Date, b: ISODateTime | Date): number {
  const am = typeof a === 'string' ? Date.parse(a) : a.getTime();
  const bm = typeof b === 'string' ? Date.parse(b) : b.getTime();
  return (bm - am) / 3_600_000;
}

export function minutesBetween(a: ISODateTime | Date, b: ISODateTime | Date): number {
  return hoursBetween(a, b) * 60;
}

export function isoNow(date: Date): ISODateTime {
  return date.toISOString();
}
