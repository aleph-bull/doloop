/** Local-only password accounts. Uses throwaway data, clear of the always-on app. */
import { join } from 'node:path';
import { API_DIR } from './lib.mjs';

Object.assign(process.env, {
  HOST: '127.0.0.1',
  PORT: process.env.SANDBOX_API_PORT ?? '8798',
  PGLITE_DATA_DIR: join(API_DIR, '.pglite-sandbox-testing'),
  DATABASE_URL: '',
  SUPABASE_URL: '',
  DEV_AUTH_SECRET: '',
  AUTH_SECRET: 'localhost-sandbox-test-accounts-only',
  ALLOWED_EMAILS: '',
  LOCAL_TEST_ACCOUNTS: 'true',
});
process.env.SANDBOX_DATA = '.pglite-sandbox-testing';
process.env.SANDBOX_API_PORT = process.env.PORT;
process.env.SANDBOX_PORTAL_PORT ??= '5184';
await import('./sandbox-api.mjs');
