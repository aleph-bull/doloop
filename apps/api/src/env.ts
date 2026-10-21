import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load apps/api/.env when present (Node 21+ built-in; no dotenv dependency).
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    /* ignore */
  }
}

function str(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

export interface Env {
  resendApiKey: string | undefined;
  mailFrom: string;
  localTestAccounts: boolean;
  port: number;
  host: string;
  corsOrigins: string[];
  /** Invite list (`ALLOWED_EMAILS`): addresses or `@domain`, comma separated. Empty is open. */
  allowedEmails: string[];
  /** Admins (`ADMIN_EMAILS`, comma separated): see every account and its data. */
  adminEmails: string[];
  databaseUrl: string | undefined;
  supabaseUrl: string | undefined;
  supabaseJwtSecret: string | undefined;
  /** Secret for the API's own email-and-password accounts, when Supabase sign-in is not used. */
  authSecret: string | undefined;
  /** Proxies in front of the API whose X-Forwarded-For entry to trust (`TRUST_PROXY_HOPS`). */
  trustProxyHops: number;
  /**
   * OAuth client id for "Continue with Google" on the API's own accounts. Only the id is
   * needed; the portal's address must be an authorised JavaScript origin on the client.
   */
  googleSignInClientId: string | undefined;
  /** Dev-only HS256 secret for locally minted tokens when Supabase is not configured. */
  devAuthSecret: string | undefined;
  /** Where PGlite stores dev data when DATABASE_URL is unset. */
  pgliteDataDir: string;
  google: {
    clientId: string | undefined;
    clientSecret: string | undefined;
    redirectUri: string;
  };
  tokenEncryptionKey: string | undefined;
  outlook: {
    clientId: string | undefined;
    clientSecret: string | undefined;
    redirectUri: string;
    tenant: string;
  };
  portalUrl: string;
  /**
   * TMDB credentials for film and TV posters on the Analytics page: a v4 read access token
   * or a v3 API key. Without either, the equivalents fall back to listed runtimes and icons.
   */
  tmdb: { readToken: string | undefined; apiKey: string | undefined };
}

export function loadEnv(): Env {
  return {
    resendApiKey: str('RESEND_API_KEY'),
    mailFrom: str('MAIL_FROM', 'Komodon <noreply@komogon.app>')!,
    localTestAccounts: process.env.LOCAL_TEST_ACCOUNTS === 'true',
    outlook: {
      clientId: str('OUTLOOK_CLIENT_ID'),
      clientSecret: str('OUTLOOK_CLIENT_SECRET'),
      redirectUri: str(
        'OUTLOOK_REDIRECT_URI',
        'http://localhost:8787/api/calendar/outlook/callback',
      )!,
      tenant: str('OUTLOOK_TENANT', 'common')!,
    },
    port: Number(str('PORT', '8787')),
    host: str('HOST', '0.0.0.0')!,
    corsOrigins: str('CORS_ORIGINS', 'http://localhost:5173')!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    allowedEmails: str('ALLOWED_EMAILS', '')!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    adminEmails: str('ADMIN_EMAILS', '')!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    databaseUrl: str('DATABASE_URL'),
    supabaseUrl: str('SUPABASE_URL'),
    supabaseJwtSecret: str('SUPABASE_JWT_SECRET'),
    authSecret: str('AUTH_SECRET'),
    trustProxyHops: Number(str('TRUST_PROXY_HOPS', '0')) || 0,
    googleSignInClientId: str('GOOGLE_SIGNIN_CLIENT_ID'),
    devAuthSecret: str('DEV_AUTH_SECRET'),
    pgliteDataDir: str('PGLITE_DATA_DIR', '.pglite')!,
    google: {
      clientId: str('GOOGLE_CLIENT_ID'),
      clientSecret: str('GOOGLE_CLIENT_SECRET'),
      redirectUri: str(
        'GOOGLE_REDIRECT_URI',
        'http://localhost:8787/api/calendar/google/callback',
      )!,
    },
    tokenEncryptionKey: str('TOKEN_ENCRYPTION_KEY'),
    portalUrl: str('PORTAL_URL', 'http://localhost:5173')!,
    tmdb: { readToken: str('TMDB_READ_TOKEN'), apiKey: str('TMDB_API_KEY') },
  };
}
