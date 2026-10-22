import { describe, expect, it } from 'vitest';
import { emptyRestDayPolicy } from './rest-days';
import { layoutLanes, planWeek, type WeekPlanInput } from './week-planner';

const TZ = 'America/Toronto';
/** Local Toronto time on a September 2026 day (EDT, UTC-4). */
const t = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, day, hour + 4, minute)).toISOString();

// Mon 21 Sep 08:00 to Sat 26 Sep 00:00: five weekdays.
const base: WeekPlanInput = {
  from: t(21, 8),
  to: t(26, 0),
  needs: [],
  busy: [],
  planned: [],
  timezone: TZ,
  policy: emptyRestDayPolicy('u'),
};

const localDay = (iso: string) => new Date(Date.parse(iso) - 4 * 3_600_000).getUTCDate();

describe('planWeek', () => {
  it('spreads one task over different days instead of stacking a day', () => {
    const out = planWeek({
      ...base,
      needs: [{ nodeId: 'a', minutes: 180, deadline: null, blockMinutes: 60 }],
    });
    expect(out).toHaveLength(3);
    expect(new Set(out.map((b) => localDay(b.start))).size).toBe(3);
    expect(out[0]).toEqual({ nodeId: 'a', start: t(21, 8), end: t(21, 9) });
  });

  it('keeps every block before the deadline', () => {
    const out = planWeek({
      ...base,
      needs: [{ nodeId: 'a', minutes: 240, deadline: t(22, 12), blockMinutes: 120 }],
    });
    expect(out.length).toBeGreaterThan(0);
    for (const b of out) expect(Date.parse(b.end)).toBeLessThanOrEqual(Date.parse(t(22, 12)));
  });

  it('plans the soonest deadline first', () => {
    const out = planWeek({
      ...base,
      dailyCapMinutes: 60,
      needs: [
        { nodeId: 'later', minutes: 60, deadline: t(25, 23), blockMinutes: 60 },
        { nodeId: 'soon', minutes: 60, deadline: t(21, 23), blockMinutes: 60 },
      ],
    });
    expect(out.find((b) => b.nodeId === 'soon')?.start).toBe(t(21, 8));
    expect(localDay(out.find((b) => b.nodeId === 'later')!.start)).toBe(22);
  });

  it('plans something already overdue first, anywhere in the window', () => {
    const out = planWeek({
      ...base,
      dailyCapMinutes: 60,
      needs: [
        { nodeId: 'soon', minutes: 60, deadline: t(22, 23), blockMinutes: 60 },
        { nodeId: 'late', minutes: 60, deadline: t(18, 23), blockMinutes: 60 },
      ],
    });
    expect(out.find((b) => b.nodeId === 'late')?.start).toBe(t(21, 8));
    expect(localDay(out.find((b) => b.nodeId === 'soon')!.start)).toBe(22);
  });

  it('puts overdue work on the first day with room, even when later days are lighter', () => {
    const out = planWeek({
      ...base,
      planned: [{ start: t(21, 18), end: t(21, 20) }],
      needs: [{ nodeId: 'late', minutes: 60, deadline: t(18, 23), blockMinutes: 60 }],
    });
    expect(out).toEqual([{ nodeId: 'late', start: t(21, 8), end: t(21, 9) }]);
  });

  it('leaves room around busy time and existing blocks', () => {
    const out = planWeek({
      ...base,
      to: t(22, 0),
      busy: [{ start: t(21, 8), end: t(21, 10) }],
      planned: [{ start: t(21, 11), end: t(21, 12) }],
      needs: [{ nodeId: 'a', minutes: 60, deadline: null, blockMinutes: 60 }],
    });
    // 10:15 to 11:15 would touch the 11:00 block, so the first fit is after it.
    expect(out).toEqual([{ nodeId: 'a', start: t(21, 12, 15), end: t(21, 13, 15) }]);
  });

  it('skips rest days', () => {
    const policy = { ...emptyRestDayPolicy('u'), weeklyRestDays: [1] }; // Mondays
    const out = planWeek({
      ...base,
      policy,
      needs: [{ nodeId: 'a', minutes: 60, deadline: null, blockMinutes: 60 }],
    });
    expect(localDay(out[0]!.start)).toBe(22);
  });

  it('counts blocks already planned towards the daily cap', () => {
    const out = planWeek({
      ...base,
      to: t(22, 0),
      dailyCapMinutes: 120,
      planned: [{ start: t(21, 18), end: t(21, 19, 30) }],
      needs: [{ nodeId: 'a', minutes: 120, deadline: null, blockMinutes: 120 }],
    });
    expect(out).toEqual([{ nodeId: 'a', start: t(21, 8), end: t(21, 8, 30) }]);
  });

  it('proposes nothing when nothing fits', () => {
    const out = planWeek({
      ...base,
      busy: [{ start: t(21, 0), end: t(26, 0) }],
      needs: [{ nodeId: 'a', minutes: 60, deadline: null, blockMinutes: 60 }],
    });
    expect(out).toEqual([]);
  });

  it('never starts before the window opens', () => {
    const out = planWeek({
      ...base,
      from: t(21, 9, 7),
      to: t(22, 0),
      needs: [{ nodeId: 'a', minutes: 30, deadline: null, blockMinutes: 30 }],
    });
    expect(out[0]!.start).toBe(t(21, 9, 15));
  });
});

describe('layoutLanes', () => {
  it('puts overlapping items side by side and leaves the rest full width', () => {
    const out = layoutLanes([
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 30, end: 90 },
      { id: 'c', start: 120, end: 180 },
    ]);
    const by = Object.fromEntries(out.map((o) => [o.id, o]));
    expect(by.a).toMatchObject({ lane: 0, lanes: 2, overlaps: true });
    expect(by.b).toMatchObject({ lane: 1, lanes: 2, overlaps: true });
    expect(by.c).toMatchObject({ lane: 0, lanes: 1, overlaps: false });
  });

  it('reuses a lane once the item in it has ended', () => {
    const out = layoutLanes([
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 0, end: 30 },
      { id: 'c', start: 30, end: 60 },
    ]);
    const by = Object.fromEntries(out.map((o) => [o.id, o]));
    expect(by.c!.lane).toBe(1);
  });
});
