import {
  addDays,
  buildIndex,
  effectiveColor,
  isRestDay,
  restReason,
  rootOf,
  toLocalDate,
  type PlanItem,
  type PlannedBlock,
  type RestDayPolicy,
  type RestReason,
  type StudyNode,
} from '@komogon/core';
import type { PlanSummary } from './api';

/** An event from someone's own calendar (Google, Outlook or one added by link): time taken. */
export function isImported(source: PlannedBlock['source']): boolean {
  return source === 'google' || source === 'outlook' || source === 'ics';
}

/** Minutes in a day column. */
export const DAY_MIN = 24 * 60;
/** Local hours "Plan my week" and "find a time" plan within, like the free-slot suggester. */
export const PLAN_DAY_START = 8;
export const PLAN_DAY_END = 22;

export const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.split('-').map(Number);
  return [y!, m!, d!];
}

/** The instant `minutes` of wall-clock time after local midnight on a day (DST-safe). */
export function isoAt(day: string, minutes: number): string {
  const [y, m, d] = parts(day);
  return new Date(y, m - 1, d, 0, minutes).toISOString();
}

/** Where an instant falls in a day's column, in wall-clock minutes, clamped to the day. */
export function minutesOf(iso: string, day: string): number {
  const at = new Date(iso);
  const local = toLocalDate(at, localTz());
  if (local < day) return 0;
  if (local > day) return DAY_MIN;
  return at.getHours() * 60 + at.getMinutes() + at.getSeconds() / 60;
}

export const snap = (min: number, step = 15) => Math.round(min / step) * step;
const floor15 = (min: number) => Math.max(0, Math.floor(min / 15) * 15);

/** The days from `from` to `to`, inclusive. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "Oct 19 – 25", "October 2026", "Wednesday, Oct 21". */
export function periodLabel(kind: 'week' | 'month' | 'day', from: string, to: string): string {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  if (kind === 'month')
    return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(a);
  if (kind === 'day')
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(a);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).formatRange(a, b);
}

/**
 * "9:00 – 10:30 AM". Past midnight it stays times only, "11:39 PM – 12:31 AM": formatRange
 * would put the full date on both ends.
 */
export function timeRange(startIso: string, endIso: string): string {
  const fmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (start.toDateString() !== end.toDateString())
    return `${fmt.format(start)} – ${fmt.format(end)}`;
  return fmt.formatRange(start, end);
}

/** "9 AM" for the grid's gutter. */
export function hourLabel(hour: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2026, 0, 1, hour));
}

/* ---------- what sits in a day column ---------- */

/**
 * planned: time set aside that is still ahead. missed: set aside, passed, nothing studied in
 * it. kept: set aside and studied in, drawn as an outline behind the session. session: study
 * that happened. commitment: an imported event. proposal: a "Plan my week" suggestion not yet
 * added. live: the session running now.
 */
export type CalKind =
  'planned' | 'missed' | 'kept' | 'session' | 'commitment' | 'proposal' | 'live';

export interface CalItem {
  key: string;
  kind: CalKind;
  day: string;
  /** Wall-clock minutes into the day, clipped to it. */
  start: number;
  end: number;
  startAt: string;
  endAt: string;
  title: string;
  /** The course or plan it belongs to. */
  sub: string | null;
  color: string | null;
  nodeId: string | null;
  block: PlannedBlock | null;
  proposalKey: string | null;
}

export interface Proposal {
  key: string;
  nodeId: string;
  startAt: string;
  endAt: string;
}

export interface NodeLookup {
  title: (id: string | null) => string | null;
  sub: (id: string | null) => string | null;
  color: (id: string | null) => string | null;
}

export function nodeLookup(nodes: StudyNode[]): NodeLookup {
  const index = buildIndex(nodes);
  return {
    title: (id) => (id ? (index.byId.get(id)?.title ?? null) : null),
    sub: (id) => {
      if (!id) return null;
      const root = rootOf(index, id);
      return root && root.id !== id ? root.title : null;
    },
    color: (id) => (id ? effectiveColor(index, id) : null),
  };
}

const overlaps = (a: { startAt: string; endAt: string }, b: { startAt: string; endAt: string }) =>
  Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(a.endAt) > Date.parse(b.startAt);

