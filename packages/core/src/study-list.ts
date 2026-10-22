import type { ISODate } from './types';

/**
 * A pasted list of courses and what's due in them, read into something Komodon can add in
 * one go. The list can be an AI chat's answer to `studyListPrompt`, columns copied out of
 * a spreadsheet, or lines typed by hand:
 *
 *   MAT137 | Problem set 3 | 2026-11-04 | 3 | task
 *   ECO101	Midterm	2026-11-12 14:00	6
 *   CSC148 lab 5 due Nov 6
 *
 * Columns are split on "|" or tabs (so a markdown table works too) in the order
 * Course, Item, Due, Hours, Type, unless a header row names them in another order. An
 * empty course cell is the course above it. A line without columns starts with a course
 * code, or sits under a line naming the course ("MAT137", "Chemistry:").
 *
 * Nothing is guessed quietly: a line it can't use, or a date or estimate it can't read,
 * comes back in `problems` with the line it was on.
 */

export interface StudyListItem {
  title: string;
  kind: 'assessment' | 'task';
  /** Calendar day in the user's timezone, or null when none was given. */
  dueDate: ISODate | null;
  /** "HH:MM", or null when the date had no time. */
  dueTime: string | null;
  estimatedMinutes: number | null;
  /** The line of the paste it came from, counting from 1. */
  line: number;
}

export interface StudyListCourse {
  title: string;
  items: StudyListItem[];
}

export interface StudyListProblem {
  line: number;
  text: string;
  message: string;
}

export interface StudyList {
  courses: StudyListCourse[];
  problems: StudyListProblem[];
}

export const STUDY_LIST = {
  /** Longest title kept for a course or an item; the API allows 200. */
  MAX_TITLE: 200,
  /** Most items one paste can add. */
  MAX_ITEMS: 500,
  /** Most courses one paste can add. */
  MAX_COURSES: 60,
  /** A date written without a year is this year's, unless that is this far in the past. */
  PAST_GRACE_DAYS: 60,
} as const;

