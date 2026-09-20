import { addDays, toLocalDate } from './dates';
import { computePaceFromIndex, type NodePace, type PaceContext } from './pace';
import { countedEditsInMonth } from './rest-day-changes';
import { buildIndex, descendantIds, type NodeIndex } from './tree';
import type {
  ISODate,
  PlannedBlock,
  RestDayPolicy,
  Session,
  StreakState,
  StudyNode,
} from './types';

/** Advanced analytics (spec §11b): everything, shown neutrally. */

export interface NodeAnalytics {
  nodeId: string;
  title: string;
  kind: StudyNode['kind'];
  pace: NodePace | null;
  /** Future, non-cancelled planned minutes for this node. */
  plannedMinutes: number;
  neededMinutes: number | null;
  sessions: Session[];
  /** Prepared ratings over time (assessments). */
  preparedness: Array<{ at: string; value: number }>;
  /** Share of answered sessions reporting any distraction, 0..1, or null if none answered. */
  distractionRate: number | null;
  outcomeRating: number | null;
}

export interface CourseAnalytics {
  courseId: string;
  title: string;
  /** Minutes per child this week and last week. */
  children: Array<{ nodeId: string; title: string; thisWeek: number; lastWeek: number }>;
  thisWeekTotal: number;
  lastWeekTotal: number;
}

export interface EstimateAccuracy {
  samples: Array<{ nodeId: string; title: string; kind: StudyNode['kind']; ratio: number }>;
  /** Median logged/estimated per kind, only for kinds with >= 2 samples. */
  byKind: Array<{ kind: StudyNode['kind']; median: number; count: number }>;
  insight: string | null;
}

export interface WeeklyReview {
  weekStart: ISODate;
  weekEnd: ISODate;
  plannedMinutes: number;
  actualMinutes: number;
  sessions: number;
  streak: StreakState;
  freezesUsed: number;
  /** Days with the most 'a-lot' answers, best first. */
  topDistractionDays: Array<{ date: ISODate; count: number }>;
  restDayEditsThisMonth: number;
  hoursByDay: Array<{ date: ISODate; minutes: number }>;
}

export interface AnalyticsInput {
  nodes: StudyNode[];
  sessions: Session[];
  plannedBlocks: PlannedBlock[];
  ctx: PaceContext;
}

function sessionsInWeek(sessions: Session[], weekStart: ISODate, tz: string): Session[] {
  const end = addDays(weekStart, 6);
  return sessions.filter((s) => {
    const d = toLocalDate(s.startedAt, tz);
    return d >= weekStart && d <= end;
  });
}

const work = (ss: Session[]) => ss.reduce((a, s) => a + s.workSeconds / 60, 0);

export function nodeAnalytics(input: AnalyticsInput, nodeId: string): NodeAnalytics | null {
  const index = buildIndex(input.nodes, input.sessions);
  const node = index.byId.get(nodeId);
  if (!node) return null;
  const paces = computePaceFromIndex(index, input.ctx);
  const pace = paces.get(nodeId) ?? null;
  const ids = new Set([nodeId, ...descendantIds(index, nodeId)]);
  const sessions = input.sessions
    .filter((s) => ids.has(s.nodeId) && s.endedAt)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const nowMs = Date.parse(input.ctx.now);
  const plannedMinutes = input.plannedBlocks
    .filter((b) => b.nodeId && ids.has(b.nodeId) && !b.cancelled && Date.parse(b.endAt) > nowMs)
    .reduce((a, b) => a + (Date.parse(b.endAt) - Date.parse(b.startAt)) / 60_000, 0);
  const answered = sessions.filter(
    (s) => s.review && !s.review.skipped && s.review.distracted !== null,
  );
  const preparedness = [...sessions]
    .reverse()
    .filter((s) => s.review && !s.review.skipped && s.review.prepared != null)
    .map((s) => ({ at: s.startedAt, value: s.review!.prepared! }));
  return {
    nodeId,
    title: node.title,
    kind: node.kind,
    pace,
    plannedMinutes,
    neededMinutes: pace?.remainingMinutes ?? null,
    sessions,
    preparedness,
    distractionRate: answered.length
      ? answered.filter((s) => s.review!.distracted !== 'no').length / answered.length
      : null,
    outcomeRating: node.outcomeRating,
  };
}

