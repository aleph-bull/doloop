import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TimerState } from '@komogon/core';
import { nodes, sessions } from '../db/schema';
import { createTestApp, USER_A, USER_B, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-09-23T14:00:00.000Z');
  for (const token of [t.tokenA, t.tokenB]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
  await t.api({ method: 'PATCH', url: '/api/me/settings', payload: { profile: { name: 'Ada' } } });
  await t.api({
    method: 'PATCH',
    url: '/api/me/settings',
    token: t.tokenB,
    payload: { profile: { name: 'Ben' } },
  });
});
afterAll(() => t.close());

const finished = (userId: string, startedAt: string, workSeconds: number, nodeId?: string) => ({
  userId,
  nodeId: nodeId ?? null,
  startedAt: new Date(startedAt),
  endedAt: new Date(Date.parse(startedAt) + workSeconds * 1000),
  mode: 'unlimited' as const,
  workSeconds,
  timer: {} as TimerState,
});

// Four bytes of "video": the route checks the type and size, not the codec.
const MP4 = 'data:video/mp4;base64,AAAAGA==';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQ';

describe('posts on the feed', () => {
  let sessionId: string;
  let sessionB: string;
  let postId: string;

  it('shares a session with its minutes and subject, plus a video', async () => {
    const [course] = await t.db
      .insert(nodes)
      .values({ userId: USER_A.id, title: 'Linear algebra', kind: 'course' })
      .returning();
    const [s] = await t.db
      .insert(sessions)
      .values(finished(USER_A.id, '2026-09-23T10:00:00Z', 5400, course!.id))
      .returning();
    sessionId = s!.id;
    const [sb] = await t.db
      .insert(sessions)
      .values(finished(USER_B.id, '2026-09-22T10:00:00Z', 1800))
      .returning();
    sessionB = sb!.id;

    // Every post is about a session: without one it is refused.
    const nothing = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { body: 'Hi' },
    });
    expect(nothing.statusCode).toBe(400);

    const res = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { body: 'Good morning.', sessionId, media: MP4, poster: JPEG },
    });
    expect(res.statusCode).toBe(201);
    const { post, people } = res.json();
    postId = post.id;
    expect(post).toMatchObject({
      userId: USER_A.id,
      body: 'Good morning.',
      session: { minutes: 90, subject: 'Linear algebra' },
      media: { mime: 'video/mp4', bytes: 4, poster: JPEG },
      likes: 0,
      liked: false,
      comments: 0,
      you: true,
    });
    expect(people[USER_A.id]).toMatchObject({ name: 'Ada', avatarUrl: null });
    expect(res.body).not.toContain('@example.com');
  });

  it("refuses someone else's session, a wrong video type and a poster alone", async () => {
    const theirs = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      token: t.tokenB,
      payload: { sessionId },
    });
    expect(theirs.statusCode).toBe(404);
    const gif = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { sessionId, media: 'data:image/gif;base64,AAAA' },
    });
    expect(gif.statusCode).toBe(400);
    const poster = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { sessionId, body: 'Hi', poster: JPEG },
    });
    expect(poster.statusCode).toBe(400);
  });

  it('takes a picture too, but no poster with it', async () => {
    const pic = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { sessionId, media: 'data:image/png;base64,iVBORw0KGgo=' },
    });
    expect(pic.statusCode).toBe(201);
    expect(pic.json().post.media).toEqual({ mime: 'image/png', bytes: 8, poster: null });
    const withPoster = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { sessionId, media: 'data:image/png;base64,iVBORw0KGgo=', poster: JPEG },
    });
    expect(withPoster.statusCode).toBe(400);
    await t.api({ method: 'DELETE', url: `/api/posts/${pic.json().post.id}` });
  });

  it('serves the video as bytes to anyone signed in', async () => {
    const res = await t.api({ method: 'GET', url: `/api/posts/${postId}/media`, token: t.tokenB });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.rawPayload).toEqual(Buffer.from('AAAAGA==', 'base64'));
  });

  it('lists the feed newest first, with a cursor', async () => {
    t.clock.now = '2026-09-23T15:00:00.000Z';
    await t.api({
      method: 'POST',
      url: '/api/social/posts',
      token: t.tokenB,
      payload: { body: 'Afternoon.', sessionId: sessionB },
    });
    const page = (await t.api({ method: 'GET', url: '/api/social/feed?limit=1' })).json();
    expect(page.posts.map((p: { body: string }) => p.body)).toEqual(['Afternoon.']);
    expect(page.nextBefore).toBe('2026-09-23T15:00:00.000Z');
    const next = (
      await t.api({ method: 'GET', url: `/api/social/feed?limit=1&before=${page.nextBefore}` })
    ).json();
    expect(next.posts.map((p: { body: string }) => p.body)).toEqual(['Good morning.']);
    // A full page may have more behind it; an empty one ends the walk.
    const end = (
      await t.api({ method: 'GET', url: `/api/social/feed?limit=1&before=${next.nextBefore}` })
    ).json();
    expect(end).toMatchObject({ posts: [], nextBefore: null });
  });

  it('likes once per person, and counts for everyone', async () => {
    const liked = await t.api({
      method: 'POST',
      url: `/api/posts/${postId}/like`,
      token: t.tokenB,
    });
    expect(liked.json()).toEqual({ likes: 1, liked: true });
    const again = await t.api({
      method: 'POST',
      url: `/api/posts/${postId}/like`,
      token: t.tokenB,
    });
    expect(again.json()).toEqual({ likes: 1, liked: true });
    const mine = (await t.api({ method: 'GET', url: '/api/profiles/me' })).json();
    expect(mine.posts[0]).toMatchObject({ likes: 1, liked: false });
    const unliked = await t.api({
      method: 'DELETE',
      url: `/api/posts/${postId}/like`,
      token: t.tokenB,
    });
    expect(unliked.json()).toEqual({ likes: 0, liked: false });
  });

  it('comments, and lets the author of the post or the comment delete it', async () => {
    const c = await t.api({
      method: 'POST',
      url: `/api/posts/${postId}/comments`,
      token: t.tokenB,
      payload: { body: 'Nice one.' },
    });
    expect(c.statusCode).toBe(201);
    const list = (await t.api({ method: 'GET', url: `/api/posts/${postId}/comments` })).json();
    expect(list.comments).toHaveLength(1);
    expect(list.comments[0]).toMatchObject({ userId: USER_B.id, body: 'Nice one.', you: false });
    expect(list.people[USER_B.id].name).toBe('Ben');
    const feed = (await t.api({ method: 'GET', url: '/api/social/feed' })).json();
    expect(feed.posts.find((p: { id: string }) => p.id === postId).comments).toBe(1);
    // The post's author may remove a comment on it.
    const gone = await t.api({ method: 'DELETE', url: `/api/comments/${c.json().comment.id}` });
    expect(gone.statusCode).toBe(204);
  });
});

