import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TimerState } from '@komogon/core';
import { eq } from 'drizzle-orm';
import { sessions } from '../db/schema';
import { createTestApp, USER_A, USER_B, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
  await t.api({ method: 'GET', url: '/api/me' });
  await t.api({ method: 'GET', url: '/api/me', token: t.tokenB });
});
afterAll(() => t.close());

const finished = (userId: string, workSeconds: number, ended = true) => ({
  userId,
  startedAt: new Date('2026-09-21T10:00:00Z'),
  endedAt: ended ? new Date('2026-09-21T12:00:00Z') : null,
  mode: 'unlimited' as const,
  workSeconds,
  timer: {} as TimerState,
});

describe('leaderboard', () => {
  it('ranks by focused time, shows chosen names, never emails', async () => {
    await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { profile: { name: 'Ada' } },
    });
    await t.db.insert(sessions).values([finished(USER_A.id, 3600), finished(USER_B.id, 7200)]);

    const res = await t.api({ method: 'GET', url: '/api/leaderboard' });
    expect(res.statusCode).toBe(200);
    const { entries } = res.json();
    expect(entries[0].weekly).toHaveLength(8);
    expect(
      entries.map((e: Record<string, unknown>) => {
        const { weekly: _w, thisWeek: _t, streak: _s, activeDays28: _a, ...rest } = e;
        return rest;
      }),
    ).toEqual([
      {
        rank: 1,
        userId: USER_B.id,
        // No name of their own: their username, without its @.
        name: expect.stringMatching(/^[a-z]+.[a-z]+$/),
        avatarUrl: null,
        focusMinutes: 120,
        you: false,
        friend: false,
      },
      {
        rank: 2,
        userId: USER_A.id,
        name: 'Ada',
        avatarUrl: null,
        focusMinutes: 60,
        you: true,
        friend: false,
      },
    ]);
    expect(res.body).not.toContain('@example.com');
  });

  it('leaves out a session still running', async () => {
    await t.db.insert(sessions).values(finished(USER_A.id, 99_999, false));
    const { entries } = (await t.api({ method: 'GET', url: '/api/leaderboard' })).json();
    expect(entries.find((e: { name: string }) => e.name === 'Ada').focusMinutes).toBe(60);
  });
});

describe('how you compare with everyone', () => {
  it('averages the week over people with 15 minutes or more, and ranks you all time', async () => {
    // Ada has 60 min this week, Ben 120 (from the board test, both on 2026-09-21).
    // A third person with 5 minutes is left out of the average.
    const tiny = { id: '33333333-3333-4333-8333-333333333333', email: 'c@example.com' };
    const { signDevToken } = await import('../auth/verify');
    const { TEST_SECRET } = await import('./helpers');
    const tokenC = await signDevToken(TEST_SECRET, tiny);
    await t.api({ method: 'GET', url: '/api/me', token: tokenC });
    await t.db
      .insert(sessions)
      .values({ ...finished(tiny.id, 300), startedAt: new Date('2026-09-21T09:00:00Z') });

    const res = await t.api({ method: 'GET', url: '/api/leaderboard/stats' });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.week).toMatchObject({
      which: 'this',
      you: 60,
      average: 120,
      people: 1,
      aheadOf: 0,
    });
    expect(stats.days).toEqual({ you: 1, average: 1 });
    expect(stats.sessionLength).toEqual({ you: 60, average: 120 });
    expect(stats.rank).toEqual({ position: 2, of: 3 });
  });

  it("falls back to last week's average when this week has no one else yet", async () => {
    // Everyone else's sessions move to last week; Ben's 120 min counts there.
    await t.db
      .update(sessions)
      .set({
        startedAt: new Date('2026-09-15T10:00:00Z'),
        endedAt: new Date('2026-09-15T12:00:00Z'),
      })
      .where(eq(sessions.userId, USER_B.id));
    const stats = (await t.api({ method: 'GET', url: '/api/leaderboard/stats' })).json();
    expect(stats.week).toMatchObject({ which: 'last', you: 0, average: 120, people: 1 });
  });
});
