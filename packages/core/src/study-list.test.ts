import { describe, expect, it } from 'vitest';
import {
  STUDY_LIST,
  findStudyDate,
  parseStudyHours,
  parseStudyList,
  studyKey,
  studyListPrompt,
} from './study-list';

const TODAY = '2026-10-21';

describe('parseStudyList', () => {
  it('reads the format the prompt asks for, inside a code block', () => {
    const list = parseStudyList(
      [
        '```',
        'MAT137 | Problem set 3 | 2026-11-04 | 3 | task',
        'MAT137 | Midterm 1 | 2026-11-12 14:00 | 6 | assessment',
        'ECO101 | Read chapter 4 | 2026-10-28 | 1.5 | task',
        '```',
      ].join('\n'),
      TODAY,
    );
    expect(list.problems).toEqual([]);
    expect(list.courses.map((c) => c.title)).toEqual(['MAT137', 'ECO101']);
    expect(list.courses[0]!.items).toEqual([
      {
        title: 'Problem set 3',
        kind: 'task',
        dueDate: '2026-11-04',
        dueTime: null,
        estimatedMinutes: 180,
        line: 2,
      },
      {
        title: 'Midterm 1',
        kind: 'assessment',
        dueDate: '2026-11-12',
        dueTime: '14:00',
        estimatedMinutes: 360,
        line: 3,
      },
    ]);
    expect(list.courses[1]!.items[0]!.estimatedMinutes).toBe(90);
  });

  it('reads a markdown table with its own header order, carrying an empty course down', () => {
    const list = parseStudyList(
      [
        '| Course | Due | Item | Hours |',
        '|---|---|---|---|',
        '| **CSC148** | Nov 6 | Lab 5 | 2 |',
        '|  | Dec 10 | Final exam | 10 |',
      ].join('\n'),
      TODAY,
    );
    expect(list.problems).toEqual([]);
    expect(list.courses).toHaveLength(1);
    expect(list.courses[0]!.title).toBe('CSC148');
    expect(list.courses[0]!.items.map((i) => [i.title, i.dueDate, i.kind])).toEqual([
      ['Lab 5', '2026-11-06', 'task'],
      ['Final exam', '2026-12-10', 'assessment'],
    ]);
  });

  it('reads columns pasted from a spreadsheet', () => {
    const list = parseStudyList('PSY100\tEssay draft\t2026-11-20\t4', TODAY);
    expect(list.courses[0]!.items[0]).toMatchObject({
      title: 'Essay draft',
      dueDate: '2026-11-20',
      estimatedMinutes: 240,
    });
  });

  it('reads lines typed by hand that start with a course code', () => {
    const list = parseStudyList(
      [
        'CSC148 lab 5 due Nov 6',
        'ECO 101 midterm Nov 12 at 2pm 6h',
        'mat137 problem set 3, Tue Nov 4 3h',
      ].join('\n'),
      TODAY,
    );
    expect(list.problems).toEqual([]);
    expect(list.courses.map((c) => c.title)).toEqual(['CSC148', 'ECO101', 'MAT137']);
    expect(list.courses.map((c) => c.items[0])).toMatchObject([
      { title: 'Lab 5', dueDate: '2026-11-06', dueTime: null, estimatedMinutes: null },
      {
        title: 'Midterm',
        kind: 'assessment',
        dueDate: '2026-11-12',
        dueTime: '14:00',
        estimatedMinutes: 360,
      },
      { title: 'Problem set 3', dueDate: '2026-11-04', estimatedMinutes: 180 },
    ]);
  });

  it('puts lines under the course named above them', () => {
    const list = parseStudyList(
      [
        'Chemistry:',
        '- Lab report, Nov 3',
        '- Quiz 2 Nov 10',
        '',
        'MAT137',
        'Read 3.1 Oct 30',
      ].join('\n'),
      TODAY,
    );
    expect(list.problems).toEqual([]);
    expect(list.courses.map((c) => [c.title, c.items.map((i) => i.title)])).toEqual([
      ['Chemistry', ['Lab report', 'Quiz 2']],
      ['MAT137', ['Read 3.1']],
    ]);
    expect(list.courses[0]!.items[1]!.kind).toBe('assessment');
  });

  it('adds a course on its own line with nothing under it', () => {
    const list = parseStudyList('HIS201 |  |  |', TODAY);
    expect(list.courses).toEqual([{ title: 'HIS201', items: [] }]);
    expect(list.problems).toEqual([]);
  });

  it('reports lines it cannot use instead of guessing', () => {
    const list = parseStudyList(
      [
        'Finish the reading for next week, it is long',
        'MAT137 | Problem set 4 | next Tuesday | lots',
        'MAT137 | Problem set 4 | 2026-11-18 | 3',
        'MAT137 | Problem set 4 | 2026-11-18 | 3',
      ].join('\n'),
      TODAY,
    );
    expect(list.problems.map((p) => [p.line, p.message])).toEqual([
      [1, "Left out: it doesn't start with a course code. Try Course | Item | Due."],
      [2, 'No due date: couldn\'t read "next Tuesday".'],
      [2, 'No estimate: couldn\'t read "lots" as hours.'],
      [4, 'Left out: the same as line 3.'],
    ]);
    // The line with the unreadable date and estimate is still added, without them.
    expect(list.courses[0]!.items.map((i) => [i.dueDate, i.estimatedMinutes])).toEqual([
      [null, null],
      ['2026-11-18', 180],
    ]);
  });

  it('does not take "Week 10" or "Chapter 12" for a course code', () => {
    const list = parseStudyList('Week 10 quiz Nov 2', TODAY);
    expect(list.courses).toEqual([]);
    expect(list.problems).toHaveLength(1);
  });

  it('treats empty-looking cells as empty', () => {
    const list = parseStudyList('BIO120 | Field notes | TBD | ? |', TODAY);
    expect(list.problems).toEqual([]);
    expect(list.courses[0]!.items[0]).toMatchObject({ dueDate: null, estimatedMinutes: null });
  });

  it('matches courses however the code is spaced or cased', () => {
    const list = parseStudyList('ECO101 | A | 2026-11-01\neco 101 | B | 2026-11-02', TODAY);
    expect(list.courses).toHaveLength(1);
    expect(list.courses[0]!.items.map((i) => i.title)).toEqual(['A', 'B']);
    expect(studyKey('ECO 101')).toBe(studyKey('eco101'));
  });

  it('stops at the item limit and says so', () => {
    const lines = Array.from(
      { length: STUDY_LIST.MAX_ITEMS + 2 },
      (_, i) => `MAT137 | Item ${i} |`,
    );
    const list = parseStudyList(lines.join('\n'), TODAY);
    expect(list.courses[0]!.items).toHaveLength(STUDY_LIST.MAX_ITEMS);
    expect(list.problems).toHaveLength(2);
  });
});

