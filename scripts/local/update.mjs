/**
 * Moves the always-on local Komogon to the latest build: stop, freeze the new build, start.
 * `pnpm local:update` builds first and only gets here if the build passed, so a broken
 * build leaves the running copy untouched.
 *
 * Run: pnpm local:update
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshot } from './lib.mjs';

const run = (file) =>
  execFileSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], {
    stdio: 'inherit',
  });

run('./stop.mjs');
snapshot();
run('./start.mjs');
