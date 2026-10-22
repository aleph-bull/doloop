import { addDays, toLocalDate, zonedTimeUtc } from './dates';
import { isRestDay } from './rest-days';
import type { Interval } from './scheduler';
import type { ISODate, ISODateTime, RestDayPolicy } from './types';

/** Time a task (or a study-plan topic) still wants set aside in the window. */
export interface PlanNeed {
  nodeId: string;
  /** Minutes to find. */
  minutes: number;
  /**
   * No block for it may end after this instant (the due time). One already past makes it
   * the most urgent and plans it anywhere; null plans it anywhere, after everything due.
   */
  deadline: ISODateTime | null;
  /** The length one block should be, when there is that much left. */
  blockMinutes: number;
}

export interface WeekPlanInput {
  /** The window to plan in; nothing is proposed outside it. */
  from: ISODateTime;
  to: ISODateTime;
  needs: PlanNeed[];
  /** Time that is taken: commitments, Google busy times. Never planned over. */
  busy: Interval[];
  /** Study blocks already planned. Never planned over, and they count towards a day's cap. */
  planned: Interval[];
  timezone: string;
  policy: RestDayPolicy;
  /** Local hours within which to plan. */
  dayStartHour?: number;
  dayEndHour?: number;
  /** The most planned study a day gets, counting what is already there. */
  dailyCapMinutes?: number;
  /** The shortest block worth proposing. */
  minBlockMinutes?: number;
  /** Breathing room kept either side of anything already in the calendar. */
  gapMinutes?: number;
}

export interface ProposedBlock {
  nodeId: string;
  start: ISODateTime;
  end: ISODateTime;
}

const SNAP = 15 * 60_000;
const snapUp = (ms: number) => Math.ceil(ms / SNAP) * SNAP;
const snapDown = (min: number) => Math.floor(min / 15) * 15;

function merged(list: Array<[number, number]>): Array<[number, number]> {
  const xs = list.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of xs) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * Spreads what each task needs across the free time in a window, as blocks to propose.
 *
 * Soonest deadline first. Each block goes on the lightest study day before its deadline that
 * the task has no block on yet (earliest first when days tie), in the first free stretch of
 * that day, so a week fills evenly instead of piling onto Monday. A task only doubles up on
 * a day once every other day is used or full. Rest days, busy time, existing blocks and the
 * daily cap are respected; whatever does not fit is simply left out. Pure and deterministic.
 */
export function planWeek(input: WeekPlanInput): ProposedBlock[] {
  const tz = input.timezone;
  const dayStart = input.dayStartHour ?? 8;
  const dayEnd = input.dayEndHour ?? 22;
  const cap = input.dailyCapMinutes ?? 4 * 60;
  const minBlock = input.minBlockMinutes ?? 30;
  const gap = (input.gapMinutes ?? 15) * 60_000;
  const fromMs = Date.parse(input.from);
  const toMs = Date.parse(input.to);

  // Taken time, padded by the gap so nothing lands hard against a class or another block.
  let taken = merged(
    [...input.busy, ...input.planned].map((b) => [
      Date.parse(b.start) - gap,
      Date.parse(b.end) + gap,
    ]),
  );

  const days: Array<{ date: ISODate; start: number; end: number; load: number }> = [];
  for (
    let d = toLocalDate(input.from, tz);
    d <= toLocalDate(new Date(toMs - 1), tz);
    d = addDays(d, 1)
  ) {
    if (isRestDay(input.policy, d)) continue;
    const start = Math.max(fromMs, zonedTimeUtc(d, dayStart, 0, tz).getTime());
    const end = Math.min(toMs, zonedTimeUtc(d, dayEnd, 0, tz).getTime());
    if (end - start < minBlock * 60_000) continue;
    const load = input.planned.reduce((sum, b) => {
      const a = Math.max(Date.parse(b.start), zonedTimeUtc(d, 0, 0, tz).getTime());
      const z = Math.min(Date.parse(b.end), zonedTimeUtc(addDays(d, 1), 0, 0, tz).getTime());
      return z > a ? sum + (z - a) / 60_000 : sum;
    }, 0);
    days.push({ date: d, start, end, load });
  }

  /** The first free stretch of `minutes` in a day that ends by `limit`, if there is one. */
  const firstFree = (day: (typeof days)[number], minutes: number, limit: number) => {
    const need = minutes * 60_000;
    const end = Math.min(day.end, limit);
    let cursor = snapUp(day.start);
    for (const [a, b] of taken) {
      if (b <= cursor) continue;
      if (a >= end) break;
      if (a - cursor >= need) return cursor;
      cursor = snapUp(Math.max(cursor, b));
    }
    return end - cursor >= need ? cursor : null;
  };

  const order = [...input.needs].sort((a, b) => {
    if (a.deadline !== b.deadline) {
      if (a.deadline === null) return 1;
      if (b.deadline === null) return -1;
      return Date.parse(a.deadline) - Date.parse(b.deadline);
    }
    return b.minutes - a.minutes;
  });

  const out: ProposedBlock[] = [];
  for (const need of order) {
    let left = snapDown(need.minutes);
    const due = need.deadline ? Date.parse(need.deadline) : Infinity;
    const limit = due > fromMs ? due : Infinity;
    // Overdue work goes in the first free time; anything else spreads to the lighter days.
    const asap = due <= fromMs;
    const used = new Set<ISODate>();
    while (left >= minBlock) {
      const candidates = days
        .filter((d) => d.start < limit && cap - d.load >= minBlock)
        .sort((a, b) => {
          const au = used.has(a.date) ? 1 : 0;
          const bu = used.has(b.date) ? 1 : 0;
          if (au !== bu) return au - bu;
          // Loads within half an hour of each other count as even, so earlier days win.
          const al = asap ? 0 : Math.floor(a.load / 30);
          const bl = asap ? 0 : Math.floor(b.load / 30);
          if (al !== bl) return al - bl;
          return a.date < b.date ? -1 : 1;
        });
      let placed = false;
      for (const day of candidates) {
        const room = snapDown(Math.min(left, need.blockMinutes, cap - day.load));
        // Try the full length, then shorter, down to the shortest block worth having.
        for (let len = room; len >= minBlock; len -= 15) {
          const at = firstFree(day, len, limit);
          if (at === null) continue;
          const end = at + len * 60_000;
          out.push({
            nodeId: need.nodeId,
            start: new Date(at).toISOString(),
            end: new Date(end).toISOString(),
          });
          taken = merged([...taken, [at - gap, end + gap]]);
          day.load += len;
          left -= len;
          used.add(day.date);
          placed = true;
          break;
        }
        if (placed) break;
      }
      if (!placed) break;
    }
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** Where one item sits in a day column: its lane and how many lanes its cluster spans. */
export interface DayLane {
  lane: number;
  lanes: number;
  /** True when it shares time with something else in the column. */
  overlaps: boolean;
}

/**
 * Lays a day column out in lanes, like any calendar: items that share time sit side by side
 * and each takes only the width of the cluster it actually collides with. Input order does
 * not matter; items are taken by start, longest first on ties.
 */
export function layoutLanes<T extends { start: number; end: number }>(
  items: T[],
): Array<T & DayLane> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const laneEnds: number[] = [];
  const placed = sorted.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else laneEnds[lane] = item.end;
    return { item, lane };
  });
  return placed.map(({ item, lane }) => {
    const cluster = placed.filter((o) => o.item.start < item.end && o.item.end > item.start);
    return {
      ...item,
      lane,
      lanes: Math.max(...cluster.map((o) => o.lane)) + 1,
      overlaps: cluster.length > 1,
    };
  });
}
