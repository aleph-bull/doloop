import { describe, expect, it } from 'vitest';
import {
  canTick,
  describeRecurrence,
  nextOccurrence,
  occursOn,
  occurrencesBetween,
  ROUTINES,
  routineAdherence,
  routineAgenda,
  routineXp,
  routinesDue,
  validateRoutineDraft,
  type Routine,
  type RoutineCompletion,
  type RoutineSpec,
} from './routines';

const spec = (over: Partial<RoutineSpec> = {}): RoutineSpec => ({
  freq: 'daily',
  interval: 1,
  byWeekday: [],
  byMonthday: [],
  // 2026-09-21 is a Monday.
  startDate: '2026-09-21',
  endDate: null,
  ...over,
});

const routine = (over: Partial<Routine> = {}): Routine => ({
  ...spec(),
  id: 'r1',
  userId: 'u1',
  title: 'Read 10 pages',
  note: null,
  nodeId: null,
  estimatedMinutes: 20,
  source: 'app',
  icsUid: null,
  archived: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('occursOn', () => {
  it('never fires before the start or after the end', () => {
    const s = spec({ endDate: '2026-09-25' });
    expect(occursOn(s, '2026-09-20')).toBe(false);
    expect(occursOn(s, '2026-09-21')).toBe(true);
    expect(occursOn(s, '2026-09-25')).toBe(true);
    expect(occursOn(s, '2026-09-26')).toBe(false);
  });

  it('handles a daily interval', () => {
    const s = spec({ interval: 3 });
    expect(['2026-09-21', '2026-09-24', '2026-09-27'].every((d) => occursOn(s, d))).toBe(true);
    expect(['2026-09-22', '2026-09-23'].some((d) => occursOn(s, d))).toBe(false);
  });

  it('handles weekly days, defaulting to the start date’s weekday', () => {
    // Mondays and Thursdays.
    const s = spec({ freq: 'weekly', byWeekday: [1, 4] });
    expect(occursOn(s, '2026-09-21')).toBe(true); // Mon
    expect(occursOn(s, '2026-09-24')).toBe(true); // Thu
    expect(occursOn(s, '2026-09-23')).toBe(false); // Wed
    expect(occursOn(s, '2026-09-28')).toBe(true); // next Mon

    const implied = spec({ freq: 'weekly' });
    expect(occursOn(implied, '2026-09-28')).toBe(true);
    expect(occursOn(implied, '2026-09-29')).toBe(false);
  });

  it('skips weeks for a fortnightly routine', () => {
    const s = spec({ freq: 'weekly', interval: 2, byWeekday: [1] });
    expect(occursOn(s, '2026-09-21')).toBe(true);
    expect(occursOn(s, '2026-09-28')).toBe(false);
    expect(occursOn(s, '2026-10-05')).toBe(true);
  });

  it('handles monthly days and skips months that lack them', () => {
    const s = spec({ freq: 'monthly', byMonthday: [31], startDate: '2026-01-31' });
    expect(occursOn(s, '2026-01-31')).toBe(true);
    expect(occursOn(s, '2026-03-31')).toBe(true);
    // February has no 31st, so the occurrence simply does not exist.
    expect(occurrencesBetween(s, '2026-02-01', '2026-02-28')).toEqual([]);
  });

  it('handles a two-monthly interval', () => {
    const s = spec({ freq: 'monthly', interval: 2, startDate: '2026-09-21' });
    expect(occursOn(s, '2026-09-21')).toBe(true);
    expect(occursOn(s, '2026-10-21')).toBe(false);
    expect(occursOn(s, '2026-11-21')).toBe(true);
  });
});

describe('occurrencesBetween / nextOccurrence', () => {
  it('lists the days in order and clamps to the end date', () => {
    const s = spec({ freq: 'weekly', byWeekday: [1, 4], endDate: '2026-09-28' });
    expect(occurrencesBetween(s, '2026-09-01', '2026-10-31')).toEqual([
      '2026-09-21',
      '2026-09-24',
      '2026-09-28',
    ]);
  });

  it('returns nothing when the window ends before the routine starts', () => {
    expect(occurrencesBetween(spec(), '2026-08-01', '2026-08-31')).toEqual([]);
  });

  it('finds the next occurrence, or null once finished', () => {
    const s = spec({ freq: 'weekly', byWeekday: [1] });
    expect(nextOccurrence(s, '2026-09-22')).toBe('2026-09-28');
    expect(nextOccurrence(spec({ endDate: '2026-09-22' }), '2026-09-23')).toBeNull();
  });
});

describe('describeRecurrence', () => {
  it('reads as plain English', () => {
    expect(describeRecurrence(spec())).toBe('Every day');
    expect(describeRecurrence(spec({ interval: 3 }))).toBe('Every 3 days');
    expect(describeRecurrence(spec({ freq: 'weekly', byWeekday: [1, 4] }))).toBe(
      'Every week on Mon, Thu',
    );
    expect(describeRecurrence(spec({ freq: 'monthly', byMonthday: [1, 22] }))).toBe(
      'Every month on the 1st, 22nd',
    );
    expect(describeRecurrence(spec({ freq: 'monthly', byMonthday: [3, 13] }))).toBe(
      'Every month on the 3rd, 13th',
    );
  });
});

describe('routineXp', () => {
  it('pays per estimated minute', () => {
    expect(routineXp({ estimatedMinutes: 20, earnedToday: 0 })).toBe(20);
  });

  it('caps a single tick', () => {
    expect(routineXp({ estimatedMinutes: 600, earnedToday: 0 })).toBe(ROUTINES.MAX_XP_PER_TICK);
  });

  it('caps the day, and pays nothing once the day is spent', () => {
    expect(routineXp({ estimatedMinutes: 60, earnedToday: ROUTINES.MAX_XP_PER_DAY - 10 })).toBe(10);
    expect(routineXp({ estimatedMinutes: 60, earnedToday: ROUTINES.MAX_XP_PER_DAY })).toBe(0);
  });

  it('never goes negative', () => {
    expect(routineXp({ estimatedMinutes: 0, earnedToday: 0 })).toBe(0);
    expect(routineXp({ estimatedMinutes: 10, earnedToday: 9999 })).toBe(0);
  });
});

describe('validateRoutineDraft', () => {
  const base = {
    title: 'Read',
    estimatedMinutes: 20,
    freq: 'daily' as const,
    startDate: '2026-09-21',
  };

  it('normalises and defaults', () => {
    const r = validateRoutineDraft({ ...base, title: '  Read  ' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toMatchObject({
      title: 'Read',
      note: null,
      interval: 1,
      byWeekday: [],
      byMonthday: [],
      endDate: null,
    });
  });

  it('drops selectors that do not belong to the frequency', () => {
    const r = validateRoutineDraft({ ...base, freq: 'daily', byWeekday: [1, 2] });
    expect(r.ok && r.value.byWeekday).toEqual([]);
  });

  it('refuses mismatched selectors', () => {
    expect(validateRoutineDraft({ ...base, freq: 'weekly', byMonthday: [5] }).ok).toBe(false);
    expect(validateRoutineDraft({ ...base, freq: 'monthly', byWeekday: [5] }).ok).toBe(false);
  });

  it('refuses bad names, estimates, intervals and date ranges', () => {
    expect(validateRoutineDraft({ ...base, title: '  ' }).ok).toBe(false);
    expect(validateRoutineDraft({ ...base, estimatedMinutes: 0 }).ok).toBe(false);
    expect(validateRoutineDraft({ ...base, estimatedMinutes: 10_000 }).ok).toBe(false);
    expect(validateRoutineDraft({ ...base, interval: 0 }).ok).toBe(false);
    expect(validateRoutineDraft({ ...base, endDate: '2026-09-20' }).ok).toBe(false);
  });

  it('de-duplicates and sorts the selectors', () => {
    const r = validateRoutineDraft({ ...base, freq: 'weekly', byWeekday: [4, 1, 4] });
    expect(r.ok && r.value.byWeekday).toEqual([1, 4]);
  });
});

describe('routineAgenda', () => {
  const completions: RoutineCompletion[] = [
    {
      id: 'c1',
      routineId: 'r1',
      date: '2026-09-21',
      completedAt: '2026-09-21T18:00:00.000Z',
      minutes: 20,
      xpAwarded: 20,
    },
  ];

  it('marks ticked days and flags the overdue ones', () => {
    const items = routineAgenda({
      routines: [routine()],
      completions,
      from: '2026-09-21',
      to: '2026-09-24',
      today: '2026-09-23',
    });
    expect(items.map((o) => [o.date, o.done, o.overdue])).toEqual([
      ['2026-09-21', true, false],
      ['2026-09-22', false, true],
      ['2026-09-23', false, false],
      ['2026-09-24', false, false],
    ]);
    expect(items[0]!.xpAwarded).toBe(20);
  });

  it('leaves archived routines out', () => {
    expect(
      routineAgenda({
        routines: [routine({ archived: true })],
        completions: [],
        from: '2026-09-21',
        to: '2026-09-24',
        today: '2026-09-23',
      }),
    ).toEqual([]);
  });

  it('lists what is still due today and recently, never the future', () => {
    const due = routinesDue({ routines: [routine()], completions, today: '2026-09-23' });
    expect(due.map((o) => o.date)).toEqual(['2026-09-22', '2026-09-23']);
  });

  it('drops missed days up to the cleared date but keeps today', () => {
    const base = { routines: [routine()], completions: [], today: '2026-09-25' };
    expect(routinesDue({ ...base, clearedThrough: '2026-09-24' }).map((o) => o.date)).toEqual([
      '2026-09-25',
    ]);
    expect(routinesDue({ ...base, clearedThrough: '2026-09-22' }).map((o) => o.date)).toEqual([
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
    ]);
    // Cleared through a later day (a clock change, an edited setting): today still shows.
    expect(routinesDue({ ...base, clearedThrough: '2026-09-30' }).map((o) => o.date)).toEqual([
      '2026-09-25',
    ]);
  });
});

describe('routineAdherence', () => {
  it('ignores the future and reports a rate', () => {
    const a = routineAdherence({
      routines: [routine()],
      completions: [
        {
          id: 'c1',
          routineId: 'r1',
          date: '2026-09-21',
          completedAt: '2026-09-21T18:00:00.000Z',
          minutes: 20,
          xpAwarded: 20,
        },
      ],
      from: '2026-09-21',
      to: '2026-09-30',
      today: '2026-09-22',
    });
    expect(a).toEqual({ due: 2, done: 1, rate: 0.5 });
  });

  it('is null when nothing was due', () => {
    expect(
      routineAdherence({
        routines: [],
        completions: [],
        from: '2026-09-01',
        to: '2026-09-30',
        today: '2026-09-22',
      }).rate,
    ).toBeNull();
  });
});

describe('canTick', () => {
  it('refuses the future and days the routine does not fall on', () => {
    const s = spec({ freq: 'weekly', byWeekday: [1] });
    expect(canTick(s, '2026-09-28', '2026-09-23')).toMatchObject({ ok: false });
    expect(canTick(s, '2026-09-22', '2026-09-23')).toMatchObject({ ok: false });
    expect(canTick(s, '2026-09-21', '2026-09-23')).toMatchObject({ ok: true });
  });

  it('allows ticking today', () => {
    expect(canTick(spec(), '2026-09-23', '2026-09-23')).toMatchObject({ ok: true });
  });
});
