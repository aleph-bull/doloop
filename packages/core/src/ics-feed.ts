import {
  addDays,
  dayOfWeek,
  diffDays,
  isValidTimezone,
  zonedMidnightUtc,
  zonedTimeUtc,
} from './dates';
import { parseLine, unescapeText, unfold, type ContentLine } from './ics-parse';
import type { ISODate, ISODateTime } from './types';

/**
 * Reads a calendar someone subscribes to by link (the .ics address Google, Outlook, iCloud,
 * Moodle and most timetables hand out) into the events inside a window of time. Unlike
 * `parseIcs`, which only needs a routine's shape, this one has to place every event on the
 * right day at the right time: time zones, repeats, cancelled and moved occurrences.
 */

export interface FeedEvent {
  /** Stable from one read to the next: the UID, plus the original start for a repeat. */
  id: string;
  title: string;
  description: string | null;
  start: ISODateTime;
  end: ISODateTime;
  allDay: boolean;
  /** Marked as free time (TRANSP:TRANSPARENT), so nothing should be planned around it. */
  free: boolean;
}

export interface FeedCalendar {
  /** The calendar's own name (X-WR-CALNAME), when it has one. */
  name: string | null;
  events: FeedEvent[];
}

export interface FeedWindow {
  from: ISODateTime;
  to: ISODateTime;
  /** The account's timezone: used for all-day events and times that name no zone. */
  timezone: string;
}

/** More than this many events in the window and the rest are left out. */
export const FEED_MAX_EVENTS = 3000;
/** Repeat periods walked per event before giving up (about 50 years of a daily event). */
const MAX_PERIODS = 20_000;

interface RawTime {
  date: ISODate;
  /** Seconds past midnight; null for an all-day (date-only) value. */
  seconds: number | null;
  utc: boolean;
  tzid: string | null;
}

interface RawEvent {
  uid: string | null;
  summary: string | null;
  description: string | null;
  status: string | null;
  transp: string | null;
  start: RawTime | null;
  end: RawTime | null;
  /** DURATION, split the way RFC 5545 means it: whole days on the calendar, then exact time. */
  duration: { days: number; ms: number } | null;
  rrule: Record<string, string> | null;
  rdates: RawTime[];
  exdates: RawTime[];
  recurrenceId: RawTime | null;
}

/** True when the text looks like an iCalendar document at all. */
export function looksLikeIcs(text: string): boolean {
  return /^\s*BEGIN:VCALENDAR/i.test(text.slice(0, 2000).replace(/^\uFEFF/, ''));
}

