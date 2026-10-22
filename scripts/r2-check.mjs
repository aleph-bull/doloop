/**
 * Checks a Cloudflare R2 setup end to end with the same code the API uses: upload through
 * a signed link, read it back, copy, delete, measure the bucket, and whether the bucket's
 * CORS lets the portal upload from the browser. Reads R2_* from apps/api/.env (or the environment). Leaves
 * nothing behind in the bucket.
 *
 * Run: node scripts/r2-check.mjs [portal address, e.g. https://komogon.app]
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/api');
const envFile = join(API_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const need = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
const missing = need.filter(
  (k) => !process.env[k] && !(k === 'R2_ACCOUNT_ID' && process.env.R2_ENDPOINT),
);
if (missing.length) {
  console.error(`Missing in apps/api/.env: ${missing.join(', ')}`);
  process.exit(1);
}

const require = createRequire(join(API_DIR, 'package.json'));
const { register } = await import(pathToFileURL(require.resolve('tsx/esm/api')).href);
register();
const { createR2Store } = await import(
  pathToFileURL(join(API_DIR, 'src/services/media-store.ts')).href
);

const store = createR2Store({
  accountId: process.env.R2_ACCOUNT_ID ?? '',
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
  endpoint: process.env.R2_ENDPOINT,
});

let failed = false;
const step = async (what, fn) => {
  try {
    const note = await fn();
    console.log(`ok      ${what}${note ? ` (${note})` : ''}`);
    return true;
  } catch (err) {
    failed = true;
    console.log(`FAILED  ${what}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
};

const text = `Komodon R2 check ${new Date().toISOString()}`;
const mime = 'text/plain';
const upload = `uploads/r2-check/${randomUUID()}`;
const kept = `posts/r2-check/${randomUUID()}.txt`;
const uploadUrl = await store.uploadUrl(upload, mime, Buffer.byteLength(text), 600);

const uploaded = await step('upload through a signed link', async () => {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': mime },
    body: text,
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
});
if (uploaded) {
  await step('a link for one size refuses another', async () => {
    const url = await store.uploadUrl(`${upload}-x`, mime, 3, 600);
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': mime },
      body: 'four',
    });
    if (res.ok) {
      await store.remove(`${upload}-x`);
      throw new Error('R2 took a file of the wrong size');
    }
    return `refused with ${res.status}`;
  });
  await step('see its size and type', async () => {
    const head = await store.head(upload);
    if (!head) throw new Error('not found');
    if (head.bytes !== Buffer.byteLength(text) || head.mime !== mime)
      throw new Error(`got ${head.bytes} bytes of ${head.mime}`);
  });
  await step('read it through a signed link', async () => {
    const res = await fetch(await store.readUrl(upload, 600));
    if ((await res.text()) !== text) throw new Error(`${res.status}, different bytes`);
  });
  await step('copy it from uploads/ to posts/', async () => {
    await store.copy(upload, kept);
    if (!(await store.head(kept))) throw new Error('the copy is not there');
  });
  await step('delete both', async () => {
    await store.remove(upload);
    await store.remove(kept);
    if ((await store.head(upload)) || (await store.head(kept))) throw new Error('still there');
  });
}
// The API lists the bucket to stop uploads at 10 GB; without this it counts from Postgres.
await step('measure the whole bucket', async () => {
  const bytes = await store.usage();
  return `${(bytes / 1024 / 1024).toFixed(1)} MB of 10240 MB`;
});

const origins = [...process.argv.slice(2), ...(process.env.CORS_ORIGINS ?? '').split(',')]
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter((s) => /^https?:\/\//.test(s));
for (const origin of [...new Set(origins)]) {
  await step(`CORS lets ${origin} upload`, async () => {
    const res = await fetch(uploadUrl, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type',
      },
    });
    const allowed = res.headers.get('access-control-allow-origin');
    if (allowed !== origin && allowed !== '*')
      throw new Error(`no (status ${res.status}); add ${origin} to the bucket's CORS policy`);
  });
}
if (origins.length === 0)
  console.log(
    'skipped CORS: pass the portal address, e.g. node scripts/r2-check.mjs https://komogon.app',
  );

console.log(failed ? '\nSomething is off; see above.' : '\nR2 is ready.');
// exitCode, not exit(): exiting while fetch's sockets close trips an assertion on Windows.
process.exitCode = failed ? 1 : 0;
