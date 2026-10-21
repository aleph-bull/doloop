import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPgliteDb } from '../db/client';
import { createHsVerifier } from '../auth/verify';
import { buildServer } from '../server';
import { sessions } from '../db/schema';
import { allowLocalTestAccounts, LOCAL_TEST_ACCOUNTS } from '../services/local-test-accounts';

const secret = 'local-account-test-secret';
let pg: Awaited<ReturnType<typeof createPgliteDb>>;
let app: Awaited<ReturnType<typeof buildServer>>;
let onboardingToken: string, adminToken: string;
const credentials = (role: 'admin' | 'onboarding') =>
  LOCAL_TEST_ACCOUNTS.find((a) => a.role === role)!;
const signIn = async (role: 'admin' | 'onboarding') =>
  (await app.inject({ method: 'POST', url: '/api/auth/signin', payload: credentials(role) })).json()
    .token as string;
const headers = (token: string) => ({ authorization: `Bearer ${token}` });
beforeAll(async () => {
  pg = await createPgliteDb();
  app = await buildServer({
    db: pg.db,
    verifier: createHsVerifier(secret),
    passwordAuth: { secret },
    localTestAccounts: true,
    adminEmails: ['owner@example.test'],
  });
  await app.ready();
  onboardingToken = await signIn('onboarding');
  adminToken = await signIn('admin');
});
afterAll(async () => {
  await app.close();
  await pg.close();
});

it('offers fixed localhost credentials and separates onboarding from admin access', async () => {
  const info = await app.inject({ method: 'GET', url: '/api/auth/local-test-accounts' });
  expect(info.statusCode).toBe(200);
  expect(info.json().accounts).toHaveLength(2);
  expect(
    (await app.inject({ method: 'GET', url: '/api/me', headers: headers(onboardingToken) })).json()
      .onboarded,
  ).toBe(false);
  expect(
    (await app.inject({ method: 'GET', url: '/api/me', headers: headers(adminToken) })).json()
      .onboarded,
  ).toBe(true);
  expect(
    (await app.inject({ method: 'GET', url: '/api/admin/accounts', headers: headers(adminToken) }))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/api/admin/accounts',
        headers: headers(onboardingToken),
      })
    ).statusCode,
  ).toBe(403);
});

it('blocks remote IPs and origins, including requests using a valid test token', async () => {
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/api/auth/local-test-accounts',
        remoteAddress: '203.0.113.1',
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/api/auth/local-test-accounts',
        headers: { origin: 'https://example.com' },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: headers(adminToken),
        remoteAddress: '203.0.113.1',
      })
    ).statusCode,
  ).toBe(403);
});

it('keeps test accounts off the leaderboard and configured admins on it', async () => {
  const student = (
    await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'student@example.test', password: 'student-test-password' },
    })
  ).json();
  await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email: 'owner@example.test', password: 'owner-test-password' },
  });
  const users = await pg.db.query.users.findMany();
  for (const user of users)
    await pg.db
      .insert(sessions)
      .values({
        userId: user.id,
        startedAt: new Date('2026-10-21T12:00:00Z'),
        endedAt: new Date('2026-10-21T13:00:00Z'),
        mode: 'unlimited',
        workSeconds: user.email === 'student@example.test' ? 3600 : 99999,
        timer: {} as never,
      });
  const leaderboard = await app.inject({
    method: 'GET',
    url: '/api/leaderboard',
    headers: headers(student.token),
  });
  // The owner (an admin) is on the board; the two seeded test accounts, with the same
  // minutes, are not. Entries also carry the userId that opens the profile.
  expect(leaderboard.json().entries).toMatchObject([
    { rank: 1, name: 'Someone', focusMinutes: 1667, you: false },
    { rank: 2, name: 'Someone', focusMinutes: 60, you: true },
  ]);
  expect(leaderboard.json().entries).toHaveLength(2);
});

it('resets only onboarding data and invalidates its old login', async () => {
  await app.inject({
    method: 'PATCH',
    url: '/api/me',
    headers: headers(onboardingToken),
    payload: { onboarded: true },
  });
  await app.inject({
    method: 'PATCH',
    url: '/api/me/settings',
    headers: headers(adminToken),
    payload: { profile: { name: 'Keep this admin name' } },
  });
  expect(
    (await app.inject({ method: 'POST', url: '/api/auth/local-test-accounts/onboarding/reset' }))
      .statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ method: 'GET', url: '/api/me', headers: headers(onboardingToken) }))
      .statusCode,
  ).toBe(401);
  onboardingToken = await signIn('onboarding');
  expect(
    (await app.inject({ method: 'GET', url: '/api/me', headers: headers(onboardingToken) })).json()
      .onboarded,
  ).toBe(false);
  expect(
    (await app.inject({ method: 'GET', url: '/api/me', headers: headers(adminToken) })).json().user
      .settings.profile.name,
  ).toBe('Keep this admin name');
});

it('refuses existing test accounts when sandbox access is disabled', async () => {
  const hosted = await buildServer({
    db: pg.db,
    verifier: createHsVerifier(secret),
    passwordAuth: { secret },
  });
  try {
    expect(
      (
        await hosted.inject({
          method: 'POST',
          url: '/api/auth/signin',
          payload: credentials('admin'),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await hosted.inject({ method: 'GET', url: '/api/me', headers: headers(adminToken) }))
        .statusCode,
    ).toBe(403);
    expect(
      (await hosted.inject({ method: 'GET', url: '/api/auth/local-test-accounts' })).statusCode,
    ).toBe(403);
  } finally {
    await hosted.close();
  }
});

it('requires an isolated local configuration and refuses production or remote databases', () => {
  const config = {
    enabled: true,
    host: '127.0.0.1',
    dataDir: 'C:/sandbox/.pglite-sandbox-testing',
    production: false,
  };
  expect(allowLocalTestAccounts(config)).toBe(true);
  expect(() => allowLocalTestAccounts({ ...config, production: true })).toThrow();
  expect(() => allowLocalTestAccounts({ ...config, host: '0.0.0.0' })).toThrow();
  expect(() =>
    allowLocalTestAccounts({ ...config, databaseUrl: 'postgres://host/database' }),
  ).toThrow();
  expect(() => allowLocalTestAccounts({ ...config, dataDir: 'C:/real/pglite' })).toThrow();
});
