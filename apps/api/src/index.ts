import { createHsVerifier, createSupabaseVerifier, type Verifier } from './auth/verify';
import { createDb, createPgliteDb, migratePg } from './db/client';
import { loadEnv } from './env';
import { buildServer } from './server';
import { createGoogleClient } from './services/google';
import type { CalendarDeps } from './services/calendar-sync';
import { createSpotifyClient } from './services/spotify';
import type { SpotifyDeps } from './services/spotify-connection';

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
  console.warn(`[api] DATABASE_URL not set; using PGlite at ${env.pgliteDataDir} (dev only).`);
  ({ db, close } = await createPgliteDb(env.pgliteDataDir));
}

let calendarDeps: CalendarDeps | null = null;
if (env.google.clientId && env.google.clientSecret && env.tokenEncryptionKey) {
  calendarDeps = {
    google: createGoogleClient({
      clientId: env.google.clientId,
      clientSecret: env.google.clientSecret,
      redirectUri: env.google.redirectUri,
    }),
    encryptionKey: env.tokenEncryptionKey,
  };
} else {
  console.warn(
    '[api] Google Calendar disabled (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY).',
  );
}

let spotifyDeps: SpotifyDeps | null = null;
if (env.spotify.clientId && env.spotify.clientSecret && env.tokenEncryptionKey) {
  spotifyDeps = {
    spotify: createSpotifyClient({
      clientId: env.spotify.clientId,
      clientSecret: env.spotify.clientSecret,
      redirectUri: env.spotify.redirectUri,
    }),
    encryptionKey: env.tokenEncryptionKey,
  };
} else {
  console.warn(
    '[api] Spotify disabled (set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY).',
  );
}

const app = await buildServer({
  db,
  verifier,
  logger: true,
  corsOrigins: env.corsOrigins,
  calendar: {
    deps: calendarDeps,
    stateSecret: env.tokenEncryptionKey ?? env.devAuthSecret ?? 'dev-state-secret',
    portalUrl: env.portalUrl,
  },
  spotify: { deps: spotifyDeps },
});

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
