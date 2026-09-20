import { createHsVerifier, createSupabaseVerifier, type Verifier } from './auth/verify';
import { createDb, createPgliteDb, migratePg } from './db/client';
import { loadEnv } from './env';
import { buildServer } from './server';

const env = loadEnv();

let verifier: Verifier;
if (env.supabaseUrl) {
  verifier = createSupabaseVerifier({
    supabaseUrl: env.supabaseUrl,
    jwtSecret: env.supabaseJwtSecret,
  });
} else if (env.devAuthSecret) {
  verifier = createHsVerifier(env.devAuthSecret);
  console.warn('[api] SUPABASE_URL not set; using DEV_AUTH_SECRET for HS256 tokens (dev only).');
} else {
  console.error('[api] Set SUPABASE_URL (+ SUPABASE_JWT_SECRET) or DEV_AUTH_SECRET.');
  process.exit(1);
}

let db;
let close: () => Promise<void>;
if (env.databaseUrl) {
  await migratePg(env.databaseUrl);
  ({ db, close } = createDb(env.databaseUrl));
} else {
  console.warn('[api] DATABASE_URL not set; using in-memory PGlite (data is lost on restart).');
  ({ db, close } = await createPgliteDb());
}

const app = await buildServer({ db, verifier, logger: true, corsOrigins: env.corsOrigins });

const shutdown = async () => {
  await app.close();
  await close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port: env.port, host: env.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
