import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nodes } from '../db/schema';
import { HANDOVER_PART_BYTES } from '../services/session-handovers';
import { advanceClock, createTestApp, USER_A, type TestApp } from './helpers';

let t: TestApp;
let sessionId: string;

beforeAll(async () => {
  t = await createTestApp('2026-11-05T14:00:00.000Z');
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

const link = (payload: Record<string, unknown>) =>
  t.api({ method: 'POST', url: '/api/camera-link', payload: { sessionId, ...payload } });
const view = async (token = t.tokenA) =>
  (await t.api({ method: 'GET', url: `/api/sessions/${sessionId}/handover`, token })).json();
const putPart = (n: number, data: Buffer) =>
  t.api({
    method: 'PUT',
    url: `/api/sessions/${sessionId}/handover/${n}`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: data,
  });

describe('the computer handing its screen to the phone', () => {
  it('tells the computer a phone films, and holds that until the phone says otherwise', async () => {
    expect((await link({ role: 'host', device: 'computer' })).json().phoneFilms).toBeUndefined();
    await link({ role: 'camera', films: true });
    expect((await link({ role: 'host', device: 'computer' })).json().phoneFilms).toBe(true);
    // The phone's page going quiet doesn't change it; only the phone saying so does.
    await link({ role: 'camera' });
    expect((await link({ role: 'host', device: 'computer' })).json().phoneFilms).toBe(true);
    await link({ role: 'camera', films: false });
    expect((await link({ role: 'host', device: 'computer' })).json().phoneFilms).toBeUndefined();
  });

  it('expects the screen once a phone films while the computer records it', async () => {
    const before = await view();
    expect(before.handover).toBeNull();
    expect(before.partBytes).toBe(HANDOVER_PART_BYTES);
    expect(typeof before.now).toBe('string');
    await link({ role: 'camera', films: true });
    await link({ role: 'host', device: 'computer', screen: false });
    expect((await view()).handover).toBeNull();
    await link({ role: 'host', device: 'computer', screen: true });
    const first = (await view()).handover;
    expect(first).toEqual({ state: 'expected', seen: expect.any(Number) });
    // Each turn of the computer's says it is still there.
    advanceClock(t, 0, 30);
    await link({ role: 'host', device: 'computer', screen: true });
    expect((await view()).handover.seen).toBe(first.seen + 30_000);
  });

  it('takes it in parts, gives it back whole, and lets it go once taken', async () => {
    const a = Buffer.alloc(HANDOVER_PART_BYTES, 1);
    const b = Buffer.from('the rest');
    const bytes = a.length + b.length;
    const started = await t.api({
      method: 'POST',
      url: `/api/sessions/${sessionId}/handover`,
      payload: { bytes, parts: 2 },
    });
    expect(started.json().handover).toEqual({ state: 'sending', parts: 2, bytes });
    expect((await putPart(1, b)).statusCode).toBe(204);
    // Not all there yet.
    const early = await t.api({ method: 'POST', url: `/api/sessions/${sessionId}/handover/done` });
    expect(early.statusCode).toBe(409);
    // A part too big for what was said is refused.
    expect((await putPart(0, Buffer.alloc(HANDOVER_PART_BYTES + 10))).statusCode).toBe(413);
    expect((await putPart(0, a)).statusCode).toBe(204);
    const done = await t.api({ method: 'POST', url: `/api/sessions/${sessionId}/handover/done` });
    expect(done.json().handover).toEqual({ state: 'ready', parts: 2, bytes });

    const got0 = await t.api({ method: 'GET', url: `/api/sessions/${sessionId}/handover/0` });
    expect(got0.headers['content-type']).toContain('application/octet-stream');
    expect(got0.rawPayload.equals(a)).toBe(true);
    const got1 = await t.api({ method: 'GET', url: `/api/sessions/${sessionId}/handover/1` });
    expect(got1.rawPayload.toString()).toBe('the rest');

    const taken = await t.api({ method: 'POST', url: `/api/sessions/${sessionId}/handover/taken` });
    expect(taken.json().handover).toEqual({ state: 'taken' });
    const gone = await t.api({ method: 'GET', url: `/api/sessions/${sessionId}/handover/0` });
    expect(gone.statusCode).toBe(409);
  });

  it('is only for the session’s owner', async () => {
    const other = await t.api({
      method: 'GET',
      url: `/api/sessions/${sessionId}/handover`,
      token: t.tokenB,
    });
    expect(other.statusCode).toBe(404);
    const send = await t.api({
      method: 'POST',
      url: `/api/sessions/${sessionId}/handover`,
      token: t.tokenB,
      payload: { nothing: true },
    });
    expect(send.statusCode).toBe(404);
  });

  it('says when the computer has nothing, and forgets it all after a while', async () => {
    const res = await t.api({
      method: 'POST',
      url: `/api/sessions/${sessionId}/handover`,
      payload: { nothing: true },
    });
    // Taken already: the phone has it, so "nothing" changes nothing.
    expect(res.json().handover).toEqual({ state: 'taken' });
    advanceClock(t, 121);
    expect((await view()).handover).toBeNull();
    await t.api({
      method: 'POST',
      url: `/api/sessions/${sessionId}/handover`,
      payload: { nothing: true },
    });
    expect((await view()).handover).toEqual({ state: 'nothing' });
  });

  it('refuses one too big to hold', async () => {
    const res = await t.api({
      method: 'POST',
      url: `/api/sessions/${sessionId}/handover`,
      payload: { bytes: 500 * 1024 * 1024, parts: 3 },
    });
    expect(res.statusCode).toBe(400);
  });
});
