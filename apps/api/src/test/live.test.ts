import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nodes } from '../db/schema';
import { advanceClock, createTestApp, USER_B, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-09-23T14:00:00.000Z');
  for (const token of [t.tokenA, t.tokenB]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
  await t.api({
    method: 'PATCH',
    url: '/api/me/settings',
    token: t.tokenB,
    payload: { profile: { name: 'Ben' } },
  });
});
afterAll(() => t.close());

const live = async (token = t.tokenA) =>
  (await t.api({ method: 'GET', url: '/api/social/live', token })).json();

describe('friends studying now', () => {
  it('shows nobody to someone who is not a friend', async () => {
    const [task] = await t.db
      .insert(nodes)
      .values({ userId: USER_B.id, title: 'Organic chem', kind: 'task' })
      .returning();
    const started = await t.api({
      method: 'POST',
      url: '/api/sessions',
      token: t.tokenB,
      payload: { nodeId: task!.id, mode: 'unlimited' },
    });
    expect(started.statusCode).toBe(201);
    expect(await live()).toEqual({ live: [], people: {} });
  });

  it('shows a friend in a session, with how long and on what', async () => {
    const ask = (
      await t.api({
        method: 'POST',
        url: '/api/social/friends/requests',
        payload: { userId: USER_B.id },
      })
    ).json();
    await t.api({
      method: 'POST',
      url: `/api/social/friends/requests/${ask.friendship.requestId}/accept`,
      token: t.tokenB,
    });
    const res = await live();
    expect(res.live).toEqual([
      {
        userId: USER_B.id,
        startedAt: '2026-09-23T14:00:00.000Z',
        subject: 'Organic chem',
        state: 'focus',
      },
    ]);
    expect(res.people[USER_B.id].name).toBe('Ben');
    const profile = (await t.api({ method: 'GET', url: `/api/profiles/${USER_B.id}` })).json();
    expect(profile.live).toMatchObject({ subject: 'Organic chem', state: 'focus' });
  });

  it('keeps an open-ended session live while its app is still checking in', async () => {
    // Nothing about an open-ended timer changes, so only the check-ins keep it fresh.
    for (let i = 0; i < 4; i++) {
      advanceClock(t, 5);
      await t.api({ method: 'GET', url: '/api/sessions/active', token: t.tokenB });
    }
    expect((await live()).live).toHaveLength(1);
    // The app closes: ten minutes later the session no longer counts as live.
    advanceClock(t, 11);
    expect((await live()).live).toEqual([]);
    await t.api({ method: 'GET', url: '/api/sessions/active', token: t.tokenB });
    expect((await live()).live).toHaveLength(1);
  });

  it('says when they are paused', async () => {
    const active = (
      await t.api({ method: 'GET', url: '/api/sessions/active', token: t.tokenB })
    ).json().active;
    await t.api({
      method: 'POST',
      url: `/api/sessions/${active.session.id}/events`,
      token: t.tokenB,
      payload: { type: 'pause' },
    });
    expect((await live()).live[0].state).toBe('paused');
  });

  it('hides them when they turn it off', async () => {
    await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      token: t.tokenB,
      payload: { social: { live: false } },
    });
    expect((await live()).live).toEqual([]);
    const groups = (await t.api({ method: 'GET', url: '/api/social/groups' })).json();
    expect(groups.live).toEqual([]);
    const profile = (await t.api({ method: 'GET', url: `/api/profiles/${USER_B.id}` })).json();
    expect(profile.live).toBeNull();
  });
});
