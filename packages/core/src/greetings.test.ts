import { describe, expect, it } from 'vitest';
import {
  bucketForGreeting,
  GREETINGS,
  greetingsFor,
  pickGreeting,
  type GreetingContext,
  type GreetingSignals,
} from './greetings';

const signals = (over: Partial<GreetingSignals> = {}): GreetingSignals => ({
  localHour: 14,
  dayOfWeek: 3,
  streak: 0,
  minutesToday: 0,
  minutesThisWeek: 0,
  sessionsEver: 10,
  daysSinceLastSession: 1,
  dueSoon: [],
  ...over,
});

const ctx = (over: Partial<GreetingContext> = {}): GreetingContext => ({
  ...signals(),
  name: 'Zach',
  seed: '2026-09-22',
  ...over,
});

describe('bucketForGreeting', () => {
  it('greets a brand new user before anything else', () => {
    expect(bucketForGreeting(signals({ sessionsEver: 0, streak: 30 }))).toBe('first-ever');
  });

  it('welcomes back after a week away', () => {
    expect(bucketForGreeting(signals({ daysSinceLastSession: 9 }))).toBe('back-after-break');
    expect(bucketForGreeting(signals({ daysSinceLastSession: 6 }))).not.toBe('back-after-break');
  });

  it('calls out round-number streaks', () => {
    expect(bucketForGreeting(signals({ streak: 100 }))).toBe('streak-milestone');
    expect(bucketForGreeting(signals({ streak: 9 }))).toBe('streak');
  });

  it('puts the hour ahead of an ordinary streak', () => {
    expect(bucketForGreeting(signals({ localHour: 23, streak: 5 }))).toBe('late-night');
    expect(bucketForGreeting(signals({ localHour: 2, streak: 5 }))).toBe('late-night');
    expect(bucketForGreeting(signals({ localHour: 5, streak: 5 }))).toBe('early-morning');
  });

  it('mentions what is due when there is no streak to talk about', () => {
    expect(bucketForGreeting(signals({ dueSoon: [{ title: 'Problem set 4' }] }))).toBe('due-soon');
  });

  it('falls through hours studied to the plain greeting', () => {
    expect(bucketForGreeting(signals({ minutesToday: 40 }))).toBe('studied-today');
    expect(bucketForGreeting(signals({ minutesThisWeek: 200 }))).toBe('week-progress');
    expect(bucketForGreeting(signals({ dayOfWeek: 6 }))).toBe('weekend');
    expect(bucketForGreeting(signals())).toBe('default');
  });
});

describe('pickGreeting', () => {
  it('puts the name in the salutation, apart from the line', () => {
    const g = pickGreeting(ctx());
    expect(g.salutation).toBe('Hello Zach');
    expect(g.line).not.toContain('Hello');
  });

  it('greets without a name when there is none', () => {
    expect(pickGreeting(ctx({ name: null })).salutation).toBe('Hello');
    expect(pickGreeting(ctx({ name: '   ' })).salutation).toBe('Hello');
  });

  it('starts every line as its own sentence', () => {
    for (const g of GREETINGS) {
      const first = g.text[0]!;
      expect(first === first.toUpperCase() || first === '{').toBe(true);
    }
  });

  it('is stable for the same seed and varies across seeds', () => {
    const a = pickGreeting(ctx({ seed: 'day-1' }));
    expect(pickGreeting(ctx({ seed: 'day-1' })).id).toBe(a.id);
    const ids = new Set(
      Array.from({ length: 40 }, (_, i) => pickGreeting(ctx({ seed: `day-${i}` })).id),
    );
    expect(ids.size).toBeGreaterThan(1);
  });

  it('never repeats the last greeting back to back', () => {
    const first = pickGreeting(ctx({ seed: 'day-1' }));
    const second = pickGreeting(ctx({ seed: 'day-1', lastGreetingId: first.id }));
    expect(second.id).not.toBe(first.id);
  });

  it('substitutes the streak and the day after it', () => {
    const picked = pickGreeting(ctx({ streak: 30, seed: 'x' }));
    expect(picked.bucket).toBe('streak-milestone');
    expect(picked.line).toContain('30');
    expect(picked.line).not.toContain('{');
  });

  it('substitutes hours for the time-studied buckets', () => {
    const today = pickGreeting(ctx({ minutesToday: 150, seed: 'a' }));
    expect(today.bucket).toBe('studied-today');
    expect(today.line).toMatch(/2 h 30 min|\bboard\b|block/);

    const week = pickGreeting(ctx({ minutesThisWeek: 60, seed: 'b' }));
    expect(week.bucket).toBe('week-progress');
    expect(week.line).not.toContain('{');
  });

  it('substitutes the title and count of what is due', () => {
    const picked = pickGreeting(
      ctx({ dueSoon: [{ title: 'Problem set 4' }, { title: 'Lab 2' }], seed: 'q' }),
    );
    expect(picked.bucket).toBe('due-soon');
    expect(picked.line).not.toContain('{');
  });

  it('leaves no placeholder unfilled in any greeting', () => {
    for (const g of GREETINGS) {
      const filled = pickGreeting(
        ctx({
          streak: 7,
          minutesToday: 30,
          minutesThisWeek: 300,
          dueSoon: [{ title: 'Lab 2' }],
          seed: g.id,
        }),
      );
      expect(filled.line).not.toMatch(/\{[a-z]+\}/);
    }
  });

  it('gives every bucket something to say', () => {
    for (const g of GREETINGS) expect(greetingsFor(g.bucket).length).toBeGreaterThan(0);
  });

  it('never nags: no bedtime, no guilt, no comparing', () => {
    const nag =
      /\b(sleep|bed|laptop|rest|wind down|keep going|most people|you should|need to|don't let|take a break|call it)\b/i;
    for (const g of GREETINGS) expect(g.text, g.id).not.toMatch(nag);
  });
});
