import { addDays, dayOfWeek, diffDays, toLocalDate } from './dates';
import { HIGHLIGHT_FALLBACK, HIGHLIGHT_THRESHOLDS as T } from './highlights-thresholds';
import { computePace, type PaceContext } from './pace';
import type {
  ISODate,
  ISODateTime,
  PlannedBlock,
  RestDayPolicy,
  Session,
  StreakState,
  StudyNode,
} from './types';

export type HighlightKey =
  | 'hours-total'
  | 'hours-up'
  | 'sessions-up'
  | 'throughput-up'
  | 'accuracy-up'
  | 'mood-up'
  | 'preparedness-up'
  | 'focus-streak'
  | 'distraction-down'
  | 'tasks-all-done'
  | 'tasks-done-count'
  | 'goal-progress'
  | 'on-pace'
  | 'planned-kept'
  | 'estimate-beat'
  | 'streak'
  | 'best-day'
  | 'early-finish'
  | 'xp-week';

export interface Highlight {
  key: HighlightKey;
  headline: string;
  detail: string;
  /** 0..1, used to order cards. */
  magnitude: number;
}

export interface HighlightsInput {
  nodes: StudyNode[];
  /** All completed sessions (history is needed for baselines and records). */
  sessions: Session[];
  plannedBlocks: PlannedBlock[];
  streak: StreakState;
  timezone: string;
  policy: RestDayPolicy;
  maxComfortableMinutesPerDay: number;
  now: ISODateTime;
  /** Monday of the week to report on (user tz). */
  weekStart: ISODate;
}

export interface HighlightsResult {
  highlights: Highlight[];
  /** Shown when nothing qualifies. Never an empty panel, never a fake stat. */
  fallback: string | null;
  weekStart: ISODate;
  weekEnd: ISODate;
}

/* ---------- helpers ---------- */

export function fmtHoursWord(minutes: number): string {
  const h = minutes / 60;
  const rounded = Math.round(h * 10) / 10;
  const n = rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1);
  return `${n} hour${rounded === 1 ? '' : 's'}`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const workMin = (s: Session) => s.workSeconds / 60;
const answered = (s: Session) => s.review && !s.review.skipped && s.review.distracted !== null;
const distracted = (s: Session) => answered(s) && s.review!.distracted !== 'no';

function dayOf(s: Session, tz: string): ISODate {
  return toLocalDate(s.startedAt, tz);
}

function inRange(d: ISODate, from: ISODate, to: ISODate): boolean {
  return d >= from && d <= to;
}

/** Sessions ordered by start; every helper walks the same order. */
function sorted(sessions: Session[]): Session[] {
  return [...sessions]
    .filter((s) => s.endedAt !== null)
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
}

/** Previous session on the same node (strictly before `s`) that satisfies `pred`. */
function previousOnNode(all: Session[], s: Session, pred: (x: Session) => boolean): Session | null {
  for (let i = all.indexOf(s) - 1; i >= 0; i--) {
    const x = all[i]!;
    if (x.nodeId === s.nodeId && pred(x)) return x;
  }
  return null;
}

function titleOf(nodes: StudyNode[], id: string): string {
  return nodes.find((n) => n.id === id)?.title ?? 'a task';
}

/* ---------- engine ---------- */

