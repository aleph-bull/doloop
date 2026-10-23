import { randomUUID } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { passwordAccounts, users } from '../db/schema';
import { HttpError } from '../errors';
import { ensureUser } from './users';

/** What we use from a Google ID token once it has been checked. */
export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
}

export type GoogleTokenVerifier = (idToken: string) => Promise<GoogleIdentity>;

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * Checks an ID token from Google's sign-in button: signed by Google's keys, issued by
 * Google, and meant for our client id.
 */
export function createGoogleTokenVerifier(clientId: string): GoogleTokenVerifier {
  const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  return async (idToken) => {
    try {
      const { payload } = await jwtVerify(idToken, jwks, {
        issuer: GOOGLE_ISSUERS,
        audience: clientId,
      });
      return {
        email: typeof payload.email === 'string' ? payload.email : '',
        emailVerified: payload.email_verified === true,
      };
    } catch {
      throw new HttpError(401, "Google sign-in didn't go through. Try again.");
    }
  };
}

/**
 * Checks an access token from Google's account popup, which the portal's own "Continue with
 * Google" button opens. Google's tokeninfo says whom the token was issued to: it must be our
 * client id, or a token another site got for the same person could sign in here.
 */
export function createGoogleAccessTokenVerifier(
  clientId: string,
  fetcher: typeof fetch = fetch,
): GoogleTokenVerifier {
  return async (accessToken) => {
    const failed = new HttpError(401, "Google sign-in didn't go through. Try again.");
    let info: Record<string, unknown>;
    try {
      const res = await fetcher('https://oauth2.googleapis.com/tokeninfo', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: accessToken }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw failed;
      info = (await res.json()) as Record<string, unknown>;
    } catch {
      throw failed;
    }
    if (info.aud !== clientId) throw failed;
    return {
      email: typeof info.email === 'string' ? info.email : '',
      // tokeninfo sends it as the string "true".
      emailVerified: info.email_verified === true || info.email_verified === 'true',
    };
  };
}

/**
 * Who a Google sign-in belongs to. Google has checked the email, so it joins the account
 * that already uses that address (one made with a password, or moved over from a local
 * copy), and otherwise starts a new one.
 */
export async function googleSignIn(
  db: Db,
  identity: GoogleIdentity,
  timezone: string | null,
): Promise<{ id: string; email: string }> {
  if (!identity.email || !identity.emailVerified)
    throw new HttpError(401, "Google didn't confirm an email for this account.");
  const e = identity.email.trim().toLowerCase();
  const withPassword = await db.query.passwordAccounts.findFirst({
    where: eq(passwordAccounts.email, e),
  });
  if (withPassword) return { id: withPassword.userId, email: e };
  const existing = await db.query.users.findFirst({ where: eq(sql`lower(${users.email})`, e) });
  if (existing) return { id: existing.id, email: e };
  const id = randomUUID();
  await ensureUser(db, { id, email: e }, timezone);
  return { id, email: e };
}
