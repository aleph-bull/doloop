import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TimerState } from '@komogon/core';
import { eq } from 'drizzle-orm';
import { nodes, sessions, users } from '../db/schema';
import { advanceClock, createTestApp, USER_A, USER_B, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-09-23T14:00:00.000Z');
  for (const token of [t.tokenA, t.tokenB]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
  await t.api({ method: 'PATCH', url: '/api/me/settings', payload: { profile: { name: 'Ada' } } });
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
});
afterAll(() => t.close());

const list = async (token?: string) =>
  (await t.api({ method: 'GET', url: '/api/social/notifications', token })).json();

describe('the bell on Social', () => {
  let postId: string;

  it('lists kudos, comments and nudges on your posts, newest first', async () => {
    const [course] = await t.db
      .insert(nodes)
      .values({ userId: USER_A.id, title: 'Calculus', kind: 'course' })
      .returning();
    const [s] = await t.db
      .insert(sessions)
      .values({
        userId: USER_A.id,
        nodeId: course!.id,
        startedAt: new Date('2026-09-23T12:00:00Z'),
        endedAt: new Date('2026-09-23T13:00:00Z'),
        mode: 'unlimited',
        workSeconds: 3600,
        timer: {} as TimerState,
      })
      .returning();
    postId = (
      await t.api({
        method: 'POST',
        url: '/api/social/posts',
        payload: { body: 'Done for today', sessionId: s!.id },
      })
    ).json().post.id;

    // Your own kudos on your own post isn't news.
    await t.api({ method: 'POST', url: `/api/posts/${postId}/like` });
    expect((await list()).notifications).toEqual([]);

    advanceClock(t, 1);
    await t.api({ method: 'POST', url: `/api/posts/${postId}/like`, token: t.tokenB });
    advanceClock(t, 1);
    await t.api({
      method: 'POST',
      url: `/api/posts/${postId}/comments`,
      token: t.tokenB,
      payload: { body: 'Nice one' },
    });
    advanceClock(t, 1);
    await t.api({
      method: 'POST',
      url: '/api/social/nudges',
      token: t.tokenB,
      payload: { userId: USER_A.id },
    });

    const res = await list();
    expect(res.notifications.map((n: { kind: string }) => n.kind)).toEqual([
      'nudge',
      'comment',
      'kudos',
    ]);
    expect(res.notifications[1]).toMatchObject({
      fromId: USER_B.id,
      postId,
      comment: 'Nice one',
      unread: true,
    });
    expect(res.posts[postId]).toMatchObject({ body: 'Done for today', subject: 'Calculus' });
    expect(res.people[USER_B.id]).toBeDefined();
    expect(res.unread).toBe(3);

    // Ben hears nothing about his own doing.
    expect((await list(t.tokenB)).notifications).toEqual([]);
  });

  it('opening the bell makes everything so far seen, and only later things are new', async () => {
    const seen = await t.api({ method: 'POST', url: '/api/social/notifications/seen' });
    expect(seen.statusCode).toBe(204);
    let res = await list();
    expect(res.unread).toBe(0);
    expect(res.notifications).toHaveLength(3);

    advanceClock(t, 5);
    await t.api({
      method: 'POST',
      url: `/api/posts/${postId}/comments`,
      token: t.tokenB,
      payload: { body: 'Again tomorrow?' },
    });
    res = await list();
    expect(res.unread).toBe(1);
    expect(res.notifications[0]).toMatchObject({ kind: 'comment', unread: true });
    expect(res.notifications[1].unread).toBe(false);
  });

  it('drops kudos taken back, and leaves out a suspended account', async () => {
    await t.api({ method: 'DELETE', url: `/api/posts/${postId}/like`, token: t.tokenB });
    let res = await list();
    expect(res.notifications.some((n: { kind: string }) => n.kind === 'kudos')).toBe(false);

    await t.db.update(users).set({ bannedAt: new Date() }).where(eq(users.id, USER_B.id));
    res = await list();
    expect(res.notifications).toEqual([]);
    await t.db.update(users).set({ bannedAt: null }).where(eq(users.id, USER_B.id));
  });

  it('looks back 30 days', async () => {
    expect((await list()).notifications.length).toBeGreaterThan(0);
    advanceClock(t, 31 * 24 * 60);
    expect((await list()).notifications).toEqual([]);
  });
});
