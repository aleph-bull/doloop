import type { RoutineDraft, RoutineFreq } from './routines';
import { ROUTINES } from './routines';
import type { ISODate } from './types';

/**
 * A small iCalendar reader, enough to turn a calendar export into recurring tasks.
 * Deliberately narrow: VEVENT only, and of those only the fields a routine needs.
 * Anything it does not understand is reported as skipped rather than guessed at.
 */

export interface IcsEvent {
  uid: string | null;
  summary: string | null;
  description: string | null;
  /** Raw DTSTART/DTEND values with their parameters, e.g. "20260921T090000Z". */
  start: IcsTime | null;
  end: IcsTime | null;
  rrule: Record<string, string> | null;
}

export interface IcsTime {
  /** Calendar date in the value's own frame (floating, or UTC when `utc`). */
  date: ISODate;
  /** Minutes past midnight, or null for an all-day (VALUE=DATE) event. */
  minutes: number | null;
  utc: boolean;
}

/** Undo RFC 5545 line folding: a CRLF followed by a space or tab continues the line. */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((l) => l.trim() !== '');
}

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): ContentLine | null {
  const colon = splitOnUnquoted(line, ':');
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(';');
  const name = (parts[0] ?? '').trim().toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).trim().toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

/** Index of the first `ch` that is not inside a quoted parameter value. */
function splitOnUnquoted(line: string, ch: string): number {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') quoted = !quoted;
    else if (c === ch && !quoted) return i;
  }
  return -1;
}

function parseTime(line: ContentLine): IcsTime | null {
  const v = line.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly)
    return { date: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`, minutes: null, utc: false };
  const full = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!full) return null;
  return {
    date: `${full[1]}-${full[2]}-${full[3]}`,
    minutes: Number(full[4]) * 60 + Number(full[5]),
    utc: full[7] === 'Z',
  };
}

function parseRruleValue(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim();
  }
  return out;
}

/** Parse an .ics document into its VEVENTs. Malformed lines are skipped, not thrown on. */
export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let current: IcsEvent | null = null;
  for (const raw of unfold(text)) {
    const line = parseLine(raw);
    if (!line) continue;
    if (line.name === 'BEGIN' && line.value.trim().toUpperCase() === 'VEVENT') {
      current = {
        uid: null,
        summary: null,
        description: null,
        start: null,
        end: null,
        rrule: null,
      };
      continue;
    }
    if (line.name === 'END' && line.value.trim().toUpperCase() === 'VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
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
      case 'DTSTART':
        current.start = parseTime(line);
        break;
      case 'DTEND':
        current.end = parseTime(line);
        break;
      case 'RRULE':
        current.rrule = parseRruleValue(line.value);
        break;
    }
  }
  return events;
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function weekdayNumbers(byday: string): number[] {
  const out: number[] = [];
  for (const token of byday.split(',')) {
    // Strip an ordinal prefix ("2TH"); positional weekdays are not modelled.
    const code = token
      .trim()
      .toUpperCase()
      .replace(/^[+-]?\d+/, '');
    const i = WEEKDAY_CODES.indexOf(code);
    if (i >= 0) out.push(i);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function untilDate(until: string): ISODate | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(until.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export interface IcsImportCandidate {
  draft: RoutineDraft;
  uid: string | null;
  /** How the recurrence reads, for the confirmation list. */
  summary: string;
}

export interface IcsImportSkip {
  summary: string;
  reason: string;
}

export interface IcsImportPlan {
  candidates: IcsImportCandidate[];
  skipped: IcsImportSkip[];
}

/** Event duration in whole minutes, falling back to a sensible default. */
function durationMinutes(ev: IcsEvent, fallback: number): number {
  if (!ev.start || !ev.end) return fallback;
  if (ev.start.minutes === null || ev.end.minutes === null) return fallback;
  const days = Math.round(
    (Date.parse(`${ev.end.date}T00:00:00Z`) - Date.parse(`${ev.start.date}T00:00:00Z`)) /
      86_400_000,
  );
  const mins = days * 1440 + (ev.end.minutes - ev.start.minutes);
  if (!Number.isFinite(mins) || mins <= 0) return fallback;
  return Math.min(ROUTINES.MAX_ESTIMATE_MIN, Math.max(ROUTINES.MIN_ESTIMATE_MIN, Math.round(mins)));
}

/**
 * Turn parsed events into routine drafts. Only DAILY/WEEKLY/MONTHLY recurrences become
 * routines; everything else is reported so the user can see what was left out.
 *
 * `defaultEstimate` is used when an event carries no usable duration (all-day events).
 */
export function planIcsImport(events: IcsEvent[], defaultEstimate = 30): IcsImportPlan {
  const candidates: IcsImportCandidate[] = [];
  const skipped: IcsImportSkip[] = [];
  for (const ev of events) {
    const name = ev.summary ?? 'Untitled event';
    if (!ev.rrule) {
      skipped.push({ summary: name, reason: 'Does not repeat' });
      continue;
    }
    if (!ev.start) {
      skipped.push({ summary: name, reason: 'No start date' });
      continue;
    }
    const freqRaw = (ev.rrule.FREQ ?? '').toUpperCase();
    if (freqRaw !== 'DAILY' && freqRaw !== 'WEEKLY' && freqRaw !== 'MONTHLY') {
      skipped.push({
        summary: name,
        reason: freqRaw ? `${freqRaw.toLowerCase()} repeats are not supported` : 'No repeat rule',
      });
      continue;
    }
    const freq = freqRaw.toLowerCase() as RoutineFreq;
    const interval = Math.max(
      1,
      Math.min(ROUTINES.MAX_INTERVAL, Number(ev.rrule.INTERVAL ?? 1) || 1),
    );
    const byWeekday = freq === 'weekly' && ev.rrule.BYDAY ? weekdayNumbers(ev.rrule.BYDAY) : [];
    const byMonthday =
      freq === 'monthly' && ev.rrule.BYMONTHDAY
        ? [
            ...new Set(
              ev.rrule.BYMONTHDAY.split(',')
                .map((d) => Number(d.trim()))
                .filter((d) => Number.isInteger(d) && d >= 1 && d <= 31),
            ),
          ].sort((a, b) => a - b)
        : [];

    candidates.push({
      uid: ev.uid,
      summary: name,
      draft: {
        title: name.slice(0, ROUTINES.TITLE_MAX),
        note: ev.description ? ev.description.slice(0, 280) : null,
        estimatedMinutes: durationMinutes(ev, defaultEstimate),
        freq,
        interval,
        byWeekday,
        byMonthday,
        startDate: ev.start.date,
        endDate: ev.rrule.UNTIL ? untilDate(ev.rrule.UNTIL) : null,
      },
    });
  }
  return { candidates, skipped };
}
