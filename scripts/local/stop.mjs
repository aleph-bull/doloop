/**
 * Stops the always-on local Komogon started by `pnpm local:start`. Dev servers and anything
 * else on the same ports are left alone: only the processes it started are stopped.
 *
 * Run: pnpm local:stop
 */
import {
  API_PORT,
  PORTAL_PORT,
  isListening,
  isNodeProcess,
  log,
  readPids,
  sleep,
  writePids,
} from './lib.mjs';

const pids = readPids();
let stopped = 0;
for (const [name, pid] of Object.entries(pids)) {
  if (isNodeProcess(pid)) {
    process.kill(pid);
    stopped++;
    log(`Stopped ${name} (pid ${pid}).`);
  }
}
writePids({});

// Give the ports a moment to free up, so a start straight after does not skip them.
for (let i = 0; stopped > 0 && i < 20; i++) {
  if (!(await isListening(API_PORT)) && !(await isListening(PORTAL_PORT))) break;
  await sleep(250);
}