/** Every item for each of the given days, split at midnight where something runs past it. */
export function buildItems(
  days: string[],
  input: {
    blocks: PlannedBlock[];
    proposals: Proposal[];
    live: { nodeId: string | null; title: string; startAt: string } | null;
    lookup: NodeLookup;
    now: number;
  },
): Map<string, CalItem[]> {
  const { lookup, now } = input;
  const blocks = input.blocks.filter((b) => !b.cancelled);
  const sessions = blocks.filter((b) => b.source === 'session');
  const nowIso = new Date(now).toISOString();
  const whole: Array<Omit<CalItem, 'day' | 'start' | 'end'>> = [];

  for (const b of blocks) {
    const base = {
      key: b.id,
      startAt: b.startAt,
      endAt: b.endAt,
      nodeId: b.nodeId,
      block: b,
      proposalKey: null,
    };
    if (isImported(b.source)) {
      whole.push({ ...base, kind: 'commitment', title: b.title ?? 'Busy', sub: null, color: null });
      continue;
    }
    // A routine session has no task; its block carries the routine's name.
    const title = lookup.title(b.nodeId) ?? b.title ?? 'Study';
    let kind: CalKind = b.source === 'session' ? 'session' : 'planned';
    if (b.source === 'app') {
      // Kept the way the app counts it: a session on the same task inside the block's time.
      if (sessions.some((s) => s.nodeId === b.nodeId && overlaps(s, b))) kind = 'kept';
      else if (Date.parse(b.endAt) <= now) kind = 'missed';
    }
    whole.push({
      ...base,
      kind,
      title,
      sub: lookup.sub(b.nodeId),
      color: lookup.color(b.nodeId),
    });
  }
  for (const p of input.proposals)
    whole.push({
      key: `proposal-${p.key}`,
      kind: 'proposal',
      startAt: p.startAt,
      endAt: p.endAt,
      title: lookup.title(p.nodeId) ?? 'Study',
      sub: lookup.sub(p.nodeId),
      color: lookup.color(p.nodeId),
      nodeId: p.nodeId,
      block: null,
      proposalKey: p.key,
    });
  if (input.live && Date.parse(input.live.startAt) < now)
    whole.push({
      key: 'live',
      kind: 'live',
      startAt: input.live.startAt,
      endAt: nowIso,
      title: input.live.title,
      sub: lookup.sub(input.live.nodeId),
      color: lookup.color(input.live.nodeId),
      nodeId: input.live.nodeId,
      block: null,
      proposalKey: null,
    });

  const tz = localTz();
  const out = new Map<string, CalItem[]>(days.map((d) => [d, []]));
  for (const item of whole) {
    const first = toLocalDate(item.startAt, tz);
    const last = toLocalDate(new Date(Date.parse(item.endAt) - 1), tz);
    for (const d of days) {
      if (d < first || d > last) continue;
      const start = minutesOf(item.startAt, d);
      const end = minutesOf(item.endAt, d);
      if (end > start) out.get(d)!.push({ ...item, day: d, start, end });
    }
  }
  return out;
}

/** Busy intervals from a connected calendar, per day, in wall-clock minutes. */
export function busyByDay(
  days: string[],
  busy: Array<{ start: string; end: string }>,
): Map<string, Array<{ start: number; end: number }>> {
  return new Map(
    days.map((d) => [
      d,
      busy
        .map((b) => ({ start: minutesOf(b.start, d), end: minutesOf(b.end, d) }))
        .filter((b) => b.end > b.start),
    ]),
  );
}

/* ---------- deadlines and rest days ---------- */

export interface Deadline {
  node: StudyNode;
  day: string;
  course: string | null;
  color: string | null;
  done: boolean;
  assessment: boolean;
}

/** Tasks and assessments due on each day, as set on the task. Courses are headings, not due. */
export function deadlinesByDay(
  nodes: StudyNode[],
  lookup: NodeLookup,
  from: string,
  to: string,
): Map<string, Deadline[]> {
  const tz = localTz();
  const out = new Map<string, Deadline[]>();
  for (const n of nodes) {
    if (n.archived || !n.dueAt || n.kind === 'course') continue;
    const day = toLocalDate(n.dueAt, tz);
    if (day < from || day > to) continue;
    if (!out.has(day)) out.set(day, []);
    out.get(day)!.push({
      node: n,
      day,
      course: lookup.sub(n.id),
      color: lookup.color(n.id),
      done: Boolean(n.completedAt),
      assessment: n.kind === 'assessment',
    });
  }
  for (const list of out.values())
    list.sort(
      (a, b) =>
        Number(a.done) - Number(b.done) || Date.parse(a.node.dueAt!) - Date.parse(b.node.dueAt!),
    );
  return out;
}

export function restByDay(policy: RestDayPolicy | null, days: string[]): Map<string, RestReason> {
  return new Map(days.map((d) => [d, policy ? restReason(policy, d) : null]));
}

export function restLabel(reason: RestReason): string | null {
  if (reason === 'vacation') return 'Time off';
  if (reason === 'weekly' || reason === 'break') return 'Rest day';
  return null;
}

/* ---------- totals ---------- */

/** Time set aside and time studied between two days, inclusive. */
export function totals(blocks: PlannedBlock[], from: string, to: string) {
  const a = Date.parse(isoAt(from, 0));
  const z = Date.parse(isoAt(addDays(to, 1), 0));
  let planned = 0;
  let studied = 0;
  for (const b of blocks) {
    if (b.cancelled) continue;
    const s = Math.max(a, Date.parse(b.startAt));
    const e = Math.min(z, Date.parse(b.endAt));
    if (e <= s) continue;
    if (b.source === 'app') planned += (e - s) / 60_000;
    if (b.source === 'session') studied += (e - s) / 60_000;
  }
  return { planned, studied };
}