export function courseAnalytics(input: AnalyticsInput, weekStart: ISODate): CourseAnalytics[] {
  const index: NodeIndex = buildIndex(input.nodes, input.sessions);
  const tz = input.ctx.timezone;
  const thisWeek = sessionsInWeek(input.sessions, weekStart, tz);
  const lastWeek = sessionsInWeek(input.sessions, addDays(weekStart, -7), tz);
  return index.roots.map((course) => {
    const kids = index.childrenOf.get(course.id) ?? [];
    const children = kids.map((k) => {
      const ids = new Set([k.id, ...descendantIds(index, k.id)]);
      return {
        nodeId: k.id,
        title: k.title,
        thisWeek: work(thisWeek.filter((s) => ids.has(s.nodeId))),
        lastWeek: work(lastWeek.filter((s) => ids.has(s.nodeId))),
      };
    });
    const own = {
      nodeId: course.id,
      title: course.title,
      thisWeek: work(thisWeek.filter((s) => s.nodeId === course.id)),
      lastWeek: work(lastWeek.filter((s) => s.nodeId === course.id)),
    };
    const all =
      own.thisWeek + own.lastWeek > 0
        ? [...children, { ...own, title: `${course.title} (direct)` }]
        : children;
    return {
      courseId: course.id,
      title: course.title,
      children: all,
      thisWeekTotal: all.reduce((a, c) => a + c.thisWeek, 0),
      lastWeekTotal: all.reduce((a, c) => a + c.lastWeek, 0),
    };
  });
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const KIND_WORD: Record<StudyNode['kind'], string> = {
  task: 'homework',
  assessment: 'assessment prep',
  course: 'courses',
  other: 'other work',
};

export function estimateAccuracy(input: AnalyticsInput): EstimateAccuracy {
  const index = buildIndex(input.nodes, input.sessions);
  const paces = computePaceFromIndex(index, input.ctx);
  const samples: EstimateAccuracy['samples'] = [];
  for (const n of input.nodes) {
    if (!n.completedAt || !n.estimatedMinutes || n.archived) continue;
    const p = paces.get(n.id);
    if (!p || p.aggregated) continue;
    samples.push({
      nodeId: n.id,
      title: n.title,
      kind: n.kind,
      ratio: p.loggedWorkMinutes / n.estimatedMinutes,
    });
  }
  const byKind: EstimateAccuracy['byKind'] = [];
  for (const kind of ['task', 'assessment', 'other', 'course'] as const) {
    const xs = samples.filter((s) => s.kind === kind).map((s) => s.ratio);
    if (xs.length >= 2) byKind.push({ kind, median: median(xs), count: xs.length });
  }
  let insight: string | null = null;
  const worst = [...byKind].sort((a, b) => Math.abs(b.median - 1) - Math.abs(a.median - 1))[0];
  if (worst && Math.abs(worst.median - 1) >= 0.1) {
    const pct = Math.round(Math.abs(worst.median - 1) * 100);
    insight =
      worst.median > 1
        ? `You typically underestimate ${KIND_WORD[worst.kind]} by ~${pct}%`
        : `You typically overestimate ${KIND_WORD[worst.kind]} by ~${pct}%`;
  } else if (byKind.length > 0) {
    insight = 'Your estimates are close to actual time. Keep estimating the same way.';
  }
  return { samples, byKind, insight };
}

export interface WeeklyReviewInput extends AnalyticsInput {
  weekStart: ISODate;
  streak: StreakState;
  /** Dates (user tz) on which a freeze was consumed, from the API's streak event log. */
  freezeDates: ISODate[];
  policy: RestDayPolicy;
}

export function weeklyReview(input: WeeklyReviewInput): WeeklyReview {
  const tz = input.ctx.timezone;
  const weekEnd = addDays(input.weekStart, 6);
  const sessions = sessionsInWeek(input.sessions, input.weekStart, tz).filter((s) => s.endedAt);
  const planned = input.plannedBlocks
    .filter((b) => !b.cancelled)
    .filter((b) => {
      const d = toLocalDate(b.startAt, tz);
      return d >= input.weekStart && d <= weekEnd;
    })
    .reduce((a, b) => a + (Date.parse(b.endAt) - Date.parse(b.startAt)) / 60_000, 0);
  const byDay = new Map<ISODate, number>();
  const distracted = new Map<ISODate, number>();
  for (let i = 0; i < 7; i++) byDay.set(addDays(input.weekStart, i), 0);
  for (const s of sessions) {
    const d = toLocalDate(s.startedAt, tz);
    byDay.set(d, (byDay.get(d) ?? 0) + s.workSeconds / 60);
    if (s.review && !s.review.skipped && s.review.distracted === 'a-lot')
      distracted.set(d, (distracted.get(d) ?? 0) + 1);
  }
  return {
    weekStart: input.weekStart,
    weekEnd,
    plannedMinutes: planned,
    actualMinutes: work(sessions),
    sessions: sessions.length,
    streak: input.streak,
    freezesUsed: input.freezeDates.filter((d) => d >= input.weekStart && d <= weekEnd).length,
    topDistractionDays: [...distracted.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => b.count - a.count || (a.date < b.date ? -1 : 1))
      .slice(0, 3),
    restDayEditsThisMonth: countedEditsInMonth(input.policy, input.weekStart.slice(0, 7), tz),
    hoursByDay: [...byDay.entries()].map(([date, minutes]) => ({ date, minutes })),
  };
}

/** Assessments whose due date passed at least a day ago and were never asked about. */
export function pendingFollowUps(nodes: StudyNode[], now: string, tz: string): StudyNode[] {
  const today = toLocalDate(now, tz);
  return nodes.filter((n) => {
    if (n.archived || n.kind !== 'assessment' || !n.dueAt || n.outcomeRating !== null) return false;
    return addDays(toLocalDate(n.dueAt, tz), 1) <= today;
  });
}
