import {
  addDays,
  dayOfWeek,
  diffDays,
  eachDay,
  startOfMonth,
  startOfWeekMonday,
  toLocalDate,
  toLocalParts,
} from './dates';
import { fmtDurationWord } from './highlights';
import { STREAK_MILESTONES, weekStreakNumbers } from './streak';
import { buildIndex, rootOf } from './tree';
import type { ISODate, ISODateTime, PlannedBlock, Session, StreakState, StudyNode } from './types';

/**
 * The recap: the numbers behind the Analytics page's pictures and the dashboard's stats.
 * Everything here is pure and descriptive. A week that went badly is a week with fewer
 * minutes, never a scolding; the words that go with the numbers are chosen to say what
 * happened and leave it there.
 */

const workMin = (s: Session) => s.workSeconds / 60;
const done = (sessions: Session[]) => sessions.filter((s) => s.endedAt !== null);
const round1 = (x: number) => Math.round(x * 10) / 10;

/* ---------- daily totals ---------- */

export interface DayTotal {
  date: ISODate;
  minutes: number;
  sessions: number;
}

/** Minutes and sessions per local day, for everything else to be built from. */
export function dailyTotals(sessions: Session[], tz: string): Map<ISODate, DayTotal> {
  const out = new Map<ISODate, DayTotal>();
  for (const s of done(sessions)) {
    const date = toLocalDate(s.startedAt, tz);
    const cur = out.get(date) ?? { date, minutes: 0, sessions: 0 };
    cur.minutes += workMin(s);
    cur.sessions += 1;
    out.set(date, cur);
  }
  return out;
}

function sumRange(totals: Map<ISODate, DayTotal>, from: ISODate, to: ISODate): number {
  let sum = 0;
  for (const [date, t] of totals) if (date >= from && date <= to) sum += t.minutes;
  return sum;
}

/* ---------- a week or a month ---------- */

export type RecapRange = 'week' | 'month';

export interface RecapDay {
  date: ISODate;
  minutes: number;
  /** The same day of the range before (last Monday for this Monday), or null. */
  previousMinutes: number | null;
  today: boolean;
  future: boolean;
  best: boolean;
}

export interface RangeRecap {
  range: RecapRange;
  from: ISODate;
  to: ISODate;
  minutes: number;
  sessions: number;
  activeDays: number;
  /** The range before, matched day for day where the month is still in progress. */
  previousMinutes: number;
  /** (this - previous) / previous, or null when the previous range is too small to compare to. */
  change: number | null;
  byDay: RecapDay[];
  bestDay: { date: ISODate; minutes: number } | null;
  /** The biggest range on record, counting this one. */
  bestEver: boolean;
  /**
   * Too little history for a comparison to mean anything: the range before was under
   * `MIN_BASELINE_MINUTES`. The page then welcomes instead of comparing.
   */
  firstTime: boolean;
  /** One sentence that says what happened, in a good light and without fibbing. */
  summary: string;
  /** The weekly goal and how far along it is; only on a week. */
  goalMinutes: number | null;
  goalRatio: number | null;
}

/** A previous range under this many minutes is not a baseline; it is noise. */
export const MIN_BASELINE_MINUTES = 30;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface RangeRecapInput {
  sessions: Session[];
  timezone: string;
  now: ISODateTime;
  range: RecapRange;
  /** The Monday or the first of the month to report on; defaults to the current one. */
  start?: ISODate;
  /** Weekly goal, for the ring. Ignored for a month. */
  goalMinutes?: number | null;
}

function rangeBounds(range: RecapRange, start: ISODate): { from: ISODate; to: ISODate } {
  if (range === 'week') return { from: start, to: addDays(start, 6) };
  const from = startOfMonth(start);
  const next = startOfMonth(addDays(from, 32));
  return { from, to: addDays(next, -1) };
}