/** Minutes each day was planned and studied, for the month view. */
export function minutesByDay(blocks: PlannedBlock[], days: string[]) {
  return new Map(days.map((d) => [d, totals(blocks, d, d)]));
}

/* ---------- what still wants time ---------- */

export interface TrayItem {
  key: string;
  kind: 'task' | 'plan';
  nodeId: string;
  title: string;
  sub: string | null;
  color: string | null;
  /** Minutes still to set aside in the window. Zero once it is covered. */
  need: number;
  /** Minutes already set aside in the window, still ahead. */
  planned: number;
  /** No block for it should end after this. */
  deadline: string | null;
  dueDay: string | null;
  /** How long one block for it should be. */
  blockMinutes: number;
}

/**
 * What wants time set aside in a window of days, from now on.
 *
 * A task gets its fair share of the window: the minutes per study day its pace asks for,
 * times the study days in the window before it is due, less what is already planned there,
 * and never more than is left on it. A study plan gets what is left of its weekly budget.
 * Something already covered stays listed with nothing to add, so the list shows the win.
 */
export function trayItems(input: {
  nodes: StudyNode[];
  lookup: NodeLookup;
  pace: { plan: PlanItem[]; plannedMinutes: Record<string, number> };
  plans: PlanSummary[];
  blocks: PlannedBlock[];
  policy: RestDayPolicy | null;
  today: string;
  from: string;
  to: string;
  now: number;
}): TrayItem[] {
  const { lookup, today, now } = input;
  const from = input.from > today ? input.from : today;
  const to = input.to;
  if (from > to) return [];
  const winStart = Math.max(now, Date.parse(isoAt(from, 0)));
  const winEnd = Date.parse(isoAt(addDays(to, 1), 0));
  const tz = localTz();
  const studyDays = (until: string) =>
    dayRange(from, until < to ? until : to).filter(
      (d) => !input.policy || !isRestDay(input.policy, d),
    ).length;
  const plannedIn = (ids: Set<string>) =>
    input.blocks.reduce((sum, b) => {
      if (b.cancelled || b.source !== 'app' || !b.nodeId || !ids.has(b.nodeId)) return sum;
      const s = Math.max(winStart, Date.parse(b.startAt));
      const e = Math.min(winEnd, Date.parse(b.endAt));
      return e > s ? sum + (e - s) / 60_000 : sum;
    }, 0);

  const planIds = new Set(input.plans.map((p) => p.plan.id));
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const out: TrayItem[] = [];

  for (const item of input.pace.plan) {
    const node = byId.get(item.nodeId);
    if (!node || node.archived || (node.parentId && planIds.has(node.parentId))) continue;
    if (item.requiredPerDay === null || !node.dueAt) continue;
    const dueDay = toLocalDate(node.dueAt, tz);
    const toPlan = item.remainingMinutes - (input.pace.plannedMinutes[item.nodeId] ?? 0);
    const planned = plannedIn(new Set([item.nodeId]));
    const share = dueDay < from ? toPlan : item.requiredPerDay * Math.max(1, studyDays(dueDay));
    const need = floor15(Math.min(toPlan, share - planned));
    if (need < 15 && planned <= 0) continue;
    out.push({
      key: `task-${item.nodeId}`,
      kind: 'task',
      nodeId: item.nodeId,
      title: node.title,
      sub: lookup.sub(item.nodeId),
      color: lookup.color(item.nodeId),
      need: need >= 15 ? need : 0,
      planned,
      // A past due date is kept: the planner takes it as the most urgent.
      deadline: node.dueAt,
      dueDay,
      blockMinutes: Math.min(120, Math.max(45, snap(item.suggestedMinutes))),
    });
  }
  out.sort((a, b) => (a.dueDay ?? '9').localeCompare(b.dueDay ?? '9'));

  const thisWeek = input.from <= today && today <= to;
  for (const s of input.plans) {
    if (s.pacing.status === 'done' || !s.upNext) continue;
    const topics = new Set(input.nodes.filter((n) => n.parentId === s.plan.id).map((n) => n.id));
    const planned = plannedIn(topics);
    const logged = thisWeek ? s.pacing.thisWeekMinutes : 0;
    const toPlan = s.pacing.remainingMinutes - (input.pace.plannedMinutes[s.plan.id] ?? 0);
    const need = floor15(Math.min(toPlan, s.plan.weeklyMinutes - logged - planned));
    if (need < 15 && planned <= 0) continue;
    const target = s.plan.targetDate ? isoAt(addDays(s.plan.targetDate, 1), 0) : null;
    out.push({
      key: `plan-${s.plan.id}`,
      kind: 'plan',
      nodeId: s.upNext.id,
      title: s.plan.title,
      sub: `${s.upNext.title} next`,
      color: s.color ?? lookup.color(s.plan.id),
      need: need >= 15 ? need : 0,
      planned,
      deadline: target && Date.parse(target) > now ? target : null,
      dueDay: s.plan.targetDate,
      blockMinutes: 60,
    });
  }
  return out;
}
