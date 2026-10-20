import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHsVerifier } from '../auth/verify';
import { createPgliteDb, type Db } from '../db/client';
import { buildServer } from '../server';
import { ensureUser } from '../services/users';

const SECRET = 'admin-test-secret';
const ADMIN = { id: '55555555-5555-4555-8555-555555555555', email: 'Boss@Example.com' };

describe('admin', () => {
  let app: FastifyInstance;
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createPgliteDb());
    // The admin's account exists before passwords did, as if moved over from a local copy.
    await ensureUser(db, ADMIN, 'America/Toronto');
    app = await buildServer({
      db,
      verifier: createHsVerifier(SECRET),
      passwordAuth: { secret: SECRET },
      adminEmails: ['boss@example.com'],
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  const post = (url: string, payload: Record<string, unknown>, token?: string) =>
    app.inject({
      method: 'POST',
      url,
      payload,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const get = (url: string, token: string) =>
    app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

  let adminToken = '';
  let memberToken = '';
  let memberId = '';

  it("an admin's sign-up takes over their existing account", async () => {
    const res = await post('/api/auth/signup', {
      email: 'boss@example.com',
      password: 'boss-pass',
    });
    expect(res.statusCode).toBe(200);
    adminToken = res.json().token;
    const me = await get('/api/me', adminToken);
    expect(me.json().user.id).toBe(ADMIN.id);
    expect(me.json().user.timezone).toBe('America/Toronto');
  });

  it('a member gets a new account, never an existing one', async () => {
    const res = await post('/api/auth/signup', {
      email: 'member@example.com',
      password: 'member1',
    });
    memberToken = res.json().token;
    memberId = (await get('/api/me', memberToken)).json().user.id;
    expect(memberId).not.toBe(ADMIN.id);
  });

  it('lists accounts and exports data for admins only', async () => {
    expect((await get('/api/admin/me', adminToken)).json()).toEqual({ admin: true });
    expect((await get('/api/admin/me', memberToken)).json()).toEqual({ admin: false });
    expect((await get('/api/admin/accounts', memberToken)).statusCode).toBe(403);

    const list = await get('/api/admin/accounts', adminToken);
    expect(list.statusCode).toBe(200);
    const emails = list.json().accounts.map((a: { email: string }) => a.email);
    expect(emails).toEqual(expect.arrayContaining(['member@example.com']));
    expect(JSON.stringify(list.json())).not.toContain('member1');

    const exp = await get(`/api/admin/accounts/${memberId}/export`, adminToken);
    expect(exp.statusCode).toBe(200);
    expect(exp.json().user.email).toBe('member@example.com');
    expect((await get(`/api/admin/accounts/${memberId}/export`, memberToken)).statusCode).toBe(403);
  });

  it('lets an admin set a forgotten password', async () => {
    const set = await post(
      `/api/admin/accounts/${memberId}/password`,
      { password: 'fresh-pass' },
      adminToken,
    );
    expect(set.statusCode).toBe(204);
    expect(
      (await post('/api/auth/signin', { email: 'member@example.com', password: 'member1' }))
        .statusCode,
    ).toBe(401);
    const back = await post('/api/auth/signin', {
      email: 'member@example.com',
      password: 'fresh-pass',
    });
    expect(back.statusCode).toBe(200);
    expect(
      (await post(`/api/admin/accounts/${memberId}/password`, { password: 'x1x1x1' }, memberToken))
        .statusCode,
    ).toBe(403);
  });
});
