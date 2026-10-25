import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { streakEvents, users } from '../db/schema';
import { advanceClock, createTestApp, USER_A, type TestApp } from './helpers';

let t: TestApp;
// Monday 21 September 2026, 10:00 in Toronto.
beforeEach(async () => {
  t = await createTestApp('2026-09-21T14:00:00.000Z');
  await t.api({ method: 'GET', url: '/api/me' });
});
afterEach(() => t.close());

const DAY = 24 * 60;
const me = async () => (await t.api({ method: 'GET', url: '/api/me' })).json().user;

/** A free session of `minutes`; returns its end-of-session summary. */
async function study(minutes = 40) {
  const { active } = (
    await t.api({ method: 'POST', url: '/api/sessions', payload: { mode: 'unlimited' } })
  ).json();
  advanceClock(t, minutes);
  const res = await t.api({
    method: 'POST',
    url: `/api/sessions/${active.session.id}/end`,
    payload: { review: null },
  });
  return res.json().summary;
}

const count = (id: string, counted: boolean) =>
  t.api({ method: 'PUT', url: `/api/sessions/${id}/counted`, payload: { counted } });

describe('a session that does not count', () => {
  it('gives no hours, streak days or XP, and counting it again puts them back', async () => {
    const summary = await study();
    expect(summary.streak.current).toBe(1);
    expect(summary.streak.weeks).toEqual({ current: 1, longest: 1 });
    expect(summary.session.counted).toBe(true);
    const xpBefore = (await me()).xp;
    expect(xpBefore).toBeGreaterThan(0);

    const res = await count(summary.session.id, false);
    expect(res.statusCode).toBe(200);
    const off = res.json();
    expect(off.session.counted).toBe(false);
    expect(off.streak).toEqual({ current: 0, longest: 0, weeks: { current: 0, longest: 0 } });
    // The session's XP, and the first-session badge's, which no longer holds.
    expect(off.xpTotal).toBe(0);
    expect(off.badgesRevoked).toContain('first-session');
    const user = await me();
    expect(user.xp).toBe(0);
    expect(user.streak).toMatchObject({ current: 0, longest: 0, lastCountedDate: null });

    // Profiles show once setup is done.
    await t.db.update(users).set({ onboardedAt: new Date() }).where(eq(users.id, USER_A.id));
    const profile = (await t.api({ method: 'GET', url: '/api/profiles/me' })).json();
    expect(profile.stats.totalMinutes).toBe(0);
    const overview = (await t.api({ method: 'GET', url: '/api/analytics/overview' })).json();
    expect(overview.lifetime.totalMinutes).toBe(0);
    // Still in the history, marked.
    const history = (await t.api({ method: 'GET', url: '/api/sessions/history' })).json();
    expect(history.sessions[0]).toMatchObject({ id: summary.session.id, counted: false });

    const on = (await count(summary.session.id, true)).json();
    expect(on.session.counted).toBe(true);
    expect(on.streak).toEqual({ current: 1, longest: 1, weeks: { current: 1, longest: 1 } });
    expect(on.xpTotal).toBe(xpBefore);
    expect(on.session.badgesAwarded).toContain('first-session');
    expect(
      (await t.api({ method: 'GET', url: '/api/profiles/me' })).json().stats.totalMinutes,
    ).toBe(40);
  });

  it('keeps the day when another session still counts it', async () => {
    const first = await study();
    advanceClock(t, 60);
    const second = await study();
    expect(second.streak.current).toBe(1);

    expect((await count(second.session.id, false)).json().streak.current).toBe(1);
    expect((await count(first.session.id, false)).json().streak.current).toBe(0);
    expect((await count(second.session.id, true)).json().streak.current).toBe(1);
  });

  it('takes the day off the streak, which carries on from the day before', async () => {
    await study();
    advanceClock(t, DAY);
    const tuesday = await study();
    expect(tuesday.streak).toMatchObject({ current: 2, longest: 2 });

    const off = (await count(tuesday.session.id, false)).json();
    expect(off.streak).toMatchObject({ current: 1, longest: 1 });

    // Tuesday ends with nothing that counts, so Wednesday starts again.
    advanceClock(t, DAY);
    expect((await study()).streak).toMatchObject({ current: 1, longest: 1 });
  });

  it('hands back a freeze it spends again, never losing or doubling one', async () => {
    await study();
    await t.db.update(users).set({ xp: 1000 }).where(eq(users.id, USER_A.id));
    expect((await t.api({ method: 'POST', url: '/api/shop/freeze' })).statusCode).toBe(200);

    advanceClock(t, 2 * DAY); // Tuesday missed; Wednesday's session spends the freeze on it
    const wednesday = await study();
    expect(wednesday.streak.current).toBe(2);
    expect((await me()).streak.freezesHeld).toBe(0);

    const off = (await count(wednesday.session.id, false)).json();
    expect(off.streak.current).toBe(1);
    const user = await me();
    expect(user.streak.freezesHeld).toBe(0);
    const used = await t.db.query.streakEvents.findMany({
      where: and(eq(streakEvents.userId, USER_A.id), eq(streakEvents.type, 'freeze-used')),
    });
    expect(used.map((e) => e.date)).toEqual(['2026-09-22']);
  });

  it('refuses a session still running', async () => {
    const { active } = (
      await t.api({ method: 'POST', url: '/api/sessions', payload: { mode: 'unlimited' } })
    ).json();
    expect((await count(active.session.id, false)).statusCode).toBe(409);
  });
});
