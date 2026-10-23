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
  await t.api({ method: 'PATCH', url: '/api/me/settings', payload: { profile: { name: 'Ada' } } });
});
afterAll(() => t.close());

/** A finished session of Ada's that ended `daysAgo` days before the test clock. */
const session = async (daysAgo: number) => {
  const end = Date.parse(t.clock.now) - daysAgo * 24 * 60 * 60_000;
  const [s] = await t.db
    .insert(sessions)
    .values({
      userId: USER_A.id,
      startedAt: new Date(end - 3600_000),
      endedAt: new Date(end),
      mode: 'unlimited',
      workSeconds: 3600,
      timer: {} as TimerState,
    })
    .returning();
  return s!.id;
};

const post = (payload: Record<string, unknown>, token?: string) =>
  t.api({ method: 'POST', url: '/api/social/posts', payload, token });

const MP4 = 'data:video/mp4;base64,AAAAGA==';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQ';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('which sessions can be posted', () => {
  it('only one that ended within the week, and only once', async () => {
    const recent = await session(1);
    const old = await session(8);
    const postable = (await t.api({ method: 'GET', url: '/api/social/postable' })).json();
    expect(postable.sessionIds).toContain(recent);
    expect(postable.sessionIds).not.toContain(old);

    expect((await post({ sessionId: old })).statusCode).toBe(400);
    const first = await post({ sessionId: recent, body: 'Done.' });
    expect(first.statusCode).toBe(201);
    expect((await post({ sessionId: recent, body: 'Again.' })).statusCode).toBe(409);
    expect(
      (await t.api({ method: 'GET', url: '/api/social/postable' })).json().sessionIds,
    ).not.toContain(recent);

    // Deleting the post frees the session again.
    await t.api({ method: 'DELETE', url: `/api/posts/${first.json().post.id}` });
    expect(
      (await t.api({ method: 'GET', url: '/api/social/postable' })).json().sessionIds,
    ).toContain(recent);
  });
});

describe('a carousel: one video and three pictures', () => {
  it('keeps them in order, each served by its place', async () => {
    const res = await post({
      sessionId: await session(0),
      files: [{ media: PNG }, { media: MP4 }, { media: JPEG }, { media: PNG }],
      poster: JPEG,
    });
    expect(res.statusCode).toBe(201);
    const p = res.json().post;
    expect(p.files.map((f: { n: number; mime: string }) => [f.n, f.mime])).toEqual([
      [0, 'image/png'],
      [1, 'video/mp4'],
      [2, 'image/jpeg'],
      [3, 'image/png'],
    ]);
    // The poster belongs to the video; older portals read the first file as before.
    expect(p.files[1].poster).toBe(JPEG);
    expect(p.files[0].poster).toBeNull();
    expect(p.media).toEqual({ mime: 'image/png', bytes: 8, poster: null });

    const third = await t.api({ method: 'GET', url: `/api/posts/${p.id}/media?n=2` });
    expect(third.headers['content-type']).toBe('image/jpeg');
    const video = await t.api({
      method: 'GET',
      url: `/api/posts/${p.id}/media?n=1`,
      token: t.tokenB,
    });
    expect(video.statusCode).toBe(200);
    expect(video.rawPayload).toEqual(Buffer.from('AAAAGA==', 'base64'));
    expect((await t.api({ method: 'GET', url: `/api/posts/${p.id}/media?n=4` })).statusCode).toBe(
      404,
    );
  });

  it('refuses a second video or a fourth picture', async () => {
    const twoVideos = await post({
      sessionId: await session(0),
      files: [{ media: MP4 }, { media: MP4 }],
    });
    expect(twoVideos.statusCode).toBe(400);
    const fourPictures = await post({
      sessionId: await session(0),
      files: [{ media: PNG }, { media: PNG }, { media: PNG }, { media: JPEG }],
    });
    expect(fourPictures.statusCode).toBe(400);
    const both = await post({
      sessionId: await session(0),
      media: PNG,
      files: [{ media: PNG }],
    });
    expect(both.statusCode).toBe(400);
  });
});

describe('a post for friends only', () => {
  let id: string;

  it('shows only to the author until they are friends', async () => {
    const res = await post({
      sessionId: await session(0),
      body: 'Friends only.',
      friendsOnly: true,
      media: PNG,
    });
    expect(res.statusCode).toBe(201);
    id = res.json().post.id;
    expect(res.json().post.friendsOnly).toBe(true);

    const bodies = async (url: string) =>
      (await t.api({ method: 'GET', url, token: t.tokenB }))
        .json()
        .posts.map((p: { body: string }) => p.body);
    expect(await bodies('/api/social/feed')).not.toContain('Friends only.');
    expect(await bodies(`/api/profiles/${USER_A.id}`)).not.toContain('Friends only.');
    expect(
      (await t.api({ method: 'GET', url: `/api/posts/${id}/media`, token: t.tokenB })).statusCode,
    ).toBe(404);
    // The author sees it.
    const own = (await t.api({ method: 'GET', url: '/api/social/feed' })).json().posts;
    expect(own.map((p: { body: string }) => p.body)).toContain('Friends only.');

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
    expect(await bodies('/api/social/feed')).toContain('Friends only.');
    expect(await bodies(`/api/profiles/${USER_A.id}`)).toContain('Friends only.');
    expect(
      (await t.api({ method: 'GET', url: `/api/posts/${id}/media`, token: t.tokenB })).statusCode,
    ).toBe(200);
  });
});
