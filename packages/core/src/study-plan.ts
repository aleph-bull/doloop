/**
 * Study plans: anything a user wants to learn, turned into ordered topics with planned
 * hours. A plan is a node (the topics are its children), so sessions, pace, streaks and
 * analytics treat it like any course. This module adds what a course does not have:
 * drill accuracy, mastery, the miss queue, and pacing against a weekly budget.
 */
import { addDays, diffDays, startOfWeekMonday } from './dates';
import type { ISODate, ISODateTime } from './types';

/** How a drilled question went: got it cold, got there with a wobble, or missed it. */
export type DrillResult = 'ok' | 'shaky' | 'miss';

export interface StudyPlan {
  /** The plan's node id. */
  id: string;
  userId: string;
  title: string;
  /** Hours the user means to give it a week, in minutes. */
  weeklyMinutes: number;
  /** The day the plan began, for "week 2 of 3". */
  startedOn: ISODate;
  /** The target end date (the node's due date), if there is one. */
  targetDate: ISODate | null;
  /** How each topic is worked, in the user's words: "warm up, cold drill, re-read misses". */
  method: string | null;
  /** Accuracy, 0..1, a practised topic needs before it counts as mastered. */
  masteryTarget: number;
  createdAt: ISODateTime;
}

export interface PlanTopic {
  /** The topic's node id. */
  id: string;
  planId: string;
  title: string;
  plannedMinutes: number;
  sortOrder: number;
  /** A book, a course module, a link: where the material is. */
  resource: string | null;
  /** True when the topic is drilled with questions and marked ✓ / shaky / ✗. */
  practice: boolean;
  completedAt: ISODateTime | null;
}

/** One drilling pass over a topic: how many came back right, shaky and missed. */
export interface DrillRound {
  id: string;
  topicId: string;
  sessionId: string | null;
  date: ISODate;
  ok: number;
  shaky: number;
  miss: number;
  createdAt: ISODateTime;
}

/** A question that got missed or wobbled, queued to come back. */
export interface DrillItem {
  id: string;
  topicId: string;
  prompt: string;
  lastResult: DrillResult;
  /** The day it is next due back. */
  dueOn: ISODate;
  /** Leitner box: 0 after a miss, up one per clean answer. Retired past the last box. */
  box: number;
  attempts: number;
  retired: boolean;
  createdAt: ISODateTime;
}

export const STUDY_PLAN = {
  DEFAULT_MASTERY: 0.85,
  /** Rounds that make up "recent accuracy". Two passes, so one lucky run is not mastery. */
  RECENT_ROUNDS: 2,
  /** Days until a queued item comes back, by box after a clean answer. */
  BOX_GAPS: [1, 3, 7] as readonly number[],
  /** Clean answers in a row from box 0 before an item leaves the queue. */
  RETIRE_AT_BOX: 3,
  /** Shaky counts as half right. */
  SHAKY_WEIGHT: 0.5,
  /** Pace inside this share of the budget still reads as on track. */
  ON_TRACK_SLACK: 1.1,
} as const;

export function roundTotal(r: Pick<DrillRound, 'ok' | 'shaky' | 'miss'>): number {
  return r.ok + r.shaky + r.miss;
}

/** Right answers over all answers, shaky counting half. Null for an empty round. */
export function roundAccuracy(r: Pick<DrillRound, 'ok' | 'shaky' | 'miss'>): number | null {
  const total = roundTotal(r);
  if (total === 0) return null;
  return (r.ok + r.shaky * STUDY_PLAN.SHAKY_WEIGHT) / total;
}

/** Accuracy over the most recent rounds, pooled by question, oldest rounds ignored. */
export function recentAccuracy(rounds: DrillRound[], n: number = STUDY_PLAN.RECENT_ROUNDS) {
  const recent = [...rounds].sort(byNewest).slice(0, n);
  return roundAccuracy({
    ok: sum(recent, (r) => r.ok),
    shaky: sum(recent, (r) => r.shaky),
    miss: sum(recent, (r) => r.miss),
  });
}