describe('friends', () => {
  let requestId: string;

  it('asks, shows up as incoming, and is accepted', async () => {
    const self = await t.api({
      method: 'POST',
      url: '/api/social/friends/requests',
      payload: { userId: USER_A.id },
    });
    expect(self.statusCode).toBe(400);

    const ask = await t.api({
      method: 'POST',
      url: '/api/social/friends/requests',
      payload: { userId: USER_B.id },
    });
    expect(ask.statusCode).toBe(201);
    expect(ask.json().friendship.status).toBe('requested');
    requestId = ask.json().friendship.requestId;

    const twice = await t.api({
      method: 'POST',
      url: '/api/social/friends/requests',
      payload: { userId: USER_B.id },
    });
    expect(twice.statusCode).toBe(409);

    const theirs = (
      await t.api({ method: 'GET', url: '/api/social/friends', token: t.tokenB })
    ).json();
    expect(theirs.incoming).toEqual([
      { id: requestId, userId: USER_A.id, at: '2026-09-23T15:00:00.000Z' },
    ]);
    expect(theirs.people[USER_A.id].name).toBe('Ada');
    const profile = (
      await t.api({ method: 'GET', url: `/api/profiles/${USER_A.id}`, token: t.tokenB })
    ).json();
    expect(profile.profile.friendship).toEqual({ status: 'incoming', requestId, since: null });

    // Only the person asked can accept.
    const notMine = await t.api({
      method: 'POST',
      url: `/api/social/friends/requests/${requestId}/accept`,
    });
    expect(notMine.statusCode).toBe(404);
    const yes = await t.api({
      method: 'POST',
      url: `/api/social/friends/requests/${requestId}/accept`,
      token: t.tokenB,
    });
    expect(yes.json().friendship.status).toBe('friends');
    const mine = (await t.api({ method: 'GET', url: '/api/social/friends' })).json();
    expect(mine.friends.map((f: { userId: string }) => f.userId)).toEqual([USER_B.id]);
    expect(mine.incoming).toEqual([]);
    const board = (await t.api({ method: 'GET', url: '/api/leaderboard' })).json();
    expect(board.entries.find((e: { userId: string }) => e.userId === USER_B.id)?.friend).toBe(
      true,
    );
  });

  it('filters the feed to friends, and finds people by name', async () => {
    const friends = (await t.api({ method: 'GET', url: '/api/social/feed?scope=friends' })).json();
    expect(friends.posts.map((p: { userId: string }) => p.userId).sort()).toEqual(
      [USER_A.id, USER_B.id].sort(),
    );
    const found = (await t.api({ method: 'GET', url: '/api/social/people?q=be' })).json();
    expect(found.results).toEqual([
      {
        userId: USER_B.id,
        friendship: { status: 'friends', requestId, since: expect.any(String) },
        acceptsRequests: true,
      },
    ]);
  });

  it('removes a friend, then declining a new request deletes it', async () => {
    const gone = await t.api({ method: 'DELETE', url: `/api/social/friends/${USER_B.id}` });
    expect(gone.statusCode).toBe(204);
    const ask = await t.api({
      method: 'POST',
      url: '/api/social/friends/requests',
      token: t.tokenB,
      payload: { userId: USER_A.id },
    });
    expect(ask.statusCode).toBe(201);
    const no = await t.api({
      method: 'DELETE',
      url: `/api/social/friends/requests/${ask.json().friendship.requestId}`,
    });
    expect(no.statusCode).toBe(204);
    const mine = (await t.api({ method: 'GET', url: '/api/social/friends' })).json();
    expect(mine).toMatchObject({ friends: [], incoming: [], outgoing: [] });
    // Asking back when they asked first is a yes.
    const a = await t.api({
      method: 'POST',
      url: '/api/social/friends/requests',
      payload: { userId: USER_B.id },
    });
    const b = await t.api({
      method: 'POST',
      url: '/api/social/friends/requests',
      token: t.tokenB,
      payload: { userId: USER_A.id },
    });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json().friendship.status).toBe('friends');
  });
});

