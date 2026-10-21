import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TimerState } from '@komogon/core';
import { eq } from 'drizzle-orm';
import { sessions, users } from '../db/schema';
import { createTestApp, USER_A, USER_B, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
  // Both accounts exist and have finished onboarding, so each has a profile to open.
  for (const token of [t.tokenA, t.tokenB]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
});
afterAll(() => t.close());

const finished = (userId: string, workSeconds: number) => ({
  userId,
  startedAt: new Date('2026-09-20T10:00:00Z'),
  endedAt: new Date('2026-09-20T12:00:00Z'),
  mode: 'unlimited' as const,
  workSeconds,
  timer: {} as TimerState,
});

// A 1x1 PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let sessionId: string;

describe('profiles', () => {
  it('keeps the profile fields; the university only comes from verification', async () => {
    const ok = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { profile: { name: 'Ada', bio: '  Second year, CS.  ' } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().settings.profile).toEqual({
      name: 'Ada',
      university: null,
      bio: 'Second year, CS.',
    });
    // What the verification route writes once a code comes back (university.test.ts).
    const row = (await t.db.query.users.findFirst({ where: eq(users.id, USER_A.id) }))!;
    await t.db
      .update(users)
      .set({
        settings: {
          ...row.settings,
          profile: { name: 'Ada', university: 'toronto', bio: 'Second year, CS.' },
        },
      })
      .where(eq(users.id, USER_A.id));
  });

  it('shows your own profile at /me with totals and the grid, never the email', async () => {
    const [made] = await t.db.insert(sessions).values(finished(USER_A.id, 5400)).returning();
    sessionId = made!.id;
    const res = await t.api({ method: 'GET', url: '/api/profiles/me' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profile).toMatchObject({
      id: USER_A.id,
      name: 'Ada',
      university: { id: 'toronto', name: 'University of Toronto', short: 'U of T' },
      bio: 'Second year, CS.',
      avatarUrl: null,
      you: true,
    });
    expect(body.stats.totalMinutes).toBe(90);
    expect(body.stats.totalSessions).toBe(1);
    expect(body.stats.activeDays).toBe(1);
    expect(body.heatmap.weeks).toHaveLength(26);
    expect(body.heatmap.activeDays).toBe(1);
    expect(body.posts).toEqual([]);
    expect(res.body).not.toContain('@example.com');
  });

  it('opens someone else by id, with "Someone" when they chose no name', async () => {
    const res = await t.api({ method: 'GET', url: `/api/profiles/${USER_A.id}`, token: t.tokenB });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.you).toBe(false);
    expect(res.json().profile.name).toBe('Ada');

    const other = await t.api({ method: 'GET', url: `/api/profiles/${USER_B.id}` });
    expect(other.json().profile).toMatchObject({ name: 'Someone', university: null, you: false });
    expect(other.body).not.toContain('@example.com');
  });

  it('answers 404 for an unknown id', async () => {
    const res = await t.api({
      method: 'GET',
      url: '/api/profiles/99999999-9999-4999-8999-999999999999',
    });
    expect(res.statusCode).toBe(404);
  });

  it('stores a profile picture and serves it with the profile', async () => {
    const up = await t.api({ method: 'PUT', url: '/api/me/avatar', payload: { dataUrl: PNG } });
    expect(up.statusCode).toBe(200);
    let prof = (await t.api({ method: 'GET', url: '/api/profiles/me' })).json();
    expect(prof.profile.avatarUrl).toBe(PNG);
    expect((await t.api({ method: 'GET', url: '/api/me/avatar' })).json()).toEqual({
      dataUrl: PNG,
    });
    // Others see it too.
    const seen = (
      await t.api({ method: 'GET', url: `/api/profiles/${USER_A.id}`, token: t.tokenB })
    ).json();
    expect(seen.profile.avatarUrl).toBe(PNG);

    const gone = await t.api({ method: 'DELETE', url: '/api/me/avatar' });
    expect(gone.statusCode).toBe(204);
    prof = (await t.api({ method: 'GET', url: '/api/profiles/me' })).json();
    expect(prof.profile.avatarUrl).toBeNull();
    expect((await t.api({ method: 'GET', url: '/api/me/avatar' })).json()).toEqual({
      dataUrl: null,
    });

    const bad = await t.api({
      method: 'PUT',
      url: '/api/me/avatar',
      payload: { dataUrl: 'data:text/plain;base64,aGk=' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('posts belong to their author: newest first, only the author can delete', async () => {
    const empty = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { body: '  ' },
    });
    expect(empty.statusCode).toBe(400);
    // Every post says which session it is about.
    const noSession = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { body: 'Finished the first problem set.' },
    });
    expect(noSession.statusCode).toBe(400);

    const first = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { body: 'Finished the first problem set.', sessionId },
    });
    expect(first.statusCode).toBe(201);
    t.clock.now = '2026-09-21T15:00:00.000Z';
    const second = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { body: 'Two hours on linear algebra today.', sessionId },
    });
    const prof = (
      await t.api({ method: 'GET', url: `/api/profiles/${USER_A.id}`, token: t.tokenB })
    ).json();
    expect(prof.posts.map((p: { body: string }) => p.body)).toEqual([
      'Two hours on linear algebra today.',
      'Finished the first problem set.',
    ]);

    const notYours = await t.api({
      method: 'DELETE',
      url: `/api/posts/${first.json().post.id}`,
      token: t.tokenB,
    });
    expect(notYours.statusCode).toBe(404);
    const yours = await t.api({ method: 'DELETE', url: `/api/posts/${first.json().post.id}` });
    expect(yours.statusCode).toBe(204);
    const after = (await t.api({ method: 'GET', url: '/api/profiles/me' })).json();
    expect(after.posts.map((p: { id: string }) => p.id)).toEqual([second.json().post.id]);
  });
});
