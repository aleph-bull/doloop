import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers';

let t: TestApp;
// 2026-09-21 is a Monday in America/Toronto.
beforeAll(async () => {
  t = await createTestApp('2026-09-21T14:00:00.000Z');
  await t.api({ method: 'GET', url: '/api/me' }); // create the user
});
afterAll(() => t.close());

const board = () => t.api({ method: 'GET', url: '/api/trackers' });
const log = (id: string, payload: Record<string, unknown>) =>
  t.api({ method: 'POST', url: `/api/trackers/${id}/log`, payload });

describe('custom trackers', () => {
  let pages = '';

  it('starts with no trackers', async () => {
    const res = await board();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ trackers: [], widgets: [] });
  });

  it('creates a tracker', async () => {
    const res = await t.api({
      method: 'POST',
      url: '/api/trackers',
      payload: { title: 'Pages read', unitLabel: 'pages', dailyGoal: 40 },
    });
    expect(res.statusCode).toBe(201);
    pages = res.json().tracker.id;
    expect(res.json().tracker).toMatchObject({
      title: 'Pages read',
      unitLabel: 'pages',
      dailyGoal: 40,
      archived: false,
    });
  });

  it('rejects a tracker with no unit', async () => {
    const res = await t.api({
      method: 'POST',
      url: '/api/trackers',
      payload: { title: 'Nameless', unitLabel: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('logs an amount for today and builds a grid', async () => {
    const res = await log(pages, { amount: 30 });
    expect(res.statusCode).toBe(200);
    expect(res.json().entry).toMatchObject({ date: '2026-09-21', amount: 30 });

    const w = (await board()).json().widgets[0];
    expect(w.todayAmount).toBe(30);
    expect(w.grid.total).toBe(30);
    expect(w.grid.currentRun).toBe(1);
  });

  it('replaces the day by default and adds on request', async () => {
    expect((await log(pages, { amount: 25 })).json().entry.amount).toBe(25);
    expect((await log(pages, { amount: 10, mode: 'add' })).json().entry.amount).toBe(35);
    expect((await board()).json().widgets[0].todayAmount).toBe(35);
  });

  it('keeps one row per day rather than piling up entries', async () => {
    await log(pages, { amount: 12 });
    const w = (await board()).json().widgets[0];
    expect(w.grid.total).toBe(12);
    expect(w.grid.activeDays).toBe(1);
  });

  it('clears a day back to empty when it reaches zero', async () => {
    const res = await log(pages, { amount: 0 });
    expect(res.json().entry).toBeNull();
    const w = (await board()).json().widgets[0];
    expect(w.todayAmount).toBe(0);
    expect(w.grid.activeDays).toBe(0);
  });

  it('logs a past day', async () => {
    await log(pages, { amount: 50, date: '2026-09-19' });
    const w = (await board()).json().widgets[0];
    expect(w.grid.total).toBe(50);
    expect(w.grid.best).toEqual({ date: '2026-09-19', amount: 50 });
  });

  it('renames and re-goals a tracker', async () => {
    const res = await t.api({
      method: 'PATCH',
      url: `/api/trackers/${pages}`,
      payload: { title: 'Pages of Rudin', dailyGoal: 20 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tracker).toMatchObject({ title: 'Pages of Rudin', dailyGoal: 20 });
  });

  it('hides an archived tracker from the board', async () => {
    const other = (
      await t.api({
        method: 'POST',
        url: '/api/trackers',
        payload: { title: 'Kilometres', unitLabel: 'km' },
      })
    ).json().tracker.id;
    expect((await board()).json().widgets).toHaveLength(2);
    await t.api({ method: 'PATCH', url: `/api/trackers/${other}`, payload: { archived: true } });
    expect((await board()).json().widgets).toHaveLength(1);
  });

  it("will not touch another user's tracker", async () => {
    await t.api({ method: 'GET', url: '/api/me', token: t.tokenB });
    const res = await t.api({
      method: 'PATCH',
      url: `/api/trackers/${pages}`,
      payload: {},
      token: t.tokenB,
    });
    expect(res.statusCode).toBe(404);
  });

  it('deletes a tracker and its history', async () => {
    const res = await t.api({ method: 'DELETE', url: `/api/trackers/${pages}` });
    expect(res.statusCode).toBe(204);
    expect((await board()).json().trackers).toHaveLength(0);
  });
});
