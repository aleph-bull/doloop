import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { isValidTimezone } from '@komogon/core';
import type { Db } from '../db/client';
import type { UserRow } from '../db/schema';
import { ensureUser } from '../services/users';
import { AuthError, type Verifier } from './verify';
import { isLocalTestEmail, requireLocalTestRequest } from '../services/local-test-accounts';
import { isEmailBlocked, SUSPENDED } from '../services/moderation';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow;
    authUserId: string;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}

export interface AuthPluginOptions {
  db: Db;
  verifier: Verifier;
  /** Invite list for a closed test; empty or missing lets every signed-in account in. */
  allowedEmails?: string[];
  localTestAccounts?: boolean;
}

/**
 * Whether an email is on the invite list. Entries are whole addresses or `@domain`; case is
 * ignored. An empty list lets everyone in.
 */
export function isInvited(email: string | null, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return allowed.some((entry) => {
    const a = entry.trim().toLowerCase();
    return a.startsWith('@') ? e.endsWith(a) : e === a;
  });
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

/** Verifies the bearer token on every non-public route and attaches the user row. */
export const authPlugin = fp(async (app: FastifyInstance, opts: AuthPluginOptions) => {
  app.decorateRequest('user', null as unknown as UserRow);
  app.decorateRequest('authUserId', '');

  app.addHook('onRequest', async (req, reply) => {
    if (req.routeOptions.config.public) return;
    const token = bearer(req);
    if (!token) return reply.code(401).send({ error: 'Missing bearer token' });
    try {
      const auth = await opts.verifier.verify(token);
      const existing = await opts.db.query.users.findFirst({ where: eq(users.id, auth.id) });
      if (existing && existing.authVersion !== (auth.authVersion ?? 0))
        return reply.code(401).send({ error: 'Session expired. Sign in again.' });
      if (existing?.isTestAccount || isLocalTestEmail(auth.email)) {
        requireLocalTestRequest(req, opts.localTestAccounts ?? false);
        if (!existing)
          return reply.code(401).send({ error: 'Test account was reset. Sign in again.' });
      }
      // Checked before ensureUser, so an uninvited sign-in never creates an account row.
      if (!isInvited(auth.email, opts.allowedEmails))
        return reply.code(403).send({ error: 'invite_only' });
      // Suspended by an admin, or a new account for a blocked address.
      if (existing ? existing.bannedAt : await isEmailBlocked(opts.db, auth.email))
        return reply.code(403).send({ error: SUSPENDED });
      const tzHeader = req.headers['x-timezone'];
      const tz = typeof tzHeader === 'string' && isValidTimezone(tzHeader) ? tzHeader : null;
      req.authUserId = auth.id;
      req.user = await ensureUser(opts.db, auth, tz);
    } catch (err) {
      if (err instanceof AuthError) return reply.code(401).send({ error: err.message });
      throw err;
    }
  });
});
