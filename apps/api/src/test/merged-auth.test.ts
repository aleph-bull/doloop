import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createHsVerifier } from '../auth/verify';
import { createPgliteDb } from '../db/client';
import { users } from '../db/schema';
import { buildServer } from '../server';
import { createLocalMailer } from '../services/mailer';

const secret = 'merged-auth-test-secret';
const mailer = createLocalMailer();
let pg: Awaited<ReturnType<typeof createPgliteDb>>;
let app: Awaited<ReturnType<typeof buildServer>>;
let now = '2026-10-21T12:00:00.000Z';
const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
const me = (token: string) =>
  app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });
const latestCode = () => mailer.messages!.at(-1)!.text.match(/^\d{6}$/m)![0];

beforeAll(async () => {
  pg = await createPgliteDb();
  app = await buildServer({
    db: pg.db,
    verifier: createHsVerifier(secret),
    passwordAuth: {
      secret,
      google: {
        clientId: 'merged-client',
        verify: async (email) => ({ email, emailVerified: true }),
        verifyAccessToken: async (email) => ({ email, emailVerified: true }),
      },
    },
    mailer,
    requireEmailVerification: true,
    clock: () => now,
  });
});
afterAll(async () => {
  await app.close();
  await pg.close();
});

it('joins a code-verified password account through Google and revokes both sessions on password reset', async () => {
  const email = 'merged@example.test';
  const pending = await post('/api/auth/signup', { email, password: 'original-password' });
  expect(pending.statusCode, pending.body).toBe(200);
  expect(pending.json().verificationRequired).toBe(true);
  const verified = await post('/api/auth/email/verify-signup', {
    challengeId: pending.json().challengeId,
    code: latestCode(),
  });
  expect(verified.statusCode, verified.body).toBe(200);
  const google = await post('/api/auth/google', { credential: email });
  expect(google.statusCode, google.body).toBe(200);
  const passwordUser = (await me(verified.json().token)).json().user;
  expect((await me(google.json().token)).json().user.id).toBe(passwordUser.id);
  expect(passwordUser.settings.nav.style).toBe('sidebar');
  now = '2026-10-21T12:02:00.000Z';
  const reset = await post('/api/auth/password/request-reset', { email });
  expect(reset.statusCode, reset.body).toBe(200);
  expect(
    (
      await post('/api/auth/password/reset', {
        challengeId: reset.json().challengeId,
        code: latestCode(),
        password: 'new-password',
      })
    ).statusCode,
  ).toBe(200);
  expect((await me(verified.json().token)).statusCode).toBe(401);
  expect((await me(google.json().token)).statusCode).toBe(401);
  const again = await post('/api/auth/google', { credential: email });
  expect((await me(again.json().token)).json().user.id).toBe(passwordUser.id);
});

it('tells a password try on a Google-only email to use Google or set a password, which works', async () => {
  const email = 'only-google@example.test';
  const google = await post('/api/auth/google', { credential: email });
  expect(google.statusCode, google.body).toBe(200);
  const userId = (await me(google.json().token)).json().user.id;

  const tried = await post('/api/auth/signin', {
    email: 'Only-Google@example.test',
    password: 'guess-1',
  });
  expect(tried.statusCode).toBe(401);
  expect(tried.json()).toMatchObject({
    error: 'This email signs in with Google. Continue with Google, or set a password.',
    details: { reason: 'google' },
  });
  // Creating an account on it would make a second, empty one: the same answer.
  const created = await post('/api/auth/signup', { email, password: 'another-1' });
  expect(created.statusCode).toBe(409);
  expect(created.json().details).toEqual({ reason: 'google' });
  // An unknown email still gets the plain answer.
  const unknown = await post('/api/auth/signin', { email: 'nobody@example.test', password: 'x' });
  expect(unknown.json()).toMatchObject({ error: "That email and password don't match." });

  now = '2026-10-21T12:10:00.000Z';
  const ask = await post('/api/auth/password/request-reset', { email });
  expect(ask.statusCode, ask.body).toBe(200);
  const set = await post('/api/auth/password/reset', {
    challengeId: ask.json().challengeId,
    code: latestCode(),
    password: 'first-password',
  });
  expect(set.statusCode, set.body).toBe(200);
  const signedIn = await post('/api/auth/signin', { email, password: 'first-password' });
  expect(signedIn.statusCode, signedIn.body).toBe(200);
  expect((await me(signedIn.json().token)).json().user.id).toBe(userId);
  const again = await post('/api/auth/google', { credential: email });
  expect((await me(again.json().token)).json().user.id).toBe(userId);
  // With a password now, a wrong one is just wrong.
  const wrong = await post('/api/auth/signin', { email, password: 'guess-2' });
  expect(wrong.json()).toMatchObject({ error: "That email and password don't match." });
});

it('records Google email proof without granting organization proof and blocks reserved test identities', async () => {
  const response = await post('/api/auth/google', { credential: 'google-only@example.test' });
  expect(response.statusCode, response.body).toBe(200);
  const user = await pg.db.query.users.findFirst({
    where: eq(users.email, 'google-only@example.test'),
  });
  expect(user!.emailVerifiedAt).not.toBeNull();
  const blocked = await post('/api/auth/google', { credential: 'admin@komodon.test' });
  expect(blocked.statusCode, blocked.body).toBe(403);
  expect(
    await pg.db.query.users.findFirst({ where: eq(users.email, 'admin@komodon.test') }),
  ).toBeUndefined();
});
