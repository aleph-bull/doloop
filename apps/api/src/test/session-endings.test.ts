import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nodes } from '../db/schema';
import { advanceClock, createTestApp, USER_A, type TestApp } from './helpers';

let t: TestApp;
let taskId: string;

beforeAll(async () => {
  t = await createTestApp('2026-11-04T14:00:00.000Z');
  for (const token of [t.tokenA, t.tokenB]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
  const [task] = await t.db
    .insert(nodes)
    .values({ userId: USER_A.id, title: 'Linear algebra', kind: 'task' })
    .returning();
  taskId = task!.id;
});
afterAll(() => t.close());

const summaryOf = (id: string, token = t.tokenA) =>
  t.api({ method: 'GET', url: `/api/sessions/${id}/summary`, token });

describe("the other device's ending screen", () => {
  it('gets the same summary the ending device got, for a while', async () => {
    const started = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: taskId, mode: 'unlimited' },
    });
    const id: string = started.json().active.session.id;
    // Still running: nothing to show yet.
    expect((await summaryOf(id)).statusCode).toBe(404);

    advanceClock(t, 20);
    const ended = await t.api({ method: 'POST', url: `/api/sessions/${id}/end`, payload: {} });
    expect(ended.statusCode).toBe(200);

    const got = await summaryOf(id);
    expect(got.statusCode).toBe(200);
    expect(got.json().summary).toEqual(ended.json().summary);
    // Someone else's session is never shown.
    expect((await summaryOf(id, t.tokenB)).statusCode).toBe(404);

    // Half an hour on, it is gone; the device shows its stills without it.
    advanceClock(t, 31);
    expect((await summaryOf(id)).statusCode).toBe(404);
  });

  it('turns away an id that is not one', async () => {
    expect((await summaryOf('not-a-session')).statusCode).toBe(400);
  });
});