/**
 * Where a drilled question goes next. A miss or a wobble comes back tomorrow; a clean answer moves it up a box and further out, and from the last box it retires.
 */
export function scheduleItem(
  item: Pick<DrillItem, 'box' | 'attempts'>,
  result: DrillResult,
  today: ISODate,
): Pick<DrillItem, 'box' | 'dueOn' | 'lastResult' | 'attempts' | 'retired'> {
  const attempts = item.attempts + 1;
  if (result !== 'ok') {
    return { box: 0, dueOn: addDays(today, 1), lastResult: result, attempts, retired: false };
  }
  const box = item.box + 1;
  const gaps = STUDY_PLAN.BOX_GAPS;
  return {
    box,
    dueOn: addDays(today, gaps[Math.min(box, gaps.length) - 1]!),
    lastResult: result,
    attempts,
    retired: box >= STUDY_PLAN.RETIRE_AT_BOX,
  };
}

export function isDue(item: DrillItem, today: ISODate): boolean {
  return !item.retired && item.dueOn <= today;
}

export type TopicState = 'up-next' | 'not-started' | 'in-progress' | 'drilling' | 'mastered';

export interface TopicProgress {
  topic: PlanTopic;
  loggedMinutes: number;
  /** Logged over planned, uncapped. */
  hoursShare: number;
  rounds: number;
  /** Pooled accuracy of the last few rounds, null until drilled. */
  accuracy: number | null;
  /** Accuracy per round, oldest first, for the trend line. */
  accuracyTrend: number[];
  /** Items still in the queue (due now or later). */
  openItems: number;
  dueItems: number;
  /** Items whose last answer was a miss or a wobble: they hold mastery back until redone. */
  outstandingItems: number;
  /** A practised topic met the bar: two rounds at target, and every miss redone cleanly. */
  meetsMastery: boolean;
  state: TopicState;
}

export function topicProgress(
  topic: PlanTopic,
  loggedMinutes: number,
  rounds: DrillRound[],
  items: DrillItem[],
  masteryTarget: number,
  today: ISODate,
): Omit<TopicProgress, 'state'> & { state: Exclude<TopicState, 'up-next'> } {
  const mine = rounds.filter((r) => r.topicId === topic.id);
  const queue = items.filter((i) => i.topicId === topic.id && !i.retired);
  const accuracy = recentAccuracy(mine);
  const dueItems = queue.filter((i) => isDue(i, today)).length;
  const outstandingItems = queue.filter((i) => i.lastResult !== 'ok').length;
  const meetsMastery =
    topic.practice &&
    mine.length >= STUDY_PLAN.RECENT_ROUNDS &&
    accuracy !== null &&
    accuracy >= masteryTarget &&
    outstandingItems === 0;
  const trend = [...mine]
    .sort((a, b) => -byNewest(a, b))
    .map(roundAccuracy)
    .filter((x): x is number => x !== null);
  const state: Exclude<TopicState, 'up-next'> =
    topic.completedAt !== null
      ? 'mastered'
      : mine.length > 0
        ? 'drilling'
        : loggedMinutes > 0
          ? 'in-progress'
          : 'not-started';
  return {
    topic,
    loggedMinutes,
    hoursShare: topic.plannedMinutes > 0 ? loggedMinutes / topic.plannedMinutes : 0,
    rounds: mine.length,
    accuracy,
    accuracyTrend: trend,
    openItems: queue.length,
    dueItems,
    outstandingItems,
    meetsMastery,
    state,
  };
}

