import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TimerState } from '@komogon/core';
import { nodes, sessions } from '../db/schema';
import { createTestApp, USER_A, type TestApp } from './helpers';

let t: TestApp;
const task: Record<string, string> = {};
beforeAll(async () => {
  t = await createTestApp('2026-09-23T14:00:00.000Z');
  await t.api({ method: 'GET', url: '/api/me' });
  await t.api({ method: 'PATCH', url: '/api/me', payload: { onboarded: true } });
  for (const [course, name] of [
    ['MAT137', 'Problem set 4'],
    ['CHM135', 'Lab report'],
  ] as const) {
    const [c] = await t.db
      .insert(nodes)
      .values({ userId: USER_A.id, title: course, kind: 'course' })
      .returning();
    const [n] = await t.db
      .insert(nodes)
      .values({ userId: USER_A.id, title: name, kind: 'task', parentId: c!.id })
      .returning();
    task[course] = n!.id;
  }
});
afterAll(() => t.close());

/** A finished session on a task, from `start` for `work` minutes of focus and `breaks` of breaks. */
async function session(nodeId: string | null, start: string, work: number, breaks = 0) {
  const startedAt = new Date(start);
  const [s] = await t.db
    .insert(sessions)
    .values({
      userId: USER_A.id,
      nodeId,
      startedAt,
      endedAt: new Date(startedAt.getTime() + (work + breaks) * 60_000),
      mode: 'pomodoro',
      workSeconds: work * 60,
      breakSeconds: breaks * 60,
      badgesAwarded: nodeId === task.CHM135 ? ['first-session'] : [],
      timer: {} as TimerState,
    })
    .returning();
  return s!.id;
}

const send = (payload: Record<string, unknown>) =>
  t.api({ method: 'POST', url: '/api/social/posts', payload });
const postable = async () =>
  (await t.api({ method: 'GET', url: '/api/social/postable' })).json().sessionIds as string[];

describe('one post for sessions on different tasks', () => {
  it('adds them up, names each task and runs from the first start to the last end', async () => {
    // Sent out of order: the post puts them in the order they happened.
    const second = await session(task.CHM135!, '2026-09-23T10:40:00Z', 30, 5);
    const first = await session(task.MAT137!, '2026-09-23T09:00:00Z', 50, 10);
    const res = await send({ sessionIds: [second, first], showElapsed: true });
    expect(res.statusCode).toBe(201);
    expect(res.json().post.session).toEqual({
      minutes: 80,
      subject: 'MAT137 · Problem set 4, CHM135 · Lab report',
      elapsedMinutes: 95,
      startedAt: '2026-09-23T09:00:00.000Z',
      endedAt: '2026-09-23T11:15:00.000Z',
      badges: ['first-session'],
      streak: null,
    });
    // Neither can go in another post.
    expect(await postable()).not.toContain(first);
    expect(await postable()).not.toContain(second);
    expect((await send({ sessionId: first })).statusCode).toBe(409);
    expect((await send({ sessionIds: [second] })).statusCode).toBe(409);
  });

  it('names a task once when two sessions were on it', async () => {
    const a = await session(task.MAT137!, '2026-09-23T12:00:00Z', 25);
    const b = await session(task.MAT137!, '2026-09-23T12:30:00Z', 25);
    const res = await send({ sessionIds: [a, b] });
    expect(res.json().post.session).toMatchObject({
      minutes: 50,
      subject: 'MAT137 · Problem set 4',
    });
  });

  it('still takes one session the older way', async () => {
    const one = await session(null, '2026-09-23T13:00:00Z', 20);
    expect(await postable()).toContain(one);
    const res = await send({ sessionId: one });
    expect(res.statusCode).toBe(201);
    expect(res.json().post.session).toMatchObject({ minutes: 20, subject: null });
    expect(await postable()).not.toContain(one);
  });

  it('needs at least one of your own finished sessions', async () => {
    expect((await send({})).statusCode).toBe(400);
    expect((await send({ sessionIds: ['00000000-0000-4000-8000-000000000000'] })).statusCode).toBe(
      404,
    );
  });
});
