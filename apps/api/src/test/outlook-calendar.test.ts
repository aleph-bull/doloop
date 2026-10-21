import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPgliteDb } from '../db/client';
import { nodes } from '../db/schema';
import { buildServer } from '../server';
import { createHsVerifier, signDevToken } from '../auth/verify';
import { decrypt } from '../services/crypto';
import type { AcademicEvent } from '../services/calendar-recognition';
import { OutlookRevokedError, type OutlookClient } from '../services/outlook';
import { TEST_SECRET, USER_A, USER_B } from './helpers';

let app: Awaited<ReturnType<typeof buildServer>>;
let pg: Awaited<ReturnType<typeof createPgliteDb>>;
let token: string, tokenB: string;
let revoked = false,
  failed = false,
  challenge = '';
let events: AcademicEvent[] = [
  {
    id: 'exam',
    calendarId: 'school',
    calendarName: 'MAT137',
    title: 'Midterm',
    start: '2026-10-28T14:00:00Z',
    end: '2026-10-28T16:00:00Z',
    allDay: false,
  },
];
const key = 'b'.repeat(64);
const client: OutlookClient = {
  authUrl(state, codeChallenge) {
    challenge = codeChallenge;
    return `https://login.microsoftonline.com/authorize?state=${state}`;
  },
  async exchangeCode(_code, verifier) {
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);
    return { accessToken: 'at', refreshToken: 'refresh-initial' };
  },
  async refreshAccessToken() {
    if (revoked) throw new OutlookRevokedError();
    return { accessToken: 'at', refreshToken: 'refresh-rotated' };
  },
  async events() {
    if (failed) throw new Error('Remote page failed');
    return events;
  },
};
beforeAll(async () => {
  pg = await createPgliteDb();
  app = await buildServer({
    db: pg.db,
    verifier: createHsVerifier(TEST_SECRET),
    clock: () => '2026-10-21T12:00:00Z',
    calendar: {
      outlook: { client, encryptionKey: key },
      stateSecret: 'state',
      portalUrl: 'http://portal.test',
    },
  });
  await app.ready();
  token = await signDevToken(TEST_SECRET, USER_A);
  tokenB = await signDevToken(TEST_SECRET, USER_B);
});
afterAll(async () => {
  await app.close();
  await pg.close();
});
const api = (method: 'GET' | 'POST' | 'DELETE', url: string, auth = token) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${auth}`, 'x-timezone': 'America/Toronto' },
  });

it('requires authentication and rejects forged callback state', async () => {
  expect(
    (await app.inject({ method: 'POST', url: '/api/calendar/outlook/connect' })).statusCode,
  ).toBe(401);
  expect(
    (await api('GET', '/api/calendar/outlook/callback?code=a&state=forged')).headers.location,
  ).toContain('outlook=invalid');
});

it('connects with single-use PKCE, encrypts rotated refresh tokens and imports tasks', async () => {
  const connect = await api('POST', '/api/calendar/outlook/connect');
  const state = new URL(connect.json().url).searchParams.get('state')!;
  const callback = `/api/calendar/outlook/callback?code=ok&state=${encodeURIComponent(state)}`;
  expect((await api('GET', callback)).headers.location).toContain('outlook=connected');
  expect((await api('GET', callback)).headers.location).toContain('outlook=invalid');
  const row = await pg.db.query.outlookCalendar.findFirst();
  expect(row!.refreshTokenEnc).not.toContain('refresh');
  expect(decrypt(row!.refreshTokenEnc, key)).toBe('refresh-rotated');
  expect(await pg.db.query.nodes.findMany()).toHaveLength(2);
  expect((await api('GET', '/api/calendar/outlook/status')).json()).toMatchObject({
    connected: true,
    revoked: false,
    lastSyncAt: '2026-10-21T12:00:00.000Z',
  });
});

it('does not cancel imports when a remote request fails; other users cannot sync them', async () => {
  failed = true;
  expect((await api('POST', '/api/calendar/outlook/sync')).statusCode).toBe(500);
  expect(
    (await pg.db.query.nodes.findFirst({ where: eq(nodes.kind, 'assessment') }))!.archived,
  ).toBe(false);
  failed = false;
  expect((await api('POST', '/api/calendar/outlook/sync', tokenB)).json().status).toBe(
    'not-connected',
  );
  expect((await api('GET', '/api/calendar/outlook/status', tokenB)).json().connected).toBe(false);
});

it('surfaces revoked credentials and stops retrying them', async () => {
  revoked = true;
  expect((await api('POST', '/api/calendar/outlook/sync')).json().status).toBe('revoked');
  expect((await api('GET', '/api/calendar/outlook/status')).json().revoked).toBe(true);
  revoked = false;
  events = [];
  expect((await api('POST', '/api/calendar/outlook/sync')).json().status).toBe('revoked');
  expect(
    (await pg.db.query.nodes.findFirst({ where: eq(nodes.kind, 'assessment') }))!.archived,
  ).toBe(false);
});

it('disconnects without deleting courses or tasks and omits tokens from exports', async () => {
  const exported = (await api('GET', '/api/me/export')).body;
  expect(exported).not.toContain('refresh-rotated');
  expect(exported).not.toContain('refreshTokenEnc');
  expect((await api('DELETE', '/api/calendar/outlook')).statusCode).toBe(204);
  expect(await pg.db.query.outlookCalendar.findMany()).toHaveLength(0);
  expect(await pg.db.query.nodes.findMany()).toHaveLength(2);
});
