import { addDays, eachDay, startOfWeekMonday, toLocalDate } from './dates';
import type { ISODate, ISODateTime, Tracker, TrackerEntry } from './types';

/**
 * Contribution grids for arbitrary daily numbers.
 *
 * The study heatmap in `insights.ts` is the same shape over session minutes; this is the
 * general version, so a user-defined tracker ("pages read") gets an identical grid without
 * the analytics module having to know what a page is.
 */

export interface GridCell {
  date: ISODate;
  /** The day's total in the tracker's own unit. */
  amount: number;
  /** 0 = nothing, 1-4 = the colour ramp. */
  level: 0 | 1 | 2 | 3 | 4;
  /** Days after today are placeholders, not empty days. */
  future: boolean;
}

export interface Grid {
  /** Columns of seven cells, Monday first, oldest column first. */
  weeks: GridCell[][];
  monthLabels: Array<{ column: number; label: string }>;
  from: ISODate;
  to: ISODate;
  total: number;
  activeDays: number;
  /** The amounts behind levels 1-3, so a legend can explain a shade. */
  thresholds: [number, number, number];
  /** Longest run of consecutive days with anything logged. */
  longestRun: number;
  /** Run ending today (or yesterday, if today is still empty). */
  currentRun: number;
  best: { date: ISODate; amount: number } | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const GRID_MAX_WEEKS = 106;

/**
 * Never show fewer than this many columns. A grid of two columns is not a grid, and the
 * month labels need room to mean anything.
 */
export const GRID_MIN_WEEKS = 8;

/**
 * How many weeks of grid a history actually justifies.
 *
 * A year of empty squares on someone's second day says "you have done nothing" far more
 * loudly than it says "here is your year". The grid starts near the width of the history
 * and grows into the full range as the history does.
 */
export function weeksForHistory(firstActivity: ISODate | null, today: ISODate, max = 53): number {
  const cap = Math.max(1, Math.min(max, GRID_MAX_WEEKS));
  if (!firstActivity || firstActivity > today) return Math.min(GRID_MIN_WEEKS, cap);
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${firstActivity}T00:00:00Z`)) / 86_400_000,
  );
  // One spare column so the oldest day is never flush against the left edge. The cap is
  // applied last: an explicitly chosen range wins over the minimum width.
  const spanned = Math.ceil((days + 1) / 7) + 1;
  return Math.min(cap, Math.max(GRID_MIN_WEEKS, spanned));
}

export interface GridInput {
  /** Day totals. Days missing from the map are zero. */
  byDay: ReadonlyMap<ISODate, number>;
  today: ISODate;
  weeks?: number;
  /**
   * A day's target. When given, the four steps are fixed fractions of it (25/50/75/100%),
   * so hitting your goal always looks the same shade. Without one the ramp uses quartiles
   * of the days you actually logged, which keeps a grid readable whether you log 5 pages a
   * day or 500.
   */
  dailyGoal?: number | null;
}

export function buildGrid(input: GridInput): Grid {
  const weeks = Math.max(1, Math.min(input.weeks ?? 53, GRID_MAX_WEEKS));
  const today = input.today;
  const lastMonday = startOfWeekMonday(today);
  const from = addDays(lastMonday, -(weeks - 1) * 7);
  const to = addDays(lastMonday, 6);

  const inRange = new Map<ISODate, number>();
  for (const [date, amount] of input.byDay) {
    if (date < from || date > to) continue;
    if (amount > 0) inRange.set(date, amount);
  }

  const nonEmpty = [...inRange.values()].sort((a, b) => a - b);
  const goal = input.dailyGoal && input.dailyGoal > 0 ? input.dailyGoal : null;
  const quantile = (p: number) =>
    nonEmpty.length ? nonEmpty[Math.min(nonEmpty.length - 1, Math.floor(nonEmpty.length * p))]! : 0;
  const thresholds: [number, number, number] = goal
    ? [goal * 0.25, goal * 0.5, goal * 0.75]
    : [quantile(0.25), quantile(0.5), quantile(0.75)];

  // Strictly-less comparisons so the heaviest day always lands in the top step rather than
  // tying with the top threshold and rendering a shade lighter than the maximum.
  const levelOf = (n: number): GridCell['level'] => {
    if (n <= 0) return 0;
    if (n < thresholds[0]) return 1;
    if (n < thresholds[1]) return 2;
    if (n < thresholds[2]) return 3;
    return 4;
  };

  const cells: GridCell[] = [];
  for (const date of eachDay(from, to)) {
    const amount = inRange.get(date) ?? 0;
    cells.push({ date, amount, level: levelOf(amount), future: date > today });
  }

  const columns: GridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) columns.push(cells.slice(i, i + 7));

  const monthLabels: Grid['monthLabels'] = [];
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
    if (c.amount > 0) {
      run++;
      longestRun = Math.max(longestRun, run);
    } else run = 0;
  }

  // Today not being logged yet does not end a run - it has not happened yet.
  let currentRun = 0;
  let cursor = inRange.has(today) ? today : addDays(today, -1);
  while (cursor >= from && (inRange.get(cursor) ?? 0) > 0) {
    currentRun++;
    cursor = addDays(cursor, -1);
  }

  let best: Grid['best'] = null;
  for (const [date, amount] of inRange) {
    if (!best || amount > best.amount) best = { date, amount };
  }

  return {
    weeks: columns,
    monthLabels,
    from,
    to,
    total: [...inRange.values()].reduce((a, b) => a + b, 0),
    activeDays: nonEmpty.length,
    thresholds,
    longestRun,
    currentRun,
    best,
  };
}

/** Day totals for one tracker. Entries are one-per-day already, but summing is safe. */
export function entriesByDay(entries: TrackerEntry[]): Map<ISODate, number> {
  const out = new Map<ISODate, number>();
  for (const e of entries) out.set(e.date, (out.get(e.date) ?? 0) + e.amount);
  return out;
}

export interface TrackerWidget {
  tracker: Tracker;
  grid: Grid;
  /** Today's logged amount, for the quick-log field's current value. */
  todayAmount: number;
}

export interface TrackerWidgetInput {
  trackers: Tracker[];
  entries: TrackerEntry[];
  now: ISODateTime;
  timezone: string;
  weeks?: number;
}

/** One widget per non-archived tracker, in sort order. */
export function trackerWidgets(input: TrackerWidgetInput): TrackerWidget[] {
  const today = toLocalDate(input.now, input.timezone);
  const byTracker = new Map<string, TrackerEntry[]>();
  for (const e of input.entries) {
    const list = byTracker.get(e.trackerId) ?? [];
    list.push(e);
    byTracker.set(e.trackerId, list);
  }
  return input.trackers
    .filter((t) => !t.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((tracker) => {
      const byDay = entriesByDay(byTracker.get(tracker.id) ?? []);
      return {
        tracker,
        grid: buildGrid({
          byDay,
          today,
          weeks: input.weeks,
          dailyGoal: tracker.dailyGoal,
        }),
        todayAmount: byDay.get(today) ?? 0,
      };
    });
}
