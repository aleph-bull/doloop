import { addDays, compareDates, dayOfWeek, diffDays, eachDay, toLocalDate } from './dates';
import type { Result } from './economy';
import type { ISODate, ISODateTime } from './types';

/**
 * Recurring tasks ("routines"): the things that repeat rather than finish — daily reading,
 * a weekly problem set, a monthly review. They are ticked off, not timed, so they carry an
 * estimate rather than a logged duration and earn XP at a lower rate than focused sessions.
 */

export type RoutineFreq = 'daily' | 'weekly' | 'monthly';
export type RoutineSource = 'app' | 'ics';

export const ROUTINES = {
  /**
   * XP per estimated minute. Half the rate of a focused session: a tick is self-reported,
   * so it is worth real XP but never more than actually sitting down and working.
   */
  XP_PER_MINUTE: 1,
  /** Cap per tick, so one enormous estimate cannot mint XP. */
  MAX_XP_PER_TICK: 60,
  /** Cap across all routine ticks in a day. */
  MAX_XP_PER_DAY: 120,
  MIN_ESTIMATE_MIN: 1,
  MAX_ESTIMATE_MIN: 600,
  MAX_INTERVAL: 52,
  TITLE_MAX: 200,
  /** How far ahead an occurrence may be generated, to bound the expansion loops. */
  MAX_HORIZON_DAYS: 400,
} as const;

export interface RoutineSpec {
  freq: RoutineFreq;
  /** Repeat every N periods (1 = every day/week/month). */
  interval: number;
  /** Weekly: which days, 0 = Sunday .. 6 = Saturday. Empty means "the start date's day". */
  byWeekday: number[];
  /** Monthly: which days of the month, 1-31. Empty means "the start date's day". */
  byMonthday: number[];
  startDate: ISODate;
  /** Inclusive last date, or null for open-ended. */
  endDate: ISODate | null;
}

export interface Routine extends RoutineSpec {
  id: string;
  userId: string;
  title: string;
  note: string | null;
  /** Optional link to a study node, so a routine can belong to a course. */
  nodeId: string | null;
  estimatedMinutes: number;
  source: RoutineSource;
  icsUid: string | null;
  archived: boolean;
  createdAt: ISODateTime;
}

export interface RoutineCompletion {
  id: string;
  routineId: string;
  /** The occurrence that was ticked, as a calendar day in the user's timezone. */
  date: ISODate;
  completedAt: ISODateTime;
  minutes: number;
  xpAwarded: number;
}

/* ---------- recurrence ---------- */

function monthsBetween(a: ISODate, b: ISODate): number {
  const ay = Number(a.slice(0, 4));
  const am = Number(a.slice(5, 7));
  const by = Number(b.slice(0, 4));
  const bm = Number(b.slice(5, 7));
  return (by - ay) * 12 + (bm - am);
}

const dayOfMonth = (date: ISODate) => Number(date.slice(8, 10));

/** Whether a routine has an occurrence on `date`. */
export function occursOn(spec: RoutineSpec, date: ISODate): boolean {
  if (compareDates(date, spec.startDate) < 0) return false;
  if (spec.endDate && compareDates(date, spec.endDate) > 0) return false;
  const interval = Math.max(1, spec.interval);

  if (spec.freq === 'daily') return diffDays(spec.startDate, date) % interval === 0;

  if (spec.freq === 'weekly') {
    const days = spec.byWeekday.length ? spec.byWeekday : [dayOfWeek(spec.startDate)];
    if (!days.includes(dayOfWeek(date))) return false;
    // Weeks are counted from the week containing the start date, Sunday-based like dayOfWeek.
    const startWeek = startOfWeekSunday(spec.startDate);
    const thisWeek = startOfWeekSunday(date);
    return (diffDays(startWeek, thisWeek) / 7) % interval === 0;
  }

  const days = spec.byMonthday.length ? spec.byMonthday : [dayOfMonth(spec.startDate)];
  if (!days.includes(dayOfMonth(date))) return false;
  return monthsBetween(spec.startDate, date) % interval === 0;
}

function startOfWeekSunday(date: ISODate): ISODate {
  return addDays(date, -dayOfWeek(date));
}

