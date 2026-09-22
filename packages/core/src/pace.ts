import { addDays, diffDays, toLocalDate } from './dates';
import { isRestDay } from './rest-days';
import { buildIndex, childrenOf, sessionsForSubtree, type NodeIndex } from './tree';
import type { ISODate, ISODateTime, PaceStatus, RestDayPolicy, Session, StudyNode } from './types';

/** Tunable pace constants (spec §3). */
export const PACE = {
  /** 'behind' when requiredPerDay exceeds this multiple of the 7-day average. */
  BEHIND_MULTIPLIER: 1.25,
  /** ...and the deadline is this close or closer (in study days). */
  BEHIND_WINDOW_DAYS: 3,
  /** Window for the recent-average calculation. */
  RECENT_DAYS: 7,
  /** Default suggestion for nodes with an estimate but no due date. */
  DEFAULT_SUGGESTED_MINUTES: 60,
  MIN_SUGGESTED_MINUTES: 5,
} as const;

export interface PaceContext {
  now: ISODateTime;
  timezone: string;
  policy: RestDayPolicy;
  maxComfortableMinutesPerDay: number;
}

export interface NodePace {
  nodeId: string;
  /** Work minutes on the node and all descendants. Only this counts toward progress. */
  loggedWorkMinutes: number;
  /** Work + break + idle: "time at desk", never progress. */
  cumulativeMinutes: number;
  estimatedMinutes: number | null;
  remainingMinutes: number | null;
  /** 0..1 capped, for the bar. */
  progress: number | null;
  /** Uncapped logged / estimated, for analytics. */
  rawProgress: number | null;
  dueDate: ISODate | null;
  studyDaysRemaining: number | null;
  requiredPerDay: number | null;
  /** Average work minutes per study day over the recent window. */
  avgPerStudyDayRecent: number;
  status: PaceStatus;
  /** True when the values were rolled up from children because the node has no estimate of its own. */
  aggregated: boolean;
  /** Direct children that carry an estimate, whether or not they set this node's numbers. */
  contributingChildren: string[];
}

const SEVERITY: Record<PaceStatus, number> = {
  overdue: 5,
  critical: 4,
  behind: 3,
  'on-track': 2,
  'no-estimate': 1,
  done: 0,
};

export function worstStatus(statuses: PaceStatus[]): PaceStatus {
  let worst: PaceStatus = 'done';
  for (const s of statuses) if (SEVERITY[s] > SEVERITY[worst]) worst = s;
  return worst;
}

/**
 * True when the node's numbers cover work that children account for separately - either
 * rolled up from them, or its own estimate broken down by them. Callers that want one row
 * per piece of work (the daily plan, estimate accuracy, weekly highlights) skip these, or
 * they would count the same hours twice.
 */
export function standsInForChildren(p: NodePace): boolean {
  return p.aggregated || p.contributingChildren.length > 0;
}

/**
 * Days from `today` through the day before `dueDate`, excluding rest days
 * (weekly, vacation, break). Today is excluded if it is a rest day.
 */
export function studyDaysRemaining(
  today: ISODate,
  dueDate: ISODate,
  policy: RestDayPolicy,
): number {
  const span = diffDays(today, dueDate);
  if (span <= 0) return 0;
  let count = 0;
  for (let i = 0; i < span; i++) {
    const d = addDays(today, i);
    if (!isRestDay(policy, d)) count++;
  }
  return count;
}

function sumWork(sessions: Session[]): number {
  let s = 0;
  for (const x of sessions) s += x.workSeconds;
  return s / 60;
}

function sumCumulative(sessions: Session[]): number {
  let s = 0;
  for (const x of sessions) s += x.workSeconds + x.breakSeconds + x.idleSeconds;
  return s / 60;
}

/** Average work minutes per non-rest day across the last RECENT_DAYS days ending today. */
export function recentAveragePerStudyDay(
  sessions: Session[],
  today: ISODate,
  ctx: PaceContext,
): number {
  const from = addDays(today, -(PACE.RECENT_DAYS - 1));
  let work = 0;
  for (const s of sessions) {
    const d = toLocalDate(s.startedAt, ctx.timezone);
    if (d >= from && d <= today) work += s.workSeconds / 60;
  }
  let studyDays = 0;
  for (let i = 0; i < PACE.RECENT_DAYS; i++) {
    if (!isRestDay(ctx.policy, addDays(from, i))) studyDays++;
  }
  return work / Math.max(studyDays, 1);
}

