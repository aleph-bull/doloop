import type { FastifyInstance } from 'fastify';
import { isValidTimezone } from '@komogon/core';
import { z } from 'zod';
import { isInvited } from '../auth/plugin';
import { signDevToken } from '../auth/verify';
import type { Db } from '../db/client';
import { HttpError } from '../errors';
import { isAdmin } from '../services/admin';
import { signIn, signUp } from '../services/passwords';

const credentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
});

/** Sign-ins last 30 days; signing in again starts a new 30. */
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface PasswordAuthOptions {
  /** HS256 secret the API signs its own tokens with (`AUTH_SECRET`). */
  secret: string;
  allowedEmails?: string[];
  /** Admins' sign-ups take over their existing account (data made before passwords existed). */
  adminEmails?: string[];
}

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

  app.post('/api/auth/signup', { config: { public: true } }, async (req) => {
    const body = credentialsSchema.parse(req.body);
    if (!isInvited(body.email, opts.allowedEmails)) throw new HttpError(403, 'invite_only');
    const tz = req.headers['x-timezone'];
    const timezone = typeof tz === 'string' && isValidTimezone(tz) ? tz : null;
    const claim = isAdmin(body.email, opts.adminEmails ?? []);
    return respond(await signUp(db, body.email, body.password, timezone, claim));
  });

  app.post('/api/auth/signin', { config: { public: true } }, async (req) => {
    const body = credentialsSchema.parse(req.body);
    return respond(await signIn(db, body.email, body.password));
  });
}