export function rangeRecap(input: RangeRecapInput): RangeRecap {
  const tz = input.timezone;
  const today = toLocalDate(input.now, tz);
  const start =
    input.start ?? (input.range === 'week' ? startOfWeekMonday(today) : startOfMonth(today));
  const { from, to } = rangeBounds(input.range, start);
  const totals = dailyTotals(input.sessions, tz);

  // The range before, aligned: the previous week whole, or the previous month up to the
  // same day-of-month as far as this one has got, so a month in progress is not held
  // against a finished one.
  const prevFrom = input.range === 'week' ? addDays(from, -7) : startOfMonth(addDays(from, -1));
  const prevBounds = rangeBounds(input.range, prevFrom);
  const elapsedTo = to < today ? to : today;
  const prevTo =
    input.range === 'week'
      ? prevBounds.to
      : addDays(prevFrom, Math.min(diffDays(from, elapsedTo), diffDays(prevFrom, prevBounds.to)));

  const byDay: RecapDay[] = [];
  let best: RangeRecap['bestDay'] = null;
  let sessions = 0;
  let activeDays = 0;
  for (const date of eachDay(from, to)) {
    const t = totals.get(date);
    const minutes = t?.minutes ?? 0;
    sessions += t?.sessions ?? 0;
    if (minutes > 0) activeDays++;
    const prevDate = addDays(date, -diffDays(prevFrom, from));
    const prevT = prevDate <= prevTo ? totals.get(prevDate) : undefined;
    byDay.push({
      date,
      minutes,
      previousMinutes: prevDate <= prevBounds.to ? (prevT?.minutes ?? 0) : null,
      today: date === today,
      future: date > today,
      best: false,
    });
    if (minutes > 0 && (!best || minutes > best.minutes)) best = { date, minutes };
  }
  if (best) for (const d of byDay) d.best = d.date === best.date;

  const minutes = byDay.reduce((a, d) => a + d.minutes, 0);
  const previousMinutes = sumRange(totals, prevFrom, prevTo);
  const firstTime = previousMinutes < MIN_BASELINE_MINUTES;
  const change = firstTime ? null : (minutes - previousMinutes) / previousMinutes;

  // Best ever: against every other range of the same kind on record.
  let bestEver = minutes > 0;
  if (bestEver) {
    const seen = new Set<ISODate>();
    for (const date of totals.keys()) {
      const key = input.range === 'week' ? startOfWeekMonday(date) : startOfMonth(date);
      if (key === from || seen.has(key)) continue;
      seen.add(key);
      const b = rangeBounds(input.range, key);
      if (sumRange(totals, b.from, b.to) >= minutes) {
        bestEver = false;
        break;
      }
    }
  }

  const goalMinutes = input.range === 'week' && input.goalMinutes ? input.goalMinutes : null;
  return {
    range: input.range,
    from,
    to,
    minutes,
    sessions,
    activeDays,
    previousMinutes,
    change,
    byDay,
    bestDay: best,
    bestEver,
    firstTime,
    summary: recapSummary({
      range: input.range,
      minutes,
      sessions,
      change,
      firstTime,
      bestEver,
      bestDay: best,
      historyMinutes: [...totals.values()].reduce((a, t) => a + t.minutes, 0),
      past: to < today,
      goalMinutes,
    }),
    goalMinutes,
    goalRatio: goalMinutes ? Math.min(1, minutes / goalMinutes) : null,
  };
}

export interface SummaryInput {
  range: RecapRange;
  minutes: number;
  sessions: number;
  change: number | null;
  firstTime: boolean;
  bestEver: boolean;
  bestDay: { date: ISODate; minutes: number } | null;
  /** Every minute on record, to tell a first week from a quiet one. */
  historyMinutes: number;
  /** A range that has already ended, looked back on: "that week", not "this week". */
  past?: boolean;
  /** The weekly goal, to say how a quieter week went against it. Only on a week. */
  goalMinutes?: number | null;
}

/** The closing word on a week below the last: the goal first, then how close it came. */
function quietWeekWord(s: SummaryInput): string {
  if (s.goalMinutes && s.minutes >= s.goalMinutes) return ' You hit your goal!';
  if (s.goalMinutes && !s.past && s.minutes >= s.goalMinutes * 0.75) return ' Almost there!';
  if (s.change !== null && s.change > -0.3) return ' Good work!';
  return '';
}

/** The hero's one sentence. Positive where it can be, plain where it cannot, never a nag. */
export function recapSummary(s: SummaryInput): string {
  const word = s.range === 'week' ? 'week' : 'month';
  const dayName = s.bestDay ? DAY_NAMES[dayOfWeek(s.bestDay.date)]! : null;
  const lifted = dayName ? `, and ${dayName} did the heavy lifting` : '';
  const before = s.past ? `the ${word} before` : `last ${word}`;
  if (s.minutes <= 0) {
    if (s.past) return `Nothing on the board that ${word}.`;
    return s.historyMinutes > 0
      ? `Nothing on the board yet this ${word}. The next session changes that.`
      : `Your first session puts this ${word} on the board.`;
  }
  if (s.firstTime && s.historyMinutes - s.minutes < MIN_BASELINE_MINUTES)
    return `Your first ${word} is on the board. Here's where you started.`;
  if (s.bestEver && !s.firstTime) return `Your best ${word} so far${lifted}.`;
  if (s.change !== null && s.change >= 0.1) return `Up on ${before}${lifted}.`;
  if (s.change !== null && s.change > -0.1) return `Right in step with ${before}${lifted}.`;
  return `You completed ${s.sessions} ${s.sessions === 1 ? 'session' : 'sessions'} ${s.past ? 'that' : 'this'} ${word}.${quietWeekWord(s)}`;
}

/* ---------- the clock ---------- */

export interface ClockProfile {
  /** Focused minutes by local hour of the day they fell in, 0 to 23. */
  hours: number[];
  peakHour: number | null;
  totalMinutes: number;
}

