#!/usr/bin/env node
/**
 * Alpha preflight: is this build safe to hand to other people?
 *
 * The automated checks (lint, types, tests including the alpha journey, contrast, build)
 * run first through `pnpm alpha:check`; this script then looks at what those can't: how the
 * build is configured and whether the code is backed up. It reads the env files the API and
 * portal are built with (`.env.production` if present, else `.env`) and reports by key name
 * only. It never prints a value, since some are secrets.
 *
 * Exit code 1 when anything is a blocker, so it can gate a release script or CI.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Parse a dotenv file into a map; values are only ever tested, not shown. */
function readEnv(dir) {
  for (const name of ['.env.production', '.env']) {
    const file = join(root, dir, name);
    if (!existsSync(file)) continue;
    const env = {};
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
    return { file: `${dir}/${name}`, env };
  }
  return { file: null, env: {} };
}

const results = [];
const block = (msg) => results.push({ level: 'BLOCK', msg });
const warn = (msg) => results.push({ level: 'WARN', msg });
const pass = (msg) => results.push({ level: 'OK', msg });
const set = (env, key) => typeof env[key] === 'string' && env[key].trim() !== '';
const isLocal = (url) => /localhost|127\.0\.0\.1|\[::1\]/.test(url ?? '');

// --- API configuration
const api = readEnv('apps/api');
if (!api.file) block('apps/api has no .env.production or .env: the API has no configuration.');
else {
  if (set(api.env, 'DEV_AUTH_SECRET'))
    block(
      `${api.file}: DEV_AUTH_SECRET is set. Dev sign-in lets anyone sign in as anyone. Remove it for a shared build.`,
    );
  else pass(`${api.file}: dev sign-in is off.`);
  if (set(api.env, 'SUPABASE_URL') && set(api.env, 'SUPABASE_JWT_SECRET'))
    pass(`${api.file}: real sign-in (Supabase) is configured.`);
  else block(`${api.file}: SUPABASE_URL and SUPABASE_JWT_SECRET are needed for real sign-in.`);
  if (set(api.env, 'DATABASE_URL')) pass(`${api.file}: a hosted database is configured.`);
  else block(`${api.file}: DATABASE_URL is not set, so data would live in a local PGlite folder.`);
  // Unset, it defaults to the local portal only, which a hosted portal would be refused by.
  if (!set(api.env, 'CORS_ORIGINS') || isLocal(api.env.CORS_ORIGINS))
    block(
      `${api.file}: CORS_ORIGINS is unset or local, so the API would refuse the hosted portal. Set it to the portal's address.`,
    );
  else pass(`${api.file}: the API accepts the hosted portal.`);
}

// --- Portal configuration
const portal = readEnv('apps/portal');
if (!portal.file)
  block('apps/portal has no .env.production or .env: the portal has no configuration.');
else {
  if (set(portal.env, 'VITE_DEV_AUTH_SECRET'))
    block(
      `${portal.file}: VITE_DEV_AUTH_SECRET is set. It would be baked into the site for anyone to read. Remove it.`,
    );
  else pass(`${portal.file}: no dev sign-in secret in the site.`);
  if (set(portal.env, 'VITE_SUPABASE_URL') && set(portal.env, 'VITE_SUPABASE_ANON_KEY'))
    pass(`${portal.file}: sign-in is configured.`);
  else
    block(`${portal.file}: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are needed for sign-in.`);
  if (!set(portal.env, 'VITE_API_URL') || isLocal(portal.env.VITE_API_URL))
    block(
      `${portal.file}: VITE_API_URL is missing or points at this computer; testers couldn't reach it.`,
    );
  else pass(`${portal.file}: the API address is a real one.`);
}

// --- The code itself
const git = (cmd) => {
  try {
    return execSync(`git ${cmd}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
};
const dirty = git('status --porcelain');
if (dirty === null) warn('Not a git repository, so this build has no version to point testers at.');
else if (dirty)
  warn(`${dirty.split('\n').length} files are uncommitted; commit so the build matches a version.`);
else pass(`Everything is committed (${git('rev-parse --short HEAD')}).`);
if (!git('remote'))
  block('The repository has no remote: one disk failure loses the code. Push to a private remote.');
else pass('The code is pushed somewhere other than this computer.');

// --- Report
const icon = { OK: '  ok   ', WARN: '  warn ', BLOCK: '  BLOCK' };
console.log('\nAlpha preflight\n');
for (const r of results) console.log(`${icon[r.level]}  ${r.msg}`);
const blockers = results.filter((r) => r.level === 'BLOCK').length;
const warnings = results.filter((r) => r.level === 'WARN').length;
console.log(
  `\n${blockers ? `${blockers} blocker${blockers === 1 ? '' : 's'}` : 'No blockers'}, ${warnings} warning${warnings === 1 ? '' : 's'}.` +
    (blockers
      ? ' Not ready to share; see docs/ALPHA.md.'
      : ' Ready for the manual pass in docs/ALPHA.md.') +
    '\n',
);
process.exit(blockers ? 1 : 0);
