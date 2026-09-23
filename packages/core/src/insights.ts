import {
  addDays,
  dayOfWeek,
  diffDays,
  eachDay,
  localHour,
  startOfWeekMonday,
  toLocalDate,
} from './dates';
import { fmtDurationWord } from './highlights';
import type { ISODate, ISODateTime, Session } from './types';

/**
 * Lifetime and long-range analytics: the numbers that only mean something once there is
 * some history. Every figure here is descriptive — no targets, no scolding — and every
 * insight carries the evidence that produced it so it can be checked rather than believed.
 */

const workMin = (s: Session) => s.workSeconds / 60;

export interface LifetimeStats {
  /** When the account was created, which is what "since you started" counts from. */
  since: ISODate;
  daysSince: number;
  totalMinutes: number;
  totalSessions: number;
  /** Distinct calendar days with at least one session. */
  activeDays: number;
  /** Share of days since joining that had a session, 0..1. */
  activeDayRate: number;
  /** Average over *active* days only; the all-days average is misleading on rest days. */
  avgMinutesPerActiveDay: number;
  bestDay: { date: ISODate; minutes: number } | null;
  longestSessionMinutes: number;
  /** Minutes in the last 28 days, and in the 28 before that. */
  last28Minutes: number;
  prior28Minutes: number;
  /** Headline sentence for the top of the page. */
  headline: string;
}

export interface LifetimeInput {
  sessions: Session[];
  timezone: string;
  now: ISODateTime;
  /** Account creation instant. */
  joinedAt: ISODateTime;
}

export function lifetimeStats(input: LifetimeInput): LifetimeStats {
  const tz = input.timezone;
  const today = toLocalDate(input.now, tz);
  const since = toLocalDate(input.joinedAt, tz);
  const done = input.sessions.filter((s) => s.endedAt !== null);

  const byDay = new Map<ISODate, number>();
  for (const s of done) {
    const d = toLocalDate(s.startedAt, tz);
    byDay.set(d, (byDay.get(d) ?? 0) + workMin(s));
  }
  const totalMinutes = done.reduce((a, s) => a + workMin(s), 0);
  const activeDays = [...byDay.values()].filter((m) => m > 0).length;
  // Inclusive of the join day, so a brand-new account reads as one day, not zero.
  const daysSince = Math.max(1, diffDays(since, today) + 1);

  let bestDay: LifetimeStats['bestDay'] = null;
  for (const [date, minutes] of byDay) {
    if (minutes > 0 && (!bestDay || minutes > bestDay.minutes)) bestDay = { date, minutes };
  }

  const windowMinutes = (from: ISODate, to: ISODate) => {
    let total = 0;
    for (const [date, minutes] of byDay) if (date >= from && date <= to) total += minutes;
    return total;
  };
  const last28 = windowMinutes(addDays(today, -27), today);
  const prior28 = windowMinutes(addDays(today, -55), addDays(today, -28));

  const headline =
    totalMinutes > 0
      ? `You have put in ${fmtDurationWord(totalMinutes)} of focused work since you started using Komodoit.`
      : 'No focused work logged yet. Your first session starts the record.';

  return {
    since,
    daysSince,
    totalMinutes,
    totalSessions: done.length,
    activeDays,
    activeDayRate: activeDays / daysSince,
    avgMinutesPerActiveDay: activeDays > 0 ? totalMinutes / activeDays : 0,
    bestDay,
    longestSessionMinutes: done.reduce((a, s) => Math.max(a, workMin(s)), 0),
    last28Minutes: last28,
    prior28Minutes: prior28,
    headline,
  };
}

/* ---------- contribution heatmap ---------- */

export interface HeatmapCell {
  date: ISODate;
  minutes: number;
  /** 0 = nothing, 1-4 = quartile of the non-empty days, for the colour ramp. */
  level: 0 | 1 | 2 | 3 | 4;
  /** Days after today are rendered as placeholders, not as empty study days. */
  future: boolean;
}

export interface Heatmap {
  /** Columns of seven cells, Monday first, oldest column first. */
  weeks: HeatmapCell[][];
  /** Month labels keyed by column index, for the axis. */
  monthLabels: Array<{ column: number; label: string }>;
  from: ISODate;
  to: ISODate;
  totalMinutes: number;
  activeDays: number;
  /** Thresholds used for the ramp, so a legend can explain what a shade means. */
  thresholds: [number, number, number];
  /** Longest run of consecutive studied days inside the window. */
  longestRun: number;
}

