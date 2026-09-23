import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { isValidTimezone } from '@komodoit/core';
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
