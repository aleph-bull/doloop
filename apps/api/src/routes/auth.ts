import type { FastifyInstance } from 'fastify';
import { isValidTimezone } from '@komogon/core';
import { z } from 'zod';
import { isInvited } from '../auth/plugin';
import type { Db } from '../db/client';
import { HttpError } from '../errors';
import { isAdmin } from '../services/admin';
import { hashPassword, signIn, signUp } from '../services/passwords';
import { accountSession } from '../services/account-session';
import { issueEmailCode, requestLimits } from '../services/email-codes';
import type { Mailer } from '../services/mailer';
import {
  LOCAL_TEST_ACCOUNTS,
  isLocalTestEmail,
  requireLocalTestRequest,
  resetLocalOnboarding,
} from '../services/local-test-accounts';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';

const credentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
});

/** Sign-ins last 30 days; signing in again starts a new 30. */

export interface PasswordAuthOptions {
  /** HS256 secret the API signs its own tokens with (`AUTH_SECRET`). */
  secret: string;
  allowedEmails?: string[];
  /** Admins' sign-ups take over their existing account (data made before passwords existed). */
  adminEmails?: string[];
  localTestAccounts?: boolean;
  mailer?: Mailer | null;
  requireVerification?: boolean;
  clock?: () => string;
}

/**
 * Email-and-password accounts kept by the API itself, for hosting without Supabase sign-in.
 * Both routes are public and answer `{ token, email }`; the token then goes in the
 * Authorization header like any other.
 */
export function passwordAuthRoutes(app: FastifyInstance, db: Db, opts: PasswordAuthOptions) {
  app.get('/api/auth/local-test-accounts', { config: { public: true } }, async (req) => {
    requireLocalTestRequest(req, opts.localTestAccounts ?? false);
    return { accounts: LOCAL_TEST_ACCOUNTS };
  });
  app.post(
    '/api/auth/local-test-accounts/onboarding/reset',
    { config: { public: true } },
    async (req) => {
      requireLocalTestRequest(req, opts.localTestAccounts ?? false);
      await resetLocalOnboarding(db, new Date().toISOString());
      return { ok: true };
    },
  );
  const respond = (user: { id: string; email: string }) => accountSession(db, opts.secret, user);

  app.post('/api/auth/signup', { config: { public: true } }, async (req) => {
    const body = credentialsSchema.parse(req.body);
    if (isLocalTestEmail(body.email))
      throw new HttpError(403, 'Use the local test account sign-in.');
    if (!isInvited(body.email, opts.allowedEmails)) throw new HttpError(403, 'invite_only');
    const tz = req.headers['x-timezone'];
    const timezone = typeof tz === 'string' && isValidTimezone(tz) ? tz : null;
    const claim = isAdmin(body.email, opts.adminEmails ?? []);
    if (opts.requireVerification) {
      const now = opts.clock?.() ?? new Date().toISOString();
      await requestLimits(db, opts.secret, body.email, req.ip, now);
      if (body.password.length < 6)
        throw new HttpError(400, 'Use a password of at least 6 characters.');
      const challenge = await issueEmailCode(
        db,
        opts.mailer ?? null,
        opts.secret,
        {
          email: body.email,
          purpose: 'signup',
          payload: {
            passwordHash: await hashPassword(body.password),
            timezone,
            claimExisting: claim,
          },
        },
        now,
      );
      return { verificationRequired: true, ...challenge };
    }
    return respond(await signUp(db, body.email, body.password, timezone, claim));
  });

  app.post('/api/auth/signin', { config: { public: true } }, async (req) => {
    const body = credentialsSchema.parse(req.body);
    const identity = await signIn(db, body.email, body.password);
    const user = await db.query.users.findFirst({ where: eq(users.id, identity.id) });
    if (user?.isTestAccount || isLocalTestEmail(identity.email))
      requireLocalTestRequest(req, opts.localTestAccounts ?? false);
    return respond(identity);
  });
}