export interface HeatmapInput {
  sessions: Session[];
  timezone: string;
  now: ISODateTime;
  /** How many weeks back to show. */
  weeks?: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A GitHub-style contribution grid of study minutes. The ramp uses quartiles of the days
 * that actually had work, so it stays readable whether the user does 20 minutes a day or
 * three hours — a fixed scale would wash one of those out entirely.
 */
export function studyHeatmap(input: HeatmapInput): Heatmap {
  const tz = input.timezone;
  const weeks = Math.max(1, Math.min(input.weeks ?? 53, 106));
  const today = toLocalDate(input.now, tz);
  // Start on the Monday that makes the last column the current week.
  const lastMonday = startOfWeekMonday(today);
  const from = addDays(lastMonday, -(weeks - 1) * 7);
  const to = addDays(lastMonday, 6);

  const byDay = new Map<ISODate, number>();
  for (const s of input.sessions) {
    if (!s.endedAt) continue;
    const d = toLocalDate(s.startedAt, tz);
    if (d < from || d > to) continue;
    byDay.set(d, (byDay.get(d) ?? 0) + workMin(s));
  }

  const nonEmpty = [...byDay.values()].filter((m) => m > 0).sort((a, b) => a - b);
  const quantile = (p: number) =>
    nonEmpty.length ? nonEmpty[Math.min(nonEmpty.length - 1, Math.floor(nonEmpty.length * p))]! : 0;
  const thresholds: [number, number, number] = [quantile(0.25), quantile(0.5), quantile(0.75)];

  // Strictly-less comparisons, so the heaviest day always lands in the top step rather
  // than tying with the 75th percentile and rendering a shade lighter than the maximum.
  const levelOf = (m: number): HeatmapCell['level'] => {
    if (m <= 0) return 0;
    if (m < thresholds[0]) return 1;
    if (m < thresholds[1]) return 2;
    if (m < thresholds[2]) return 3;
    return 4;
  };

  const cells: HeatmapCell[] = [];
  for (const date of eachDay(from, to)) {
    const minutes = byDay.get(date) ?? 0;
    cells.push({ date, minutes, level: levelOf(minutes), future: date > today });
  }

  const columns: HeatmapCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) columns.push(cells.slice(i, i + 7));

  const monthLabels: Heatmap['monthLabels'] = [];
  let lastMonth = '';
  columns.forEach((col, i) => {
    const first = col[0];
    if (!first) return;
    const month = first.date.slice(0, 7);
    if (month !== lastMonth) {
      lastMonth = month;
      monthLabels.push({ column: i, label: MONTHS[Number(first.date.slice(5, 7)) - 1] ?? '' });
    }
  });

  let longestRun = 0;
  let run = 0;
  for (const c of cells) {
    if (c.future) break;
    if (c.minutes > 0) {
      run++;
      longestRun = Math.max(longestRun, run);
    } else run = 0;
  }

  return {
    weeks: columns,
    monthLabels,
    from,
    to,
    totalMinutes: [...byDay.values()].reduce((a, b) => a + b, 0),
    activeDays: nonEmpty.length,
    thresholds,
    longestRun,
  };
}

/* ---------- rhythm profiles ---------- */

export interface Bucket {
  label: string;
  minutes: number;
  /** Share of the total, 0..1. */
  share: number;
}

export interface RhythmProfile {
  buckets: Bucket[];
  /** The fullest bucket, or null when there is nothing to report. */
  peak: Bucket | null;
  totalMinutes: number;
}

const HOUR_BANDS: Array<{ label: string; from: number; to: number }> = [
  { label: 'Early (5-9)', from: 5, to: 8 },
  { label: 'Morning (9-12)', from: 9, to: 11 },
  { label: 'Afternoon (12-17)', from: 12, to: 16 },
  { label: 'Evening (17-21)', from: 17, to: 20 },
  { label: 'Night (21-5)', from: 21, to: 4 },
];

function profile(entries: Array<{ label: string; minutes: number }>): RhythmProfile {
  const total = entries.reduce((a, e) => a + e.minutes, 0);
  const buckets = entries.map((e) => ({
    label: e.label,
    minutes: e.minutes,
    share: total > 0 ? e.minutes / total : 0,
  }));
  const peak = total > 0 ? buckets.reduce((a, b) => (b.minutes > a.minutes ? b : a)) : null;
  return { buckets, peak, totalMinutes: total };
}

