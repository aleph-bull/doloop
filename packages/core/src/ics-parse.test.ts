import { describe, expect, it } from 'vitest';
import { parseIcs, planIcsImport } from './ics-parse';

const crlf = (lines: string[]) => lines.join('\r\n');

const CAL = crlf([
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:weekly-seminar@example.com',
  'SUMMARY:Stats seminar',
  'DESCRIPTION:Bring the problem set\\, and a pen',
  'DTSTART;TZID=America/Toronto:20260921T090000',
  'DTEND;TZID=America/Toronto:20260921T103000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,TH;INTERVAL=1',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:one-off@example.com',
  'SUMMARY:Dentist',
  'DTSTART:20260922T140000Z',
  'DTEND:20260922T150000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:daily@example.com',
  'SUMMARY:Flashcards',
  'DTSTART;VALUE=DATE:20260921',
  'RRULE:FREQ=DAILY;UNTIL=20261231T000000Z',
  'END:VEVENT',
  'END:VCALENDAR',
]);

describe('parseIcs', () => {
  it('reads events, params, and escaped text', () => {
    const events = parseIcs(CAL);
    expect(events).toHaveLength(3);
    const seminar = events[0]!;
    expect(seminar.uid).toBe('weekly-seminar@example.com');
    expect(seminar.summary).toBe('Stats seminar');
    expect(seminar.description).toBe('Bring the problem set, and a pen');
    expect(seminar.start).toEqual({ date: '2026-09-21', minutes: 540, utc: false });
    expect(seminar.end).toEqual({ date: '2026-09-21', minutes: 630, utc: false });
    expect(seminar.rrule).toMatchObject({ FREQ: 'WEEKLY', BYDAY: 'MO,TH', INTERVAL: '1' });
  });

  it('reads all-day values as dates without a time', () => {
    expect(parseIcs(CAL)[2]!.start).toEqual({ date: '2026-09-21', minutes: null, utc: false });
  });

  it('undoes line folding', () => {
    const folded = crlf([
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:a',
      'SUMMARY:A very long title that the exporter',
      '  wrapped across two lines',
      'DTSTART:20260921T090000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ]);
    expect(parseIcs(folded)[0]!.summary).toBe(
      'A very long title that the exporter wrapped across two lines',
    );
  });

  it('tolerates rubbish without throwing', () => {
    expect(parseIcs('')).toEqual([]);
    expect(parseIcs('not a calendar at all')).toEqual([]);
    expect(parseIcs(crlf(['BEGIN:VEVENT', 'garbage line', 'END:VEVENT']))).toHaveLength(1);
  });

  it('handles a colon inside a quoted parameter', () => {
    const ics = crlf([
      'BEGIN:VEVENT',
      'DTSTART;TZID="Foo:Bar":20260921T090000',
      'SUMMARY:Odd',
      'END:VEVENT',
    ]);
    expect(parseIcs(ics)[0]!.start).toEqual({ date: '2026-09-21', minutes: 540, utc: false });
  });
});

describe('planIcsImport', () => {
  it('turns recurring events into drafts and reports the rest', () => {
    const plan = planIcsImport(parseIcs(CAL));
    expect(plan.candidates.map((c) => c.summary)).toEqual(['Stats seminar', 'Flashcards']);
    expect(plan.skipped).toEqual([{ summary: 'Dentist', reason: 'Does not repeat' }]);
  });

  it('maps BYDAY, INTERVAL, UNTIL and the duration', () => {
    const [seminar, flashcards] = planIcsImport(parseIcs(CAL)).candidates;
    expect(seminar!.draft).toMatchObject({
      title: 'Stats seminar',
      freq: 'weekly',
      interval: 1,
      byWeekday: [1, 4],
      startDate: '2026-09-21',
      estimatedMinutes: 90,
      endDate: null,
    });
    expect(flashcards!.draft).toMatchObject({
      freq: 'daily',
      endDate: '2026-12-31',
      // All-day events carry no duration, so the default estimate is used.
      estimatedMinutes: 30,
    });
  });

  it('honours a caller-supplied default estimate', () => {
    const plan = planIcsImport(parseIcs(CAL), 45);
    expect(plan.candidates[1]!.draft.estimatedMinutes).toBe(45);
  });

  it('strips ordinal prefixes from BYDAY', () => {
    const ics = crlf([
      'BEGIN:VEVENT',
      'UID:x',
      'SUMMARY:Monthly-ish',
      'DTSTART:20260903T090000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=2TH,-1FR',
      'END:VEVENT',
    ]);
    expect(planIcsImport(parseIcs(ics)).candidates[0]!.draft.byWeekday).toEqual([4, 5]);
  });

  it('reports unsupported frequencies rather than guessing', () => {
    const ics = crlf([
      'BEGIN:VEVENT',
      'UID:y',
      'SUMMARY:Annual review',
      'DTSTART:20260903T090000Z',
      'RRULE:FREQ=YEARLY',
      'END:VEVENT',
    ]);
    const plan = planIcsImport(parseIcs(ics));
    expect(plan.candidates).toEqual([]);
    expect(plan.skipped[0]!.reason).toContain('yearly');
  });

  it('reads BYMONTHDAY for monthly rules', () => {
    const ics = crlf([
      'BEGIN:VEVENT',
      'UID:z',
      'SUMMARY:Rent the textbook',
      'DTSTART:20260901T090000Z',
      'DTEND:20260901T091500Z',
      'RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15',
      'END:VEVENT',
    ]);
    expect(planIcsImport(parseIcs(ics)).candidates[0]!.draft).toMatchObject({
      freq: 'monthly',
      byMonthday: [1, 15],
      estimatedMinutes: 15,
    });
  });

  it('skips a recurring event with no start date', () => {
    const ics = crlf(['BEGIN:VEVENT', 'SUMMARY:Ghost', 'RRULE:FREQ=DAILY', 'END:VEVENT']);
    expect(planIcsImport(parseIcs(ics)).skipped[0]).toEqual({
      summary: 'Ghost',
      reason: 'No start date',
    });
  });
});
