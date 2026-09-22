import { describe, expect, it } from 'vitest';
import { buildGrid, entriesByDay, trackerWidgets, weeksForHistory } from './trackers';
import type { ISODate, Tracker, TrackerEntry } from './types';

const TZ = 'America/Toronto';
// Wednesday 2026-09-16, 14:00 local.
const NOW = '2026-09-16T18:00:00.000Z';
const TODAY: ISODate = '2026-09-16';

const days = (pairs: Array<[ISODate, number]>) => new Map(pairs);

const tracker = (over: Partial<Tracker> = {}): Tracker => ({
  id: 't1',
  userId: 'u1',
  title: 'Pages read',
  unitLabel: 'pages',
  dailyGoal: null,
  color: null,
  sortOrder: 0,
  archived: false,
  createdAt: NOW,
  ...over,
});

let seq = 0;
const entry = (trackerId: string, date: ISODate, amount: number): TrackerEntry => ({
  id: `e${++seq}`,
  userId: 'u1',
  trackerId,
  date,
  amount,
  note: null,
  updatedAt: NOW,
});

describe('buildGrid', () => {
  it('lays out whole Monday-first weeks ending with the current one', () => {
    const grid = buildGrid({ byDay: days([]), today: TODAY, weeks: 4 });
    expect(grid.weeks).toHaveLength(4);
    for (const week of grid.weeks) expect(week).toHaveLength(7);
    expect(grid.from).toBe('2026-08-24'); // Monday, three weeks before this one
    expect(grid.to).toBe('2026-09-20'); // Sunday of the current week
    expect(grid.weeks.at(-1)![0]!.date).toBe('2026-09-14');
  });

  it('marks days after today as future, not as empty', () => {
    const grid = buildGrid({ byDay: days([]), today: TODAY, weeks: 1 });
    const flat = grid.weeks.flat();
    expect(flat.filter((c) => c.future).map((c) => c.date)).toEqual([
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
  });

  it('ramps off quartiles of the logged days when there is no goal', () => {
    const grid = buildGrid({
      byDay: days([
        ['2026-09-14', 10],
        ['2026-09-15', 40],
        ['2026-09-16', 100],
      ]),
      today: TODAY,
      weeks: 1,
    });
    const level = (d: ISODate) => grid.weeks.flat().find((c) => c.date === d)!.level;
    // Quartiles of three days put the thresholds at 10/40/100, so the lightest day sits at
    // step 2: with this little history the ramp cannot separate "barely" from "a bit".
    expect(grid.thresholds).toEqual([10, 40, 100]);
    expect(level('2026-09-14')).toBe(2);
    expect(level('2026-09-15')).toBe(3);
    expect(level('2026-09-16')).toBe(4); // the heaviest day always reaches the top step
    expect(grid.total).toBe(150);
    expect(grid.activeDays).toBe(3);
  });

  it('ramps off the daily goal when one is set', () => {
    const grid = buildGrid({
      byDay: days([
        ['2026-09-14', 5],
        ['2026-09-15', 30],
        ['2026-09-16', 60],
      ]),
      today: TODAY,
      weeks: 1,
      dailyGoal: 50,
    });
    const level = (d: ISODate) => grid.weeks.flat().find((c) => c.date === d)!.level;
    expect(grid.thresholds).toEqual([12.5, 25, 37.5]);
    expect(level('2026-09-14')).toBe(1); // under a quarter of the goal
    expect(level('2026-09-15')).toBe(3); // most of the way there
    expect(level('2026-09-16')).toBe(4); // goal met
  });

  it('counts the longest and current runs', () => {
    const grid = buildGrid({
      byDay: days([
        ['2026-09-07', 1],
        ['2026-09-08', 1],
        ['2026-09-09', 1],
        // gap
        ['2026-09-15', 1],
        ['2026-09-16', 1],
      ]),
      today: TODAY,
      weeks: 3,
    });
    expect(grid.longestRun).toBe(3);
    expect(grid.currentRun).toBe(2);
  });

  it('does not break the current run just because today is still empty', () => {
    const grid = buildGrid({
      byDay: days([
        ['2026-09-14', 1],
        ['2026-09-15', 1],
      ]),
      today: TODAY,
      weeks: 2,
    });
    expect(grid.currentRun).toBe(2);
  });

  it('reports the best day', () => {
    const grid = buildGrid({
      byDay: days([
        ['2026-09-14', 12],
        ['2026-09-15', 80],
      ]),
      today: TODAY,
      weeks: 2,
    });
    expect(grid.best).toEqual({ date: '2026-09-15', amount: 80 });
  });

  it('ignores days outside the window', () => {
    const grid = buildGrid({
      byDay: days([
        ['2020-01-01', 999],
        ['2026-09-16', 5],
      ]),
      today: TODAY,
      weeks: 2,
    });
    expect(grid.total).toBe(5);
  });

  it('survives an empty history', () => {
    const grid = buildGrid({ byDay: days([]), today: TODAY, weeks: 2 });
    expect(grid.total).toBe(0);
    expect(grid.best).toBeNull();
    expect(grid.currentRun).toBe(0);
    expect(grid.thresholds).toEqual([0, 0, 0]);
  });
});

describe('entriesByDay', () => {
  it('sums anything logged twice on one day', () => {
    const byDay = entriesByDay([
      entry('t1', '2026-09-16', 10),
      entry('t1', '2026-09-16', 5),
      entry('t1', '2026-09-15', 3),
    ]);
    expect(byDay.get('2026-09-16')).toBe(15);
    expect(byDay.get('2026-09-15')).toBe(3);
  });
});

describe('trackerWidgets', () => {
  it('builds one widget per tracker with today already filled in', () => {
    const pages = tracker({ id: 't1', title: 'Pages read', sortOrder: 1 });
    const runs = tracker({ id: 't2', title: 'Kilometres', unitLabel: 'km', sortOrder: 0 });
    const widgets = trackerWidgets({
      trackers: [pages, runs],
      entries: [entry('t1', TODAY, 40), entry('t1', '2026-09-15', 12), entry('t2', TODAY, 5)],
      now: NOW,
      timezone: TZ,
      weeks: 4,
    });
    expect(widgets.map((w) => w.tracker.title)).toEqual(['Kilometres', 'Pages read']);
    expect(widgets[1]!.todayAmount).toBe(40);
    expect(widgets[1]!.grid.total).toBe(52);
    expect(widgets[0]!.todayAmount).toBe(5);
  });

  it('leaves archived trackers out', () => {
    const widgets = trackerWidgets({
      trackers: [tracker({ id: 't1' }), tracker({ id: 't2', archived: true })],
      entries: [],
      now: NOW,
      timezone: TZ,
    });
    expect(widgets).toHaveLength(1);
  });

  it("keeps one tracker's entries out of another's grid", () => {
    const widgets = trackerWidgets({
      trackers: [tracker({ id: 't1' }), tracker({ id: 't2', sortOrder: 1 })],
      entries: [entry('t1', TODAY, 40)],
      now: NOW,
      timezone: TZ,
    });
    expect(widgets[0]!.grid.total).toBe(40);
    expect(widgets[1]!.grid.total).toBe(0);
  });
});

describe('weeksForHistory', () => {
  it('shows a short grid on day one instead of a year of empty squares', () => {
    expect(weeksForHistory(TODAY, TODAY)).toBe(8);
    expect(weeksForHistory(null, TODAY)).toBe(8);
  });

  it('grows with the history', () => {
    expect(weeksForHistory('2026-06-16', TODAY)).toBe(15); // ~13 weeks of history
    expect(weeksForHistory('2025-01-01', TODAY)).toBe(53); // capped at the range
  });

  it('never exceeds the range it is given', () => {
    expect(weeksForHistory('2020-01-01', TODAY, 13)).toBe(13);
    expect(weeksForHistory(TODAY, TODAY, 4)).toBe(4);
  });

  it('ignores a first activity in the future', () => {
    expect(weeksForHistory('2030-01-01', TODAY)).toBe(8);
  });
});
