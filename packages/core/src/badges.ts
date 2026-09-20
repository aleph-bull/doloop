import { localHour, toLocalDate } from './dates';
import type { ISODate, PlannedBlock, Session, StreakState, StudyNode } from './types';

/** Badge catalogue (spec §7). Keys are stable; conditions are evaluated in `evaluateBadges`. */
export interface BadgeDef {
  key: string;
  name: string;
  description: string;
}

export const BADGES: BadgeDef[] = [
  { key: 'first-session', name: 'First session', description: 'Complete your first session.' },
  {
    key: 'first-review',
    name: 'Honest start',
    description: 'Submit your first end-of-session review.',
  },
  { key: 'focus-5', name: 'Focused 5', description: 'Five sessions with no distraction reported.' },
  {
    key: 'focus-25',
    name: 'Focused 25',
    description: 'Twenty-five sessions with no distraction reported.',
  },
  {
    key: 'estimate-oracle',
    name: 'Estimate oracle',
    description: 'Complete three tasks within 10% of your estimate.',
  },
  { key: 'early-bird', name: 'Early bird', description: 'Start five sessions before 8:00.' },
  { key: 'planner', name: 'Planner', description: 'Study inside ten planned blocks.' },
  { key: 'streak-7', name: 'Seven days', description: 'A 7-day streak.' },
  { key: 'streak-30', name: 'Thirty days', description: 'A 30-day streak.' },
  { key: 'streak-100', name: 'Hundred days', description: 'A 100-day streak.' },
  { key: 'course-complete', name: 'Course complete', description: 'Mark a whole course as done.' },
  {
    key: 'no-freeze-30',
    name: 'Unassisted 30',
    description: 'A 30-day streak without using a freeze.',
  },
];

export interface BadgeInput {
  nodes: StudyNode[];
  /** Completed sessions, any order. */
  sessions: Session[];
  plannedBlocks: PlannedBlock[];
  streak: StreakState;
  /** Dates (user tz) on which a freeze was consumed. */
  freezeDates: ISODate[];
  timezone: string;
  /** Already unlocked keys; only new ones are returned. */
  unlocked: string[];
  /** Today's date in the user's timezone, for the no-freeze window. */
  today: ISODate;
}

function overlapsBlock(s: Session, blocks: PlannedBlock[]): boolean {
  if (!s.endedAt) return false;
  const a = Date.parse(s.startedAt);
  const b = Date.parse(s.endedAt);
  return blocks.some(
    (bl) =>
      !bl.cancelled &&
      bl.nodeId === s.nodeId &&
      Date.parse(bl.startAt) < b &&
      Date.parse(bl.endAt) > a,
  );
}

/** Which badges are satisfied right now (independent of what is already unlocked). */
export function satisfiedBadges(input: BadgeInput): Set<string> {
  const done = new Set<string>();
  const sessions = input.sessions.filter((s) => s.endedAt !== null);
  const reviewed = sessions.filter((s) => s.review && !s.review.skipped);
  const focused = sessions.filter(
    (s) => s.review && !s.review.skipped && s.review.distracted === 'no',
  );

  if (sessions.length >= 1) done.add('first-session');
  if (reviewed.length >= 1) done.add('first-review');
  if (focused.length >= 5) done.add('focus-5');
  if (focused.length >= 25) done.add('focus-25');

  // estimate-oracle: completed nodes with estimate, logged within ±10%.
  const loggedByNode = new Map<string, number>();
  for (const s of sessions)
    loggedByNode.set(s.nodeId, (loggedByNode.get(s.nodeId) ?? 0) + s.workSeconds / 60);
  let oracle = 0;
  for (const n of input.nodes) {
    if (!n.completedAt || !n.estimatedMinutes) continue;
    const logged = loggedByNode.get(n.id) ?? 0;
    if (Math.abs(logged - n.estimatedMinutes) <= n.estimatedMinutes * 0.1) oracle++;
  }
  if (oracle >= 3) done.add('estimate-oracle');

  if (sessions.filter((s) => localHour(s.startedAt, input.timezone) < 8).length >= 5)
    done.add('early-bird');
  if (sessions.filter((s) => overlapsBlock(s, input.plannedBlocks)).length >= 10)
    done.add('planner');

  const best = Math.max(input.streak.current, input.streak.longest);
  if (best >= 7) done.add('streak-7');
  if (best >= 30) done.add('streak-30');
  if (best >= 100) done.add('streak-100');

  if (input.nodes.some((n) => n.kind === 'course' && n.completedAt && !n.archived))
    done.add('course-complete');

  if (input.streak.current >= 30) {
    // Freeze used within the current 30-day run disqualifies.
    const start = new Date(Date.parse(`${input.today}T00:00:00Z`) - 29 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const usedRecently = input.freezeDates.some((d) => d >= start && d <= input.today);
    if (!usedRecently) done.add('no-freeze-30');
  }
  return done;
}

/** Badges newly earned, in catalogue order. */
export function evaluateBadges(input: BadgeInput): string[] {
  const satisfied = satisfiedBadges(input);
  const have = new Set(input.unlocked);
  return BADGES.map((b) => b.key).filter((k) => satisfied.has(k) && !have.has(k));
}

export function badgeByKey(key: string): BadgeDef | undefined {
  return BADGES.find((b) => b.key === key);
}

/** Useful for tests and the API: the local date of a session's start. */
export function sessionDate(s: Session, tz: string): ISODate {
  return toLocalDate(s.startedAt, tz);
}
