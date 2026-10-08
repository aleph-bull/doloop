/**
 * Starts the always-on local Komogon, hidden: the API on 127.0.0.1:8787 and the portal on
 * http://localhost:5173. Whatever is already running on either port is left alone.
 * A shortcut in the Windows Startup folder runs this at sign-in.
 *
 * `--outside` (what `pnpm local:start` and `local:update` pass) hands the start to Windows
 * instead, so the servers outlive the terminal or Claude session that asked for them.
 *
 * Run: pnpm local:start
 */
import { join } from 'node:path';
import {
  API_BUILD,
  API_DIR,
  API_PORT,
  DATA_DIR,
  PORTAL_BUILD,
  PORTAL_DIR,
  PORTAL_PORT,
  hasBuild,
  hasData,
  hasSnapshot,
  isListening,
  launch,
  log,
  readPids,
  sleep,
  snapshot,
  startOutside,
  writePids,
} from './lib.mjs';

if (process.argv.includes('--outside') && process.platform === 'win32') {
  startOutside();
  const up = async () => (await isListening(API_PORT)) && (await isListening(PORTAL_PORT));
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(250);
  console.log(
    (await up()) ? 'Komogon is running on http://localhost:5173' : 'Started; see ~/.komogon/logs',
  );
  process.exit(0);
}

if (!hasSnapshot()) {
  if (!hasBuild()) {
    log('Nothing is built yet. Run `pnpm local:update` first.');
    process.exit(1);
  }
  snapshot();
}

const pids = readPids();

if (await isListening(API_PORT)) {
  log(`Something is already on port ${API_PORT}; not starting the API.`);
} else if (!hasData()) {
  log(`No data at ${DATA_DIR}; not starting the API rather than start it on an empty one.`);
} else {
  // cwd is apps/api so the API still reads apps/api/.env.
  pids.api = launch('api', [join(API_BUILD, 'dist/index.js')], API_DIR, {
    HOST: '127.0.0.1',
    PORT: String(API_PORT),
    PGLITE_DATA_DIR: DATA_DIR,
  });
}

if (await isListening(PORTAL_PORT)) {
  log(`Something is already on port ${PORTAL_PORT}; not starting the portal.`);
} else {
  const vite = join(PORTAL_DIR, 'node_modules/vite/bin/vite.js');
  pids.portal = launch(
    'portal',
    [vite, 'preview', '--outDir', PORTAL_BUILD, '--port', String(PORTAL_PORT), '--strictPort'],
    PORTAL_DIR,
  );
}

writePids(pids);
