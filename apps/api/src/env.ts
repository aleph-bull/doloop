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
  port: number;
  host: string;
  corsOrigins: string[];
  databaseUrl: string | undefined;
  supabaseUrl: string | undefined;
  supabaseJwtSecret: string | undefined;
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
  portalUrl: string;
}

export function loadEnv(): Env {
  return {
    port: Number(str('PORT', '8787')),
    host: str('HOST', '0.0.0.0')!,
    corsOrigins: str('CORS_ORIGINS', 'http://localhost:5173')!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    databaseUrl: str('DATABASE_URL'),
    supabaseUrl: str('SUPABASE_URL'),
    supabaseJwtSecret: str('SUPABASE_JWT_SECRET'),
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
  };
}
