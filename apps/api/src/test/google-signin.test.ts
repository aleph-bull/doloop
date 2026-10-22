import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHsVerifier } from '../auth/verify';
import { createPgliteDb, type Db } from '../db/client';
import { buildServer } from '../server';
import { HttpError } from '../errors';
import { createGoogleAccessTokenVerifier, type GoogleIdentity } from '../services/google-signin';

const SECRET = 'google-signin-test-secret';

/** Stands in for Google: the "token" is `ok:<email>`, `unverified:<email>` or anything else. */
async function fakeVerify(token: string): Promise<GoogleIdentity> {
  const [kind, email] = token.split(':');
  if (kind === 'ok') return { email: email!, emailVerified: true };
  if (kind === 'unverified') return { email: email!, emailVerified: false };
  throw new HttpError(401, "Google sign-in didn't go through. Try again.");
}

describe('continue with Google', () => {
  let app: FastifyInstance;
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createPgliteDb());
    app = await buildServer({
      db,
      verifier: createHsVerifier(SECRET),
      allowedEmails: ['@example.com'],
      passwordAuth: {
        secret: SECRET,
        google: { clientId: 'test-client', verify: fakeVerify, verifyAccessToken: fakeVerify },
      },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, payload, headers: { 'x-timezone': 'Europe/London' } });
  const userId = async (token: string) =>
    (
      await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json().user.id as string;

  it('tells the portal the client id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/google' });
    expect(res.json()).toEqual({ clientId: 'test-client' });
  });

  it('starts a new account, and signs back in to the same one', async () => {
    const first = await post('/api/auth/google', { credential: 'ok:New@Example.com' });
    expect(first.statusCode).toBe(200);
    expect(first.json().email).toBe('new@example.com');
    const again = await post('/api/auth/google', { credential: 'ok:new@example.com' });
    expect(await userId(again.json().token)).toBe(await userId(first.json().token));
  });

  it("takes an access token from Google's popup for the same account", async () => {
    const first = await post('/api/auth/google', { credential: 'ok:popup@example.com' });
    const popup = await post('/api/auth/google', { accessToken: 'ok:popup@example.com' });
    expect(popup.statusCode).toBe(200);
    expect(await userId(popup.json().token)).toBe(await userId(first.json().token));
    expect((await post('/api/auth/google', { accessToken: 'forged' })).statusCode).toBe(401);
    expect((await post('/api/auth/google', {})).statusCode).toBe(400);
  });

  it('joins the account that already has a password for the email', async () => {
    const up = await post('/api/auth/signup', { email: 'pw@example.com', password: 'hunter22' });
    const viaGoogle = await post('/api/auth/google', { credential: 'ok:pw@example.com' });
    expect(await userId(viaGoogle.json().token)).toBe(await userId(up.json().token));
  });

  it('refuses a bad token, an unconfirmed email and someone not invited', async () => {
    expect((await post('/api/auth/google', { credential: 'forged' })).statusCode).toBe(401);
    expect(
      (await post('/api/auth/google', { credential: 'unverified:x@example.com' })).statusCode,
    ).toBe(401);
    const outsider = await post('/api/auth/google', { credential: 'ok:who@elsewhere.org' });
    expect(outsider.statusCode).toBe(403);
    expect(outsider.json().error).toBe('invite_only');
  });
});

describe("checking an access token with Google's tokeninfo", () => {
  const answering =
    (status: number, body: Record<string, unknown>): typeof fetch =>
    async () =>
      new Response(JSON.stringify(body), { status });
  const info = { aud: 'our-client', email: 'Ada@Example.com', email_verified: 'true' };

  it('reads the email when the token was issued to our client', async () => {
    const verify = createGoogleAccessTokenVerifier('our-client', answering(200, info));
    expect(await verify('t')).toEqual({ email: 'Ada@Example.com', emailVerified: true });
  });

  it("refuses another site's token, a token Google rejects and a failed request", async () => {
    const other = createGoogleAccessTokenVerifier(
      'our-client',
      answering(200, { ...info, aud: 'someone-else' }),
    );
    await expect(other('t')).rejects.toMatchObject({ status: 401 });
    const rejected = createGoogleAccessTokenVerifier(
      'our-client',
      answering(400, { error: 'invalid_token' }),
    );
    await expect(rejected('t')).rejects.toMatchObject({ status: 401 });
    const offline = createGoogleAccessTokenVerifier('our-client', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(offline('t')).rejects.toMatchObject({ status: 401 });
  });

  it('passes on an unconfirmed email as unconfirmed', async () => {
    const verify = createGoogleAccessTokenVerifier(
      'our-client',
      answering(200, { ...info, email_verified: 'false' }),
    );
    expect((await verify('t')).emailVerified).toBe(false);
  });
});

describe('without a Google client id', () => {
  it('offers no Google sign-in', async () => {
    const { db, close } = await createPgliteDb();
    const app = await buildServer({
      db,
      verifier: createHsVerifier(SECRET),
      passwordAuth: { secret: SECRET },
    });
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/api/auth/google' })).json()).toEqual({
      clientId: null,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      payload: { credential: 'ok:a@example.com' },
    });
    // No such route, and unknown routes need a sign-in first.
    expect(res.statusCode).toBe(401);
    await app.close();
    await close();
  });
});
