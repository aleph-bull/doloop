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
      payload: { title: 'Read 10 pages', estimatedMinutes: 30, freq: 'daily', startDate: '2026-09-20' },
    })
  ).json().routine.id;
});
afterAll(() => t.close());

const streak = async () => (await t.api({ method: 'GET', url: '/api/me' })).json().user.streak;
const tick = (date: string) =>
  t.api({ method: 'POST', url: `/api/routines/${routine}/tick`, payload: { date } });

describe('routine ticks and the streak', () => {
  it('a tick with no session never starts or keeps a streak', async () => {
    expect((await tick('2026-09-21')).statusCode).toBe(200);
    expect((await streak()).current).toBe(0);

    // The next day, the ticked day was judged: still nothing counted.
    advanceClock(t, 24 * 60);
    expect((await tick('2026-09-22')).statusCode).toBe(200);
    advanceClock(t, 24 * 60);
    const s = await streak();
    expect(s.current).toBe(0);
    expect(s.longest).toBe(0);
  });

  it('the data export carries routines and their ticks, without the owner column', async () => {
    const exp = (await t.api({ method: 'GET', url: '/api/me/export' })).json();
    expect(exp.routines).toHaveLength(1);
    expect(exp.routines[0]).toMatchObject({ id: routine, title: 'Read 10 pages' });
    expect(exp.routines[0]).not.toHaveProperty('userId');
    expect(exp.routineCompletions.map((c: { date: string }) => c.date).sort()).toEqual([
      '2026-09-21',
      '2026-09-22',
    ]);
    for (const key of ['trackers', 'gradeComponents', 'studyPlans', 'rewards', 'streakEvents'])
      expect(Array.isArray(exp[key])).toBe(true);
  });
});
