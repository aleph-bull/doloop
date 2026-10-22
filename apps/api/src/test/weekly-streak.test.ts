import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advanceClock, createTestApp, type TestApp } from './helpers';

let t: TestApp;
let routine = '';

// 2026-09-21 is a Monday in America/Toronto; 10:00 local.
beforeAll(async () => {
  t = await createTestApp('2026-09-21T14:00:00.000Z');
  await t.api({ method: 'GET', url: '/api/me' });
  routine = (
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
});
afterAll(() => t.close());

const DAY = 24 * 60;
const streak = async () => (await t.api({ method: 'GET', url: '/api/me' })).json().user.streak;

/** A 20-minute session, enough for a streak day; returns the end-of-session summary. */
async function study() {
  const { active } = (
    await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { routineId: routine, mode: 'unlimited' },
    })
  ).json();
  advanceClock(t, 20);
  const res = await t.api({
    method: 'POST',
    url: `/api/sessions/${active.session.id}/end`,
    payload: { review: { skipped: true } },
  });
  return res.json().summary;
}

describe('the weekly streak', () => {
  it('counts a week from its first streak day', async () => {
    const summary = await study();
    expect(summary.streak.weeks).toEqual({ current: 1, longest: 1 });
    expect((await streak()).weeks).toEqual({
      current: 1,
      longest: 1,
      lastCountedWeek: '2026-09-21',
    });
  });

  it('carries on through missed days that end the daily streak', async () => {
    advanceClock(t, 7 * DAY); // Monday the 28th
    const summary = await study();
    expect(summary.streak.current).toBe(1);
    expect(summary.streak.longest).toBe(1);
    expect(summary.streak.weeks).toEqual({ current: 2, longest: 2 });
  });

  it('gives a week of rest days no pass, in either streak', async () => {
    const res = await t.api({
      method: 'POST',
      url: '/api/rest-days/vacations',
      payload: { from: '2026-10-05', to: '2026-10-11', label: 'trip' },
    });
    expect(res.statusCode).toBe(201);
    advanceClock(t, 14 * DAY); // Monday 12 October, after a quiet week of vacation
    const s = await streak();
    expect(s.current).toBe(0);
    expect(s.weeks).toEqual({ current: 0, longest: 2, lastCountedWeek: '2026-10-05' });
  });

  it('asks for as many days a week as the setting says', async () => {
    const bad = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { streak: { daysPerWeek: 8 } },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { streak: { daysPerWeek: 2 } },
    });
    expect(ok.statusCode).toBe(200);

    expect((await study()).streak.weeks).toEqual({ current: 0, longest: 2 });
    advanceClock(t, DAY);
    expect((await study()).streak.weeks).toEqual({ current: 1, longest: 2 });
  });
});
