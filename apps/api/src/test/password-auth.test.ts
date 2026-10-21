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

  it('still refuses an unknown email with the same answer', async () => {
    const res = await post('/api/auth/signin', { email: 'nobody@example.com', password: 'x' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("That email and password don't match.");
  });

  it('stores only a hash', async () => {
    const row = await db.query.passwordAccounts.findFirst({
      where: eq(passwordAccounts.email, 'new@example.com'),
    });
    expect(row?.passwordHash).not.toContain('hunter22');
  });
});

describe('limits on tries', () => {
  let app: FastifyInstance;
  let close: () => Promise<void>;
  let now = 0;

  beforeAll(async () => {
    let db: Db;
    ({ db, close } = await createPgliteDb());
    app = await buildServer({
      db,
      verifier: createHsVerifier(SECRET),
      passwordAuth: {
        secret: SECRET,
        limits: {
          signInPerEmail: { max: 3, windowMs: 60_000 },
          signInPerIp: { max: 5, windowMs: 60_000 },
          signUpPerIp: { max: 2, windowMs: 60_000 },
          now: () => now,
        },
      },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  const post = (url: string, payload: Record<string, unknown>, ip = '10.0.0.1') =>
    app.inject({ method: 'POST', url, payload, remoteAddress: ip });

  it('stops sign-ins to one email after too many wrong passwords, from any address', async () => {
    expect(
      (await post('/api/auth/signup', { email: 'a@example.com', password: 'right1' })).statusCode,
    ).toBe(200);
    for (let i = 0; i < 3; i++)
      expect(
        (await post('/api/auth/signin', { email: 'a@example.com', password: 'wrong' })).statusCode,
      ).toBe(401);

    const blocked = await post(
      '/api/auth/signin',
      { email: 'A@example.com', password: 'right1' },
      '10.0.0.2',
    );
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBe(60);

    now += 60_000;
    expect(
      (await post('/api/auth/signin', { email: 'a@example.com', password: 'right1' })).statusCode,
    ).toBe(200);
  });

  it('a right password clears the count for that email', async () => {
    for (let i = 0; i < 2; i++)
      await post('/api/auth/signin', { email: 'a@example.com', password: 'wrong' }, '10.0.0.3');
    expect(
      (await post('/api/auth/signin', { email: 'a@example.com', password: 'right1' }, '10.0.0.3'))
        .statusCode,
    ).toBe(200);
    for (let i = 0; i < 2; i++)
      await post('/api/auth/signin', { email: 'a@example.com', password: 'wrong' }, '10.0.0.3');
    expect(
      (await post('/api/auth/signin', { email: 'a@example.com', password: 'right1' }, '10.0.0.3'))
        .statusCode,
    ).toBe(200);
  });

  it('stops one address guessing across many emails', async () => {
    for (let i = 0; i < 5; i++)
      await post('/api/auth/signin', { email: `x${i}@example.com`, password: 'wrong' }, '10.0.0.4');
    expect(
      (await post('/api/auth/signin', { email: 'a@example.com', password: 'right1' }, '10.0.0.4'))
        .statusCode,
    ).toBe(429);
    expect(
      (await post('/api/auth/signin', { email: 'a@example.com', password: 'right1' }, '10.0.0.5'))
        .statusCode,
    ).toBe(200);
  });

  it('limits sign-ups from one address', async () => {
    expect(
      (await post('/api/auth/signup', { email: 'b@example.com', password: 'right1' }, '10.0.0.6'))
        .statusCode,
    ).toBe(200);
    expect(
      (await post('/api/auth/signup', { email: 'c@example.com', password: 'right1' }, '10.0.0.6'))
        .statusCode,
    ).toBe(200);
    expect(
      (await post('/api/auth/signup', { email: 'd@example.com', password: 'right1' }, '10.0.0.6'))
        .statusCode,
    ).toBe(429);
  });
});

describe('caller addresses behind a proxy', () => {
  it('counts each caller by the address the nearest proxy saw, not one the caller wrote', async () => {
    const { db, close } = await createPgliteDb();
    const app = await buildServer({
      db,
      verifier: createHsVerifier(SECRET),
      trustProxyHops: 1,
      passwordAuth: {
        secret: SECRET,
        limits: {
          signInPerEmail: { max: 100, windowMs: 60_000 },
          signInPerIp: { max: 1, windowMs: 60_000 },
          signUpPerIp: { max: 100, windowMs: 60_000 },
        },
      },
    });
    const signIn = (forwardedFor: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/signin',
        payload: { email: 'z@example.com', password: 'wrong' },
        remoteAddress: '10.0.0.9',
        headers: { 'x-forwarded-for': forwardedFor },
      });
    try {
      expect((await signIn('1.1.1.1, 2.2.2.2')).statusCode).toBe(401);
      // A different forged first entry is still the same caller (2.2.2.2).
      expect((await signIn('9.9.9.9, 2.2.2.2')).statusCode).toBe(429);
      expect((await signIn('3.3.3.3')).statusCode).toBe(401);
    } finally {
      await app.close();
      await close();
    }
  });
});
