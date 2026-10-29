import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nodes } from '../db/schema';
import { advanceClock, createTestApp, USER_A, type TestApp } from './helpers';

let t: TestApp;
let sessionId: string;

beforeAll(async () => {
  t = await createTestApp('2026-10-28T14:00:00.000Z');
  for (const token of [t.tokenA, t.tokenB]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
  const [task] = await t.db
    .insert(nodes)
    .values({ userId: USER_A.id, title: 'Linear algebra', kind: 'task' })
    .returning();
  const started = await t.api({
    method: 'POST',
    url: '/api/sessions',
    payload: { nodeId: task!.id, mode: 'unlimited' },
  });
  expect(started.statusCode).toBe(201);
  sessionId = started.json().active.session.id;
});
afterAll(() => t.close());

const link = (payload: Record<string, unknown>, token = t.tokenA) =>
  t.api({ method: 'POST', url: '/api/camera-link', token, payload: { sessionId, ...payload } });

describe('a phone filming for the computer', () => {
  it('sees a computer only while it is recording', async () => {
    expect((await link({ role: 'camera' })).json()).toEqual({ host: false, messages: [] });
    await link({ role: 'host' });
    expect((await link({ role: 'camera' })).json().host).toBe(true);
    // The computer stops asking (closed, asleep): after a while it is gone.
    advanceClock(t, 0, 13);
    expect((await link({ role: 'camera' })).json().host).toBe(false);
    await link({ role: 'host' });
    await link({ role: 'host', leave: true });
    expect((await link({ role: 'camera' })).json().host).toBe(false);
  });

  it('passes the offer and the answer across, each once', async () => {
    await link({
      role: 'camera',
      send: [{ link: 'phone-try-1', kind: 'offer', sdp: 'v=0 offer' }],
    });
    const host = (await link({ role: 'host' })).json();
    expect(host.messages).toHaveLength(1);
    expect(host.messages[0]).toMatchObject({
      link: 'phone-try-1',
      kind: 'offer',
      sdp: 'v=0 offer',
    });
    const read = host.messages[0].id;

    await link({
      role: 'host',
      after: read,
      send: [{ link: 'phone-try-1', kind: 'answer', sdp: 'v=0 answer' }],
    });
    expect((await link({ role: 'host', after: read })).json().messages).toEqual([]);

    const camera = (await link({ role: 'camera' })).json();
    expect(camera.host).toBe(true);
    expect(camera.messages).toEqual([
      expect.objectContaining({ link: 'phone-try-1', kind: 'answer', sdp: 'v=0 answer' }),
    ]);
    const again = (await link({ role: 'camera', after: camera.messages[0].id })).json();
    expect(again.messages).toEqual([]);
  });

  it('is only for the session’s owner', async () => {
    expect((await link({ role: 'camera' }, t.tokenB)).statusCode).toBe(404);
    expect((await link({ role: 'host', send: [{ link: 'x', kind: 'offer' }] })).statusCode).toBe(
      400,
    );
  });

  it('ends with the session', async () => {
    await link({ role: 'host' });
    await link({ role: 'camera', send: [{ link: 'phone-try-2', kind: 'offer', sdp: 'v=0' }] });
    advanceClock(t, 20);
    const stopped = await t.api({
      method: 'POST',
      url: `/api/sessions/${sessionId}/end`,
      payload: {},
    });
    expect(stopped.statusCode).toBeLessThan(300);
    expect((await link({ role: 'host' })).json()).toEqual({ host: false, messages: [] });
    expect((await link({ role: 'camera' })).json()).toEqual({ host: false, messages: [] });
  });
});
