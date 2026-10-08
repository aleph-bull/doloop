import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advanceClock, createTestApp, type TestApp } from './helpers';

let t: TestApp;
let reading = '';
let weekly = '';

// 2026-09-21 is a Monday in America/Toronto; 10:00 local.
beforeAll(async () => {
  t = await createTestApp('2026-09-21T14:00:00.000Z');
  await t.api({ method: 'GET', url: '/api/me' });
  reading = (
    await t.api({
      method: 'POST',
      url: '/api/routines',
      payload: {
        title: 'Read 10 pages',
        estimatedMinutes: 30,
        freq: 'daily',
        startDate: '2026-09-21',
      },
    })
  ).json().routine.id;
  weekly = (
    await t.api({
      method: 'POST',
      url: '/api/routines',
      payload: {
        title: 'Problem set',
        estimatedMinutes: 60,
        freq: 'weekly',
        byWeekday: [3], // Wednesdays
        startDate: '2026-09-21',
      },
    })
  ).json().routine.id;
});
afterAll(() => t.close());

const start = (payload: Record<string, unknown>) =>
  t.api({ method: 'POST', url: '/api/sessions', payload });
const end = (id: string, payload: Record<string, unknown>) =>
  t.api({ method: 'POST', url: `/api/sessions/${id}/end`, payload });
const xpNow = async () => (await t.api({ method: 'GET', url: '/api/me' })).json().user.xp;
const occurrence = async (routineId: string, date: string) =>
  (await t.api({ method: 'GET', url: `/api/routines?from=${date}&to=${date}` }))
    .json()
    .occurrences.find((o: { routineId: string }) => o.routineId === routineId);

describe('routine sessions', () => {
  it('starts a timed session for a routine', async () => {
    const res = await start({ routineId: reading, mode: 'unlimited' });
    expect(res.statusCode).toBe(201);
    const { active } = res.json();
    expect(active.nodeTitle).toBe('Read 10 pages');
    expect(active.session).toMatchObject({
      nodeId: null,
      routineId: reading,
      routineDate: '2026-09-21',
    });
    // One session at a time, whatever it is for.
    expect((await start({ routineId: reading, mode: 'unlimited' })).statusCode).toBe(409);

    advanceClock(t, 40);
    const before = await xpNow();
    const summary = (
      await end(active.session.id, { review: { skipped: true }, markComplete: true })
    ).json().summary;
    expect(summary.routineTicked).toBe(true);
    expect(summary.nodeCompleted).toBe(false);
    // Study is study: a routine done under the timer keeps the streak going.
    expect(summary.streak.current).toBe(1);
    // 40 timed minutes out-earn the 30-minute tick, so the tick adds nothing on top.
    expect(summary.xp.total).toBeGreaterThan(30);
    expect((await xpNow()) - before).toBe(summary.xp.total);

    const occ = await occurrence(reading, '2026-09-21');
    expect(occ).toMatchObject({ done: true, xpAwarded: 0 });
  });

  it('tops a short session up to what a plain tick pays', async () => {
    t.clock.now = '2026-09-22T14:00:00.000Z';
    const id = (await start({ routineId: reading, mode: 'unlimited' })).json().active.session.id;
    advanceClock(t, 5);
    const before = await xpNow();
    const summary = (await end(id, { review: { skipped: true }, markComplete: true })).json()
      .summary;
    expect(summary.routineTicked).toBe(true);
    expect(summary.xp.total).toBeLessThan(30);
    // Never worth less than ticking it without the timer, never paid twice.
    expect((await xpNow()) - before).toBe(30);
  });

  it('leaves the routine open when the session ends without a tick', async () => {
    t.clock.now = '2026-09-23T14:00:00.000Z';
    const id = (await start({ routineId: weekly, mode: 'unlimited' })).json().active.session.id;
    advanceClock(t, 20);
    const summary = (await end(id, { review: { skipped: true } })).json().summary;
    expect(summary.routineTicked).toBe(false);
    expect(await occurrence(weekly, '2026-09-23')).toMatchObject({ done: false });
  });

  it('starts one for an overdue occurrence, and ticks that day', async () => {
    t.clock.now = '2026-09-24T14:00:00.000Z';
    const res = await start({ routineId: weekly, routineDate: '2026-09-23', mode: 'unlimited' });
    expect(res.statusCode).toBe(201);
    advanceClock(t, 10);
    await end(res.json().active.session.id, { review: { skipped: true }, markComplete: true });
    expect(await occurrence(weekly, '2026-09-23')).toMatchObject({ done: true });
  });

  it('refuses a day that cannot be ticked, and a start that names two things', async () => {
    t.clock.now = '2026-09-25T14:00:00.000Z';
    // Not a Wednesday.
    expect((await start({ routineId: weekly, mode: 'unlimited' })).statusCode).toBe(400);
    // Not yet.
    expect(
      (await start({ routineId: reading, routineDate: '2026-09-26', mode: 'unlimited' }))
        .statusCode,
    ).toBe(400);
    const node = (
      await t.api({ method: 'POST', url: '/api/nodes', payload: { title: 'Essay' } })
    ).json().node;
    expect(
      (await start({ nodeId: node.id, routineId: reading, mode: 'unlimited' })).statusCode,
    ).toBe(400);
    // Naming nothing is allowed: that is a free session.
    const free = await start({ mode: 'unlimited' });
    expect(free.statusCode).toBe(201);
    expect(free.json().active.nodeTitle).toBe('Free session');
    await end(free.json().active.session.id, {});
  });

  it('logs the session on the calendar under the routine name', async () => {
    const blocks = (await t.api({ method: 'GET', url: '/api/planned-blocks' })).json().blocks;
    const logged = blocks.filter((b: { source: string }) => b.source === 'session');
    expect(logged.length).toBeGreaterThan(0);
    expect(logged[0]).toMatchObject({ nodeId: null, title: expect.any(String) });
    expect(['Read 10 pages', 'Problem set']).toContain(logged[0].title);
  });
});
