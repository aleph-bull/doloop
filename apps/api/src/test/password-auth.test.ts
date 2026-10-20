import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createHsVerifier } from '../auth/verify';
import { createPgliteDb, type Db } from '../db/client';
import { passwordAccounts } from '../db/schema';
import { buildServer } from '../server';
import { checkPassword, hashPassword } from '../services/passwords';

const SECRET = 'password-auth-test-secret';

describe('password hashing', () => {
  it('checks the right password and refuses others', async () => {
    const stored = await hashPassword('correct horse');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(stored).not.toContain('correct horse');
    expect(await checkPassword('correct horse', stored)).toBe(true);
    expect(await checkPassword('wrong', stored)).toBe(false);
  });
});

describe('email and password accounts', () => {
  let app: FastifyInstance;
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createPgliteDb());
    app = await buildServer({
      db,
      verifier: createHsVerifier(SECRET),
      passwordAuth: { secret: SECRET },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, payload, headers: { 'x-timezone': 'America/Toronto' } });
  const me = (token: string) =>
    app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });

  it('signs up, keeps the data, and signs back in to the same account', async () => {
    const up = await post('/api/auth/signup', { email: 'New@Example.com', password: 'hunter22' });
    expect(up.statusCode).toBe(200);
    const { token, email } = up.json();
    expect(email).toBe('new@example.com');

    const first = await me(token);
    expect(first.statusCode).toBe(200);
    expect(first.json().user.timezone).toBe('America/Toronto');
    const id = first.json().user.id;

    // Something saved under the account survives signing in again.
    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { onboarded: true },
    });
    expect(patched.statusCode).toBeLessThan(300);

    const back = await post('/api/auth/signin', { email: 'new@example.com', password: 'hunter22' });
    expect(back.statusCode).toBe(200);
    const again = await me(back.json().token);
    expect(again.json().user.id).toBe(id);
    expect(again.json().onboarded).toBe(true);
  });

  it('refuses a wrong password, an unknown email and a taken email', async () => {
    expect(
      (await post('/api/auth/signin', { email: 'new@example.com', password: 'nope' })).statusCode,
    ).toBe(401);
    expect(
      (await post('/api/auth/signin', { email: 'who@example.com', password: 'hunter22' }))
        .statusCode,
    ).toBe(401);
    expect(
      (await post('/api/auth/signup', { email: 'new@example.com', password: 'another1' }))
        .statusCode,
    ).toBe(409);
    expect(
      (await post('/api/auth/signup', { email: 'short@example.com', password: '123' })).statusCode,
    ).toBe(400);
  });

  it('stores only a hash', async () => {
    const row = await db.query.passwordAccounts.findFirst({
      where: eq(passwordAccounts.email, 'new@example.com'),
    });
    expect(row?.passwordHash).not.toContain('hunter22');
  });
});
