import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayOfWeek,
  diffDays,
  eachDay,
  hoursBetween,
  isBetween,
  isValidDate,
  isValidTimezone,
  localHour,
  maxDate,
  minDate,
  minutesBetween,
  nextMonday,
  startOfMonth,
  startOfWeekMonday,
  toLocalDate,
  toLocalParts,
  tzOffsetMinutes,
  zonedMidnightUtc,
  zonedTimeUtc,
  compareDates,
  isoNow,
} from './dates';

const TOR = 'America/Toronto';

describe('toLocalDate', () => {
  it('converts an instant to the local calendar day', () => {
    // 03:30 UTC on Sep 21 is 23:30 on Sep 20 in Toronto (EDT, UTC-4)
    expect(toLocalDate('2026-09-21T03:30:00.000Z', TOR)).toBe('2026-09-20');
    expect(toLocalDate('2026-09-21T04:30:00.000Z', TOR)).toBe('2026-09-21');
    expect(toLocalDate(new Date('2026-09-21T04:30:00.000Z'), 'UTC')).toBe('2026-09-21');
  });

  it('handles Asia/Tokyo (UTC+9)', () => {
    expect(toLocalDate('2026-09-20T16:00:00.000Z', 'Asia/Tokyo')).toBe('2026-09-21');
  });
});

describe('toLocalParts / localHour', () => {
  it('returns wall-clock parts', () => {
    const p = toLocalParts('2026-09-21T03:30:15.000Z', TOR);
    expect(p).toEqual({ year: 2026, month: 9, day: 20, hour: 23, minute: 30, second: 15 });
    expect(localHour('2026-09-21T03:30:15.000Z', TOR)).toBe(23);
  });

  it('renders midnight as hour 0', () => {
    expect(localHour('2026-09-21T04:00:00.000Z', TOR)).toBe(0);
    expect(localHour(new Date('2026-09-21T00:00:00.000Z'), 'UTC')).toBe(0);
  });
});

describe('day arithmetic', () => {
  it('adds and diffs days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(diffDays('2026-01-01', '2026-12-31')).toBe(364);
    expect(diffDays('2026-09-20', '2026-09-10')).toBe(-10);
  });

  it('is unaffected by DST transitions', () => {
    // 2026-03-08 is the US spring-forward date.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(diffDays('2026-03-07', '2026-03-09')).toBe(2);
    // fall back 2026-11-01
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02');
  });

  it('knows the day of week', () => {
    expect(dayOfWeek('2026-09-20')).toBe(0); // Sunday
    expect(dayOfWeek('2026-09-21')).toBe(1); // Monday
    expect(dayOfWeek('2026-09-26')).toBe(6);
  });

  it('compares, mins, maxes, ranges', () => {
    expect(compareDates('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDates('2026-01-02', '2026-01-01')).toBe(1);
    expect(compareDates('2026-01-01', '2026-01-01')).toBe(0);
    expect(maxDate('2026-01-01', '2026-01-02')).toBe('2026-01-02');
    expect(minDate('2026-01-01', '2026-01-02')).toBe('2026-01-01');
    expect(isBetween('2026-01-05', '2026-01-01', '2026-01-10')).toBe(true);
    expect(isBetween('2026-01-11', '2026-01-01', '2026-01-10')).toBe(false);
  });

  it('finds Mondays', () => {
    expect(startOfWeekMonday('2026-09-20')).toBe('2026-09-14'); // Sunday -> previous Monday
    expect(startOfWeekMonday('2026-09-21')).toBe('2026-09-21');
    expect(startOfWeekMonday('2026-09-23')).toBe('2026-09-21');
    expect(nextMonday('2026-09-20')).toBe('2026-09-21');
    expect(nextMonday('2026-09-21')).toBe('2026-09-28'); // strictly after
    expect(nextMonday('2026-09-22')).toBe('2026-09-28');
  });

  it('iterates days inclusive', () => {
    expect([...eachDay('2026-02-27', '2026-03-02')]).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect([...eachDay('2026-03-02', '2026-03-01')]).toEqual([]);
  });

  it('start of month', () => {
    expect(startOfMonth('2026-09-20')).toBe('2026-09-01');
  });

  it('validates dates', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('nope')).toBe(false);
  });

  it('validates timezones', () => {
    expect(isValidTimezone(TOR)).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});

describe('zoned instants', () => {
  it('computes tz offsets on both sides of DST', () => {
    expect(tzOffsetMinutes(Date.parse('2026-07-01T12:00:00Z'), TOR)).toBe(-240);
    expect(tzOffsetMinutes(Date.parse('2026-01-01T12:00:00Z'), TOR)).toBe(-300);
    expect(tzOffsetMinutes(Date.parse('2026-07-01T12:00:00Z'), 'Europe/Berlin')).toBe(120);
  });

  it('finds local midnight in UTC', () => {
    expect(zonedMidnightUtc('2026-09-20', TOR).toISOString()).toBe('2026-09-20T04:00:00.000Z');
    expect(zonedMidnightUtc('2026-01-20', TOR).toISOString()).toBe('2026-01-20T05:00:00.000Z');
    expect(zonedMidnightUtc('2026-01-20', 'UTC').toISOString()).toBe('2026-01-20T00:00:00.000Z');
  });

  it('finds local midnight on DST transition days', () => {
    // Spring forward: Mar 8 2026 in Toronto. Midnight exists (transition is at 02:00).
    expect(zonedMidnightUtc('2026-03-08', TOR).toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(zonedMidnightUtc('2026-03-09', TOR).toISOString()).toBe('2026-03-09T04:00:00.000Z');
    // Fall back: Nov 1 2026.
    expect(zonedMidnightUtc('2026-11-01', TOR).toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(zonedMidnightUtc('2026-11-02', TOR).toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('finds a local wall time in UTC', () => {
    expect(zonedTimeUtc('2026-09-20', 16, 30, TOR).toISOString()).toBe('2026-09-20T20:30:00.000Z');
    // 03:00 on spring-forward day: valid (transition already happened at 02:00).
    expect(zonedTimeUtc('2026-03-08', 3, 0, TOR).toISOString()).toBe('2026-03-08T07:00:00.000Z');
  });

  it('measures hours and minutes between instants', () => {
    expect(hoursBetween('2026-09-20T00:00:00Z', '2026-09-20T06:00:00Z')).toBe(6);
    expect(hoursBetween(new Date('2026-09-20T06:00:00Z'), new Date('2026-09-20T00:00:00Z'))).toBe(
      -6,
    );
    expect(minutesBetween('2026-09-20T00:00:00Z', '2026-09-20T00:30:00Z')).toBe(30);
    expect(isoNow(new Date('2026-09-20T00:30:00Z'))).toBe('2026-09-20T00:30:00.000Z');
  });
});