/** Minutes by time of day, so the user can see when they actually work. */
export function timeOfDayProfile(sessions: Session[], timezone: string): RhythmProfile {
  const totals = new Map(HOUR_BANDS.map((b) => [b.label, 0]));
  for (const s of sessions) {
    if (!s.endedAt) continue;
    const h = localHour(s.startedAt, timezone);
    const band = HOUR_BANDS.find((b) =>
      b.from <= b.to ? h >= b.from && h <= b.to : h >= b.from || h <= b.to,
    );
    if (band) totals.set(band.label, (totals.get(band.label) ?? 0) + workMin(s));
  }
  return profile(HOUR_BANDS.map((b) => ({ label: b.label, minutes: totals.get(b.label) ?? 0 })));
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Minutes by day of the week, Monday first. */
export function weekdayProfile(sessions: Session[], timezone: string): RhythmProfile {
  const totals = new Array<number>(7).fill(0);
  for (const s of sessions) {
    if (!s.endedAt) continue;
    const d = dayOfWeek(toLocalDate(s.startedAt, timezone));
    totals[d] = (totals[d] ?? 0) + workMin(s);
  }
  // Monday-first ordering matches the heatmap and the weekly review.
  const order = [1, 2, 3, 4, 5, 6, 0];
  return profile(order.map((d) => ({ label: DAY_NAMES[d]!, minutes: totals[d]! })));
}

/* ---------- explained insights ---------- */

export type InsightTone = 'neutral' | 'good' | 'watch';

export interface Insight {
  key: string;
  /** The claim, in one sentence. */
  headline: string;
  /** The numbers behind it, so the claim can be checked rather than taken on trust. */
  evidence: string;
  tone: InsightTone;
}

export interface InsightsInput {
  lifetime: LifetimeStats;
  timeOfDay: RhythmProfile;
  weekday: RhythmProfile;
  heatmap: Heatmap;
  sessions: Session[];
  timezone: string;
}

const pctChange = (now: number, before: number): number | null =>
  before > 0 ? (now - before) / before : null;

/**
 * Descriptive read-outs of the long-range data. Each one states what the data shows and
 * what it was computed from; none of them tell the user what they ought to be doing.
 */
export function buildInsights(input: InsightsInput): Insight[] {
  const out: Insight[] = [];
  const { lifetime, timeOfDay, weekday, heatmap } = input;
  if (lifetime.totalSessions === 0) return out;

  out.push({
    key: 'lifetime',
    headline: lifetime.headline,
    evidence: `${lifetime.totalSessions} session${lifetime.totalSessions === 1 ? '' : 's'} across ${lifetime.activeDays} day${lifetime.activeDays === 1 ? '' : 's'}, since ${lifetime.since}.`,
    tone: 'neutral',
  });

  const change = pctChange(lifetime.last28Minutes, lifetime.prior28Minutes);
  if (change !== null && Math.abs(change) >= 0.1) {
    const up = change > 0;
    out.push({
      key: 'momentum',
      headline: up
        ? `You are studying about ${Math.round(change * 100)}% more than you were a month ago.`
        : `You are studying about ${Math.round(-change * 100)}% less than you were a month ago.`,
      evidence: `${fmtDurationWord(lifetime.last28Minutes)} in the last 28 days against ${fmtDurationWord(lifetime.prior28Minutes)} in the 28 before.`,
      tone: up ? 'good' : 'watch',
    });
  } else if (change !== null) {
    out.push({
      key: 'momentum',
      headline: 'Your workload has held steady over the last two months.',
      evidence: `${fmtDurationWord(lifetime.last28Minutes)} in the last 28 days against ${fmtDurationWord(lifetime.prior28Minutes)} in the 28 before.`,
      tone: 'neutral',
    });
  }

  // Only claim a time-of-day preference when it is actually pronounced.
  if (timeOfDay.peak && timeOfDay.peak.share >= 0.35 && timeOfDay.totalMinutes >= 120) {
    out.push({
      key: 'time-of-day',
      headline: `Most of your work happens in the ${timeOfDay.peak.label.split(' ')[0]!.toLowerCase()}.`,
      evidence: `${Math.round(timeOfDay.peak.share * 100)}% of your logged minutes start in the ${timeOfDay.peak.label.toLowerCase()} band.`,
      tone: 'neutral',
    });
  }

  if (weekday.peak && weekday.totalMinutes >= 120) {
    const quietest = [...weekday.buckets].sort((a, b) => a.minutes - b.minutes)[0];
    out.push({
      key: 'weekday',
      headline: `${weekday.peak.label} is your heaviest day.`,
      evidence: quietest
        ? `${fmtDurationWord(weekday.peak.minutes)} on ${weekday.peak.label}s against ${fmtDurationWord(quietest.minutes)} on ${quietest.label}s, all time.`
        : `${fmtDurationWord(weekday.peak.minutes)} all time.`,
      tone: 'neutral',
    });
  }

  if (heatmap.longestRun >= 2) {
    out.push({
      key: 'longest-run',
      headline: `Your longest unbroken run is ${heatmap.longestRun} days.`,
      evidence: `Counted from the ${heatmap.weeks.length}-week grid above; rest days break a run without penalty.`,
      tone: 'good',
    });
  }

  if (lifetime.bestDay) {
    out.push({
      key: 'best-day',
      headline: `Your biggest day was ${fmtDurationWord(lifetime.bestDay.minutes)}.`,
      evidence: `On ${lifetime.bestDay.date}. Your typical study day is ${fmtDurationWord(lifetime.avgMinutesPerActiveDay)}.`,
      tone: 'neutral',
    });
  }

  if (lifetime.daysSince >= 14) {
    const pct = Math.round(lifetime.activeDayRate * 100);
    out.push({
      key: 'cadence',
      headline: `You study on about ${pct}% of days.`,
      evidence: `${lifetime.activeDays} active days out of ${lifetime.daysSince} since you joined. Rest days count as days off, not misses.`,
      tone: 'neutral',
    });
  }

  return out;
}