function leafPace(node: StudyNode, index: NodeIndex, ctx: PaceContext): NodePace {
  const today = toLocalDate(ctx.now, ctx.timezone);
  const sessions = sessionsForSubtree(index, node.id);
  const loggedWorkMinutes = sumWork(sessions);
  const cumulativeMinutes = sumCumulative(sessions);
  const estimatedMinutes = node.estimatedMinutes;
  const dueDate = node.dueAt ? toLocalDate(node.dueAt, ctx.timezone) : null;
  const avg = recentAveragePerStudyDay(sessions, today, ctx);
  const completed = node.completedAt !== null;
  const pastDue = node.dueAt !== null && Date.parse(node.dueAt) < Date.parse(ctx.now);

  if (estimatedMinutes === null) {
    return {
      nodeId: node.id,
      loggedWorkMinutes,
      cumulativeMinutes,
      estimatedMinutes: null,
      remainingMinutes: null,
      progress: null,
      rawProgress: null,
      dueDate,
      studyDaysRemaining: dueDate ? studyDaysRemaining(today, dueDate, ctx.policy) : null,
      requiredPerDay: null,
      avgPerStudyDayRecent: avg,
      status: completed ? 'done' : pastDue ? 'overdue' : 'no-estimate',
      aggregated: false,
      contributingChildren: [],
    };
  }

  const remainingMinutes = completed ? 0 : Math.max(0, estimatedMinutes - loggedWorkMinutes);
  const rawProgress = estimatedMinutes > 0 ? loggedWorkMinutes / estimatedMinutes : 1;
  const progress = completed ? 1 : Math.min(1, rawProgress);

  let days: number | null = null;
  let requiredPerDay: number | null = null;
  let status: PaceStatus;

  if (remainingMinutes === 0) {
    status = 'done';
    if (dueDate) days = studyDaysRemaining(today, dueDate, ctx.policy);
  } else if (dueDate === null) {
    status = 'on-track';
  } else {
    days = studyDaysRemaining(today, dueDate, ctx.policy);
    requiredPerDay = remainingMinutes / Math.max(days, 1);
    if (pastDue) status = 'overdue';
    else if (requiredPerDay > ctx.maxComfortableMinutesPerDay) status = 'critical';
    else if (requiredPerDay > PACE.BEHIND_MULTIPLIER * avg && days <= PACE.BEHIND_WINDOW_DAYS)
      status = 'behind';
    else status = 'on-track';
  }

  return {
    nodeId: node.id,
    loggedWorkMinutes,
    cumulativeMinutes,
    estimatedMinutes,
    remainingMinutes,
    progress,
    rawProgress,
    dueDate,
    studyDaysRemaining: days,
    requiredPerDay,
    avgPerStudyDayRecent: avg,
    status,
    aggregated: false,
    contributingChildren: [],
  };
}

/**
 * Pace for every non-archived node.
 *
 * A node's own estimate always wins: children are a breakdown of the parent's work, not a
 * replacement for it, so "16 h for Test 1" stays 16 h after one unit under it is estimated
 * at 1 h. Only a node with no estimate of its own is aggregated, and then from the sum of
 * its direct children's estimates against all the time logged in the subtree. A node with
 * neither has no percentage at all - just the hours logged (see DECISIONS.md).
 */
export function computePace(
  nodes: StudyNode[],
  sessions: Session[],
  ctx: PaceContext,
): Map<string, NodePace> {
  const index = buildIndex(nodes, sessions);
  return computePaceFromIndex(index, ctx);
}

