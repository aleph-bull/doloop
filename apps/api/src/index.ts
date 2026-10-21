import { createHsVerifier, createSupabaseVerifier, type Verifier } from './auth/verify';
import { createDb, createPgliteDb, migratePg } from './db/client';
import { loadEnv } from './env';
import { buildServer } from './server';
import { backPayBadges } from './services/achievements';
import { createGoogleClient } from './services/google';
import type { CalendarDeps } from './services/calendar-sync';
import { createOutlookClient } from './services/outlook';
import { allowLocalTestAccounts } from './services/local-test-accounts';
import { createLocalMailer, createResendMailer } from './services/mailer';

const env = loadEnv();
const localTestAccounts = allowLocalTestAccounts({
  enabled: env.localTestAccounts,
  host: env.host,
  databaseUrl: env.databaseUrl,
  dataDir: env.pgliteDataDir,
  production: process.env.NODE_ENV === 'production',
});

let verifier: Verifier;
if (env.supabaseUrl) {
  verifier = createSupabaseVerifier({
    supabaseUrl: env.supabaseUrl,
    jwtSecret: env.supabaseJwtSecret,
  });
} else if (env.authSecret) {
  verifier = createHsVerifier(env.authSecret);
  console.warn('[api] Email-and-password accounts kept by the API (AUTH_SECRET).');
} else if (env.devAuthSecret) {
  verifier = createHsVerifier(env.devAuthSecret);
  console.warn('[api] SUPABASE_URL not set; using DEV_AUTH_SECRET for HS256 tokens (dev only).');
} else {
  console.error('[api] Set SUPABASE_URL (+ SUPABASE_JWT_SECRET), AUTH_SECRET or DEV_AUTH_SECRET.');
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

// Badges unlocked before they paid XP are paid once; after that this finds nothing to do.
const backPaid = await backPayBadges(db, new Date().toISOString());
if (backPaid > 0)
  console.warn(`[api] Paid the XP for ${backPaid} badges earned before badges paid XP.`);

if (env.allowedEmails.length > 0)
  console.warn(`[api] Invite-only: ${env.allowedEmails.length} allowed addresses or domains.`);

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

const app = await buildServer({
  mailer: localTestAccounts
    ? createLocalMailer()
    : env.resendApiKey
      ? createResendMailer(env.resendApiKey, env.mailFrom)
      : null,
  requireEmailVerification: true,
  localTestAccounts,
  db,
  verifier,
  logger: true,
  corsOrigins: env.corsOrigins,
  allowedEmails: env.allowedEmails,
  adminEmails: env.adminEmails,
  passwordAuth: !env.supabaseUrl && env.authSecret ? { secret: env.authSecret } : null,
  calendar: {
    deps: calendarDeps,
    outlook:
      env.outlook.clientId && env.outlook.clientSecret && env.tokenEncryptionKey
        ? {
            client: createOutlookClient({
              ...env.outlook,
              clientId: env.outlook.clientId,
              clientSecret: env.outlook.clientSecret,
            }),
            encryptionKey: env.tokenEncryptionKey,
          }
        : null,
    autoSync: true,
    stateSecret:
      env.tokenEncryptionKey ?? env.authSecret ?? env.devAuthSecret ?? 'dev-state-secret',
    portalUrl: env.portalUrl,
  },
  tmdb: env.tmdb,
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