/** Every occurrence in [from, to], inclusive. Bounded by MAX_HORIZON_DAYS. */
export function occurrencesBetween(spec: RoutineSpec, from: ISODate, to: ISODate): ISODate[] {
  const start = compareDates(from, spec.startDate) < 0 ? spec.startDate : from;
  const hardEnd = addDays(start, ROUTINES.MAX_HORIZON_DAYS);
  let end = compareDates(to, hardEnd) > 0 ? hardEnd : to;
  if (spec.endDate && compareDates(end, spec.endDate) > 0) end = spec.endDate;
  if (compareDates(start, end) > 0) return [];
  const out: ISODate[] = [];
  for (const d of eachDay(start, end)) if (occursOn(spec, d)) out.push(d);
  return out;
}

/** The first occurrence on or after `from`, or null if the routine has finished. */
export function nextOccurrence(spec: RoutineSpec, from: ISODate): ISODate | null {
  const limit = addDays(from, ROUTINES.MAX_HORIZON_DAYS);
  const end = spec.endDate && compareDates(spec.endDate, limit) < 0 ? spec.endDate : limit;
  const start = compareDates(from, spec.startDate) < 0 ? spec.startDate : from;
  if (compareDates(start, end) > 0) return null;
  for (const d of eachDay(start, end)) if (occursOn(spec, d)) return d;
  return null;
}