export function computePaceFromIndex(index: NodeIndex, ctx: PaceContext): Map<string, NodePace> {
  const out = new Map<string, NodePace>();

  const visit = (node: StudyNode): NodePace => {
    const kids = childrenOf(index, node.id);
    const kidPaces = kids.map(visit);
    // A child contributes if it has an estimate of its own or rolled one up from its children.
    const contributing = kidPaces.filter((k) => k.estimatedMinutes !== null);
    const contributingChildren = contributing.map((k) => k.nodeId);
    const own = leafPace(node, index, ctx);

    if (own.estimatedMinutes !== null) {
      // The node's own estimate is authoritative. Children still colour the status, so a
      // unit that is overdue is not hidden by a parent whose own deadline is comfortable.
      const withKids: NodePace = {
        ...own,
        status: node.completedAt
          ? 'done'
          : worstStatus([own.status, ...contributing.map((k) => k.status)]),
        contributingChildren,
      };
      out.set(node.id, withKids);
      return withKids;
    }

    if (contributing.length === 0) {
      out.set(node.id, own);
      return own;
    }

    let remaining = 0;
    let estimated = 0;
    let required = 0;
    let anyRequired = false;
    for (const k of contributing) {
      remaining += k.remainingMinutes ?? 0;
      estimated += k.estimatedMinutes ?? 0;
      if (k.requiredPerDay !== null) {
        required += k.requiredPerDay;
        anyRequired = true;
      }
    }
    const status = node.completedAt ? 'done' : worstStatus(contributing.map((k) => k.status));
    const agg: NodePace = {
      ...own,
      estimatedMinutes: estimated,
      remainingMinutes: node.completedAt ? 0 : remaining,
      progress: estimated > 0 ? Math.min(1, own.loggedWorkMinutes / estimated) : null,
      rawProgress: estimated > 0 ? own.loggedWorkMinutes / estimated : null,
      requiredPerDay: anyRequired ? required : null,
      studyDaysRemaining: own.studyDaysRemaining,
      status,
      aggregated: true,
      contributingChildren,
    };
    out.set(node.id, agg);
    return agg;
  };

  for (const root of index.roots) visit(root);
  return out;
}

export interface PlanItem {
  nodeId: string;
  title: string;
  status: PaceStatus;
  remainingMinutes: number;
  requiredPerDay: number | null;
  suggestedMinutes: number;
  dueDate: ISODate | null;
  /** requiredPerDay / remaining, i.e. 1 / studyDaysRemaining. Higher is more urgent. */
  urgency: number;
}

function roundUp5(n: number): number {
  return Math.ceil(n / 5) * 5;
}

/**
 * Ordered list of what to work on today. Leaves with an estimate and remaining work,
 * sorted by urgency, with a suggested number of minutes each. Drives the
 * "suggested next session" card.
 */
export function getDailyPlan(
  nodes: StudyNode[],
  sessions: Session[],
  ctx: PaceContext,
): PlanItem[] {
  const index = buildIndex(nodes, sessions);
  const paces = computePaceFromIndex(index, ctx);
  const items: PlanItem[] = [];
  for (const [id, p] of paces) {
    if (standsInForChildren(p)) continue;
    if (p.estimatedMinutes === null || p.remainingMinutes === null) continue;
    if (p.status === 'done' || p.remainingMinutes <= 0) continue;
    const node = index.byId.get(id)!;
    const urgency =
      p.requiredPerDay !== null && p.remainingMinutes > 0
        ? p.requiredPerDay / p.remainingMinutes
        : 0;
    const wanted = p.requiredPerDay ?? PACE.DEFAULT_SUGGESTED_MINUTES;
    const suggestedMinutes = Math.max(
      PACE.MIN_SUGGESTED_MINUTES,
      Math.min(roundUp5(wanted), Math.ceil(p.remainingMinutes), ctx.maxComfortableMinutesPerDay),
    );
    items.push({
      nodeId: id,
      title: node.title,
      status: p.status,
      remainingMinutes: p.remainingMinutes,
      requiredPerDay: p.requiredPerDay,
      suggestedMinutes,
      dueDate: p.dueDate,
      urgency,
    });
  }
  items.sort((a, b) => {
    const ao = a.status === 'overdue' ? 1 : 0;
    const bo = b.status === 'overdue' ? 1 : 0;
    if (ao !== bo) return bo - ao;
    if (b.urgency !== a.urgency) return b.urgency - a.urgency;
    if (a.dueDate !== b.dueDate) {
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  });
  return items;
}