describe('sharing settings', () => {
  it('keeps the weeks, totals, posts, board place and requests to what the person allows', async () => {
    // Ben turns everything off while still friends with Ada.
    const saved = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      token: t.tokenB,
      payload: {
        social: {
          posts: 'friends',
          stats: false,
          leaderboard: 'friends',
          requests: false,
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    // Friends only: off the global board, still on a friend's board.
    const board = (await t.api({ method: 'GET', url: '/api/leaderboard' })).json();
    expect(board.scope).toBe('global');
    expect(board.entries.map((e: { userId: string }) => e.userId)).not.toContain(USER_B.id);
    const mine = (await t.api({ method: 'GET', url: '/api/leaderboard?scope=friends' })).json();
    expect(mine.entries.map((e: { userId: string }) => e.userId).sort()).toEqual(
      [USER_A.id, USER_B.id].sort(),
    );
    await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      token: t.tokenB,
      payload: { social: { leaderboard: 'off' } },
    });
    const none = (await t.api({ method: 'GET', url: '/api/leaderboard?scope=friends' })).json();
    expect(none.entries.map((e: { userId: string }) => e.userId)).toEqual([USER_A.id]);
    // A friend still sees friends-only posts and the totals are a separate choice.
    let feed = (await t.api({ method: 'GET', url: '/api/social/feed' })).json();
    expect(feed.posts.some((p: { userId: string }) => p.userId === USER_B.id)).toBe(true);
    let profile = (await t.api({ method: 'GET', url: `/api/profiles/${USER_B.id}` })).json();
    expect(profile.stats).toBeNull();
    expect(profile.heatmap).toBeNull();
    expect(profile.posts.length).toBeGreaterThan(0);
    expect(profile.profile.acceptsRequests).toBe(false);

    // No longer friends: the posts go too, and asking again is refused.
    await t.api({ method: 'DELETE', url: `/api/social/friends/${USER_A.id}`, token: t.tokenB });
    feed = (await t.api({ method: 'GET', url: '/api/social/feed' })).json();
    expect(feed.posts.some((p: { userId: string }) => p.userId === USER_B.id)).toBe(false);
    profile = (await t.api({ method: 'GET', url: `/api/profiles/${USER_B.id}` })).json();
    expect(profile.posts).toEqual([]);
    const ask = await t.api({
      method: 'POST',
      url: '/api/social/friends/requests',
      payload: { userId: USER_B.id },
    });
    expect(ask.statusCode).toBe(403);
    const found = (await t.api({ method: 'GET', url: '/api/social/people?q=ben' })).json();
    expect(found.results[0]).toMatchObject({ userId: USER_B.id, acceptsRequests: false });
    // Ben still sees his own numbers.
    const own = (await t.api({ method: 'GET', url: '/api/profiles/me', token: t.tokenB })).json();
    expect(own.stats).not.toBeNull();
  });
});