describe('findStudyDate', () => {
  it('reads ISO dates with and without a time', () => {
    expect(findStudyDate('2026-11-04', TODAY)).toMatchObject({ date: '2026-11-04', time: null });
    expect(findStudyDate('2026-11-04T23:59', TODAY)).toMatchObject({ time: '23:59' });
    expect(findStudyDate('2026-11-04 9:30 am', TODAY)).toMatchObject({ time: '09:30' });
    expect(findStudyDate('2026-02-30', TODAY)).toBeNull();
  });

  it('reads month names either way round, with a weekday or a year', () => {
    expect(findStudyDate('Tuesday, November 4', TODAY)?.date).toBe('2026-11-04');
    expect(findStudyDate('4th of Nov', TODAY)?.date).toBe('2026-11-04');
    expect(findStudyDate('Nov 4, 2027', TODAY)?.date).toBe('2027-11-04');
    expect(findStudyDate('Dec 1 11:59pm', TODAY)).toMatchObject({
      date: '2026-12-01',
      time: '23:59',
    });
  });

  it('puts a yearless date that is long past into next year', () => {
    expect(findStudyDate('Jan 15', TODAY)?.date).toBe('2027-01-15');
    // Just gone stays this year, so it shows as overdue rather than a year away.
    expect(findStudyDate('Oct 20', TODAY)?.date).toBe('2026-10-20');
  });

  it('leaves a bare number after a date for the estimate', () => {
    const found = findStudyDate('Nov 4 3', TODAY)!;
    expect(found.time).toBeNull();
    expect('Nov 4 3'.slice(found.index + found.length)).toBe(' 3');
  });
});

describe('parseStudyHours', () => {
  it('reads the ways an estimate gets written', () => {
    expect(parseStudyHours('3')).toBe(180);
    expect(parseStudyHours('1.5 hours')).toBe(90);
    expect(parseStudyHours('~2h')).toBe(120);
    expect(parseStudyHours('90 min')).toBe(90);
    expect(parseStudyHours('1h30')).toBe(90);
    expect(parseStudyHours('2-3')).toBe(180);
    expect(parseStudyHours('')).toBeNull();
    expect(parseStudyHours('n/a')).toBeNull();
    expect(parseStudyHours('lots')).toBeUndefined();
  });
});

describe('studyListPrompt', () => {
  it("names today's date and the column order the parser expects", () => {
    const prompt = studyListPrompt(TODAY);
    expect(prompt).toContain('Today is 2026-10-21.');
    expect(prompt).toContain('Course | Item | Due | Hours | Type');
  });
});
