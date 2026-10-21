import type { FastifyInstance } from 'fastify';
import { isValidTimezone } from '@komogon/core';
import { z } from 'zod';
import { isInvited } from '../auth/plugin';
import { signDevToken } from '../auth/verify';
import type { Db } from '../db/client';
import { HttpError } from '../errors';
import { isAdmin } from '../services/admin';
import { googleSignIn, type GoogleTokenVerifier } from '../services/google-signin';
import { signIn, signUp } from '../services/passwords';
import { RateLimiter, checkLimits, type Limit } from '../services/rate-limit';

const credentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
});

/** The ID token Google's sign-in button hands the portal. */
const googleSchema = z.object({ credential: z.string().min(1).max(4096) });

/** Sign-ins last 30 days; signing in again starts a new 30. */
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface PasswordAuthOptions {
  /** HS256 secret the API signs its own tokens with (`AUTH_SECRET`). */
  secret: string;
  allowedEmails?: string[];
  /** Admins' sign-ups take over their existing account (data made before passwords existed). */
  adminEmails?: string[];
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
  const respond = async (user: { id: string; email: string }) => ({
    token: await signDevToken(opts.secret, user, TOKEN_TTL_SECONDS),
    email: user.email,
  });

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
    if (!isInvited(body.email, opts.allowedEmails)) throw new HttpError(403, 'invite_only');
    const claim = isAdmin(body.email, opts.adminEmails ?? []);
    const timezone = timezoneOf(req.headers['x-timezone']);
    return respond(await signUp(db, body.email, body.password, timezone, claim));
  });

  app.post('/api/auth/signin', { config: { public: true } }, async (req) => {
    const body = credentialsSchema.parse(req.body);
    const email = body.email.toLowerCase();
    if (!signInEmail || !signInIp) return respond(await signIn(db, email, body.password));
    checkLimits([
      [signInEmail, email],
      [signInIp, req.ip],
    ]);
    try {
      const user = await signIn(db, email, body.password);
      signInEmail.clear(email);
      return respond(user);
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
    return respond(await googleSignIn(db, identity, timezoneOf(req.headers['x-timezone'])));
  });
}

const timezoneOf = (tz: unknown) => (typeof tz === 'string' && isValidTimezone(tz) ? tz : null);