/** Human-readable recurrence, e.g. "Every 2 weeks on Mon, Thu". */
export function describeRecurrence(spec: RoutineSpec): string {
  const n = Math.max(1, spec.interval);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const every = (unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);
  if (spec.freq === 'daily') return every('day');
  if (spec.freq === 'weekly') {
    const days = spec.byWeekday.length ? spec.byWeekday : [dayOfWeek(spec.startDate)];
    const list = [...days].sort((a, b) => a - b).map((d) => names[d] ?? '?');
    return `${every('week')} on ${list.join(', ')}`;
  }
  const days = spec.byMonthday.length ? spec.byMonthday : [dayOfMonth(spec.startDate)];
  const list = [...days].sort((a, b) => a - b).map(ordinal);
  return `${every('month')} on the ${list.join(', ')}`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/* ---------- XP ---------- */

export interface RoutineXpInput {
  estimatedMinutes: number;
  /** XP already earned from routine ticks today, so the daily cap can be applied. */
  earnedToday: number;
}

/**
 * XP for ticking one occurrence. Proportional to the estimate, capped per tick and per day,
 * so a wall of tiny routines cannot out-earn actually studying.
 */
export function routineXp(input: RoutineXpInput): number {
  const minutes = Math.max(0, Math.floor(input.estimatedMinutes));
  const raw = Math.min(minutes * ROUTINES.XP_PER_MINUTE, ROUTINES.MAX_XP_PER_TICK);
  const room = Math.max(0, ROUTINES.MAX_XP_PER_DAY - Math.max(0, input.earnedToday));
  return Math.min(raw, room);
}

/* ---------- validation ---------- */

export interface RoutineDraft {
  title: string;
  note?: string | null;
  nodeId?: string | null;
  estimatedMinutes: number;
  freq: RoutineFreq;
  interval?: number;
  byWeekday?: number[];
  byMonthday?: number[];
  startDate: ISODate;
  endDate?: ISODate | null;
}

export type NormalisedRoutine = Required<Omit<RoutineDraft, 'note' | 'nodeId' | 'endDate'>> & {
  note: string | null;
  nodeId: string | null;
  endDate: ISODate | null;
};

export function validateRoutineDraft(draft: RoutineDraft): Result<NormalisedRoutine> {
  const title = draft.title.trim();
  if (!title) return { ok: false, reason: 'Give the routine a name.' };
  if (title.length > ROUTINES.TITLE_MAX)
    return { ok: false, reason: `Names are at most ${ROUTINES.TITLE_MAX} characters.` };

  const minutes = draft.estimatedMinutes;
  if (!Number.isInteger(minutes) || minutes < ROUTINES.MIN_ESTIMATE_MIN)
    return { ok: false, reason: 'Estimate at least one minute.' };
  if (minutes > ROUTINES.MAX_ESTIMATE_MIN)
    return { ok: false, reason: `Estimates are at most ${ROUTINES.MAX_ESTIMATE_MIN} minutes.` };

  const interval = draft.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > ROUTINES.MAX_INTERVAL)
    return { ok: false, reason: `Repeat every 1 to ${ROUTINES.MAX_INTERVAL} periods.` };

  const byWeekday = [...new Set(draft.byWeekday ?? [])].sort((a, b) => a - b);
  if (byWeekday.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
    return { ok: false, reason: 'Weekdays must be 0 (Sunday) to 6 (Saturday).' };
  const byMonthday = [...new Set(draft.byMonthday ?? [])].sort((a, b) => a - b);
  if (byMonthday.some((d) => !Number.isInteger(d) || d < 1 || d > 31))
    return { ok: false, reason: 'Days of the month must be 1 to 31.' };

  if (draft.freq === 'weekly' && byMonthday.length)
    return { ok: false, reason: 'A weekly routine cannot pick days of the month.' };
  if (draft.freq === 'monthly' && byWeekday.length)
    return { ok: false, reason: 'A monthly routine cannot pick weekdays.' };

  const endDate = draft.endDate ?? null;
  if (endDate && compareDates(endDate, draft.startDate) < 0)
    return { ok: false, reason: 'The end date is before the start date.' };

  const note = (draft.note ?? '').trim();
  return {
    ok: true,
    value: {
      title,
      note: note || null,
      nodeId: draft.nodeId ?? null,
      estimatedMinutes: minutes,
      freq: draft.freq,
      interval,
      byWeekday: draft.freq === 'weekly' ? byWeekday : [],
      byMonthday: draft.freq === 'monthly' ? byMonthday : [],
      startDate: draft.startDate,
      endDate,
    },
  };
}

/* ---------- the agenda a client renders ---------- */

export interface RoutineOccurrence {
  routineId: string;
  title: string;
  note: string | null;
  nodeId: string | null;
  estimatedMinutes: number;
  date: ISODate;
  done: boolean;
  /** XP earned when this occurrence was ticked; null while it is outstanding. */
  xpAwarded: number | null;
  /** Past-due occurrences are still tickable; future ones are not. */
  overdue: boolean;
}

export interface RoutineAgendaInput {
  routines: Routine[];
  completions: RoutineCompletion[];
  /** Window to render, inclusive. */
  from: ISODate;
  to: ISODate;
  /** Today in the user's timezone: occurrences after it cannot be ticked. */
  today: ISODate;
}

/** Expand routines into dated occurrences, marking which are already ticked. */
export function routineAgenda(input: RoutineAgendaInput): RoutineOccurrence[] {
  const doneBy = new Map<string, RoutineCompletion>();
  for (const c of input.completions) doneBy.set(`${c.routineId}:${c.date}`, c);
  const out: RoutineOccurrence[] = [];
  for (const r of input.routines) {
    if (r.archived) continue;
    for (const date of occurrencesBetween(r, input.from, input.to)) {
      const done = doneBy.get(`${r.id}:${date}`);
      out.push({
        routineId: r.id,
        title: r.title,
        note: r.note,
        nodeId: r.nodeId,
        estimatedMinutes: r.estimatedMinutes,
        date,
        done: !!done,
        xpAwarded: done?.xpAwarded ?? null,
        overdue: !done && compareDates(date, input.today) < 0,
      });
    }
  }
  return out.sort((a, b) => compareDates(a.date, b.date) || a.title.localeCompare(b.title) || 0);
}

/**
 * Occurrences due today, plus anything still outstanding from the recent past. Missed days
 * on or before `clearedThrough` were cleared away by the user and are not listed; today
 * always is. Clearing only hides them here: adherence still counts them as missed.
 */
export function routinesDue(
  input: Omit<RoutineAgendaInput, 'from' | 'to'> & {
    graceDays?: number;
    clearedThrough?: ISODate | null;
  },
): RoutineOccurrence[] {
  const grace = input.graceDays ?? 7;
  const cleared = input.clearedThrough ?? null;
  return routineAgenda({
    ...input,
    from: addDays(input.today, -grace),
    to: input.today,
  }).filter(
    (o) =>
      !o.done && (cleared === null || o.date === input.today || compareDates(o.date, cleared) > 0),
  );
}

/** Completion rate over a window, 0..1, or null when nothing was due. */
export function routineAdherence(input: RoutineAgendaInput): {
  due: number;
  done: number;
  rate: number | null;
} {
  const items = routineAgenda(input).filter((o) => compareDates(o.date, input.today) <= 0);
  const done = items.filter((o) => o.done).length;
  return { due: items.length, done, rate: items.length ? done / items.length : null };
}

/** Whether an occurrence may be ticked now: it must exist and not be in the future. */
export function canTick(spec: RoutineSpec, date: ISODate, today: ISODate): Result<true> {
  if (compareDates(date, today) > 0) return { ok: false, reason: 'That day has not arrived yet.' };
  if (!occursOn(spec, date))
    return { ok: false, reason: 'This routine does not repeat on that day.' };
  return { ok: true, value: true };
}

/** Local date of an instant, re-exported for callers that only import this module. */
export const routineToday = (now: ISODateTime, tz: string): ISODate => toLocalDate(now, tz);
