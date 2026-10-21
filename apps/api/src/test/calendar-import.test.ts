import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { calendarImports, nodes, plannedBlocks } from '../db/schema';
import { importCalendarSnapshot } from '../services/calendar-import';
import type { AcademicEvent } from '../services/calendar-recognition';
import { createTestApp, USER_A, USER_B, type TestApp } from './helpers';

let t: TestApp;
const now = '2026-10-21T12:00:00.000Z';
const from = '2026-10-01T00:00:00.000Z',
  to = '2027-04-01T00:00:00.000Z';
const user = { id: USER_A.id, timezone: 'America/Toronto' };
const event = (patch: Partial<AcademicEvent> = {}): AcademicEvent => ({
  id: 'midterm',
  calendarId: 'school',
  calendarName: 'School',
  title: 'CSC108 Midterm',
  start: '2026-10-28T14:00:00.000Z',
  end: '2026-10-28T16:00:00.000Z',
  allDay: false,
  ...patch,
});
const sync = (events: AcademicEvent[], provider: 'google' | 'outlook' = 'google') =>
  importCalendarSnapshot(t.db, user, provider, events, from, to, now);
const list = () => t.db.query.nodes.findMany({ where: eq(nodes.userId, USER_A.id) });
beforeAll(async () => {
  t = await createTestApp(now);
  await t.api({ method: 'GET', url: '/api/me' });
  await t.api({ method: 'GET', url: '/api/me', token: t.tokenB });
});
beforeEach(async () => {
  await t.db.delete(calendarImports);
  await t.db.delete(plannedBlocks);
  await t.db.delete(nodes);
});
afterAll(() => t.close());

it('creates one course, one assessment and recurring commitments; repeated syncs are idempotent', async () => {
  const events = [
    event(),
    event({ id: 'lecture-1', title: 'CSC108 lecture' }),
    event({
      id: 'lecture-2',
      title: 'CSC108 lecture',
      start: '2026-11-04T14:00:00Z',
      end: '2026-11-04T15:00:00Z',
    }),
  ];
  expect(await sync(events)).toMatchObject({ courses: 1, tasks: 1, events: 3 });
  expect(await sync(events)).toMatchObject({ courses: 0, tasks: 0, events: 3 });
  const rows = await list();
  const course = rows.find((n) => n.kind === 'course')!;
  expect(rows).toHaveLength(2);
  expect(rows.find((n) => n.kind === 'assessment')).toMatchObject({
    parentId: course.id,
    title: 'CSC108 Midterm',
  });
  expect(await t.db.query.plannedBlocks.findMany()).toHaveLength(3);
});

it('updates imported deadlines but preserves user titles, due dates and completion', async () => {
  await sync([event()]);
  let task = (await list()).find((n) => n.kind === 'assessment')!;
  await sync([event({ start: '2026-10-29T14:00:00Z', end: '2026-10-29T16:00:00Z' })]);
  task = (await list()).find((n) => n.id === task.id)!;
  expect(task.dueAt!.toISOString()).toBe('2026-10-29T14:00:00.000Z');
  await t.db
    .update(nodes)
    .set({
      title: 'My exam preparation',
      dueAt: new Date('2026-10-26T12:00:00Z'),
      completedAt: new Date(now),
    })
    .where(eq(nodes.id, task.id));
  await sync([
    event({
      title: 'CSC108 Final exam',
      start: '2026-10-30T14:00:00Z',
      end: '2026-10-30T16:00:00Z',
    }),
  ]);
  task = (await list()).find((n) => n.id === task.id)!;
  expect(task.title).toBe('My exam preparation');
  expect(task.dueAt!.toISOString()).toBe('2026-10-26T12:00:00.000Z');
  expect(task.completedAt).not.toBeNull();
});

it('uses account-local end of day for date-only deadlines across DST', async () => {
  await sync([
    event({
      title: 'MAT137 assignment due',
      allDay: true,
      start: '2026-11-01T04:00:00Z',
      end: '2026-11-02T05:00:00Z',
    }),
  ]);
  const task = (await list()).find((n) => n.kind === 'task')!;
  expect(task.dueAt!.toISOString()).toBe('2026-11-02T04:59:59.999Z');
  expect((await t.db.query.plannedBlocks.findFirst())?.cancelled).toBe(true);
});

it('cancels missing events, archives untouched tasks and restores them if the event returns', async () => {
  await sync([event()]);
  await sync([]);
  expect((await list()).find((n) => n.kind === 'assessment')?.archived).toBe(true);
  expect((await t.db.query.plannedBlocks.findFirst())?.cancelled).toBe(true);
  await sync([event()]);
  expect((await list()).find((n) => n.kind === 'assessment')?.archived).toBe(false);
  expect((await list()).filter((n) => n.kind === 'assessment')).toHaveLength(1);
});

it('does not recreate a task the user deleted', async () => {
  await sync([event()]);
  const task = (await list()).find((n) => n.kind === 'assessment')!;
  await t.db.delete(nodes).where(eq(nodes.id, task.id));
  await sync([event()]);
  expect((await list()).filter((n) => n.kind === 'assessment')).toHaveLength(0);
});

it('archives an untouched deadline if the event stops describing academic work', async () => {
  await sync([event()]);
  await sync([event({ title: 'Office hours' })]);
  expect((await list()).find((n) => n.kind === 'assessment')?.archived).toBe(true);
  expect((await t.db.query.plannedBlocks.findFirst())?.cancelled).toBe(false);
});

it('reuses matching courses and tasks across providers and isolates users', async () => {
  await sync([event()]);
  await sync([event({ calendarId: 'outlook-school', id: 'other-id' })], 'outlook');
  expect(await list()).toHaveLength(2);
  const other = await t.db.query.nodes.findMany({ where: eq(nodes.userId, USER_B.id) });
  expect(other).toHaveLength(0);
  expect(
    await t.db.query.plannedBlocks.findMany({
      where: and(eq(plannedBlocks.userId, USER_A.id), eq(plannedBlocks.source, 'outlook')),
    }),
  ).toHaveLength(1);
});

it('imports ordinary appointments as commitments without creating study tasks', async () => {
  await sync([event({ title: 'Dentist', calendarName: 'Personal' })], 'outlook');
  expect(await list()).toHaveLength(0);
  const blocks = (await t.api({ method: 'GET', url: '/api/calendar/commitments' })).json().blocks;
  expect(blocks).toHaveLength(1);
  expect(blocks[0]).toMatchObject({ title: 'Dentist', source: 'outlook', nodeId: null });
});
