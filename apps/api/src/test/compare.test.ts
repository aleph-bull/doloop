import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TimerState } from '@komogon/core';
import { sessions } from '../db/schema';
import { createTestApp, USER_A, USER_B, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-09-23T14:00:00.000Z');
  for (const token of [t.tokenA, t.tokenB]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
});
afterAll(() => t.close());

const finished = (userId: string, startedAt: string, workSeconds: number) => ({
  userId,
  startedAt: new Date(startedAt),
  endedAt: new Date(Date.parse(startedAt) + workSeconds * 1000),
  mode: 'unlimited' as const,
  workSeconds,
  timer: {} as TimerState,
});

describe('compare', () => {
  it('puts your weeks beside your friends, in your Monday weeks', async () => {
    await t.db
      .insert(sessions)
      .values([
        finished(USER_A.id, '2026-09-23T10:00:00Z', 5400),
        finished(USER_B.id, '2026-09-22T10:00:00Z', 1800),
      ]);
    const alone = (await t.api({ method: 'GET', url: '/api/social/compare' })).json();
    expect(alone.friends).toEqual([]);
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
    const res = await t.api({ method: 'GET', url: '/api/social/compare' });
    expect(res.statusCode).toBe(200);
    const { you, friends, weekStarts } = res.json();
    expect(weekStarts).toHaveLength(8);
    expect(weekStarts[7]).toBe('2026-09-21');
    expect(you).toMatchObject({
      userId: USER_A.id,
      thisWeek: 90,
      last28: 90,
      activeDays28: 1,
      sessionsThisWeek: 1,
      longest28: 90,
    });
    expect(you.weekly).toHaveLength(8);
    expect(friends).toHaveLength(1);
    expect(friends[0]).toMatchObject({ userId: USER_B.id, thisWeek: 30 });
  });
});
