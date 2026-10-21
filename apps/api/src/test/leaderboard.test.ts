import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TimerState } from '@komogon/core';
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
    expect(entries).toEqual([
      { rank: 1, userId: USER_B.id, name: 'Someone', focusMinutes: 120, you: false },
      { rank: 2, userId: USER_A.id, name: 'Ada', focusMinutes: 60, you: true },
    ]);
    expect(res.body).not.toContain('@example.com');
  });

  it('leaves out a session still running', async () => {
    await t.db.insert(sessions).values(finished(USER_A.id, 99_999, false));
    const { entries } = (await t.api({ method: 'GET', url: '/api/leaderboard' })).json();
    expect(entries.find((e: { name: string }) => e.name === 'Ada').focusMinutes).toBe(60);
  });
});
