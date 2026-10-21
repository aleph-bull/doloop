import { expect, it } from 'vitest';
import { recognizeCalendarEvent } from '../services/calendar-recognition';

it.each([
  ['CSC108H1 Midterm', 'Personal', 'CSC108H1', 'assessment'],
  ['Homework 2 due', 'MATH 101', 'MATH101', 'task'],
  ['BIO-120 lecture', 'School', 'BIO120', null],
  ['Calculus: tutorial', 'School', 'Calculus', null],
  ['Pick up groceries', 'Personal', null, null],
  ['Meeting moved due to weather', 'Personal', null, null],
  ['Dentist Room 101', 'Personal', null, null],
  ['Exam', 'Personal', null, 'assessment'],
  ['CSC108 and MAT137 assignment due', 'Personal', null, 'task'],
])('recognizes %s', (title, calendarName, course, kind) => {
  expect(recognizeCalendarEvent({ title, calendarName }, [])).toEqual({ course, kind });
});

it('uses existing course names and recognizes description keywords', () => {
  expect(
    recognizeCalendarEvent(
      {
        title: 'Calculus worksheet',
        calendarName: 'School',
        description: 'Submission deadline at 5pm',
      },
      [{ id: 'course', title: 'Calculus' }],
    ),
  ).toEqual({ course: 'Calculus', kind: 'task' });
  expect(
    recognizeCalendarEvent({ title: 'CSC 108H1 quiz', calendarName: 'School' }, [
      { id: 'course', title: 'CSC108H1' },
    ]),
  ).toEqual({ course: 'CSC108H1', kind: 'assessment' });
});
