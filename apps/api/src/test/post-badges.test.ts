import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TimerState } from '@komogon/core';
import { sessions } from '../db/schema';
import { createTestApp, USER_A, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-09-23T14:00:00.000Z');
  for (const token of [t.tokenA, t.tokenB]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
});
afterAll(() => t.close());

/** A finished session of Ada's that unlocked two badges on day 4 of her streak. */
async function session() {
  const [s] = await t.db
    .insert(sessions)
    .values({
      userId: USER_A.id,
      startedAt: new Date('2026-09-23T09:00:00Z'),
      endedAt: new Date('2026-09-23T10:00:00Z'),
      mode: 'unlimited',
      workSeconds: 3600,
      timer: {} as TimerState,
      badgesAwarded: ['first-session', 'focus-5'],
      streak: 4,
    })
    .returning();
  return s!.id;
}

const feedPost = async (token: string, id: string) => {
  const feed = (await t.api({ method: 'GET', url: '/api/social/feed', token })).json();
  return feed.posts.find((p: { id: string }) => p.id === id);
};

describe('badges and the streak on a post', () => {
  it("shows the session's badges and the streak it ended on", async () => {
    const res = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { sessionId: await session() },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().post.id;
    expect(res.json().post.session).toMatchObject({
      badges: ['first-session', 'focus-5'],
      streak: 4,
    });
    expect((await feedPost(t.tokenB, id)).session).toMatchObject({ streak: 4 });

    // Kept to herself like the profile's stats: others see the post without them.
    await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { social: { stats: false } },
    });
    expect((await feedPost(t.tokenB, id)).session).toMatchObject({
      minutes: 60,
      badges: [],
      streak: null,
    });
    expect((await feedPost(t.tokenA, id)).session).toMatchObject({ streak: 4 });
  });

  it('leaves them off with the time', async () => {
    const res = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { sessionId: await session(), showTime: false },
    });
    expect(res.json().post.session).toBeNull();
  });
});