export function getHighlights(input: HighlightsInput): HighlightsResult {
  const { nodes, timezone: tz, weekStart } = input;
  const weekEnd = addDays(weekStart, 6);
  const lastStart = addDays(weekStart, -7);
  const lastEnd = addDays(weekStart, -1);
  const all = sorted(input.sessions);
  const thisWeek = all.filter((s) => inRange(dayOf(s, tz), weekStart, weekEnd));
  const lastWeek = all.filter((s) => inRange(dayOf(s, tz), lastStart, lastEnd));
  const before = all.filter((s) => dayOf(s, tz) < weekStart);
  const out: Highlight[] = [];
  const push = (h: Highlight) =>
    out.push({ ...h, magnitude: Math.max(0, Math.min(1, h.magnitude)) });

  const thisWork = thisWeek.reduce((a, s) => a + workMin(s), 0);
  const lastWork = lastWeek.reduce((a, s) => a + workMin(s), 0);

  // hours-total (anchor)
  if (thisWork > 0) {
    push({
      key: 'hours-total',
      headline: `You studied ${fmtHoursWord(thisWork)} this week`,
      detail: `${thisWeek.length} session${thisWeek.length === 1 ? '' : 's'}`,
      magnitude: 1,
    });
  }

  // hours-up
  if (lastWeek.length >= 1 && lastWork > 0 && thisWork >= lastWork * T.HOURS_UP_RATIO) {
    push({
      key: 'hours-up',
      headline: `${fmtHoursWord(thisWork - lastWork)} more than last week`,
      detail: `${fmtHoursWord(thisWork)} vs ${fmtHoursWord(lastWork)}`,
      magnitude: (thisWork - lastWork) / lastWork,
    });
  }

  // sessions-up
  if (lastWeek.length >= 1 && thisWeek.length >= lastWeek.length + T.SESSIONS_UP_DELTA) {
    push({
      key: 'sessions-up',
      headline: `You showed up ${thisWeek.length} times, up from ${lastWeek.length}`,
      detail: 'Sessions this week vs last week',
      magnitude: (thisWeek.length - lastWeek.length) / 4,
    });
  }

  // throughput-up, accuracy-up, mood-up, preparedness-up: latest qualifying session per node this week.
  const seenNode = new Set<string>();
  for (let i = thisWeek.length - 1; i >= 0; i--) {
    const s = thisWeek[i]!;
    if (seenNode.has(s.nodeId)) continue;
    seenNode.add(s.nodeId);
    const r = s.review;
    if (!r || r.skipped) continue;
    const title = titleOf(nodes, s.nodeId);

    if (r.completedCount && r.completedCount > 0 && s.workSeconds > 0) {
      const prev = previousOnNode(
        all,
        s,
        (x) => !!x.review && !x.review.skipped && !!x.review.completedCount && x.workSeconds > 0,
      );
      if (prev) {
        const rate = r.completedCount / (s.workSeconds / 600);
        const prevRate = prev.review!.completedCount! / (prev.workSeconds / 600);
        if (prevRate > 0 && rate >= prevRate * T.THROUGHPUT_UP_RATIO) {
          const node = nodes.find((n) => n.id === s.nodeId);
          const unit =
            node?.countUnit === 'custom'
              ? node.countUnitLabel || 'items'
              : (node?.countUnit ?? 'items');
          push({
            key: 'throughput-up',
            headline: `${rate.toFixed(1)} ${unit} per 10 min, up from ${prevRate.toFixed(1)}, on ${title}`,
            detail: 'Compared with your previous session on it',
            magnitude: rate / prevRate - 1,
          });
        }
      }
    }

    if (
      r.completedCount != null &&
      r.correctCount != null &&
      r.completedCount >= T.ACCURACY_MIN_COMPLETED
    ) {
      const prev = previousOnNode(
        all,
        s,
        (x) =>
          !!x.review &&
          !x.review.skipped &&
          x.review.completedCount != null &&
          x.review.correctCount != null &&
          x.review.completedCount >= T.ACCURACY_MIN_COMPLETED,
      );
      if (prev) {
        const acc = (r.correctCount / r.completedCount) * 100;
        const prevAcc = (prev.review!.correctCount! / prev.review!.completedCount!) * 100;
        if (acc >= prevAcc + T.ACCURACY_UP_POINTS) {
          push({
            key: 'accuracy-up',
            headline: `${Math.round(acc)}% correct, up from ${Math.round(prevAcc)}%`,
            detail: `On ${title}`,
            magnitude: (acc - prevAcc) / 30,
          });
        }
      }
    }

    if (r.mood != null) {
      const prev = previousOnNode(
        all,
        s,
        (x) => !!x.review && !x.review.skipped && x.review.mood != null,
      );
      if (prev && r.mood >= prev.review!.mood! + T.MOOD_UP_DELTA) {
        push({
          key: 'mood-up',
          headline: 'You felt better after this session than the last one',
          detail: `On ${title}: ${prev.review!.mood} to ${r.mood}`,
          magnitude: (r.mood - prev.review!.mood!) / 4,
        });
      }
    }

    if (r.prepared != null) {
      const prev = previousOnNode(
        all,
        s,
        (x) => !!x.review && !x.review.skipped && x.review.prepared != null,
      );
      if (prev && r.prepared > prev.review!.prepared!) {
        push({
          key: 'preparedness-up',
          headline: `Preparedness for ${title} went ${prev.review!.prepared} to ${r.prepared}`,
          detail: 'Your own rating after each session',
          magnitude: (r.prepared - prev.review!.prepared!) / 4,
        });
      }
    }
  }

  // focus-streak: consecutive 'no' answers ending in the most recent answered session this week.
  {
    let n = 0;
    for (let i = all.length - 1; i >= 0; i--) {
      const s = all[i]!;
      if (!answered(s)) continue;
      if (s.review!.distracted === 'no') n++;
      else break;
    }
    const lastAnswered = [...thisWeek].reverse().find(answered);
    if (n >= T.FOCUS_STREAK_MIN && lastAnswered) {
      const words = ['', '', '', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
      push({
        key: 'focus-streak',
        headline: `${words[n] ?? n} focused sessions in a row`,
        detail: 'No distraction reported in any of them',
        magnitude: n / 6,
      });
    }
  }

  // distraction-down
  {
    const thisAns = thisWeek.filter(answered);
    const lastAns = lastWeek.filter(answered);
    if (thisAns.length >= 1 && lastAns.length >= 1) {
      const a = (thisAns.filter(distracted).length / thisAns.length) * 100;
      const b = (lastAns.filter(distracted).length / lastAns.length) * 100;
      if (a <= b - T.DISTRACTION_DOWN_POINTS) {
        push({
          key: 'distraction-down',
          headline: 'Fewer distracted sessions than last week',
          detail: `${Math.round(a)}% this week vs ${Math.round(b)}% last week`,
          magnitude: (b - a) / 50,
        });
      }
    }
  }

  // tasks-all-done / tasks-done-count
  const leaves = nodes.filter((n) => !n.archived && n.kind !== 'course');
  {
    const dueThisWeek = leaves.filter(
      (n) => n.dueAt && inRange(toLocalDate(n.dueAt, tz), weekStart, weekEnd),
    );
    const completedThisWeek = leaves.filter(
      (n) => n.completedAt && inRange(toLocalDate(n.completedAt, tz), weekStart, weekEnd),
    );
    if (dueThisWeek.length >= 1 && dueThisWeek.every((n) => n.completedAt)) {
      push({
        key: 'tasks-all-done',
        headline: 'You completed everything due this week',
        detail: `${dueThisWeek.length} item${dueThisWeek.length === 1 ? '' : 's'}`,
        magnitude: 0.9,
      });
    } else if (completedThisWeek.length >= 1) {
      push({
        key: 'tasks-done-count',
        headline: `${completedThisWeek.length} task${completedThisWeek.length === 1 ? '' : 's'} completed this week`,
        detail: completedThisWeek
          .map((n) => n.title)
          .slice(0, 3)
          .join(', '),
        magnitude: completedThisWeek.length / 5,
      });
    }
  }

  // pace now vs at week start
  const ctxNow: PaceContext = {
    now: input.now,
    timezone: tz,
    policy: input.policy,
    maxComfortableMinutesPerDay: input.maxComfortableMinutesPerDay,
  };
  const paceNow = computePace(nodes, all, ctxNow);
  {
    // goal-progress: most-progressed unfinished node with an estimate.
    let best: { title: string; progress: number } | null = null;
    for (const n of leaves) {
      const p = paceNow.get(n.id);
      if (!p || p.aggregated || p.progress == null || p.status === 'done' || n.completedAt)
        continue;
      if (p.progress > 0 && (!best || p.progress > best.progress))
        best = { title: n.title, progress: p.progress };
    }
    if (best) {
      push({
        key: 'goal-progress',
        headline: `You're ${Math.round((1 - best.progress) * 100)}% from finishing ${best.title}`,
        detail: `${Math.round(best.progress * 100)}% of the estimate logged`,
        magnitude: best.progress,
      });
    }
  }
  {
    const startInstant = `${weekStart}T12:00:00.000Z`;
    const paceStart = computePace(nodes, before, { ...ctxNow, now: startInstant });
    for (const n of leaves) {
      const a = paceStart.get(n.id);
      const b = paceNow.get(n.id);
      if (!a || !b || a.aggregated) continue;
      if ((a.status === 'behind' || a.status === 'critical') && b.status === 'on-track') {
        push({
          key: 'on-pace',
          headline: `${n.title} is back on track`,
          detail: `Was ${a.status} at the start of the week`,
          magnitude: 0.8,
        });
        break;
      }
    }
  }

  // planned-kept
  {
    const blocks = input.plannedBlocks.filter(
      (b) =>
        !b.cancelled &&
        b.nodeId &&
        inRange(toLocalDate(b.startAt, tz), weekStart, weekEnd) &&
        Date.parse(b.endAt) <= Date.parse(input.now),
    );
    if (blocks.length >= 1) {
      const kept = blocks.filter((b) =>
        all.some(
          (s) =>
            s.nodeId === b.nodeId &&
            Date.parse(s.startedAt) < Date.parse(b.endAt) &&
            Date.parse(s.endedAt!) > Date.parse(b.startAt),
        ),
      ).length;
      if (kept / blocks.length >= T.PLANNED_KEPT_RATIO) {
        push({
          key: 'planned-kept',
          headline: `You kept ${kept} of ${blocks.length} planned blocks`,
          detail: 'Studied during the time you set aside',
          magnitude: kept / blocks.length,
        });
      }
    }
  }

  // estimate-beat & early-finish
  for (const n of leaves) {
    if (!n.completedAt || !inRange(toLocalDate(n.completedAt, tz), weekStart, weekEnd)) continue;
    const p = paceNow.get(n.id);
    if (p && !p.aggregated && n.estimatedMinutes && p.loggedWorkMinutes < n.estimatedMinutes) {
      push({
        key: 'estimate-beat',
        headline: `Finished ${n.title} in ${fmtHoursWord(p.loggedWorkMinutes)}, estimated ${fmtHoursWord(n.estimatedMinutes)}`,
        detail: 'Under your own estimate',
        magnitude: (n.estimatedMinutes - p.loggedWorkMinutes) / n.estimatedMinutes,
      });
    }
    if (n.dueAt) {
      const days = diffDays(toLocalDate(n.completedAt, tz), toLocalDate(n.dueAt, tz));
      if (days >= T.EARLY_FINISH_DAYS) {
        push({
          key: 'early-finish',
          headline: `${n.title} done ${days === 2 ? 'two' : days} days early`,
          detail: 'Ahead of its due date',
          magnitude: days / 7,
        });
      }
    }
  }

  // streak
  if (input.streak.current >= T.STREAK_MIN) {
    const milestones = [7, 14, 30, 60, 100];
    const isMilestone = milestones.includes(input.streak.current);
    push({
      key: 'streak',
      headline: `${input.streak.current}-day streak`,
      detail: isMilestone ? 'A milestone' : `Longest so far: ${input.streak.longest}`,
      magnitude: Math.min(1, input.streak.current / 30) + (isMilestone ? 0.2 : 0),
    });
  }

  // best-day
  {
    const byDay = new Map<ISODate, number>();
    for (const s of all) byDay.set(dayOf(s, tz), (byDay.get(dayOf(s, tz)) ?? 0) + workMin(s));
    let record = 0;
    for (const [d, m] of byDay) if (d < weekStart) record = Math.max(record, m);
    let bestDay: ISODate | null = null;
    let bestMin = 0;
    for (const [d, m] of byDay) {
      if (inRange(d, weekStart, weekEnd) && m > bestMin) {
        bestMin = m;
        bestDay = d;
      }
    }
    if (record > 0 && bestDay && bestMin > record) {
      push({
        key: 'best-day',
        headline: `${DAY_NAMES[dayOfWeek(bestDay)]} was your biggest study day yet`,
        detail: `${fmtHoursWord(bestMin)}, previous record ${fmtHoursWord(record)}`,
        magnitude: 0.85,
      });
    }
  }

  // xp-week
  {
    const byWeek = new Map<ISODate, number>();
    for (const s of all) {
      const d = dayOf(s, tz);
      const monday = addDays(d, -((dayOfWeek(d) + 6) % 7));
      byWeek.set(monday, (byWeek.get(monday) ?? 0) + s.xpAwarded);
    }
    const thisXp = byWeek.get(weekStart) ?? 0;
    let prevBest = 0;
    let prevWeeks = 0;
    for (const [w, x] of byWeek) {
      if (w < weekStart) {
        prevWeeks++;
        prevBest = Math.max(prevBest, x);
      }
    }
    if (prevWeeks >= 1 && thisXp > prevBest) {
      push({
        key: 'xp-week',
        headline: "Most XP you've earned in a week",
        detail: `${thisXp} XP, previous best ${prevBest}`,
        magnitude: 0.7,
      });
    }
  }

  out.sort((a, b) => b.magnitude - a.magnitude || a.key.localeCompare(b.key));
  return {
    highlights: out,
    fallback: out.length === 0 ? HIGHLIGHT_FALLBACK : null,
    weekStart,
    weekEnd,
  };
}

/** Split into the top cards and the rest ("More wins"). */
export function splitHighlights(hs: Highlight[]): { top: Highlight[]; more: Highlight[] } {
  return { top: hs.slice(0, T.TOP_CARDS), more: hs.slice(T.TOP_CARDS) };
}
