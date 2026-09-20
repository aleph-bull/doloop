import Fastify from 'fastify';
import cors from '@fastify/cors';

export interface BuildOptions {
  logger?: boolean;
  corsOrigins?: string[];
}

/** Build the Fastify app without listening, so tests can inject requests. */
export async function buildServer(opts: BuildOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(cors, {
    origin: opts.corsOrigins ?? true,
    credentials: true,
  });

  app.get('/api/health', async () => ({ ok: true, service: 'doloop-api' }));

  return app;
}
