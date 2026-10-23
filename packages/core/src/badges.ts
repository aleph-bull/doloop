import { addDays, dayOfWeek, localHour, startOfWeekMonday, toLocalDate } from './dates';
import { jackTotals, GAMBLER_FOCUS_SECONDS } from './jack';
import type { ISODate, PlannedBlock, Session, StreakState, StudyNode } from './types';

/** Badge catalogue (spec §7). Keys are stable; conditions are evaluated in `evaluateBadges`. */
export interface BadgeDef {
  key: string;
  name: string;
  description: string;
  /** XP paid once, when the badge unlocks: more for what takes longer or asks more. */
  xp: number;
  /**
   * Jack mode's badges: listed only for someone who has Jack mode on or has earned one, so
   * the mode stays something people turn on, not something the badges advertise.
   */
  jack?: true;
}

/**
 * What each badge pays, in tiers by how much it asks: a first step (25), a habit forming
 * (50-100), weeks of work (150-300), a month or more (400-800), and the long hauls
 * (1,500-2,000). For scale, an hour of focus earns about 150 XP.
 */
export const BADGE_XP: Record<string, number> = {
  // First steps
  'first-session': 25,
  'first-review': 25,
  'routine-starter': 25,
  'first-reward': 50,
  'under-estimate': 50,
  // A habit forming
  'focus-5': 50,
  'sessions-10': 75,
  'tasks-10': 75,
  'early-bird': 75,
  'night-owl': 75,
  'hours-10': 100,
  'deep-work': 100,
  'estimate-oracle': 100,
  planner: 100,
  'streak-7': 100,
  // Weeks of work
  'focus-25': 150,
  'weekend-warrior': 150,
  'full-week': 150,
  'routine-perfect-week': 150,
  'reviewer-25': 150,
  'weekly-reviewer': 150,
  'reward-5': 150,
  'streak-14': 200,
  marathon: 200,
  'routine-50': 250,
  'course-complete': 300,
  'tasks-50': 300,
  // A month or more
  'streak-30': 400,
  'hours-50': 400,
  ultramarathon: 400,
  'no-freeze-30': 500,
  'sessions-100': 500,
  'routine-perfect-4': 500,
  'reviewer-100': 500,
  'course-complete-3': 600,
  'focus-100': 600,
  'hours-100': 800,
  // The long hauls
  'streak-100': 1500,
  'sessions-500': 1500,
  'hours-250': 2000,
  // Jack mode
  'gamble-1': 25,
  'gamble-10': 50,
  gambler: 75,
  'gamble-25': 75,
  'gamble-50': 100,
  'gamble-100': 150,
};

/** What a badge pays when it unlocks. */
export function badgeXp(key: string): number {
  return BADGE_XP[key] ?? 50;
}

const CATALOGUE: Array<Omit<BadgeDef, 'xp'>> = [
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
  // --- added 2026-10-17: more steps along the same ladders ---
  { key: 'sessions-10', name: 'Getting going', description: 'Finish ten sessions.' },
  {
    key: 'sessions-500',
    name: 'Five hundred sessions',
    description: 'Finish five hundred sessions.',
  },
  {
    key: 'hours-250',
    name: 'Long haul',
    description: 'Two hundred and fifty hours of focused work, all time.',
  },
  { key: 'streak-14', name: 'Two weeks', description: 'A 14-day streak.' },
  {
    key: 'focus-100',
    name: 'Focused 100',
    description: 'One hundred sessions with no distraction reported.',
  },
  {
    key: 'ultramarathon',
    name: 'Ultramarathon',
    description: 'Six hours of focused work in a single day.',
  },
  {
    key: 'under-estimate',
    name: 'Ahead of time',
    description: 'Finish a task in less time than you estimated.',
  },
  { key: 'tasks-10', name: 'Ten done', description: 'Mark ten tasks as done.' },
  { key: 'tasks-50', name: 'Fifty done', description: 'Mark fifty tasks as done.' },
  {
    key: 'routine-perfect-4',
    name: 'Four perfect weeks',
    description: 'Complete every recurring task due in four calendar weeks.',
  },
  {
    key: 'reviewer-100',
    name: 'Thoughtful',
    description: 'Submit one hundred end-of-session reviews.',
  },
  // --- Jack mode (2026-10-22) ---
  {
    key: 'gambler',
    name: 'Gambler',
    description: '45 minutes of focus with Jack mode on.',
    jack: true,
  },
  { key: 'gamble-1', name: 'Feeling lucky', description: 'Roll the dice once.', jack: true },
  { key: 'gamble-10', name: 'Ten rolls', description: 'Roll the dice ten times.', jack: true },
  {
    key: 'gamble-25',
    name: 'Regular',
    description: 'Roll the dice twenty-five times.',
    jack: true,
  },
  {
    key: 'gamble-50',
    name: 'High roller',
    description: 'Roll the dice fifty times.',
    jack: true,
  },
  {
    key: 'gamble-100',
    name: 'The house always wins',
    description: 'Roll the dice one hundred times.',
    jack: true,
  },
];

