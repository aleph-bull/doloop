import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TimerState } from '@komogon/core';
import { sessions } from '../db/schema';
import { createTestApp, USER_A, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-09-23T14:00:00.000Z');
  await t.api({ method: 'GET', url: '/api/me' });
  await t.api({ method: 'PATCH', url: '/api/me', payload: { onboarded: true } });
});
afterAll(() => t.close());

/** 60 min of focus and 15 of breaks, with a 10 min pause: 9:00 to 10:25. */
async function session() {
  const [s] = await t.db
    .insert(sessions)
    .values({
      userId: USER_A.id,
      startedAt: new Date('2026-09-23T09:00:00Z'),
      endedAt: new Date('2026-09-23T10:25:00Z'),
      mode: 'pomodoro',
      workSeconds: 3600,
      breakSeconds: 900,
      timer: {} as TimerState,
    })
    .returning();
  return s!.id;
}

const post = async (payload: Record<string, unknown>) => {
  const res = await t.api({ method: 'POST', url: '/api/social/posts', payload });
  expect(res.statusCode).toBe(201);
  return res.json().post;
};

describe('the times on a post', () => {
  it('carries when the session started and ended, and no elapsed time unless asked', async () => {
    const p = await post({ sessionId: await session() });
    expect(p.session).toEqual({
      minutes: 60,
      subject: null,
      elapsedMinutes: null,
      startedAt: '2026-09-23T09:00:00.000Z',
      endedAt: '2026-09-23T10:25:00.000Z',
      badges: [],
      streak: null,
    });
  });

  it('shows focus and breaks together, without the pause, when asked', async () => {
    const p = await post({ sessionId: await session(), showElapsed: true });
    expect(p.session).toMatchObject({ minutes: 60, elapsedMinutes: 75 });
  });

  it('hides all of it with the time', async () => {
    const p = await post({ sessionId: await session(), showTime: false, showElapsed: true });
    expect(p.session).toBeNull();
  });
});
