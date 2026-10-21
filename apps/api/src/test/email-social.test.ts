import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPgliteDb } from '../db/client';
import { createHsVerifier } from '../auth/verify';
import { buildServer } from '../server';
import { emailCodes, googleCalendar, users } from '../db/schema';
import { createLocalMailer } from '../services/mailer';
import { emailLimit } from '../services/email-codes';

const secret = 'email-test-secret';
const mailer = createLocalMailer();
let app: Awaited<ReturnType<typeof buildServer>>, pg: Awaited<ReturnType<typeof createPgliteDb>>;
let now = '2026-10-21T12:00:00.000Z';
let first: { token: string; email: string }, peer: { token: string; email: string };
const advance = (seconds = 61) => {
  now = new Date(Date.parse(now) + seconds * 1000).toISOString();
};
const codeFor = (email: string) =>
  mailer
    .messages!.filter((m) => m.to === email)
    .at(-1)!
    .text.slice(0, 6);
const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
  token?: string,
) =>
  app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
async function signup(email: string) {
  const request = await call('POST', '/api/auth/signup', { email, password: 'original-password' });
  expect(request.statusCode, request.body).toBe(200);
  expect(request.json().verificationRequired).toBe(true);
  const verified = await call('POST', '/api/auth/email/verify-signup', {
    challengeId: request.json().challengeId,
    code: codeFor(email),
  });
  expect(verified.statusCode, verified.body).toBe(200);
  return verified.json() as { token: string; email: string };
}
beforeAll(async () => {
  pg = await createPgliteDb();
  app = await buildServer({
    db: pg.db,
    verifier: createHsVerifier(secret),
    passwordAuth: { secret },
    mailer,
    requireEmailVerification: true,
    clock: () => now,
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await pg.close();
});

it('creates no account before signup proof, stores only a keyed code hash and consumes it once', async () => {
  const email = 'study@gmail.com';
  const sent = await call('POST', '/api/auth/signup', { email, password: 'original-password' });
  expect(sent.statusCode, sent.body).toBe(200);
  expect(sent.json().token).toBeUndefined();
  expect(await pg.db.query.users.findFirst({ where: eq(users.email, email) })).toBeUndefined();
  const challengeId = sent.json().challengeId;
  const stored = await pg.db.query.emailCodes.findFirst({ where: eq(emailCodes.id, challengeId) });
  expect(stored!.codeHash).not.toContain(codeFor(email));
  expect(stored!.payload.passwordHash).not.toContain('original-password');
  const response = await call('POST', '/api/auth/email/verify-signup', {
    challengeId,
    code: codeFor(email),
  });
  expect(response.statusCode, response.body).toBe(200);
  first = response.json();
  expect(
    (await pg.db.query.users.findFirst({ where: eq(users.email, email) }))!.emailVerifiedAt,
  ).not.toBeNull();
  expect(
    (await call('POST', '/api/auth/email/verify-signup', { challengeId, code: codeFor(email) }))
      .statusCode,
  ).toBe(400);
});

it('limits incorrect guesses, expires codes and rate-limits resends', async () => {
  const sent = await call('POST', '/api/auth/signup', {
    email: 'guesses@example.test',
    password: 'original-password',
  });
  const challengeId = sent.json().challengeId;
  const wrong = codeFor('guesses@example.test') === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++)
    expect(
      (await call('POST', '/api/auth/email/verify-signup', { challengeId, code: wrong }))
        .statusCode,
    ).toBe(400);
  expect(
    (
      await call('POST', '/api/auth/email/verify-signup', {
        challengeId,
        code: codeFor('guesses@example.test'),
      })
    ).statusCode,
  ).toBe(400);
  expect((await call('POST', '/api/auth/email/resend', { challengeId })).statusCode).toBe(429);
  advance();
  const resent = await call('POST', '/api/auth/email/resend', { challengeId });
  expect(resent.statusCode, resent.body).toBe(200);
  advance(601);
  expect(
    (
      await call('POST', '/api/auth/email/verify-signup', {
        challengeId: resent.json().challengeId,
        code: codeFor('guesses@example.test'),
      })
    ).statusCode,
  ).toBe(400);
});

it('resets a password through a code and invalidates existing sessions', async () => {
  const request = await call('POST', '/api/auth/password/request-reset', { email: first.email });
  expect(request.statusCode, request.body).toBe(200);
  const reset = await call('POST', '/api/auth/password/reset', {
    challengeId: request.json().challengeId,
    code: codeFor(first.email),
    password: 'new-password',
  });
  expect(reset.statusCode, reset.body).toBe(200);
  expect((await call('GET', '/api/me', undefined, first.token)).statusCode).toBe(401);
  expect(
    (await call('POST', '/api/auth/signin', { email: first.email, password: 'original-password' }))
      .statusCode,
  ).toBe(401);
  const login = await call('POST', '/api/auth/signin', {
    email: first.email,
    password: 'new-password',
  });
  expect(login.statusCode).toBe(200);
  first = login.json();
  expect((await call('GET', '/api/me', undefined, first.token)).statusCode).toBe(200);
  expect(
    (
      await call('POST', '/api/auth/password/reset', {
        challengeId: request.json().challengeId,
        code: codeFor(first.email),
        password: 'another-password',
      })
    ).statusCode,
  ).toBe(400);
});

it('returns the same reset response shape for unknown addresses and keeps the local outbox private', async () => {
  const count = mailer.messages!.length;
  const request = await call('POST', '/api/auth/password/request-reset', {
    email: 'unknown@example.test',
  });
  expect(request.statusCode).toBe(200);
  expect(request.json()).toMatchObject({
    ok: true,
    message: 'If an account uses that address, a code has been sent.',
  });
  expect(request.json().challengeId).toMatch(/^[a-f0-9-]{36}$/);
  expect(mailer.messages).toHaveLength(count);
  expect((await call('GET', '/api/auth/local-outbox?email=study%40gmail.com')).statusCode).toBe(
    403,
  );
});

it('keeps organization proof separate from login and Google Calendar, bound to the account', async () => {
  advance();
  peer = await signup('peer@example.test');
  const me = (await call('GET', '/api/me', undefined, first.token)).json().user;
  await pg.db.insert(googleCalendar).values({
    userId: me.id,
    refreshTokenEnc: 'untouched-calendar-token',
    studyCalendarId: 'study',
  });
  const sent = await call(
    'POST',
    '/api/social/organization/request-code',
    { email: 'student@utoronto.ca' },
    first.token,
  );
  expect(sent.statusCode, sent.body).toBe(200);
  const challengeId = sent.json().challengeId,
    code = codeFor('student@utoronto.ca');
  expect(
    (await call('POST', '/api/social/organization/verify', { challengeId, code }, peer.token))
      .statusCode,
  ).toBe(400);
  const response = await call(
    'POST',
    '/api/social/organization/verify',
    { challengeId, code },
    first.token,
  );
  expect(response.statusCode, response.body).toBe(200);
  const profile = (await call('GET', '/api/social/me', undefined, first.token)).json();
  expect(profile).toMatchObject({
    accountEmail: 'study@gmail.com',
    profile: {
      organizationEmail: 'student@utoronto.ca',
      organizationDomain: 'utoronto.ca',
      visible: false,
    },
  });
  expect((await pg.db.query.googleCalendar.findFirst())!.refreshTokenEnc).toBe(
    'untouched-calendar-token',
  );
  expect(
    (
      await call(
        'POST',
        '/api/social/organization/request-code',
        { email: 'work@gmail.com' },
        first.token,
      )
    ).statusCode,
  ).toBe(400);
});

it('shows only opted-in profiles from the same verified domain and never exposes private email addresses', async () => {
  const request = await call(
    'POST',
    '/api/social/organization/request-code',
    { email: 'peer@utoronto.ca' },
    peer.token,
  );
  const verified = await call(
    'POST',
    '/api/social/organization/verify',
    { challengeId: request.json().challengeId, code: codeFor('peer@utoronto.ca') },
    peer.token,
  );
  expect(verified.statusCode, verified.body).toBe(200);
  expect(
    (await call('GET', '/api/social/people', undefined, first.token)).json().people,
  ).toHaveLength(0);
  expect(
    (
      await call(
        'PATCH',
        '/api/social/me',
        { displayName: 'Ada', organizationName: 'University of Toronto', visible: true },
        peer.token,
      )
    ).statusCode,
  ).toBe(200);
  const directory = await call('GET', '/api/social/people', undefined, first.token);
  expect(directory.json().people).toHaveLength(1);
  expect(directory.body).not.toContain('@');
  expect(directory.json().people[0]).toMatchObject({
    displayName: 'Ada',
    organizationDomain: 'utoronto.ca',
  });
  await call('DELETE', '/api/social/organization', undefined, peer.token);
  expect(
    (await call('GET', '/api/social/people', undefined, first.token)).json().people,
  ).toHaveLength(0);
});

it('uses atomic rate counters and resets their window', async () => {
  await emailLimit(pg.db, 'test-limit', 1, 60_000, now);
  await expect(emailLimit(pg.db, 'test-limit', 1, 60_000, now)).rejects.toMatchObject({
    status: 429,
  });
  advance();
  await expect(emailLimit(pg.db, 'test-limit', 1, 60_000, now)).resolves.toBeUndefined();
});

it('binds account email verification to its owner and purpose', async () => {
  advance();
  const sent = await call('POST', '/api/auth/email/request-verification', {}, first.token);
  expect(sent.statusCode, sent.body).toBe(200);
  const proof = { challengeId: sent.json().challengeId, code: codeFor(first.email) };
  expect((await call('POST', '/api/auth/email/verify-account', proof, peer.token)).statusCode).toBe(
    400,
  );
  expect(
    (await call('POST', '/api/auth/password/reset', { ...proof, password: 'wrong-purpose' }))
      .statusCode,
  ).toBe(400);
  expect(
    (await call('POST', '/api/auth/email/verify-account', proof, first.token)).statusCode,
  ).toBe(200);
});

it('keeps existing sign-in available but requires a configured mailer for verified signup', async () => {
  const unconfigured = await buildServer({
    db: pg.db,
    verifier: createHsVerifier(secret),
    passwordAuth: { secret },
    requireEmailVerification: true,
    clock: () => now,
  });
  try {
    const signupResponse = await unconfigured.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'no-mailer@example.test', password: 'original-password' },
    });
    expect(signupResponse.statusCode, signupResponse.body).toBe(503);
    expect(
      await pg.db.query.users.findFirst({ where: eq(users.email, 'no-mailer@example.test') }),
    ).toBeUndefined();
    const login = await unconfigured.inject({
      method: 'POST',
      url: '/api/auth/signin',
      payload: { email: first.email, password: 'new-password' },
    });
    expect(login.statusCode, login.body).toBe(200);
  } finally {
    await unconfigured.close();
  }
});