export const BADGES: BadgeDef[] = CATALOGUE.map((b) => ({ ...b, xp: badgeXp(b.key) }));

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
      // Time set aside in the app; a session's own record of itself is not a plan.
      bl.source === 'app' &&
      s.nodeId !== null &&
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
  if (focused.length >= 100) done.add('focus-100');

  // estimate-oracle: completed nodes with estimate, logged within ±10%.
  const loggedByNode = new Map<string, number>();
  for (const s of sessions)
    if (s.nodeId !== null)
      loggedByNode.set(s.nodeId, (loggedByNode.get(s.nodeId) ?? 0) + s.workSeconds / 60);
  let oracle = 0;
  for (const n of input.nodes) {
    if (!n.completedAt || !n.estimatedMinutes) continue;
    const logged = loggedByNode.get(n.id) ?? 0;
    if (Math.abs(logged - n.estimatedMinutes) <= n.estimatedMinutes * 0.1) oracle++;
  }
  if (oracle >= 3) done.add('estimate-oracle');

  // A task done in less time than its estimate, with some time actually logged on it.
  if (
    input.nodes.some((n) => {
      if (!n.completedAt || !n.estimatedMinutes || n.kind === 'course') return false;
      const logged = loggedByNode.get(n.id) ?? 0;
      return logged > 0 && logged < n.estimatedMinutes;
    })
  )
    done.add('under-estimate');

  const tasksDone = input.nodes.filter(
    (n) => n.kind !== 'course' && n.completedAt && !n.archived,
  ).length;
  if (tasksDone >= 10) done.add('tasks-10');
  if (tasksDone >= 50) done.add('tasks-50');

  if (sessions.filter((s) => localHour(s.startedAt, input.timezone) < 8).length >= 5)
    done.add('early-bird');
  if (sessions.filter((s) => overlapsBlock(s, input.plannedBlocks)).length >= 10)
    done.add('planner');

  const best = Math.max(input.streak.current, input.streak.longest);
  if (best >= 7) done.add('streak-7');
  if (best >= 14) done.add('streak-14');
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
  if (totalMinutes >= 250 * 60) done.add('hours-250');
  if (sessions.length >= 10) done.add('sessions-10');
  if (sessions.length >= 100) done.add('sessions-100');
  if (sessions.length >= 500) done.add('sessions-500');
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
  if ([...minutesByDay.values()].some((m) => m >= 6 * 60)) done.add('ultramarathon');

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
  if ((input.perfectRoutineWeeks ?? 0) >= 4) done.add('routine-perfect-4');

  if (reviewed.length >= 25) done.add('reviewer-25');
  if (reviewed.length >= 100) done.add('reviewer-100');
  if ((input.weeklyNotes ?? 0) >= 4) done.add('weekly-reviewer');
  if ((input.rewardsRedeemed ?? 0) >= 1) done.add('first-reward');
  if ((input.rewardsRedeemed ?? 0) >= 5) done.add('reward-5');

  /* --- Jack mode --- */
  const { rolls, focusSeconds } = jackTotals(sessions);
  if (focusSeconds > GAMBLER_FOCUS_SECONDS) done.add('gambler');
  if (rolls >= 1) done.add('gamble-1');
  if (rolls >= 10) done.add('gamble-10');
  if (rolls >= 25) done.add('gamble-25');
  if (rolls >= 50) done.add('gamble-50');
  if (rolls >= 100) done.add('gamble-100');
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
