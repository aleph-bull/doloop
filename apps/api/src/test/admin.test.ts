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
    memberToken = (
      await post('/api/auth/signin', { email: 'member@example.com', password: 'fresh-pass' })
    ).json().token;
  });

  const send = (method: 'PATCH' | 'DELETE', url: string, token: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
  const account = async () =>
    (await get('/api/admin/accounts', adminToken))
      .json()
      .accounts.find((a: { id: string }) => a.id === memberId);

  it('sends an account through onboarding again without touching its data', async () => {
    await send('PATCH', '/api/me', memberToken, { onboarded: true });
    await send('PATCH', '/api/me/settings', memberToken, {
      dashboard: { focusOnly: false },
      dismissed: ['xp'],
    });
    await post('/api/nodes', { kind: 'course', title: 'Chemistry' }, memberToken);

    expect(
      (await post(`/api/admin/accounts/${memberId}/onboarding`, {}, memberToken)).statusCode,
    ).toBe(403);
    expect(
      (await post(`/api/admin/accounts/${memberId}/onboarding`, {}, adminToken)).statusCode,
    ).toBe(204);
    const me = (await get('/api/me', memberToken)).json();
    expect(me.onboarded).toBe(false);
    expect(me.user.settings.dismissed).toEqual([]);
    expect((await get('/api/nodes', memberToken)).json().nodes).toHaveLength(1);

    // Finishing it again keeps the choices the account had made.
    const done = (await send('PATCH', '/api/me', memberToken, { onboarded: true })).json();
    expect(done.onboarded).toBe(true);
    expect(done.user.settings.dashboard.focusOnly).toBe(false);
  });

  let addedId = '';

  it('adds study time on a past day, and takes it away again', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const url = `/api/admin/accounts/${memberId}/time`;
    expect((await post(url, { date: yesterday, minutes: 90 }, memberToken)).statusCode).toBe(403);
    expect((await post(url, { date: tomorrow, minutes: 30 }, adminToken)).statusCode).toBe(400);

    const added = await post(url, { date: yesterday, minutes: 90 }, adminToken);
    expect(added.statusCode).toBe(201);
    addedId = added.json().session.id;
    expect(added.json().session.startedAt).toBe(`${yesterday}T12:00:00.000Z`);
    expect((await account()).focusMinutes).toBe(90);

    const history = (await get(`/api/admin/accounts/${memberId}/sessions`, adminToken)).json();
    expect(history.sessions.map((s: { id: string }) => s.id)).toEqual([addedId]);

    const trimmed = await post(
      `/api/admin/accounts/${memberId}/sessions/${addedId}/trim`,
      { removeFocusMinutes: 30 },
      adminToken,
    );
    expect(trimmed.statusCode).toBe(200);
    expect((await account()).focusMinutes).toBe(60);

    const gone = await send(
      'DELETE',
      `/api/admin/accounts/${memberId}/sessions/${addedId}`,
      adminToken,
    );
    expect(gone.statusCode).toBe(200);
    expect((await account()).focusMinutes).toBe(0);
  });

  it('suspends an account until it is lifted', async () => {
    const adminId = (await get('/api/me', adminToken)).json().user.id;
    expect((await post(`/api/admin/accounts/${adminId}/suspend`, {}, adminToken)).statusCode).toBe(
      400,
    );
    expect(
      (await post(`/api/admin/accounts/${memberId}/suspend`, {}, memberToken)).statusCode,
    ).toBe(403);
    expect((await post(`/api/admin/accounts/${memberId}/suspend`, {}, adminToken)).statusCode).toBe(
      204,
    );

    const refused = await get('/api/me', memberToken);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe('account_suspended');
    const signIn = await post('/api/auth/signin', {
      email: 'member@example.com',
      password: 'fresh-pass',
    });
    expect(signIn.json().error).toBe('account_suspended');
    expect((await account()).bannedAt).not.toBeNull();
    const blocked = (await get('/api/admin/blocked-emails', adminToken)).json().blocked;
    expect(blocked).toEqual([
      expect.objectContaining({ email: 'member@example.com', accountId: memberId }),
    ]);

    expect(
      (await send('DELETE', `/api/admin/accounts/${memberId}/suspend`, adminToken)).statusCode,
    ).toBe(204);
    expect((await get('/api/me', memberToken)).statusCode).toBe(200);
    expect((await get('/api/admin/blocked-emails', adminToken)).json().blocked).toEqual([]);
  });

  it('blocks an address from signing up, and unblocks it', async () => {
    expect(
      (await post('/api/admin/blocked-emails', { email: 'Spam@Example.com' }, adminToken))
        .statusCode,
    ).toBe(204);
    expect(
      (await post('/api/admin/blocked-emails', { email: 'boss@example.com' }, adminToken))
        .statusCode,
    ).toBe(400);
    const refused = await post('/api/auth/signup', {
      email: 'spam@example.com',
      password: 'spam-pass',
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe('account_suspended');

    expect(
      (await send('DELETE', '/api/admin/blocked-emails/spam%40example.com', adminToken)).statusCode,
    ).toBe(204);
    expect(
      (await post('/api/auth/signup', { email: 'spam@example.com', password: 'spam-pass' }))
        .statusCode,
    ).toBe(200);
  });

  it('deletes an account, keeping its address out if asked', async () => {
    expect(
      (await send('DELETE', `/api/admin/accounts/${memberId}?block=true`, adminToken)).statusCode,
    ).toBe(204);
    expect((await account()) ?? null).toBeNull();
    expect((await get('/api/me', memberToken)).statusCode).toBe(403);
    const again = await post('/api/auth/signup', {
      email: 'member@example.com',
      password: 'member1',
    });
    expect(again.json().error).toBe('account_suspended');
  });
});
