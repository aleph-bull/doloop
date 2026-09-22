import { fnv1a } from './hash';

/**
 * The line under "Hello <name>" on the dashboard.
 *
 * Picked from the bucket that fits what is actually true right now - a streak worth
 * mentioning, hours already in this week, the hour of the night - so the greeting reads as
 * someone who looked at your week rather than a rotating fortune cookie. Buckets are tried
 * in priority order by `bucketForGreeting`.
 */

export type GreetingBucket =
  | 'first-ever' // no sessions logged yet
  | 'back-after-break' // studied before, but nothing for a week or more
  | 'streak-milestone' // a round-number streak: 7, 14, 30, 50, 100...
  | 'streak' // any streak worth naming
  | 'due-soon' // something is due in the next couple of days
  | 'late-night' // after 23:00 local
  | 'early-morning' // before 06:00 local
  | 'studied-today' // already logged time today
  | 'week-progress' // hours on the board this week
  | 'weekend'
  | 'default';

export interface Greeting {
  id: string;
  bucket: GreetingBucket;
  /**
   * The sentence under the salutation. A template: where the bucket supplies them it may
   * use `{streak}`, `{next}`, `{hours}`, `{count}`, `{s}` and `{title}`.
   */
  text: string;
}

const G = (bucket: GreetingBucket, texts: string[]): Greeting[] =>
  texts.map((text, i) => ({ id: `${bucket}-${i + 1}`, bucket, text }));

export const GREETINGS: Greeting[] = [
  ...G('first-ever', [
    'Ready to start the first one?',
    'Nothing logged yet. Want to change that?',
    'The first session is the hard one. Shall we?',
    'Welcome in. Pick something and start the clock.',
    'Blank slate. What are we working on?',
  ]),
  ...G('back-after-break', [
    'Been a while. Want to ease back in?',
    'Welcome back. A short block counts as a restart.',
    'The break is over whenever you say it is.',
    'Good to see you again. Start small today?',
    'Picking it up again is the whole trick.',
  ]),
  ...G('streak-milestone', [
    "You're on a {streak} day streak, care to do more?",
    '{streak} days in a row. That is a real habit now.',
    '{streak} straight days. Keep the chain going?',
    '{streak} days. Most people never get past three.',
    '{streak} day streak. Want to make it {next}?',
  ]),
  ...G('streak', [
    "You're on a {streak} day streak, care to do more?",
    '{streak} days running. One more keeps it alive.',
    'Day {next} of the streak starts whenever you do.',
    "{streak} days deep. Don't let today be the gap.",
    'The streak is at {streak}. Feed it?',
  ]),
  ...G('due-soon', [
    '{title} is due soon. Want to get ahead of it?',
    '{count} thing{s} due in the next few days.',
    '{title} is coming up. A block now is a calmer week.',
    'The calendar says {title}. Shall we?',
  ]),
  ...G('late-night', [
    'Late night study session?',
    'Burning the midnight oil?',
    'One last block before bed?',
    'Late one. Keep it short and sleep on it.',
    'The quiet hours. Good for deep work, bad for sleep.',
  ]),
  ...G('early-morning', [
    'Up early. Care to get a block in before the day starts?',
    'Early start. The best hours are the quiet ones.',
    'First light, first session?',
    'Morning. Want to bank an hour before anything else lands?',
  ]),
  ...G('studied-today', [
    '{hours} in today already. Room for one more?',
    'Today is already on the board. Add to it?',
    '{hours} down today. Stop here, or keep going?',
    'Good day so far. One more block?',
  ]),
  ...G('week-progress', [
    "You've studied {hours} this week, time to add more.",
    '{hours} on the board this week. Keep it moving?',
    '{hours} this week so far. Care to do some more work today?',
    'The week is at {hours}. Want to push it up?',
  ]),
  ...G('weekend', [
    'Weekend session? An hour now buys back Monday.',
    'Quiet weekend. Good time for the hard thing.',
    'Care to do a little work today?',
    'No rush today. A short block still counts.',
  ]),
  ...G('default', [
    'Care to do some more work today?',
    'What are we working on?',
    'Ready when you are.',
    'Pick something and start the clock.',
    'Good to see you. Shall we get into it?',
    'Another day, another block.',
    'Want to make today count?',
  ]),
];

const byBucket = new Map<GreetingBucket, Greeting[]>();
for (const g of GREETINGS) {
  const list = byBucket.get(g.bucket) ?? [];
  list.push(g);
  byBucket.set(g.bucket, list);
}

