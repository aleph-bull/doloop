import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { isValidTimezone } from '@komogon/core';
import type { Db } from '../db/client';
import type { UserRow } from '../db/schema';
import { ensureUser } from '../services/users';
import { AuthError, type Verifier } from './verify';

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
      // Checked before ensureUser, so an uninvited sign-in never creates an account row.
      if (!isInvited(auth.email, opts.allowedEmails))
        return reply.code(403).send({ error: 'invite_only' });
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
