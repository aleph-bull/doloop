import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TimerState } from '@komogon/core';
import { eq } from 'drizzle-orm';
import { achievements, sessions, users } from '../db/schema';
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
    const [another] = await t.db.insert(sessions).values(finished(USER_A.id, 3600)).returning();
    const second = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { body: 'Two hours on linear algebra today.', sessionId: another!.id },
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
    // Only here for the second post; the totals below count the first session alone.
    await t.db.delete(sessions).where(eq(sessions.id, another!.id));
  });

  it('shows the four badges that paid the most XP, the hours of the day and the level bar', async () => {
    const day = (d: number) => new Date(`2026-09-${String(d).padStart(2, '0')}T12:00:00Z`);
    await t.db.insert(achievements).values([
      { userId: USER_A.id, key: 'first-session', unlockedAt: day(1) }, // 25
      { userId: USER_A.id, key: 'hours-10', unlockedAt: day(2) }, // 100
      { userId: USER_A.id, key: 'deep-work', unlockedAt: day(5) }, // 100, newer
      { userId: USER_A.id, key: 'focus-25', unlockedAt: day(3) }, // 150
      { userId: USER_A.id, key: 'hours-100', unlockedAt: day(4) }, // 800
      { userId: USER_A.id, key: 'retired-badge', unlockedAt: day(6) },
    ]);
    const body = (
      await t.api({ method: 'GET', url: `/api/profiles/${USER_A.id}`, token: t.tokenB })
    ).json();
    expect(body.badges.map((b: { key: string }) => b.key)).toEqual([
      'hours-100',
      'focus-25',
      'deep-work',
      'hours-10',
    ]);
    expect(body.badges[0]).toEqual({
      key: 'hours-100',
      name: 'Century of hours',
      description: 'One hundred hours of focused work, all time.',
      unlockedAt: day(4).toISOString(),
    });
    // What a badge pays stays on Achievements.
    expect(JSON.stringify(body.badges)).not.toContain('xp');
    // The session from 6:00 to 8:00 in Toronto with 90 minutes of work, spread over its two
    // hours.
    expect(body.clock.hours).toHaveLength(24);
    expect(body.clock.totalMinutes).toBe(90);
    expect([body.clock.hours[6], body.clock.hours[7]]).toEqual([45, 45]);
    expect(body.stats.levelRatio).toBeGreaterThanOrEqual(0);
    expect(body.stats.levelRatio).toBeLessThan(1);
  });

  it('keeps badges and hours to themselves along with the totals', async () => {
    const saved = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { social: { stats: false } },
    });
    expect(saved.statusCode).toBe(200);
    const theirs = (
      await t.api({ method: 'GET', url: `/api/profiles/${USER_A.id}`, token: t.tokenB })
    ).json();
    expect(theirs).toMatchObject({ stats: null, badges: null, clock: null });
    // Their own profile still shows everything.
    const own = (await t.api({ method: 'GET', url: '/api/profiles/me' })).json();
    expect(own.badges).toHaveLength(4);
    expect(own.clock.totalMinutes).toBe(90);
  });
});
