import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TimerState } from '@komogon/core';
import { eq } from 'drizzle-orm';
import { signDevToken } from '../auth/verify';
import { sessions, users } from '../db/schema';
import { advanceClock, createTestApp, TEST_SECRET, USER_A, USER_B, type TestApp } from './helpers';

const USER_C = { id: '33333333-3333-4333-8333-333333333333', email: 'c@example.com' };

let t: TestApp;
let tokenC: string;
beforeAll(async () => {
  t = await createTestApp('2026-09-23T14:00:00.000Z');
  tokenC = await signDevToken(TEST_SECRET, USER_C);
  for (const token of [t.tokenA, t.tokenB, tokenC]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
  for (const [user, username] of [
    [USER_A, 'ada'],
    [USER_B, 'ben'],
    [USER_C, 'quiet.otter'],
  ] as const)
    await t.db.update(users).set({ username }).where(eq(users.id, user.id));
  // Ada and Ben are friends; Cleo (quiet.otter) knows neither.
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

let hour = 0;
/** One of Ada's sessions, posted. */
async function post(payload: Record<string, unknown> = {}): Promise<string> {
  hour++;
  const [s] = await t.db
    .insert(sessions)
    .values({
      userId: USER_A.id,
      startedAt: new Date(Date.UTC(2026, 8, 22, hour)),
      endedAt: new Date(Date.UTC(2026, 8, 22, hour, 30)),
      mode: 'unlimited',
      workSeconds: 1800,
      timer: {} as TimerState,
    })
    .returning();
  return (
    await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { body: 'Done', sessionId: s!.id, ...payload },
    })
  ).json().post.id;
}

const comment = async (postId: string, body: string, token = t.tokenB) => {
  advanceClock(t, 1);
  return (
    await t.api({ method: 'POST', url: `/api/posts/${postId}/comments`, token, payload: { body } })
  ).json();
};

const bell = async (token?: string) =>
  (await t.api({ method: 'GET', url: '/api/social/notifications', token })).json();

describe('@mentions in comments', () => {
  let postId: string;

  it('tells whoever a comment names, once', async () => {
    postId = await post();
    const res = await comment(postId, 'see you @quiet.otter. and @nobody');
    expect(res.comment.mentions).toEqual([USER_C.id]);
    expect(res.people[USER_C.id]).toMatchObject({ username: 'quiet.otter' });

    const c = await bell(tokenC);
    expect(c.notifications).toHaveLength(1);
    expect(c.notifications[0]).toMatchObject({
      kind: 'mention',
      fromId: USER_B.id,
      postId,
      comment: 'see you @quiet.otter. and @nobody',
      unread: true,
    });
    expect(c.posts[postId]).toMatchObject({ userId: USER_A.id, body: 'Done' });
    expect(c.unread).toBe(1);
  });

  it('shows a mention on your own post as its comment, and never your own @', async () => {
    await comment(postId, 'thanks @Ada @ben');
    const a = await bell();
    expect(a.notifications.map((n: { kind: string }) => n.kind)).toEqual(['comment', 'comment']);
    expect((await bell(t.tokenB)).notifications).toEqual([]);
  });

  it('lists who each comment names with the comments', async () => {
    const res = (await t.api({ method: 'GET', url: `/api/posts/${postId}/comments` })).json();
    expect(res.comments.map((c: { mentions: string[] }) => c.mentions)).toEqual([
      [USER_C.id],
      [USER_A.id],
    ]);
    expect(res.people[USER_C.id]).toBeDefined();
  });

  it("names nobody who can't see the post", async () => {
    const mine = await post({ friendsOnly: true });
    const res = await comment(mine, '@quiet.otter look');
    expect(res.comment.mentions).toEqual([]);
    expect((await bell(tokenC)).notifications).toHaveLength(1);
  });

  it('drops the mention when the post stops being theirs to see, or the comment goes', async () => {
    await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { social: { posts: 'friends' } },
    });
    expect((await bell(tokenC)).notifications).toEqual([]);
    await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { social: { posts: 'everyone' } },
    });
    const c = await bell(tokenC);
    expect(c.notifications).toHaveLength(1);

    const id = c.notifications[0].id.replace('mention:', '');
    await t.api({ method: 'DELETE', url: `/api/comments/${id}`, token: t.tokenB });
    expect((await bell(tokenC)).notifications).toEqual([]);
  });
});
