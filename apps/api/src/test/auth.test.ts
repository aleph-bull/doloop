import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('auth', () => {
  it('health is public', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, service: 'doloop-api' });
  });

  it('rejects missing and invalid tokens', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/me',
          headers: { authorization: 'Bearer nope' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('creates the user on first request with the timezone header and returns defaults', async () => {
    const res = await t.api({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe('a@example.com');
    expect(body.user.timezone).toBe('America/Toronto');
    expect(body.user.settings.pomodoro.workMin).toBe(25);
    expect(body.user.streak.current).toBe(0);
    expect(body.onboarded).toBe(false);
    expect(body.restDays.editsRemaining).toBe(3);
  });

  it('isolates users', async () => {
    const created = await t.api({ method: 'POST', url: '/api/nodes', payload: { title: 'Mine' } });
    expect(created.statusCode).toBe(201);
    const id = created.json().node.id;
    const other = await t.api({
      method: 'PATCH',
      url: `/api/nodes/${id}`,
      token: t.tokenB,
      payload: { title: 'x' },
    });
    expect(other.statusCode).toBe(404);
    const list = await t.api({ method: 'GET', url: '/api/nodes', token: t.tokenB });
    expect(list.json().nodes).toEqual([]);
  });

  it('validates bodies with zod', async () => {
    const res = await t.api({ method: 'POST', url: '/api/nodes', payload: { title: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Validation failed');
  });
});