/** Topics in order with their progress, and the first unfinished one marked up next. */
export function planTopics(
  topics: PlanTopic[],
  loggedByTopic: Map<string, number>,
  rounds: DrillRound[],
  items: DrillItem[],
  masteryTarget: number,
  today: ISODate,
): TopicProgress[] {
  const sorted = [...topics].sort((a, b) => a.sortOrder - b.sortOrder);
  let nextMarked = false;
  return sorted.map((t) => {
    const p: TopicProgress = topicProgress(
      t,
      loggedByTopic.get(t.id) ?? 0,
      rounds,
      items,
      masteryTarget,
      today,
    );
    if (!nextMarked && p.state !== 'mastered') {
      nextMarked = true;
      // A topic already under way keeps its own state; "up next" is for a fresh start.
      if (p.state === 'not-started') p.state = 'up-next';
    }
    return p;
  });
}

export type PlanPaceStatus = 'done' | 'ahead' | 'on-track' | 'behind' | 'no-target';

export interface PlanPacing {
  plannedMinutes: number;
  loggedMinutes: number;
  /** Planned minutes of topics not yet mastered, less what they have logged. */
  remainingMinutes: number;
  topicsDone: number;
  topicsTotal: number;
  /** When the plan lands if the weekly budget holds from today. */
  projectedFinish: ISODate | null;
  targetDate: ISODate | null;
  /** What a week needs to be to land on the target date. */
  neededPerWeek: number | null;
  weeklyMinutes: number;
  thisWeekMinutes: number;
  /** 1-based week of the plan, and how many weeks the target allows. */
  week: number;
  weeksTotal: number | null;
  status: PlanPaceStatus;
}

/**
 * Pace against the weekly budget. The projection assumes the budget holds from today,
 * spread across the remaining days of the week as well as the weeks after.
 */
export function planPacing(input: {
  plan: Pick<StudyPlan, 'weeklyMinutes' | 'startedOn' | 'targetDate'>;
  topics: TopicProgress[];
  /** Plan work minutes by local day. */
  minutesByDay: Map<ISODate, number>;
  today: ISODate;
}): PlanPacing {
  const { plan, topics, minutesByDay, today } = input;
  const plannedMinutes = sum(topics, (t) => t.topic.plannedMinutes);
  const loggedMinutes = sum(topics, (t) => t.loggedMinutes);
  const open = topics.filter((t) => t.state !== 'mastered');
  const remainingMinutes = sum(open, (t) => Math.max(0, t.topic.plannedMinutes - t.loggedMinutes));
  const weekStart = startOfWeekMonday(today);
  let thisWeekMinutes = 0;
  for (const [d, m] of minutesByDay) if (d >= weekStart && d <= today) thisWeekMinutes += m;

  const perDay = plan.weeklyMinutes / 7;
  const projectedFinish =
    remainingMinutes <= 0
      ? today
      : perDay > 0
        ? addDays(today, Math.max(0, Math.ceil(remainingMinutes / perDay) - 1))
        : null;
  const daysLeft = plan.targetDate ? diffDays(today, plan.targetDate) : null;
  const neededPerWeek =
    daysLeft === null ? null : daysLeft <= 0 ? remainingMinutes : (remainingMinutes / daysLeft) * 7;

  const week = Math.floor(diffDays(plan.startedOn, today) / 7) + 1;
  const weeksTotal = plan.targetDate
    ? Math.max(1, Math.ceil((diffDays(plan.startedOn, plan.targetDate) + 1) / 7))
    : null;

  let status: PlanPaceStatus;
  if (open.length === 0) status = 'done';
  else if (neededPerWeek === null) status = 'no-target';
  else if (neededPerWeek > plan.weeklyMinutes * STUDY_PLAN.ON_TRACK_SLACK) status = 'behind';
  else if (neededPerWeek < plan.weeklyMinutes * 0.8) status = 'ahead';
  else status = 'on-track';

  return {
    plannedMinutes,
    loggedMinutes,
    remainingMinutes,
    topicsDone: topics.length - open.length,
    topicsTotal: topics.length,
    projectedFinish,
    targetDate: plan.targetDate,
    neededPerWeek,
    weeklyMinutes: plan.weeklyMinutes,
    thisWeekMinutes,
    week: Math.max(1, week),
    weeksTotal,
    status,
  };
}

