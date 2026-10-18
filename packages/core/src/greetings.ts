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

// A calm, sincere voice (Opal is the reference): plain sentences, no quips or odd references,
// no selling. Nothing about sleep, rest or stopping, no guilt, no comparing you with others.
export const GREETINGS: Greeting[] = [
  ...G('first-ever', [
    "Welcome. Start your first session whenever you're ready.",
    'Pick one thing to work on, then press start.',
    "Brand new. Let's see what this button does.",
  ]),
  ...G('back-after-break', [
    'Welcome back.',
    'The timer missed you.',
    'Long time no see!',
    'Good to see you again. Pick up where you left off?',
    "Back from an adventure, let's settle down.",
  ]),
  ...G('streak-milestone', [
    '{streak} days in a row. Locked in.',
    '{streak} day streak. Going for a new record?',
    "{streak} days in a row. That's a real habit now.",
    '{streak} days straight. Well done.',
    '{streak} day streak. Going for {next}?',
  ]),
  ...G('streak', [
    '{streak} day streak. Going for {next}?',
    "{streak} days running. Let's hope for 7 more.",
    'Your streak is at {streak} days.',
    'Today would make it {next} days in a row.',
    '{streak} days deep and still going.',
  ]),
  ...G('due-soon', [
    '{title} is coming up. Cross it off?',
    '{count} thing{s} due soon. You got this.',
    '{title} is on the table.',
    '{title} is on the horizon.',
  ]),
  ...G('late-night', [
    'Working late tonight?',
    "Getting some work in while it's quiet?",
    'Moon out, brain on.',
    'A quiet evening to get things done.',
  ]),
  ...G('early-morning', [
    'Early start today.',
    'Good morning. A quiet time to focus.',
    'Up early. A good time to get ahead.',
    'An early session to start the day?',
  ]),
  ...G('studied-today', [
    '{hours} done today.',
    '{hours} so far today. Nice work.',
    '{hours} in today. Good progress.',
    '{hours} today and counting.',
  ]),
  ...G('week-progress', [
    '{hours} this week so far.',
    '{hours} banked this week.',
    'The week is at {hours}.',
    '{hours} this week. Steady progress.',
  ]),
  ...G('weekend', [
    'A weekend session. Nice.',
    'Getting some work in this weekend?',
    'Weekends are good for getting ahead.',
    'A calm weekend to focus.',
  ]),
  ...G('default', [
    'Ready when you are.',
    'What would you like to work on today?',
    'Pick something and press start.',
    'Good to see you.',
    'A good day to make progress.',
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

/** "2 h 30 min", "45 min" - the same shape the rest of the app uses for durations. */
function fmtHours(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  if (rest === 0) return `${h} h`;
  return `${h} h ${rest} min`;
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
