import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { streakEvents, users } from '../db/schema';
import { advanceClock, createTestApp, USER_A, type TestApp } from './helpers';

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

describe('a freeze on the weekly streak', () => {
  it('gives a short week its Monday, even with no daily streak', async () => {
    await study(); // week of 09-21
    advanceClock(t, 2 * DAY); // Wednesday: Tuesday was missed, the daily streak is over
    expect((await streak()).current).toBe(0);
    await t.db.update(users).set({ xp: 1000 }).where(eq(users.id, USER_A.id));
    expect((await t.api({ method: 'POST', url: '/api/shop/freeze' })).statusCode).toBe(200);

    advanceClock(t, 12 * DAY); // Monday 10-05, after a quiet week of 09-28
    expect(await streak()).toMatchObject({
      current: 0,
      freezesHeld: 0,
      weeks: { current: 1, longest: 1, lastCountedWeek: '2026-09-21', extended: 1 },
    });
    const used = await t.db.query.streakEvents.findMany({
      where: and(eq(streakEvents.userId, USER_A.id), eq(streakEvents.type, 'freeze-used')),
    });
    expect(used.map((e) => e.date)).toEqual(['2026-10-04']);

    expect((await study()).streak.weeks).toEqual({ current: 2, longest: 2 });
    expect((await streak()).weeks).toEqual({
      current: 2,
      longest: 2,
      lastCountedWeek: '2026-09-28',
      borrowed: 1,
    });
  });
});
