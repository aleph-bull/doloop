/**
 * The API from source on 127.0.0.1:8797 with throwaway data in `apps/api/.pglite-sandbox`,
 * for trying things without touching real data or the ports the always-on copy uses.
 * The portal half is `vite --config vite.sandbox.config.ts` on 5183. Delete the folder to
 * start from empty.
 *
 * Run: node scripts/local/sandbox-api.mjs
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { API_DIR } from './lib.mjs';

// Set before the API reads its environment; apps/api/.env never overrides these.
process.chdir(API_DIR);
Object.assign(process.env, {
  HOST: '127.0.0.1',
  PORT: '8797',
  PGLITE_DATA_DIR: join(API_DIR, '.pglite-sandbox'),
  CORS_ORIGINS: 'http://localhost:5183',
  PORTAL_URL: 'http://localhost:5183',
});

const require = createRequire(join(API_DIR, 'package.json'));
const { register } = await import(pathToFileURL(require.resolve('tsx/esm/api')).href);
register();
await import(pathToFileURL(join(API_DIR, 'src/index.ts')).href);
