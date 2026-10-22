import { describe, expect, it } from 'vitest';
import { looksLikeIcs, parseIcsDuration, readIcsFeed, resolveTzid } from './ics-feed';

const cal = (...lines: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');

const window = {
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-12-31T00:00:00.000Z',
  timezone: 'America/Toronto',
};

describe('readIcsFeed', () => {
  it('reads one-off events in UTC, in a named zone, and floating in the calendar zone', () => {
    const { name, events } = readIcsFeed(
      cal(
        'X-WR-CALNAME:Fall timetable',
        'X-WR-TIMEZONE:Europe/London',
        'BEGIN:VEVENT',
        'UID:a',
        'SUMMARY:Dentist',
        'DTSTART:20260922T140000Z',
        'DTEND:20260922T150000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:b',
        'SUMMARY:CSC108 lecture',
        'DTSTART;TZID=America/Toronto:20260923T090000',
        'DTEND;TZID=America/Toronto:20260923T103000',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:c',
        'SUMMARY:Call home',
        'DTSTART:20260924T180000',
        'DURATION:PT30M',
        'END:VEVENT',
      ),
      window,
    );
    expect(name).toBe('Fall timetable');
    expect(events.map((e) => [e.id, e.start, e.end])).toEqual([
      ['a', '2026-09-22T14:00:00.000Z', '2026-09-22T15:00:00.000Z'],
      ['b', '2026-09-23T13:00:00.000Z', '2026-09-23T14:30:00.000Z'],
      ['c', '2026-09-24T17:00:00.000Z', '2026-09-24T17:30:00.000Z'],
    ]);
  });

  it('ignores the fields of an alarm inside the event', () => {
    const { events } = readIcsFeed(
      cal(
        'BEGIN:VEVENT',
        'UID:a',
        'SUMMARY:Lab',
        'DESCRIPTION:Bring goggles',
        'DTSTART:20260922T140000Z',
        'DTEND:20260922T150000Z',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Reminder',
        'TRIGGER:-PT10M',
        'END:VALARM',
        'END:VEVENT',
      ),
      window,
    );
    expect(events[0]!.description).toBe('Bring goggles');
  });

  it('places all-day events on their days in the account zone and marks free time', () => {
    const { events } = readIcsFeed(
      cal(
        'BEGIN:VEVENT',
        'UID:reading',
        'SUMMARY:Reading week',
        'DTSTART;VALUE=DATE:20261012',
        'DTEND;VALUE=DATE:20261017',
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      ),
      window,
    );
    expect(events).toEqual([
      expect.objectContaining({
        start: '2026-10-12T04:00:00.000Z',
        end: '2026-10-17T04:00:00.000Z',
        allDay: true,
        free: true,
      }),
    ]);
  });

  it('gives a moment in time (a due date) one minute', () => {
    const { events } = readIcsFeed(
      cal(
        'BEGIN:VEVENT',
        'UID:due',
        'SUMMARY:Assignment 1 is due',
        'DTSTART:20261002T035900Z',
        'DTEND:20261002T035900Z',
        'END:VEVENT',
      ),
      window,
    );
    expect(events[0]!.end).toBe('2026-10-02T04:00:00.000Z');
  });

  it('repeats weekly on several days, keeping the local time across the DST change', () => {
    const { events } = readIcsFeed(
      cal(
        'BEGIN:VEVENT',
        'UID:lec',
        'SUMMARY:MAT137',
        'DTSTART;TZID=America/Toronto:20261026T100000',
        'DTEND;TZID=America/Toronto:20261026T110000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4',
        'END:VEVENT',
      ),
      window,
    );
    // Toronto leaves daylight time on Nov 1, so 10:00 moves from 14:00Z to 15:00Z.
    expect(events.map((e) => [e.id, e.start, e.end])).toEqual([
      ['lec/2026-10-26', '2026-10-26T14:00:00.000Z', '2026-10-26T15:00:00.000Z'],
      ['lec/2026-10-28', '2026-10-28T14:00:00.000Z', '2026-10-28T15:00:00.000Z'],
      ['lec/2026-11-02', '2026-11-02T15:00:00.000Z', '2026-11-02T16:00:00.000Z'],
      ['lec/2026-11-04', '2026-11-04T15:00:00.000Z', '2026-11-04T16:00:00.000Z'],
    ]);
  });

  it('honours UNTIL, INTERVAL, EXDATE and moved or cancelled occurrences', () => {
    const { events } = readIcsFeed(
      cal(
        'BEGIN:VEVENT',
        'UID:tut',
        'SUMMARY:Tutorial',
        'DTSTART;TZID=America/Toronto:20260907T130000',
        'DTEND;TZID=America/Toronto:20260907T140000',
        'RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261020T035959Z',
        'EXDATE;TZID=America/Toronto:20260921T130000',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:tut',
        'RECURRENCE-ID;TZID=America/Toronto:20261005T130000',
        'SUMMARY:Tutorial (room change)',
        'DTSTART;TZID=America/Toronto:20261006T150000',
        'DTEND;TZID=America/Toronto:20261006T160000',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:tut',
        'RECURRENCE-ID;TZID=America/Toronto:20261019T130000',
        'STATUS:CANCELLED',
        'DTSTART;TZID=America/Toronto:20261019T130000',
        'END:VEVENT',
      ),
      window,
    );
    expect(events.map((e) => [e.id, e.title, e.start])).toEqual([
      ['tut/2026-09-07', 'Tutorial', '2026-09-07T17:00:00.000Z'],
      ['tut/2026-10-05', 'Tutorial (room change)', '2026-10-06T19:00:00.000Z'],
    ]);
  });

  it('repeats monthly on the last Friday and yearly on a date', () => {
    const { events } = readIcsFeed(
      cal(
        'BEGIN:VEVENT',
        'UID:club',
        'SUMMARY:Book club',
        'DTSTART:20260925T230000Z',
        'DTEND:20260926T000000Z',
        'RRULE:FREQ=MONTHLY;BYDAY=-1FR',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:bday',
        'SUMMARY:Birthday',
        'DTSTART;VALUE=DATE:20201104',
        'RRULE:FREQ=YEARLY',
        'END:VEVENT',
      ),
      window,
    );
    expect(events.filter((e) => e.id.startsWith('club')).map((e) => e.start.slice(0, 10))).toEqual([
      '2026-09-25',
      '2026-10-30',
      '2026-11-27',
      '2026-12-25',
    ]);
    expect(events.filter((e) => e.id.startsWith('bday')).map((e) => e.id)).toEqual([
      'bday/2026-11-04',
    ]);
  });

  it('keeps only events that touch the window', () => {
    const { events } = readIcsFeed(
      cal(
        'BEGIN:VEVENT',
        'UID:old',
        'DTSTART:20250101T100000Z',
        'DTEND:20250101T110000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:daily',
        'DTSTART:20200101T100000Z',
        'DTEND:20200101T101500Z',
        'RRULE:FREQ=DAILY',
        'END:VEVENT',
      ),
      { ...window, to: '2026-09-04T00:00:00.000Z' },
    );
    expect(events.map((e) => e.id)).toEqual([
      'daily/2026-09-01',
      'daily/2026-09-02',
      'daily/2026-09-03',
    ]);
    expect(events[0]!.title).toBe('Busy');
  });

  it('skips cancelled events', () => {
    const { events } = readIcsFeed(
      cal(
        'BEGIN:VEVENT',
        'UID:x',
        'STATUS:CANCELLED',
        'DTSTART:20260922T140000Z',
        'DTEND:20260922T150000Z',
        'END:VEVENT',
      ),
      window,
    );
    expect(events).toEqual([]);
  });
});

describe('helpers', () => {
  it('reads Windows, prefixed and wordy zone names', () => {
    expect(resolveTzid('Eastern Standard Time')).toBe('America/New_York');
    expect(resolveTzid('/mozilla.org/20050126_1/America/Vancouver')).toBe('America/Vancouver');
    expect(resolveTzid('"(UTC-05:00) Eastern Time (US & Canada)"')).toBe('America/New_York');
    expect(resolveTzid('Nowhere Standard Time')).toBeNull();
  });

  it('reads durations', () => {
    expect(parseIcsDuration('PT1H30M')).toEqual({ days: 0, ms: 5_400_000 });
    expect(parseIcsDuration('P1W')).toEqual({ days: 7, ms: 0 });
    expect(parseIcsDuration('P')).toBeNull();
  });

  it('tells a calendar from a web page', () => {
    expect(looksLikeIcs('\uFEFFBEGIN:VCALENDAR\r\nVERSION:2.0')).toBe(true);
    expect(looksLikeIcs('<!doctype html><title>Sign in</title>')).toBe(false);
  });
});