/** How far an hour's minutes spread into its neighbours, in hours (matches the day chart). */
export const CLOCK_BANDWIDTH = 0.9;
/** The slices a session's time is walked in to place it in hours; fine enough for any zone. */
const CLOCK_SLICE_MS = 5 * 60_000;

/**
 * When in the day the studying happened. A session's focused minutes are spread over the
 * span it ran, start to end, in proportion, so a two-hour session from 1 pm fills 1 and 2 pm
 * rather than piling onto the hour it began. Breaks inside it thin each slice evenly.
 */
export function timeOfDayClock(sessions: Session[], tz: string): ClockProfile {
  const hours = new Array<number>(24).fill(0);
  for (const s of done(sessions)) {
    const work = workMin(s);
    if (work <= 0) continue;
    const start = Date.parse(s.startedAt);
    const end = Math.max(start + 60_000, Date.parse(s.endedAt!));
    const span = end - start;
    for (let t = start; t < end; t += CLOCK_SLICE_MS) {
      const len = Math.min(CLOCK_SLICE_MS, end - t);
      const h = toLocalParts(new Date(t + len / 2).toISOString(), tz).hour;
      hours[h] = (hours[h] ?? 0) + (work * len) / span;
    }
  }
  for (let h = 0; h < 24; h++) hours[h] = round1(hours[h]!);
  const total = hours.reduce((a, b) => a + b, 0);
  // The peak of the smoothed day, as the chart draws it: two busy neighbouring hours beat
  // one slightly busier hour on its own, so the caption and the curve agree.
  const smoothed = hours.map((_, h) =>
    hours.reduce((sum, m, k) => {
      const d = Math.min(Math.abs(h - k), 24 - Math.abs(h - k));
      return sum + m * Math.exp(-(d * d) / (2 * CLOCK_BANDWIDTH * CLOCK_BANDWIDTH));
    }, 0),
  );
  let peakHour: number | null = null;
  if (total > 0) {
    peakHour = 0;
    for (let h = 1; h < 24; h++) if (smoothed[h]! > smoothed[peakHour]!) peakHour = h;
  }
  return { hours, peakHour, totalMinutes: total };
}

/* ---------- subjects ---------- */

export interface SubjectSlice {
  /** The root course's id, or 'free' / 'routine' for sessions with no task. */
  key: string;
  title: string;
  color: string | null;
  minutes: number;
  share: number;
}

export interface SubjectsInput {
  nodes: StudyNode[];
  sessions: Session[];
  timezone: string;
  from?: ISODate;
  to?: ISODate;
  /** How many named slices before the rest fold into "Other". */
  limit?: number;
}

function subjectOf(
  index: ReturnType<typeof buildIndex>,
  s: Session,
): { key: string; title: string; color: string | null } {
  if (s.routineId) return { key: 'routine', title: 'Routines', color: null };
  if (!s.nodeId) return { key: 'free', title: 'Free sessions', color: null };
  const root = rootOf(index, s.nodeId);
  if (!root) return { key: 'gone', title: 'Archived tasks', color: null };
  return { key: root.id, title: root.title, color: root.color };
}