/**
 * The two honest ways back onto a target: give it more a week, or give it more weeks.
 * Rounded to quarter hours and whole days so the offer reads like a choice, not a sum.
 */
export function rebalanceOptions(p: PlanPacing): {
  raiseWeeklyTo: number | null;
  moveTargetTo: ISODate | null;
} {
  if (p.status !== 'behind' || p.neededPerWeek === null) {
    return { raiseWeeklyTo: null, moveTargetTo: null };
  }
  return {
    raiseWeeklyTo: Math.ceil(p.neededPerWeek / 15) * 15,
    moveTargetTo: p.projectedFinish,
  };
}

export interface PlanWeek {
  weekStart: ISODate;
  minutes: number;
  accuracy: number | null;
  rounds: number;
}

/** Week by week since the plan began: hours and drill accuracy, for the recap. */
export function planWeeks(
  startedOn: ISODate,
  today: ISODate,
  minutesByDay: Map<ISODate, number>,
  rounds: DrillRound[],
): PlanWeek[] {
  const first = startOfWeekMonday(startedOn);
  const last = startOfWeekMonday(today);
  const weeks: PlanWeek[] = [];
  for (let w = first; w <= last; w = addDays(w, 7)) {
    const end = addDays(w, 6);
    let minutes = 0;
    for (const [d, m] of minutesByDay) if (d >= w && d <= end) minutes += m;
    const inWeek = rounds.filter((r) => r.date >= w && r.date <= end);
    weeks.push({
      weekStart: w,
      minutes,
      accuracy: roundAccuracy({
        ok: sum(inWeek, (r) => r.ok),
        shaky: sum(inWeek, (r) => r.shaky),
        miss: sum(inWeek, (r) => r.miss),
      }),
      rounds: inWeek.length,
    });
  }
  return weeks;
}

/** Days in a row, ending today or yesterday, with plan work or a drill on them. */
export function planStreak(activeDays: Set<ISODate>, today: ISODate): number {
  let d = activeDays.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (activeDays.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export interface OutlineTopic {
  title: string;
  minutes: number | null;
  resource: string | null;
}

const HOURS_RE = /^~?\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)?$/i;

/**
 * Reads a pasted outline, one topic per line: "Topic | 8 | BIWS Mod 2-4", "Topic - 8h -
 * resource", a markdown table row, or a bare title. Numbered and bulleted lines are fine.
 * Header rows, separator rows and blank lines are skipped.
 */
export function parseOutline(text: string): OutlineTopic[] {
  const out: OutlineTopic[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || /^\|?\s*:?-{2,}/.test(line)) continue;
    line = line.replace(/^\|/, '').replace(/\|$/, '');
    let cells = line.split(/\s*\|\s*|\s+[—–-]\s+|\t/).map((c) => c.trim());
    // A leading "1", "1.", "#", "-" or "*" column is numbering, not the topic.
    if (cells.length > 1 && /^(#|\d+\.?|[-—*•])$/.test(cells[0]!)) cells = cells.slice(1);
    cells[0] = cells[0]!.replace(/^(\d+[.)]|[-*•])\s+/, '');
    cells = cells.filter((c) => c.length > 0);
    if (cells.length === 0) continue;
    const title = cells[0]!;
    if (/^(topic|title|name)$/i.test(title)) continue;
    let minutes: number | null = null;
    let resource: string | null = null;
    for (const c of cells.slice(1)) {
      const m = HOURS_RE.exec(c);
      if (m && minutes === null) {
        const n = Number(m[1]);
        minutes = /^m/i.test(m[2] ?? '') ? Math.round(n) : Math.round(n * 60);
      } else if (resource === null) {
        resource = c;
      }
    }
    out.push({ title, minutes, resource });
  }
  return out;
}

function byNewest(a: DrillRound, b: DrillRound): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

function sum<T>(xs: T[], f: (x: T) => number): number {
  let s = 0;
  for (const x of xs) s += f(x);
  return s;
}
