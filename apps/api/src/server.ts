import cors from '@fastify/cors';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { authPlugin } from './auth/plugin';
import type { Verifier } from './auth/verify';
import type { Db } from './db/client';
import { HttpError } from './errors';
import { meRoutes } from './routes/me';
import { nodeRoutes } from './routes/nodes';
import { plannedBlockRoutes } from './routes/planned-blocks';
import { restDayRoutes } from './routes/rest-days';
import { sessionRoutes } from './routes/sessions';

export interface BuildOptions {
  db: Db;
  verifier: Verifier;
  logger?: boolean;
  corsOrigins?: string[];
  /** Injectable clock for tests. */
  clock?: () => string;
}

/** Build the Fastify app without listening, so tests can inject requests. */
export async function buildServer(opts: BuildOptions) {
  const app = Fastify({ logger: opts.logger ?? false });
  const clock = opts.clock ?? (() => new Date().toISOString());

  await app.register(cors, {
    origin: opts.corsOrigins ?? true,
    credentials: true,
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Validation failed', issues: err.issues });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.message, details: err.details });
    }
    const status =
      typeof (err as { statusCode?: number }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    if (status >= 500) app.log.error(err);
    return reply
      .code(status)
      .send({ error: status >= 500 ? 'Internal error' : (err as Error).message });
  });

  app.get('/api/health', { config: { public: true } }, async () => ({
    ok: true,
    service: 'doloop-api',
  }));

  await app.register(authPlugin, { db: opts.db, verifier: opts.verifier });

  meRoutes(app, opts.db, clock);
  nodeRoutes(app, opts.db, clock);
  sessionRoutes(app, opts.db, clock);
  plannedBlockRoutes(app, opts.db, clock);
  restDayRoutes(app, opts.db, clock);

  return app;
}