function parseTimes(line: ContentLine): RawTime[] {
  const tzid = line.params.TZID ?? null;
  const out: RawTime[] = [];
  for (const raw of line.value.split(',')) {
    const v = raw.trim();
    const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (dateOnly) {
      out.push({
        date: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`,
        seconds: null,
        utc: false,
        tzid: null,
      });
      continue;
    }
    const full = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/i.exec(v);
    if (!full) continue;
    out.push({
      date: `${full[1]}-${full[2]}-${full[3]}`,
      seconds: Number(full[4]) * 3600 + Number(full[5]) * 60 + Number(full[6] ?? 0),
      utc: !!full[7],
      tzid,
    });
  }
  return out;
}

/** "P1D", "PT1H30M", "-PT15M", "P2W" into calendar days and exact milliseconds. */
export function parseIcsDuration(value: string): { days: number; ms: number } | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(
    value.trim(),
  );
  if (!m || value.trim().length <= 2) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const days = (Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * sign;
  const ms = ((Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0)) * 60 + Number(m[6] ?? 0)) * 1000 * sign;
  return { days, ms };
}

/** Windows zone names, which Outlook and Exchange write in TZID, to IANA names. */
const WINDOWS_ZONES: Record<string, string> = {
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'Newfoundland Standard Time': 'America/St_Johns',
  'Canada Central Standard Time': 'America/Regina',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'SA Pacific Standard Time': 'America/Bogota',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'Pacific SA Standard Time': 'America/Santiago',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kyiv',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Egypt Standard Time': 'Africa/Cairo',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'Arabian Standard Time': 'Asia/Dubai',
  'Iran Standard Time': 'Asia/Tehran',
  'Pakistan Standard Time': 'Asia/Karachi',
  'India Standard Time': 'Asia/Kolkata',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Taipei Standard Time': 'Asia/Taipei',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'W. Australia Standard Time': 'Australia/Perth',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  UTC: 'UTC',
  'Coordinated Universal Time': 'UTC',
};

/** "(UTC-05:00) Eastern Time (US & Canada)" and the like, from older Outlook exports. */
const ZONE_WORDS: Array<[RegExp, string]> = [
  [/eastern time/i, 'America/New_York'],
  [/central time/i, 'America/Chicago'],
  [/mountain time/i, 'America/Denver'],
  [/pacific time/i, 'America/Los_Angeles'],
  [/atlantic time/i, 'America/Halifax'],
];

/** An IANA zone for a TZID, or null when it can't be told. */
export function resolveTzid(tzid: string | null): string | null {
  if (!tzid) return null;
  const id = tzid.trim().replace(/^"|"$/g, '');
  if (!id) return null;
  if (id.includes('/') && isValidTimezone(id)) return id;
  // "/mozilla.org/20050126_1/America/New_York", "/citadel.org/.../Europe/Paris"
  const tail = /([A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/.exec(id);
  if (tail && isValidTimezone(tail[1]!)) return tail[1]!;
  const windows = WINDOWS_ZONES[id];
  if (windows) return windows;
  for (const [pattern, zone] of ZONE_WORDS) if (pattern.test(id)) return zone;
  if (/^(?:utc|gmt|z)$/i.test(id)) return 'UTC';
  return null;
}

function blankEvent(): RawEvent {
  return {
    uid: null,
    summary: null,
    description: null,
    status: null,
    transp: null,
    start: null,
    end: null,
    duration: null,
    rrule: null,
    rdates: [],
    exdates: [],
    recurrenceId: null,
  };
}

function parseRrule(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim();
  }
  return out;
}

function readEvents(text: string): {
  name: string | null;
  zone: string | null;
  events: RawEvent[];
} {
  let name: string | null = null;
  let zone: string | null = null;
  const events: RawEvent[] = [];
  let current: RawEvent | null = null;
  // Depth of components nested inside the VEVENT (VALARM); their fields are not the event's.
  let nested = 0;
  // Depth inside components outside any event (VTIMEZONE and its parts).
  let outside = 0;
  for (const raw of unfold(text.replace(/^\uFEFF/, ''))) {
    const line = parseLine(raw);
    if (!line) continue;
    const value = line.value.trim().toUpperCase();
    if (line.name === 'BEGIN') {
      if (value === 'VCALENDAR') continue;
      if (current) nested++;
      else if (value === 'VEVENT' && outside === 0) current = blankEvent();
      else outside++;
      continue;
    }
    if (line.name === 'END') {
      if (value === 'VCALENDAR') continue;
      if (current && nested > 0) nested--;
      else if (current && value === 'VEVENT') {
        events.push(current);
        current = null;
      } else if (outside > 0) outside--;
      continue;
    }
    if (!current) {
      if (outside > 0) continue;
      if (line.name === 'X-WR-CALNAME') name = unescapeText(line.value).trim() || null;
      if (line.name === 'X-WR-TIMEZONE') zone = resolveTzid(line.value);
      continue;
    }
    if (nested > 0) continue;
    switch (line.name) {
      case 'UID':
        current.uid = line.value.trim() || null;
        break;
      case 'SUMMARY':
        current.summary = unescapeText(line.value).trim() || null;
        break;
      case 'DESCRIPTION':
        current.description = unescapeText(line.value).trim() || null;
        break;
      case 'STATUS':
        current.status = value;
        break;
      case 'TRANSP':
        current.transp = value;
        break;
      case 'DTSTART':
        current.start = parseTimes(line)[0] ?? null;
        break;
      case 'DTEND':
        current.end = parseTimes(line)[0] ?? null;
        break;
      case 'DURATION':
        current.duration = parseIcsDuration(line.value);
        break;
      case 'RRULE':
        current.rrule = parseRrule(line.value);
        break;
      case 'RDATE':
        if ((line.params.VALUE ?? '').toUpperCase() !== 'PERIOD')
          current.rdates.push(...parseTimes(line));
        break;
      case 'EXDATE':
        current.exdates.push(...parseTimes(line));
        break;
      case 'RECURRENCE-ID':
        current.recurrenceId = parseTimes(line)[0] ?? null;
        break;
    }
  }
  return { name, zone, events };
}

interface Clock {
  /** The zone a time with no TZID and no Z is read in. */
  floating: string;
  timezone: string;
}

/** UTC milliseconds of a time: its own zone, else the calendar's, else the account's. */
function instantOf(t: RawTime, clock: Clock): number {
  if (t.seconds === null) return zonedMidnightUtc(t.date, clock.timezone).getTime();
  if (t.utc) return Date.parse(`${t.date}T00:00:00Z`) + t.seconds * 1000;
  const zone = resolveTzid(t.tzid) ?? clock.floating;
  const hour = Math.floor(t.seconds / 3600);
  const minute = Math.floor((t.seconds % 3600) / 60);
  return zonedTimeUtc(t.date, hour, minute, zone).getTime() + (t.seconds % 60) * 1000;
}

/** How a repeat's occurrence is matched against EXDATE and RECURRENCE-ID. */
function occurrenceKey(t: RawTime, clock: Clock): string {
  return t.seconds === null ? t.date : String(instantOf(t, clock));
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

interface ByDay {
  n: number | null;
  wd: number;
}

function parseByDay(value: string | undefined): ByDay[] {
  if (!value) return [];
  const out: ByDay[] = [];
  for (const token of value.split(',')) {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(token.trim());
    if (!m) continue;
    out.push({ n: m[1] ? Number(m[1]) : null, wd: WEEKDAYS.indexOf(m[2]!.toUpperCase()) });
  }
  return out;
}

function parseNumbers(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v) && v !== 0);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function isoDate(year: number, month0: number, day: number): ISODate {
  const d = new Date(Date.UTC(year, month0, day));
  return d.toISOString().slice(0, 10);
}

/** The month's days that match BYMONTHDAY and BYDAY, or the start's own day when neither is set. */
function daysInMonthMatching(
  year: number,
  month0: number,
  startDay: number,
  byMonthDay: number[],
  byDay: ByDay[],
): ISODate[] {
  const dim = daysInMonth(year, month0);
  const firstWd = dayOfWeek(isoDate(year, month0, 1));
  let days: number[];
  if (byMonthDay.length > 0) {
    days = byMonthDay.map((d) => (d > 0 ? d : dim + d + 1)).filter((d) => d >= 1 && d <= dim);
    if (byDay.length > 0)
      days = days.filter((d) => byDay.some((b) => (firstWd + d - 1) % 7 === b.wd));
  } else if (byDay.length > 0) {
    days = [];
    for (const b of byDay) {
      const first = 1 + ((b.wd - firstWd + 7) % 7);
      if (b.n === null) for (let d = first; d <= dim; d += 7) days.push(d);
      else if (b.n > 0) days.push(first + (b.n - 1) * 7);
      else {
        const lastWd = (firstWd + dim - 1) % 7;
        days.push(dim - ((lastWd - b.wd + 7) % 7) + (b.n + 1) * 7);
      }
    }
    days = days.filter((d) => d >= 1 && d <= dim);
  } else {
    days = startDay <= dim ? [startDay] : [];
  }
  return [...new Set(days)].sort((a, b) => a - b).map((d) => isoDate(year, month0, d));
}

function applySetPos(dates: ISODate[], setPos: number[]): ISODate[] {
  if (setPos.length === 0) return dates;
  const out: ISODate[] = [];
  for (const p of setPos) {
    const d = p > 0 ? dates[p - 1] : dates[dates.length + p];
    if (d) out.push(d);
  }
  return [...new Set(out)].sort();
}

/**
 * The local dates a repeat falls on, in order, from the start's date until `lastDate`.
 * Times of day stay the start's; the caller turns each date into an instant in its zone.
 */
function* repeatDates(start: ISODate, rule: Record<string, string>): Generator<ISODate> {
  const freq = (rule.FREQ ?? '').toUpperCase();
  const interval = Math.max(1, Math.min(1000, Number(rule.INTERVAL ?? 1) || 1));
  const byDay = parseByDay(rule.BYDAY);
  const byMonthDay = parseNumbers(rule.BYMONTHDAY);
  const byMonth = parseNumbers(rule.BYMONTH).filter((m) => m >= 1 && m <= 12);
  const setPos = parseNumbers(rule.BYSETPOS);
  const [sy, sm, sd] = start.split('-').map(Number) as [number, number, number];
  const inMonths = (d: ISODate) => byMonth.length === 0 || byMonth.includes(Number(d.slice(5, 7)));

  for (let k = 0; k < MAX_PERIODS; k++) {
    let period: ISODate[];
    if (freq === 'DAILY') {
      const d = addDays(start, k * interval);
      const wdOk = byDay.length === 0 || byDay.some((b) => b.wd === dayOfWeek(d));
      const dim = daysInMonth(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1);
      const day = Number(d.slice(8, 10));
      const mdOk =
        byMonthDay.length === 0 || byMonthDay.some((x) => (x > 0 ? x : dim + x + 1) === day);
      period = wdOk && mdOk && inMonths(d) ? [d] : [];
    } else if (freq === 'WEEKLY') {
      const wkst = Math.max(0, WEEKDAYS.indexOf((rule.WKST ?? 'MO').toUpperCase()));
      const weekStart = addDays(start, -((dayOfWeek(start) - wkst + 7) % 7) + k * 7 * interval);
      const wds = byDay.length > 0 ? byDay.map((b) => b.wd) : [dayOfWeek(start)];
      period = [...new Set(wds)]
        .map((wd) => addDays(weekStart, (wd - wkst + 7) % 7))
        .filter(inMonths)
        .sort();
    } else if (freq === 'MONTHLY') {
      const m = sm - 1 + k * interval;
      const year = sy + Math.floor(m / 12);
      const month0 = ((m % 12) + 12) % 12;
      period =
        byMonth.length === 0 || byMonth.includes(month0 + 1)
          ? daysInMonthMatching(year, month0, sd, byMonthDay, byDay)
          : [];
    } else if (freq === 'YEARLY') {
      const year = sy + k * interval;
      const months = byMonth.length > 0 ? byMonth : [sm];
      period = months.flatMap((month) =>
        byMonth.length === 0 && byMonthDay.length === 0 && byDay.length === 0
          ? sd <= daysInMonth(year, month - 1)
            ? [isoDate(year, month - 1, sd)]
            : []
          : daysInMonthMatching(year, month - 1, sd, byMonthDay, byDay),
      );
      period.sort();
    } else {
      return;
    }
    for (const d of applySetPos(period, setPos)) if (d >= start) yield d;
  }
}

/** Read a subscribed calendar into the events that touch the window, soonest first. */
export function readIcsFeed(text: string, window: FeedWindow): FeedCalendar {
  const { name, zone, events } = readEvents(text);
  const clock: Clock = { floating: zone ?? window.timezone, timezone: window.timezone };
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  const lastDate = addDays(window.to.slice(0, 10), 2);

  const overrides = new Map<string, Map<string, RawEvent>>();
  const masters: RawEvent[] = [];
  for (const ev of events) {
    if (!ev.start) continue;
    if (ev.recurrenceId && ev.uid) {
      const byKey = overrides.get(ev.uid) ?? new Map<string, RawEvent>();
      byKey.set(occurrenceKey(ev.recurrenceId, clock), ev);
      overrides.set(ev.uid, byKey);
    } else masters.push(ev);
  }

  const out: FeedEvent[] = [];
  const add = (ev: RawEvent, id: string, startMs: number, endMs: number, allDay: boolean) => {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
    // A moment in time (a Moodle due date) still needs a minute to be a block at all.
    if (endMs <= startMs) endMs = startMs + 60_000;
    if (endMs <= from || startMs >= to) return;
    out.push({
      id,
      title: ev.summary ?? 'Busy',
      description: ev.description,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      allDay,
      free: ev.transp === 'TRANSPARENT',
    });
  };
  /** One event as written: its own start, and its end from DTEND, DURATION or the default. */
  const emit = (ev: RawEvent, id: string) => {
    const start = ev.start!;
    const startMs = instantOf(start, clock);
    if (start.seconds === null) {
      const days =
        ev.end && ev.end.seconds === null
          ? Math.max(1, diffDays(start.date, ev.end.date))
          : Math.max(1, ev.duration?.days ?? 1);
      add(
        ev,
        id,
        startMs,
        zonedMidnightUtc(addDays(start.date, days), clock.timezone).getTime(),
        true,
      );
      return;
    }
    let endMs = startMs;
    if (ev.end && ev.end.seconds !== null) endMs = instantOf(ev.end, clock);
    else if (ev.duration)
      endMs =
        (ev.duration.days
          ? instantOf({ ...start, date: addDays(start.date, ev.duration.days) }, clock)
          : startMs) + ev.duration.ms;
    add(ev, id, startMs, endMs, false);
  };

  for (const ev of masters) {
    if (out.length >= FEED_MAX_EVENTS) break;
    const start = ev.start!;
    const uid = ev.uid ?? `${ev.summary ?? ''}@${start.date}T${start.seconds ?? ''}`;
    if (ev.status === 'CANCELLED') continue;
    if (!ev.rrule && ev.rdates.length === 0) {
      emit(ev, uid);
      continue;
    }
    const moved = (ev.uid && overrides.get(ev.uid)) || new Map<string, RawEvent>();
    const excluded = new Set(ev.exdates.map((t) => occurrenceKey(t, clock)));
    // A timed repeat keeps its first occurrence's length in real time (DST moves the clock,
    // not the event); an all-day one keeps its number of days.
    const firstMs = instantOf(start, clock);
    const lengthMs =
      start.seconds !== null && ev.end && ev.end.seconds !== null
        ? instantOf(ev.end, clock) - firstMs
        : null;

    const rule = ev.rrule;
    const until = rule?.UNTIL
      ? (parseTimes({ name: 'UNTIL', params: {}, value: rule.UNTIL })[0] ?? null)
      : null;
    const untilMs =
      until && until.seconds !== null
        ? instantOf({ ...until, tzid: until.utc ? null : start.tzid }, clock)
        : null;
    const count = rule?.COUNT ? Math.max(1, Number(rule.COUNT) || 1) : null;

    const dates = new Set<ISODate>([start.date]);
    let taken = 1;
    if (rule)
      for (const d of repeatDates(start.date, rule)) {
        if (d > lastDate) break;
        if (d === start.date) continue;
        if (count !== null && taken >= count) break;
        if (until && until.seconds === null && d > until.date) break;
        if (untilMs !== null && instantOf({ ...start, date: d }, clock) > untilMs) break;
        dates.add(d);
        taken++;
      }
    for (const r of ev.rdates) dates.add(r.date);

    for (const d of [...dates].sort()) {
      if (out.length >= FEED_MAX_EVENTS) break;
      const at: RawTime = { ...start, date: d };
      const key = occurrenceKey(at, clock);
      if (excluded.has(key)) continue;
      const id = `${uid}/${d}`;
      const override = moved.get(key);
      if (override) {
        moved.delete(key);
        if (override.status !== 'CANCELLED') emit(override, id);
        continue;
      }
      if (lengthMs !== null) {
        const startMs = instantOf(at, clock);
        add(ev, id, startMs, startMs + lengthMs, false);
      } else {
        const shift = diffDays(start.date, d);
        emit(
          { ...ev, start: at, end: ev.end && { ...ev.end, date: addDays(ev.end.date, shift) } },
          id,
        );
      }
    }
    // Occurrences moved to a time the rule doesn't produce still happen.
    for (const [key, override] of moved)
      if (override.status !== 'CANCELLED') emit(override, `${uid}/${key}`);
  }

  // A moved occurrence whose repeating event isn't in the file is still an event.
  const masterUids = new Set(masters.map((m) => m.uid));
  for (const [uid, byKey] of overrides)
    if (!masterUids.has(uid))
      for (const [key, ev] of byKey) if (ev.status !== 'CANCELLED') emit(ev, `${uid}/${key}`);

  out.sort((a, b) => a.start.localeCompare(b.start));
  return { name, events: out.slice(0, FEED_MAX_EVENTS) };
}
