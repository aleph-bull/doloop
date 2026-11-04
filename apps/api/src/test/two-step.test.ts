import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPgliteDb } from '../db/client';
import { createHsVerifier } from '../auth/verify';
import { buildServer } from '../server';
import { users } from '../db/schema';
import { createLocalMailer } from '../services/mailer';

/**
 * Settings › Security: verifying the email after sign-up (never required), two-step sign-in
 * by an emailed code (off until turned on), and changing the password.
 */

const secret = 'two-step-test-secret';
const mailer = createLocalMailer();
let app: Awaited<ReturnType<typeof buildServer>>, pg: Awaited<ReturnType<typeof createPgliteDb>>;
let now = '2026-11-03T12:00:00.000Z';
/** Past the minute between codes to one address. */
const advance = (seconds = 61) => {
  now = new Date(Date.parse(now) + seconds * 1000).toISOString();
};
const lastMail = (email: string) => mailer.messages!.filter((m) => m.to === email).at(-1)!;
const codeFor = (email: string) => lastMail(email).text.match(/^\d{6}$/m)![0];
const call = (method: 'GET' | 'POST', url: string, payload?: object, token?: string) =>
  app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });

const email = 'twostep@example.com';
let token = '';

beforeAll(async () => {
  pg = await createPgliteDb();
  app = await buildServer({
    db: pg.db,
    verifier: createHsVerifier(secret),
    passwordAuth: { secret, limits: null },
    mailer,
    clock: () => now,
  });
  await app.ready();
  const up = await call('POST', '/api/auth/signup', { email, password: 'first-password' });
  expect(up.statusCode, up.body).toBe(200);
  token = up.json().token;
});
afterAll(async () => {
  await app.close();
  await pg.close();
});

it('makes the account at once, unverified, with two-step off', async () => {
  const res = await call('GET', '/api/account/security', undefined, token);
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json()).toEqual({
    email,
    emailVerified: false,
    hasPassword: true,
    twoStep: false,
    canVerify: true,
  });
});

it('verifies the email with a code', async () => {
  const sent = await call('POST', '/api/auth/email/request-verification', undefined, token);
  expect(sent.statusCode, sent.body).toBe(200);
  const wrong = await call(
    'POST',
    '/api/auth/email/verify-account',
    { challengeId: sent.json().challengeId, code: codeFor(email) === '000000' ? '111111' : '000000' },
    token,
  );
  expect(wrong.statusCode).toBe(400);
  const ok = await call(
    'POST',
    '/api/auth/email/verify-account',
    { challengeId: sent.json().challengeId, code: codeFor(email) },
    token,
  );
  expect(ok.statusCode, ok.body).toBe(200);
  const res = await call('GET', '/api/account/security', undefined, token);
  expect(res.json().emailVerified).toBe(true);
});

it('signs in with just the password while two-step is off', async () => {
  const res = await call('POST', '/api/auth/signin', { email, password: 'first-password' });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().token).toBeTruthy();
});

it('turns two-step on only with a code from the email', async () => {
  advance();
  const sent = await call('POST', '/api/auth/email/request-verification', undefined, token);
  expect(sent.statusCode, sent.body).toBe(200);
  const res = await call(
    'POST',
    '/api/account/two-step',
    { on: true, challengeId: sent.json().challengeId, code: codeFor(email) },
    token,
  );
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().twoStep).toBe(true);
  const row = await pg.db.query.users.findFirst({ where: eq(users.email, email) });
  expect(row!.twoStepAt).not.toBeNull();
});

it('asks for an emailed code after the password, and gives the token only for it', async () => {
  advance();
  const first = await call('POST', '/api/auth/signin', { email, password: 'first-password' });
  expect(first.statusCode, first.body).toBe(200);
  expect(first.json().token).toBeUndefined();
  expect(first.json().twoStep).toBe(true);
  expect(lastMail(email).subject).toBe('Your Komogon sign-in code');
  expect(lastMail(email).text).toMatch(
    /^Hi,\n\nHere's your code to sign in:\n\n\d{6}\n\nIt works for 10 minutes\. If this wasn't you, you can ignore it\.\n\nKomogon$/,
  );
  const { challengeId } = first.json();

  // A wrong password never sends a code.
  const before = mailer.messages!.length;
  advance();
  const wrongPassword = await call('POST', '/api/auth/signin', { email, password: 'nope-nope' });
  expect(wrongPassword.statusCode).toBe(401);
  expect(mailer.messages!.length).toBe(before);

  const code = codeFor(email);
  const wrong = await call('POST', '/api/auth/two-step', {
    challengeId,
    code: code === '000000' ? '111111' : '000000',
  });
  expect(wrong.statusCode).toBe(400);
  const right = await call('POST', '/api/auth/two-step', { challengeId, code });
  expect(right.statusCode, right.body).toBe(200);
  const me = await call('GET', '/api/me', undefined, right.json().token);
  expect(me.statusCode).toBe(200);
  // Used once.
  expect((await call('POST', '/api/auth/two-step', { challengeId, code })).statusCode).toBe(400);
});

it('sends a new sign-in code on request, and the old one stops working', async () => {
  advance();
  const first = await call('POST', '/api/auth/signin', { email, password: 'first-password' });
  const old = codeFor(email);
  advance();
  const again = await call('POST', '/api/auth/email/resend', {
    challengeId: first.json().challengeId,
  });
  expect(again.statusCode, again.body).toBe(200);
  expect(
    (
      await call('POST', '/api/auth/two-step', {
        challengeId: first.json().challengeId,
        code: old,
      })
    ).statusCode,
  ).toBe(400);
  const right = await call('POST', '/api/auth/two-step', {
    challengeId: again.json().challengeId,
    code: codeFor(email),
  });
  expect(right.statusCode, right.body).toBe(200);
});

it('turns two-step off with a code, and the password alone signs in again', async () => {
  // Five codes an hour go to one address.
  advance(3601);
  const sent = await call('POST', '/api/auth/email/request-verification', undefined, token);
  const off = await call(
    'POST',
    '/api/account/two-step',
    { on: false, challengeId: sent.json().challengeId, code: codeFor(email) },
    token,
  );
  expect(off.statusCode, off.body).toBe(200);
  expect(off.json().twoStep).toBe(false);
  const res = await call('POST', '/api/auth/signin', { email, password: 'first-password' });
  expect(res.json().token).toBeTruthy();
});

it('changes the password given the current one, and signs out other devices', async () => {
  const other = (await call('POST', '/api/auth/signin', { email, password: 'first-password' })).json()
    .token as string;
  const wrong = await call(
    'POST',
    '/api/account/password',
    { current: 'not-it', password: 'second-password' },
    token,
  );
  expect(wrong.statusCode).toBe(400);
  const res = await call(
    'POST',
    '/api/account/password',
    { current: 'first-password', password: 'second-password' },
    token,
  );
  expect(res.statusCode, res.body).toBe(200);
  const fresh = res.json().token as string;
  expect((await call('GET', '/api/me', undefined, fresh)).statusCode).toBe(200);
  expect((await call('GET', '/api/me', undefined, other)).statusCode).toBe(401);
  expect((await call('GET', '/api/me', undefined, token)).statusCode).toBe(401);
  expect(
    (await call('POST', '/api/auth/signin', { email, password: 'first-password' })).statusCode,
  ).toBe(401);
  expect(
    (await call('POST', '/api/auth/signin', { email, password: 'second-password' })).statusCode,
  ).toBe(200);
  token = fresh;
});
