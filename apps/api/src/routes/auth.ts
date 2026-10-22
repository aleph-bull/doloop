import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isValidTimezone } from '@komogon/core';
import { z } from 'zod';
import { isInvited } from '../auth/plugin';
import type { Db } from '../db/client';
import { HttpError } from '../errors';
import { isAdmin } from '../services/admin';
import { isEmailBlocked, SUSPENDED } from '../services/moderation';
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
import { googleSignIn, type GoogleTokenVerifier } from '../services/google-signin';
import { RateLimiter, checkLimits, type Limit } from '../services/rate-limit';

const credentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
});

/** The ID token Google's sign-in button hands the portal. */
const googleSchema = z.object({ credential: z.string().min(1).max(4096) });

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

  /** "Continue with Google" (`GOOGLE_SIGNIN_CLIENT_ID`); left out, only passwords work. */
  google?: { clientId: string; verify: GoogleTokenVerifier } | null;
  /** Limits on tries, to slow down password guessing; null turns them off (tests). */
  limits?: AuthLimits | null;
}

export interface AuthLimits {
  /** Failed sign-ins for one email, from anywhere. */
  signInPerEmail: Limit;
  /** Failed sign-ins from one address, whatever the email. */
  signInPerIp: Limit;
  /** Sign-ups from one address. */
  signUpPerIp: Limit;
  now?: () => number;
}

const MINUTE = 60 * 1000;

export const DEFAULT_AUTH_LIMITS: AuthLimits = {
  signInPerEmail: { max: 10, windowMs: 15 * MINUTE },
  signInPerIp: { max: 30, windowMs: 15 * MINUTE },
  // Generous enough for a class signing up together behind one school address.
  signUpPerIp: { max: 20, windowMs: 60 * MINUTE },
};

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
  const finishSignIn = async (identity: { id: string; email: string }, req: FastifyRequest) => {
    const user = await db.query.users.findFirst({ where: eq(users.id, identity.id) });
    if (user?.isTestAccount || isLocalTestEmail(identity.email))
      requireLocalTestRequest(req, opts.localTestAccounts ?? false);
    return respond(identity);
  };

  const limits = opts.limits === undefined ? DEFAULT_AUTH_LIMITS : opts.limits;
  const limiter = (limit: Limit) => new RateLimiter(limit, limits?.now);
  const signInEmail = limits && limiter(limits.signInPerEmail);
  const signInIp = limits && limiter(limits.signInPerIp);
  const signUpIp = limits && limiter(limits.signUpPerIp);

  app.post('/api/auth/signup', { config: { public: true } }, async (req) => {
    if (signUpIp) {
      checkLimits([[signUpIp, req.ip]]);
      signUpIp.hit(req.ip);
    }
    const body = credentialsSchema.parse(req.body);
    if (isLocalTestEmail(body.email))
      throw new HttpError(403, 'Use the local test account sign-in.');
    if (!isInvited(body.email, opts.allowedEmails)) throw new HttpError(403, 'invite_only');
    if (await isEmailBlocked(db, body.email)) throw new HttpError(403, SUSPENDED);
    const claim = isAdmin(body.email, opts.adminEmails ?? []);
    const timezone = timezoneOf(req.headers['x-timezone']);
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
    const email = body.email.toLowerCase();
    if (!signInEmail || !signInIp) return finishSignIn(await signIn(db, email, body.password), req);
    checkLimits([
      [signInEmail, email],
      [signInIp, req.ip],
    ]);
    try {
      const user = await signIn(db, email, body.password);
      signInEmail.clear(email);
      return finishSignIn(user, req);
    } catch (err) {
      // Only failed tries count, so people signing in normally never meet the limit.
      if (err instanceof HttpError && err.status === 401) {
        signInEmail.hit(email);
        signInIp.hit(req.ip);
      }
      throw err;
    }
  });

  const google = opts.google;
  // The portal asks first, and shows the Google button only when this answers a client id.
  app.get('/api/auth/google', { config: { public: true } }, async () => ({
    clientId: google?.clientId ?? null,
  }));
  if (!google) return;
  app.post('/api/auth/google', { config: { public: true } }, async (req) => {
    const { credential } = googleSchema.parse(req.body);
    if (signInIp) checkLimits([[signInIp, req.ip]]);
    const identity = await google.verify(credential).catch((err: unknown) => {
      signInIp?.hit(req.ip);
      throw err;
    });
    if (!isInvited(identity.email, opts.allowedEmails)) throw new HttpError(403, 'invite_only');
    if (isLocalTestEmail(identity.email))
      throw new HttpError(403, 'Use the local test account sign-in.');
    // Before googleSignIn, which would start an account for a new address.
    if (await isEmailBlocked(db, identity.email)) throw new HttpError(403, SUSPENDED);
    const account = await googleSignIn(db, identity, timezoneOf(req.headers['x-timezone']));
    await db
      .update(users)
      .set({ emailVerifiedAt: new Date(opts.clock?.() ?? Date.now()) })
      .where(eq(users.id, account.id));
    return finishSignIn(account, req);
  });
}

const timezoneOf = (tz: unknown) => (typeof tz === 'string' && isValidTimezone(tz) ? tz : null);