/** Minutes per course (the root of each task) in a range, largest first, the tail folded. */
export function subjectBreakdown(input: SubjectsInput): SubjectSlice[] {
  const index = buildIndex(input.nodes);
  const tz = input.timezone;
  const acc = new Map<string, SubjectSlice>();
  for (const s of done(input.sessions)) {
    const date = toLocalDate(s.startedAt, tz);
    if (input.from && date < input.from) continue;
    if (input.to && date > input.to) continue;
    const sub = subjectOf(index, s);
    const cur = acc.get(sub.key) ?? { ...sub, minutes: 0, share: 0 };
    cur.minutes += workMin(s);
    acc.set(sub.key, cur);
  }
  const all = [...acc.values()].filter((x) => x.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  const limit = input.limit ?? 6;
  const head = all.slice(0, limit);
  const tail = all.slice(limit);
  if (tail.length > 0)
    head.push({
      key: 'other',
      title: 'Other',
      color: null,
      minutes: tail.reduce((a, x) => a + x.minutes, 0),
      share: 0,
    });
  const total = head.reduce((a, x) => a + x.minutes, 0);
  for (const x of head) x.share = total > 0 ? x.minutes / total : 0;
  return head;
}

export interface DaySubjects {
  date: ISODate;
  segments: Array<{ key: string; minutes: number }>;
}

/** What each day of a range was made of, keyed like `subjectBreakdown`. */
export function dailyBySubject(
  input: SubjectsInput & { from: ISODate; to: ISODate },
): DaySubjects[] {
  const index = buildIndex(input.nodes);
  const slices = subjectBreakdown(input);
  const named = new Set(slices.map((s) => s.key).filter((k) => k !== 'other'));
  const days = new Map<ISODate, Map<string, number>>();
  for (const date of eachDay(input.from, input.to)) days.set(date, new Map());
  for (const s of done(input.sessions)) {
    const date = toLocalDate(s.startedAt, input.timezone);
    const day = days.get(date);
    if (!day) continue;
    const sub = subjectOf(index, s);
    const key = named.has(sub.key) ? sub.key : 'other';
    day.set(key, (day.get(key) ?? 0) + workMin(s));
  }
  return [...days.entries()].map(([date, m]) => ({
    date,
    segments: slices.map((sl) => ({ key: sl.key, minutes: m.get(sl.key) ?? 0 })),
  }));
}

/* ---------- the climb ---------- */

export const HOUR_MILESTONES = [10, 25, 50, 100, 250, 500, 1000] as const;

export interface CumulativePoint {
  date: ISODate;
  /** Total minutes up to and including this day. */
  minutes: number;
}

export interface Cumulative {
  points: CumulativePoint[];
  totalMinutes: number;
  reached: Array<{ hours: number; date: ISODate }>;
  next: { hours: number; remainingMinutes: number } | null;
}

/** Total hours climbing over time, one point per studied day, with the milestones passed. */
export function cumulativeHours(sessions: Session[], tz: string): Cumulative {
  const totals = [...dailyTotals(sessions, tz).values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const points: CumulativePoint[] = [];
  const reached: Cumulative['reached'] = [];
  let sum = 0;
  let mi = 0;
  for (const t of totals) {
    sum += t.minutes;
    points.push({ date: t.date, minutes: sum });
    while (mi < HOUR_MILESTONES.length && sum >= HOUR_MILESTONES[mi]! * 60) {
      reached.push({ hours: HOUR_MILESTONES[mi]!, date: t.date });
      mi++;
    }
  }
  const nextHours =
    mi < HOUR_MILESTONES.length ? HOUR_MILESTONES[mi]! : Math.ceil((sum / 60 + 1) / 500) * 500;
  return {
    points,
    totalMinutes: sum,
    reached,
    next: { hours: nextHours, remainingMinutes: Math.max(0, nextHours * 60 - sum) },
  };
}

/* ---------- session lengths ---------- */

export interface HistogramBucket {
  label: string;
  from: number;
  to: number | null;
  count: number;
}

export interface SessionHistogram {
  buckets: HistogramBucket[];
  total: number;
  /** "Most of your sessions are 20 to 40 minutes", or null with nothing to say. */
  takeaway: string | null;
  medianMinutes: number | null;
}

const LENGTH_BUCKETS: ReadonlyArray<{ label: string; from: number; to: number | null }> = [
  { label: 'Under 20 min', from: 0, to: 20 },
  { label: '20 to 40 min', from: 20, to: 40 },
  { label: '40 min to 1 h', from: 40, to: 60 },
  { label: '1 to 1.5 h', from: 60, to: 90 },
  { label: 'Over 1.5 h', from: 90, to: null },
];

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function sessionHistogram(sessions: Session[]): SessionHistogram {
  const lengths = done(sessions)
    .map(workMin)
    .filter((m) => m > 0);
  const buckets = LENGTH_BUCKETS.map((b) => ({ ...b, count: 0 }));
  for (const m of lengths) {
    const b = buckets.find((x) => m >= x.from && (x.to === null || m < x.to));
    if (b) b.count++;
  }
  const top = buckets.reduce((a, b) => (b.count > a.count ? b : a), buckets[0]!);
  const total = lengths.length;
  const takeaway =
    total >= 3 && top.count / total >= 0.4
      ? `Most of your sessions are ${top.label.replace('Under', 'under').replace('Over', 'over')}.`
      : total >= 3
        ? 'Your sessions come in all lengths.'
        : null;
  return { buckets, total, takeaway, medianMinutes: median(lengths) };
}

/* ---------- consistency ---------- */

export interface WeekDot {
  date: ISODate;
  studied: boolean;
  today: boolean;
  future: boolean;
}

export interface Consistency {
  /** Days with a qualifying session out of the last 30, and as a share. */
  activeDays30: number;
  ratio30: number;
  weekDots: WeekDot[];
  nextMilestone: { days: number; remaining: number } | null;
}

export interface ConsistencyInput {
  sessions: Session[];
  timezone: string;
  now: ISODateTime;
  /** Minutes a day needs to count, the same figure the streak uses. */
  minMinutes: number;
  streak: StreakState;
}

/** The next streak milestone above the current run, and how many days away it is. */
export function nextStreakMilestone(current: number): { days: number; remaining: number } | null {
  for (const m of STREAK_MILESTONES) if (m > current) return { days: m, remaining: m - current };
  const next = Math.ceil((current + 1) / 100) * 100;
  return { days: next, remaining: next - current };
}

export function consistency(input: ConsistencyInput): Consistency {
  const tz = input.timezone;
  const today = toLocalDate(input.now, tz);
  const totals = dailyTotals(input.sessions, tz);
  const qualifies = (date: ISODate) => (totals.get(date)?.minutes ?? 0) >= input.minMinutes;
  let active = 0;
  for (const date of eachDay(addDays(today, -29), today)) if (qualifies(date)) active++;
  const monday = startOfWeekMonday(today);
  const weekDots: WeekDot[] = [];
  for (const date of eachDay(monday, addDays(monday, 6)))
    weekDots.push({ date, studied: qualifies(date), today: date === today, future: date > today });
  return {
    activeDays30: active,
    ratio30: active / 30,
    weekDots,
    nextMilestone: nextStreakMilestone(input.streak.current),
  };
}

/* ---------- the trophy shelf ---------- */

export type RecordKey =
  | 'biggest-day'
  | 'biggest-week'
  | 'biggest-month'
  | 'longest-session'
  | 'most-sessions-day'
  | 'longest-streak'
  | 'most-tasks-week'
  | 'most-courses-week'
  | 'most-routines-week'
  | 'most-focused-run'
  | 'earliest-start'
  | 'latest-finish';

export interface PersonalRecord {
  key: RecordKey;
  label: string;
  icon: string;
  /** The figure as words: "3 h 20 m", "12 days", "6:05 am". */
  display: string;
  /** The day it was set, the Monday of the week, or the 1st of the month. Null when undated. */
  when: ISODate | null;
  /** Set during the week being looked at. */
  isNew: boolean;
}

/** Sessions needed before an earliest start or latest finish is named. */
export const MIN_CLOCK_SESSIONS = 3;
const MAX_CLOCK_SESSION_MS = 12 * 60 * 60 * 1000;

export interface RecordsInput {
  sessions: Session[];
  nodes: StudyNode[];
  timezone: string;
  now: ISODateTime;
  weekStart: ISODate;
  streak: StreakState;
  /** Recurring-task ticks, by occurrence date, for the routines record. Absent is none. */
  routineTicks?: { date: ISODate }[];
}

/** The entry with the largest value; the earliest one wins a tie, so a record stays put. */
function largest<K>(m: Map<K, number>): [K, number] | null {
  let best: [K, number] | null = null;
  for (const e of m) if (!best || e[1] > best[1]) best = e;
  return best;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function fmtClockTime(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}

export function personalRecords(input: RecordsInput): PersonalRecord[] {
  const tz = input.timezone;
  const weekEnd = addDays(input.weekStart, 6);
  const inWeek = (date: ISODate | null) =>
    date !== null && date >= input.weekStart && date <= weekEnd;
  const out: PersonalRecord[] = [];
  const totals = dailyTotals(input.sessions, tz);

  let bestDay: DayTotal | null = null;
  for (const t of totals.values()) if (!bestDay || t.minutes > bestDay.minutes) bestDay = t;
  if (bestDay && bestDay.minutes > 0)
    out.push({
      key: 'biggest-day',
      label: 'Biggest day',
      icon: '☀️',
      display: fmtDurationWord(bestDay.minutes),
      when: bestDay.date,
      isNew: inWeek(bestDay.date),
    });

  const weeks = new Map<ISODate, number>();
  for (const t of totals.values()) {
    const k = startOfWeekMonday(t.date);
    weeks.set(k, (weeks.get(k) ?? 0) + t.minutes);
  }
  let bestWeek: [ISODate, number] | null = null;
  for (const e of weeks) if (!bestWeek || e[1] > bestWeek[1]) bestWeek = e;
  if (bestWeek && bestWeek[1] > 0)
    out.push({
      key: 'biggest-week',
      label: 'Biggest week',
      icon: '📈',
      display: fmtDurationWord(bestWeek[1]),
      when: bestWeek[0],
      isNew: bestWeek[0] === input.weekStart,
    });

  const months = new Map<ISODate, number>();
  for (const t of totals.values()) {
    const k = startOfMonth(t.date);
    months.set(k, (months.get(k) ?? 0) + t.minutes);
  }
  const bestMonth = largest(months);
  if (bestMonth && bestMonth[1] > 0)
    out.push({
      key: 'biggest-month',
      label: 'Biggest month',
      icon: '🗓️',
      display: fmtDurationWord(bestMonth[1]),
      when: bestMonth[0],
      // The month being looked at holds the week being looked at.
      isNew:
        bestMonth[0] === startOfMonth(input.weekStart) || bestMonth[0] === startOfMonth(weekEnd),
    });

  let longest: Session | null = null;
  for (const s of done(input.sessions)) if (!longest || workMin(s) > workMin(longest)) longest = s;
  if (longest && workMin(longest) > 0)
    out.push({
      key: 'longest-session',
      label: 'Longest session',
      icon: '🧘',
      display: fmtDurationWord(workMin(longest)),
      when: toLocalDate(longest.startedAt, tz),
      isNew: inWeek(toLocalDate(longest.startedAt, tz)),
    });

  let busiest: DayTotal | null = null;
  for (const t of totals.values()) if (!busiest || t.sessions > busiest.sessions) busiest = t;
  if (busiest && busiest.sessions > 0)
    out.push({
      key: 'most-sessions-day',
      label: 'Most sessions in a day',
      icon: '⏱️',
      display: plural(busiest.sessions, 'session', 'sessions'),
      when: busiest.date,
      isNew: inWeek(busiest.date),
    });

  if (input.streak.longest > 0)
    out.push({
      key: 'longest-streak',
      label: 'Longest streak',
      icon: '🔥',
      display: `${input.streak.longest} ${input.streak.longest === 1 ? 'day' : 'days'}`,
      when: null,
      // The record is being set right now: the current run is the longest and still going.
      isNew: input.streak.current === input.streak.longest && inWeek(input.streak.lastCountedDate),
    });

  const doneByWeek = new Map<ISODate, number>();
  for (const n of input.nodes) {
    if (!n.completedAt || n.kind === 'course') continue;
    const k = startOfWeekMonday(toLocalDate(n.completedAt, tz));
    doneByWeek.set(k, (doneByWeek.get(k) ?? 0) + 1);
  }
  let bestDone: [ISODate, number] | null = null;
  for (const e of doneByWeek) if (!bestDone || e[1] > bestDone[1]) bestDone = e;
  if (bestDone)
    out.push({
      key: 'most-tasks-week',
      label: 'Most tasks in a week',
      icon: '✅',
      display: `${bestDone[1]} ${bestDone[1] === 1 ? 'task' : 'tasks'}`,
      when: bestDone[0],
      isNew: bestDone[0] === input.weekStart,
    });

  // Courses touched in a week: the top of the tree above each task studied.
  const index = buildIndex(input.nodes);
  const coursesByWeek = new Map<ISODate, Set<string>>();
  for (const s of done(input.sessions)) {
    if (s.nodeId === null || workMin(s) <= 0) continue;
    const course = rootOf(index, s.nodeId);
    if (!course) continue;
    const k = startOfWeekMonday(toLocalDate(s.startedAt, tz));
    if (!coursesByWeek.has(k)) coursesByWeek.set(k, new Set());
    coursesByWeek.get(k)!.add(course.id);
  }
  const bestCourses = largest(new Map([...coursesByWeek].map(([k, v]) => [k, v.size])));
  if (bestCourses)
    out.push({
      key: 'most-courses-week',
      label: 'Most courses in a week',
      icon: '📚',
      display: plural(bestCourses[1], 'course', 'courses'),
      when: bestCourses[0],
      isNew: bestCourses[0] === input.weekStart,
    });

  const ticksByWeek = new Map<ISODate, number>();
  for (const t of input.routineTicks ?? []) {
    const k = startOfWeekMonday(t.date);
    ticksByWeek.set(k, (ticksByWeek.get(k) ?? 0) + 1);
  }
  const bestTicks = largest(ticksByWeek);
  if (bestTicks)
    out.push({
      key: 'most-routines-week',
      label: 'Most routines in a week',
      icon: '🔁',
      display: plural(bestTicks[1], 'routine', 'routines'),
      when: bestTicks[0],
      isNew: bestTicks[0] === input.weekStart,
    });

  // Sessions in a row reviewed as undistracted. Sessions without an answer neither add to
  // a run nor break it; one reported as distracted ends it.
  let run = 0;
  let bestRun: { count: number; date: ISODate } | null = null;
  const reviewedInOrder = done(input.sessions)
    .filter((s) => s.review && !s.review.skipped && s.review.distracted !== null)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  for (const s of reviewedInOrder) {
    run = s.review!.distracted === 'no' ? run + 1 : 0;
    if (run > 0 && (!bestRun || run > bestRun.count))
      bestRun = { count: run, date: toLocalDate(s.startedAt, tz) };
  }
  if (bestRun)
    out.push({
      key: 'most-focused-run',
      label: 'Focused in a row',
      icon: '🎯',
      display: plural(bestRun.count, 'session', 'sessions'),
      when: bestRun.date,
      isNew: inWeek(bestRun.date),
    });

  // Earliest start and latest finish, as clock times. A finish after midnight counts as
  // late, not early: 1:10 am reads as 25:10 for the comparison. They only mean something
  // across a few sessions, and a session left running for half a day says nothing about
  // when someone likes to work, so those are left out.
  let earliest: { s: Session; at: number } | null = null;
  let latest: { s: Session; at: number } | null = null;
  const timed = done(input.sessions).filter(
    (s) =>
      workMin(s) > 0 && Date.parse(s.endedAt!) - Date.parse(s.startedAt) < MAX_CLOCK_SESSION_MS,
  );
  for (const s of timed.length >= MIN_CLOCK_SESSIONS ? timed : []) {
    const start = toLocalParts(s.startedAt, tz);
    const startAt = start.hour * 60 + start.minute;
    if (start.hour >= 4 && (!earliest || startAt < earliest.at)) earliest = { s, at: startAt };
    const end = toLocalParts(s.endedAt!, tz);
    const endAt = (end.hour < 4 ? end.hour + 24 : end.hour) * 60 + end.minute;
    if (!latest || endAt > latest.at) latest = { s, at: endAt };
  }
  if (earliest)
    out.push({
      key: 'earliest-start',
      label: 'Earliest start',
      icon: '🐦',
      display: fmtClockTime(Math.floor(earliest.at / 60), earliest.at % 60),
      when: toLocalDate(earliest.s.startedAt, tz),
      isNew: inWeek(toLocalDate(earliest.s.startedAt, tz)),
    });
  if (latest)
    out.push({
      key: 'latest-finish',
      label: 'Latest finish',
      icon: '🦉',
      display: fmtClockTime(Math.floor(latest.at / 60) % 24, latest.at % 60),
      when: toLocalDate(latest.s.startedAt, tz),
      isNew: inWeek(toLocalDate(latest.s.startedAt, tz)),
    });
  return out;
}

/* ---------- study personality ---------- */

export type PersonalityId =
  'night-owl' | 'early-bird' | 'weekend-warrior' | 'sprinter' | 'deep-diver' | 'consistent-climber';

export interface Personality {
  id: PersonalityId;
  label: string;
  emoji: string;
  /** The pattern it was read from, in one line. */
  reason: string;
}

export interface PersonalityInput {
  sessions: Session[];
  timezone: string;
  now: ISODateTime;
}

/** Enough sessions and minutes before a pattern is called a personality. */
export const PERSONALITY_MIN_SESSIONS = 5;
export const PERSONALITY_MIN_MINUTES = 120;

export function studyPersonality(input: PersonalityInput): Personality | null {
  const ss = done(input.sessions).filter((s) => workMin(s) > 0);
  const total = ss.reduce((a, s) => a + workMin(s), 0);
  if (ss.length < PERSONALITY_MIN_SESSIONS || total < PERSONALITY_MIN_MINUTES) return null;
  const tz = input.timezone;
  let night = 0;
  let early = 0;
  let weekend = 0;
  for (const s of ss) {
    const h = toLocalParts(s.startedAt, tz).hour;
    const m = workMin(s);
    if (h >= 21 || h < 4) night += m;
    if (h >= 5 && h < 9) early += m;
    const d = dayOfWeek(toLocalDate(s.startedAt, tz));
    if (d === 0 || d === 6) weekend += m;
  }
  const pct = (x: number) => Math.round((x / total) * 100);
  if (night / total >= 0.45)
    return {
      id: 'night-owl',
      label: 'Night owl',
      emoji: '🦉',
      reason: `${pct(night)}% of your minutes start after 9 pm.`,
    };
  if (early / total >= 0.35)
    return {
      id: 'early-bird',
      label: 'Early bird',
      emoji: '🐦',
      reason: `${pct(early)}% of your minutes start before 9 am.`,
    };
  if (weekend / total >= 0.5)
    return {
      id: 'weekend-warrior',
      label: 'Weekend warrior',
      emoji: '🛡️',
      reason: `${pct(weekend)}% of your minutes land on Saturdays and Sundays.`,
    };
  const med = median(ss.map(workMin)) ?? 0;
  const days = dailyTotals(ss, tz);
  const perDay = ss.length / Math.max(1, days.size);
  if (med >= 60)
    return {
      id: 'deep-diver',
      label: 'Deep diver',
      emoji: '🤿',
      reason: `Your typical session runs ${fmtDurationWord(med)}.`,
    };
  if (med < 25 && perDay >= 2)
    return {
      id: 'sprinter',
      label: 'Sprinter',
      emoji: '⚡',
      reason: `Short bursts, ${round1(perDay)} a day on the days you study.`,
    };
  const today = toLocalDate(input.now, tz);
  let active = 0;
  for (const date of eachDay(addDays(today, -29), today))
    if ((days.get(date)?.minutes ?? 0) > 0) active++;
  if (active >= 18)
    return {
      id: 'consistent-climber',
      label: 'Consistent climber',
      emoji: '🧗',
      reason: `You studied on ${active} of the last 30 days.`,
    };
  return null;
}

/* ---------- forecast ---------- */

export interface Forecast {
  hours: number;
  date: ISODate;
  /** "At this pace you'll hit 100 hours by March 3 🎯" */
  text: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface ForecastInput {
  totalMinutes: number;
  /** Minutes over the last 28 days: the pace. */
  last28Minutes: number;
  now: ISODateTime;
  timezone: string;
}

/** When the next hour milestone lands at the current pace, or null with no pace to speak of. */
export function hoursForecast(input: ForecastInput): Forecast | null {
  const perDay = input.last28Minutes / 28;
  if (perDay <= 0) return null;
  const next =
    HOUR_MILESTONES.find((h) => h * 60 > input.totalMinutes) ??
    Math.ceil((input.totalMinutes / 60 + 1) / 500) * 500;
  const days = Math.ceil((next * 60 - input.totalMinutes) / perDay);
  const today = toLocalDate(input.now, input.timezone);
  const date = addDays(today, days);
  const month = MONTHS[Number(date.slice(5, 7)) - 1]!;
  const when =
    days <= 366 ? `${month} ${Number(date.slice(8, 10))}` : `${month} ${date.slice(0, 4)}`;
  return { hours: next, date, text: `At this pace you'll hit ${next} hours by ${when} 🎯` };
}

/* ---------- focus quality ---------- */

export interface FocusQuality {
  /** Sessions whose review answered the distraction question. */
  answered: number;
  /** Share answered "no distraction", 0..1. */
  ratio: number | null;
}

export function focusQuality(sessions: Session[]): FocusQuality {
  const answered = done(sessions).filter(
    (s) => s.review && !s.review.skipped && s.review.distracted !== null,
  );
  const clean = answered.filter((s) => s.review!.distracted === 'no').length;
  return { answered: answered.length, ratio: answered.length ? clean / answered.length : null };
}

/* ---------- planned against actual ---------- */

export interface PlanKept {
  planned: number;
  kept: number;
}

/** Of the study blocks planned in a range that have passed, how many had a session inside them. */
export function planKept(
  blocks: PlannedBlock[],
  sessions: Session[],
  from: ISODate,
  to: ISODate,
  tz: string,
  now: ISODateTime,
): PlanKept {
  const nowMs = Date.parse(now);
  const ss = done(sessions);
  let planned = 0;
  let kept = 0;
  for (const b of blocks) {
    if (b.cancelled || b.source !== 'app') continue;
    const date = toLocalDate(b.startAt, tz);
    if (date < from || date > to) continue;
    const start = Date.parse(b.startAt);
    const end = Date.parse(b.endAt);
    if (end > nowMs) continue;
    planned++;
    if (
      ss.some(
        (s) => Date.parse(s.startedAt) < end && Date.parse(s.endedAt!) > start && workMin(s) > 0,
      )
    )
      kept++;
  }
  return { planned, kept };
}

/* ---------- study against grades ---------- */

export interface CourseStudyGrade {
  nodeId: string;
  title: string;
  minutes: number;
  percent: number;
}

export interface StudyVsGrades {
  courses: CourseStudyGrade[];
  /** Gentle, and only what the numbers support. */
  note: string;
}

/** Hours studied per course next to its mark. Null until three courses have both. */
export function studyVsGrades(courses: CourseStudyGrade[]): StudyVsGrades | null {
  const rows = courses.filter((c) => c.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  if (rows.length < 3) return null;
  const mostStudied = rows[0]!;
  const top = [...rows].sort((a, b) => b.percent - a.percent)[0]!;
  const note =
    mostStudied.nodeId === top.nodeId
      ? `${mostStudied.title} gets the most of your time and holds your highest mark.`
      : `${mostStudied.title} gets the most of your time; ${top.title} holds your highest mark.`;
  return { courses: rows, note };
}

/* ---------- the dashboard strip ---------- */

export interface DashboardStats {
  totalMinutes: number;
  weekMinutes: number;
  goalMinutes: number;
  goalRatio: number;
  /** The last seven days, oldest first, ending today. */
  sparkline: Array<{ date: ISODate; minutes: number }>;
  streak: { current: number; longest: number; weeks: { current: number; longest: number } };
}

export interface DashboardInput {
  sessions: Session[];
  timezone: string;
  now: ISODateTime;
  goalMinutes: number;
  streak: StreakState;
}

export function dashboardStats(input: DashboardInput): DashboardStats {
  const tz = input.timezone;
  const today = toLocalDate(input.now, tz);
  const totals = dailyTotals(input.sessions, tz);
  const monday = startOfWeekMonday(today);
  const weekMinutes = sumRange(totals, monday, addDays(monday, 6));
  const sparkline: DashboardStats['sparkline'] = [];
  for (const date of eachDay(addDays(today, -6), today))
    sparkline.push({ date, minutes: totals.get(date)?.minutes ?? 0 });
  return {
    totalMinutes: [...totals.values()].reduce((a, t) => a + t.minutes, 0),
    weekMinutes,
    goalMinutes: input.goalMinutes,
    goalRatio: input.goalMinutes > 0 ? Math.min(1, weekMinutes / input.goalMinutes) : 0,
    sparkline,
    streak: {
      current: input.streak.current,
      longest: input.streak.longest,
      weeks: weekStreakNumbers(input.streak),
    },
  };
}
