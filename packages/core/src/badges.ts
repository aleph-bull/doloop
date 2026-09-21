import { addDays, dayOfWeek, localHour, startOfWeekMonday, toLocalDate } from './dates';
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
  // --- volume ---
  { key: 'hours-10', name: 'Ten hours', description: 'Ten hours of focused work, all time.' },
  { key: 'hours-50', name: 'Fifty hours', description: 'Fifty hours of focused work, all time.' },
  {
    key: 'hours-100',
    name: 'Century of hours',
    description: 'One hundred hours of focused work, all time.',
  },
  {
    key: 'sessions-100',
    name: 'Hundred sessions',
    description: 'Finish one hundred sessions.',
  },
  // --- rhythm ---
  { key: 'night-owl', name: 'Night owl', description: 'Start five sessions after 22:00.' },
  {
    key: 'weekend-warrior',
    name: 'Weekend warrior',
    description: 'Study on both days of the same weekend, five times.',
  },
  {
    key: 'full-week',
    name: 'Full week',
    description: 'Study on all seven days of one calendar week.',
  },
  {
    key: 'marathon',
    name: 'Marathon',
    description: 'Four hours of focused work in a single day.',
  },
  {
    key: 'deep-work',
    name: 'Deep work',
    description: 'A single session of two hours or more.',
  },
  // --- habits ---
  {
    key: 'routine-starter',
    name: 'Routine starter',
    description: 'Tick off your first recurring task.',
  },
  {
    key: 'routine-50',
    name: 'Creature of habit',
    description: 'Tick off fifty recurring tasks.',
  },
  {
    key: 'routine-perfect-week',
    name: 'Perfect week',
    description: 'Complete every recurring task due in one calendar week.',
  },
  // --- reflection and rewards ---
  {
    key: 'reviewer-25',
    name: 'Reflective',
    description: 'Submit twenty-five end-of-session reviews.',
  },
  {
    key: 'weekly-reviewer',
    name: 'Looking back',
    description: 'Write notes on four weekly reviews.',
  },
  {
    key: 'first-reward',
    name: 'Well earned',
    description: 'Redeem a reward you set for yourself.',
  },
  {
    key: 'reward-5',
    name: 'Paid in full',
    description: 'Redeem five rewards.',
  },
  {
    key: 'course-complete-3',
    name: 'Three down',
    description: 'Mark three courses as done.',
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
  /** Recurring-task ticks, for the habit badges. Absent is treated as none. */
  routineTicks?: RoutineTick[];
  /** Weeks (Monday, user tz) in which every due recurring task was ticked. */
  perfectRoutineWeeks?: number;
  /** How many custom rewards have been redeemed. */
  rewardsRedeemed?: number;
  /** How many weekly reviews carry a written note. */
  weeklyNotes?: number;
}

export interface RoutineTick {
  date: ISODate;
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

  const courses = input.nodes.filter((n) => n.kind === 'course' && n.completedAt && !n.archived);
  if (courses.length >= 1) done.add('course-complete');
  if (courses.length >= 3) done.add('course-complete-3');

  /* --- volume --- */
  const totalMinutes = sessions.reduce((a, s) => a + s.workSeconds / 60, 0);
  if (totalMinutes >= 10 * 60) done.add('hours-10');
  if (totalMinutes >= 50 * 60) done.add('hours-50');
  if (totalMinutes >= 100 * 60) done.add('hours-100');
  if (sessions.length >= 100) done.add('sessions-100');
  if (sessions.some((s) => s.workSeconds >= 2 * 3600)) done.add('deep-work');

  /* --- rhythm --- */
  if (sessions.filter((s) => localHour(s.startedAt, input.timezone) >= 22).length >= 5)
    done.add('night-owl');

  const minutesByDay = new Map<ISODate, number>();
  for (const s of sessions) {
    const d = toLocalDate(s.startedAt, input.timezone);
    minutesByDay.set(d, (minutesByDay.get(d) ?? 0) + s.workSeconds / 60);
  }
  if ([...minutesByDay.values()].some((m) => m >= 4 * 60)) done.add('marathon');

  const studiedDays = new Set(minutesByDay.keys());
  // A weekend counts when both its Saturday and the following Sunday were studied.
  let weekends = 0;
  for (const d of studiedDays) {
    if (dayOfWeek(d) === 6 && studiedDays.has(addDays(d, 1))) weekends++;
  }
  if (weekends >= 5) done.add('weekend-warrior');

  const weekDayCounts = new Map<ISODate, Set<ISODate>>();
  for (const d of studiedDays) {
    const wk = startOfWeekMonday(d);
    if (!weekDayCounts.has(wk)) weekDayCounts.set(wk, new Set());
    weekDayCounts.get(wk)!.add(d);
  }
  if ([...weekDayCounts.values()].some((days) => days.size >= 7)) done.add('full-week');

  /* --- habits, reflection, rewards --- */
  const ticks = input.routineTicks ?? [];
  if (ticks.length >= 1) done.add('routine-starter');
  if (ticks.length >= 50) done.add('routine-50');
  if ((input.perfectRoutineWeeks ?? 0) >= 1) done.add('routine-perfect-week');

  if (reviewed.length >= 25) done.add('reviewer-25');
  if ((input.weeklyNotes ?? 0) >= 4) done.add('weekly-reviewer');
  if ((input.rewardsRedeemed ?? 0) >= 1) done.add('first-reward');
  if ((input.rewardsRedeemed ?? 0) >= 5) done.add('reward-5');

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