/** The key courses are matched by, as in the calendar import: "ECO 101" and "eco101" agree. */
export function studyKey(title: string): string {
  return title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** What to paste into an AI chat, along with course outlines, to get a list back. */
export function studyListPrompt(today: ISODate): string {
  return [
    "I'm setting up a study planner. From the course outlines, syllabi or screenshots I share, list everything I still have to hand in or sit this term: assignments, readings, labs, quizzes, tests and exams.",
    '',
    'Reply with only a code block, one item per line, in this form:',
    'Course | Item | Due | Hours | Type',
    '',
    '- Course: the course code if it has one (like MAT137), otherwise a short name',
    '- Item: a short name, like "Problem set 3" or "Midterm 1"',
    `- Due: YYYY-MM-DD, plus HH:MM in 24-hour time if a time is given. Today is ${today}.`,
    '- Hours: a rough guess at how many hours of work it needs, as a number',
    '- Type: assessment for quizzes, tests and exams, task for everything else',
    '',
    "Leave out anything already past. If a date isn't clear, leave Due empty instead of guessing. No header row and no notes outside the code block.",
  ].join('\n');
}

type Column = 'course' | 'item' | 'due' | 'hours' | 'type' | 'other';

const DEFAULT_COLUMNS: Column[] = ['course', 'item', 'due', 'hours', 'type'];

const HEADER_WORDS: Array<[Exclude<Column, 'other'>, RegExp]> = [
  ['course', /^(?:course|class|subject|course code|code)$/i],
  ['item', /^(?:item|task|title|name|what|assignment|deliverable|assessment|work)$/i],
  ['due', /^(?:due|due date|date|deadline|when)$/i],
  ['hours', /^(?:hours?|hrs?|estimate|est\.?|estimated hours|time)$/i],
  ['type', /^(?:type|kind|category)$/i],
];

/** A course code: letters then digits, "MAT137", "ECO 101", "CSC-148H1". */
const CODE = /^([a-z]{2,8})[ -]?(\d{2,4}[a-z]?\d?)(?![\p{L}\p{N}])/iu;

/** Words that look like a code beside a number but name something else ("Week 10"). */
const NOT_CODES =
  /^(?:week|wk|chapter|chap|ch|unit|lab|lecture|lec|tut|tutorial|module|part|section|sec|problem|problems|set|ps|assignment|hw|homework|quiz|test|exam|midterm|term|day|room|page|pages|pp|question|essay|project|reading|step|level|grade|year)$/i;

const ASSESSMENT = /\b(?:mid[ -]?terms?|exams?|examination|finals?|quiz(?:zes)?|tests?)\b/i;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const WEEKDAY = String.raw`(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+)?`;

const ISO_DATE = /\b(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/;
const MONTH_FIRST = new RegExp(
  String.raw`\b${WEEKDAY}${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?`,
  'i',
);
const DAY_FIRST = new RegExp(
  String.raw`\b${WEEKDAY}(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH}(?:,?\s+(\d{4})\b)?`,
  'i',
);
/** A time straight after a date: "14:00", "T23:59", "at 5pm", ", 11:59 p.m.". */
const TIME_AFTER =
  /^(?:\s*,)?(?:\s*|T)(?:at\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i;

/** What a list writes for "nothing here". */
const BLANK = /^(?:|-+|–|—|n\/?a|none|tbd|tba|unknown|\?+|no date)$/i;

interface FoundDate {
  date: ISODate;
  time: string | null;
  index: number;
  length: number;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const back = new Date(Date.UTC(y, m - 1, d));
  return back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
}

function daysBetween(a: ISODate, b: ISODate): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}

/**
 * A clock time from its parts, only when it really is one: "5pm", "17:00", "9:30 am". A
 * bare number is not ("Nov 4 3" is an estimate after a date).
 */
function clock(h: string, min: string | undefined, meridiem: string | undefined): string | null {
  if (min === undefined && !meridiem) return null;
  let hour = Number(h);
  const minute = min === undefined ? 0 : Number(min);
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem.toLowerCase().startsWith('p') ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

/** The first date in `text`, and the stretch it takes up, so the rest can be the title. */
export function findStudyDate(text: string, today: ISODate): FoundDate | null {
  let found: { y: number; m: number; d: number; index: number; length: number } | null = null;
  const iso = ISO_DATE.exec(text);
  if (iso && validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))) {
    found = {
      y: Number(iso[1]),
      m: Number(iso[2]),
      d: Number(iso[3]),
      index: iso.index,
      length: iso[0].length,
    };
  } else {
    // "Nov 4" before "4 Nov": in "Problem set 3 Nov 4" the date is the fourth.
    const named =
      ((m) => m && { m, month: m[1]!, day: m[2]!, year: m[3] })(MONTH_FIRST.exec(text)) ||
      ((m) => m && { m, month: m[2]!, day: m[1]!, year: m[3] })(DAY_FIRST.exec(text));
    if (named) {
      const month = MONTHS.indexOf(named.month.slice(0, 3).toLowerCase()) + 1;
      const day = Number(named.day);
      let year = named.year ? Number(named.year) : Number(today.slice(0, 4));
      // "Jan 15" written in October is next January's.
      if (
        !named.year &&
        validDate(year, month, day) &&
        daysBetween(`${year}-${pad(month)}-${pad(day)}`, today) > STUDY_LIST.PAST_GRACE_DAYS
      )
        year += 1;
      if (validDate(year, month, day))
        found = { y: year, m: month, d: day, index: named.m.index, length: named.m[0].length };
    }
  }
  if (!found) return null;
  const after = TIME_AFTER.exec(text.slice(found.index + found.length));
  const time = after ? clock(after[1]!, after[2], after[3]) : null;
  return {
    date: `${found.y}-${pad(found.m)}-${pad(found.d)}`,
    time,
    index: found.index,
    length: found.length + (time && after ? after[0].length : 0),
  };
}

function minutes(n: number): number | undefined {
  if (!Number.isFinite(n) || n < 0 || n > 100_000) return undefined;
  return Math.round(n);
}

/**
 * Hours as written in an estimate column: "3", "3h", "1.5 hours", "90 min", "1h30", "2-3"
 * (the larger end). Null when left empty, undefined when it can't be read.
 */
export function parseStudyHours(text: string): number | null | undefined {
  const s = text
    .trim()
    .replace(/^(?:~|about|approx\.?|around)\s*/i, '')
    .trim();
  if (BLANK.test(s)) return null;
  const hm =
    /^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(?:(\d{1,2})\s*(?:m(?:in(?:utes?|s)?)?)?)?$/i.exec(s);
  if (hm) return minutes(Number(hm[1]) * 60 + Number(hm[2] ?? 0));
  const m = /^(\d+)\s*m(?:in(?:utes?|s)?)?$/i.exec(s);
  if (m) return minutes(Number(m[1]));
  const range = /^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(?:h(?:ours?|rs?)?)?$/i.exec(s);
  if (range) return minutes(Math.max(Number(range[1]), Number(range[2])) * 60);
  const plain = /^(\d+(?:\.\d+)?)\s*(?:h(?:ours?|rs?)?)?$/i.exec(s);
  if (plain) return minutes(Number(plain[1]) * 60);
  return undefined;
}

/** An estimate inside a line typed by hand: "3h", "2 hours", "90 min". */
const HOURS_IN_TEXT =
  /(?:^|\s|\()~?\s*(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|mins?|minutes?)(?=$|[\s,.;)])/i;

function kindOf(typeCell: string, title: string): StudyListItem['kind'] {
  const t = typeCell.trim();
  if (/assess|exam|mid[ -]?term|final|quiz|test/i.test(t)) return 'assessment';
  if (t) return 'task';
  return ASSESSMENT.test(title) ? 'assessment' : 'task';
}

function clean(text: string): string {
  return text
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A title from what is left of a line once its course, date and estimate are taken out. */
function leftover(text: string): string {
  const t = clean(text)
    .replace(/\(\s*\)/g, '')
    .replace(/(?:\s+|^)(?:due|by|on|at)\s*[,;:–—-]*\s*$/i, '')
    .replace(/^(?:due|by|on)\s+/i, '')
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '')
    .trim();
  return t.charAt(0).toLocaleUpperCase() + t.slice(1);
}

function cut(text: string, index: number, length: number): string {
  return `${text.slice(0, index)} ${text.slice(index + length)}`;
}

function splitCells(line: string): string[] | null {
  if (line.includes('\t')) return line.split('\t').map(clean);
  if (!line.includes('|')) return null;
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map(clean);
}

/** A header row's columns, when it is one: at least two known names, one of them Course. */
function headerColumns(cells: string[]): Column[] | null {
  const cols = cells.map((c) => HEADER_WORDS.find(([, re]) => re.test(c))?.[0] ?? 'other');
  if (cols.filter((c) => c !== 'other').length < 2 || !cols.includes('course')) return null;
  return cols;
}

/** A course code at the start of a line, and the rest of the line after it. */
function leadingCode(text: string): { code: string; rest: string } | null {
  const m = CODE.exec(text);
  if (!m || NOT_CODES.test(m[1]!)) return null;
  return { code: `${m[1]}${m[2]}`.toUpperCase(), rest: text.slice(m[0].length) };
}

export function parseStudyList(text: string, today: ISODate): StudyList {
  const courses = new Map<string, StudyListCourse>();
  const problems: StudyListProblem[] = [];
  const seen = new Map<string, number>();
  let columns = DEFAULT_COLUMNS;
  let current: StudyListCourse | null = null;
  let count = 0;

  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((raw, i) => {
      const line = i + 1;
      const trimmed = raw.trim();
      const problem = (message: string) => problems.push({ line, text: trimmed, message });
      // Blank lines, code fences, headings and a markdown table's rule carry nothing.
      if (!trimmed || /^(?:```|~~~)/.test(trimmed) || /^#{1,6}\s/.test(trimmed)) return;
      if (/^\|?[\s:|-]*-{2,}[\s:|-]*$/.test(trimmed)) return;
      const body = trimmed.replace(/^(?:[-*•]|\d{1,3}[.)])\s+/, '');

      const courseFor = (title: string): StudyListCourse | null => {
        const name = title.slice(0, STUDY_LIST.MAX_TITLE);
        const key = studyKey(name);
        if (!key) return null;
        let c = courses.get(key);
        if (!c) {
          if (courses.size >= STUDY_LIST.MAX_COURSES) {
            problem(`Left out: one list can add up to ${STUDY_LIST.MAX_COURSES} courses.`);
            return null;
          }
          c = { title: name, items: [] };
          courses.set(key, c);
        }
        return c;
      };

      let course: StudyListCourse | null;
      let title: string;
      let dueDate: ISODate | null = null;
      let dueTime: string | null = null;
      let estimatedMinutes: number | null = null;
      let typeText = '';

      const cells = splitCells(body);
      if (cells) {
        if (cells.every((c) => !c)) return;
        const header = headerColumns(cells);
        if (header) {
          columns = header;
          return;
        }
        const cell = (col: Column) => {
          const at = columns.indexOf(col);
          return at < 0 ? '' : (cells[at] ?? '');
        };
        const courseText = cell('course');
        course = courseText ? courseFor(courseText) : current;
        if (!course) {
          if (!courseText) problem('Left out: no course on this line.');
          return;
        }
        title = cell('item');
        typeText = cell('type');
        const dueText = cell('due');
        if (!BLANK.test(dueText)) {
          const found = findStudyDate(dueText, today);
          if (found) {
            dueDate = found.date;
            dueTime = found.time;
          } else if (title) problem(`No due date: couldn't read "${dueText}".`);
        }
        const hoursText = cell('hours');
        const est = parseStudyHours(hoursText);
        if (est === undefined) {
          if (title) problem(`No estimate: couldn't read "${hoursText}" as hours.`);
        } else estimatedMinutes = est;
      } else {
        const textLine = clean(body);
        if (textLine.endsWith(':')) {
          // "MAT137:", "MAT137 - Calculus:" and "Chemistry:" name the course for what follows.
          const name = textLine.slice(0, -1).trim();
          current = courseFor(leadingCode(name)?.code ?? name) ?? current;
          return;
        }
        const lead = leadingCode(textLine);
        let rest = lead ? lead.rest : textLine;
        const found = findStudyDate(rest, today);
        if (lead) course = courseFor(lead.code);
        else if (current) course = current;
        else if (!found && textLine.split(' ').length <= 4) {
          // A short line on its own, before anything else, is a course to add.
          current = courseFor(textLine) ?? current;
          return;
        } else
          return void problem(
            "Left out: it doesn't start with a course code. Try Course | Item | Due.",
          );
        if (!course) return;
        if (found) {
          dueDate = found.date;
          dueTime = found.time;
          rest = cut(rest, found.index, found.length);
        }
        const hours = HOURS_IN_TEXT.exec(rest);
        if (hours) {
          const n = Number(hours[1]);
          estimatedMinutes = minutes(hours[2]!.toLowerCase().startsWith('h') ? n * 60 : n) ?? null;
          rest = cut(rest, hours.index, hours[0].length);
        }
        title = leftover(rest);
      }

      current = course;
      title = clean(title).slice(0, STUDY_LIST.MAX_TITLE);
      if (!title) return; // Only a course: it is added, with nothing under it yet.

      const key = `${studyKey(course.title)}|${studyKey(title)}|${dueDate ?? ''}`;
      const earlier = seen.get(key);
      if (earlier !== undefined) return void problem(`Left out: the same as line ${earlier}.`);
      if (count >= STUDY_LIST.MAX_ITEMS)
        return void problem(`Left out: one list can add up to ${STUDY_LIST.MAX_ITEMS} items.`);
      seen.set(key, line);
      count += 1;
      course.items.push({
        title,
        kind: kindOf(typeText, title),
        dueDate,
        dueTime,
        estimatedMinutes,
        line,
      });
    });

  return { courses: [...courses.values()], problems };
}