export function greetingsFor(bucket: GreetingBucket): Greeting[] {
  return byBucket.get(bucket) ?? [];
}

/** Streaks worth calling out by name in a greeting. */
export const GREETING_STREAK_MILESTONES = [
  7, 10, 14, 21, 30, 50, 60, 75, 100, 150, 200, 250, 300, 365, 500, 1000,
] as const;

export interface GreetingSignals {
  /** Local hour, 0-23. */
  localHour: number;
  /** Local day of week, 0 = Sunday. */
  dayOfWeek: number;
  streak: number;
  minutesToday: number;
  minutesThisWeek: number;
  /** Total completed sessions, ever. */
  sessionsEver: number;
  /** Days since the last session, or null if there has never been one. */
  daysSinceLastSession: number | null;
  /** Items due within the next few days, soonest first. */
  dueSoon: Array<{ title: string }>;
}

/** Days of silence after which the greeting welcomes you back instead of nagging. */
export const BACK_AFTER_BREAK_DAYS = 7;

/**
 * Choose the bucket that fits. Order is priority order: the rarest, most specific thing
 * that is true about this moment wins, so a 100-day streak is never buried under "what are
 * we working on?".
 */
export function bucketForGreeting(s: GreetingSignals): GreetingBucket {
  if (s.sessionsEver === 0) return 'first-ever';
  if (s.daysSinceLastSession !== null && s.daysSinceLastSession >= BACK_AFTER_BREAK_DAYS)
    return 'back-after-break';
  if ((GREETING_STREAK_MILESTONES as readonly number[]).includes(s.streak))
    return 'streak-milestone';
  if (s.localHour >= 23 || s.localHour < 4) return 'late-night';
  if (s.localHour < 6) return 'early-morning';
  if (s.streak >= 2) return 'streak';
  if (s.dueSoon.length > 0) return 'due-soon';
  if (s.minutesToday > 0) return 'studied-today';
  if (s.minutesThisWeek > 0) return 'week-progress';
  if (s.dayOfWeek === 0 || s.dayOfWeek === 6) return 'weekend';
  return 'default';
}

/** "2 h 30 m", "45 m" - the same shape the rest of the app uses for durations. */
function fmtHours(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} m`;
  if (rest === 0) return `${h} h`;
  return `${h} h ${rest} m`;
}

export interface GreetingContext extends GreetingSignals {
  /** Empty or missing falls back to a name-free greeting. */
  name: string | null;
  /** Anything that varies per pick. The same seed gives the same greeting all day. */
  seed: string;
  /** The greeting shown last, so the next one is never an immediate repeat. */
  lastGreetingId?: string | null;
}

export interface PickedGreeting {
  id: string;
  bucket: GreetingBucket;
  /** "Hello Zach" - the heading. */
  salutation: string;
  /** The sentence under it, already filled in. */
  line: string;
}

function fill(template: string, ctx: GreetingContext, bucket: GreetingBucket): string {
  const due = ctx.dueSoon[0];
  const minutes = bucket === 'studied-today' ? ctx.minutesToday : ctx.minutesThisWeek;
  return template
    .replace(/\{streak\}/g, String(ctx.streak))
    .replace(/\{next\}/g, String(ctx.streak + 1))
    .replace(/\{hours\}/g, fmtHours(minutes))
    .replace(/\{count\}/g, String(ctx.dueSoon.length))
    .replace(/\{s\}/g, ctx.dueSoon.length === 1 ? '' : 's')
    .replace(/\{title\}/g, due?.title ?? 'your next deadline');
}

/**
 * Deterministic pick: the same (bucket, seed) always gives the same line, so the greeting
 * is stable across a re-render or a tab reload rather than flickering on every paint.
 * Seed with the local date to get one greeting per day.
 */
export function pickGreeting(ctx: GreetingContext): PickedGreeting {
  const bucket = bucketForGreeting(ctx);
  const list = greetingsFor(bucket);
  const pool = list.length > 0 ? list : greetingsFor('default');
  let idx = fnv1a(`${bucket}|${ctx.seed}`) % pool.length;
  if (ctx.lastGreetingId && pool[idx]!.id === ctx.lastGreetingId && pool.length > 1) {
    idx = (idx + 1) % pool.length;
  }
  const chosen = pool[idx]!;
  const name = ctx.name?.trim();
  return {
    id: chosen.id,
    bucket: chosen.bucket,
    salutation: name ? `Hello ${name}` : 'Hello',
    line: fill(chosen.text, ctx, chosen.bucket),
  };
}
