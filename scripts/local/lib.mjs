/**
 * Shared pieces of the always-on local Komogon (`pnpm local:start | local:stop | local:update`).
 *
 * It runs a frozen copy of the last build, not the working tree, so a rebuild during
 * development (`pnpm check` builds too) never changes the app you are using. Its data lives
 * in %LOCALAPPDATA%\Komogon, apart from `apps/api/.pglite`, which dev servers keep for
 * testing. Both servers listen on this PC only.
 */
import { spawn, execFileSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const API_DIR = join(ROOT, 'apps/api');
export const PORTAL_DIR = join(ROOT, 'apps/portal');

/** The frozen copies. The API's sits under apps/api so its node_modules still resolve. */
export const API_BUILD = join(API_DIR, '.local-build');
export const PORTAL_BUILD = join(PORTAL_DIR, '.local-build');

export const HOME = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'), 'Komogon');
export const DATA_DIR = join(HOME, 'pglite');
export const LOG_DIR = join(HOME, 'logs');
const PID_FILE = join(HOME, 'pids.json');
const DEV_DATA_DIR = join(API_DIR, '.pglite');

/** The extension only talks to the portal on 5173, so these are fixed. */
export const API_PORT = 8787;
export const PORTAL_PORT = 5173;

export function log(message) {
  const line = `${new Date().toISOString()}  ${message}`;
  console.log(line);
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, 'launcher.log'), line + '\n');
  } catch {
    // Logging is best effort.
  }
}

export function hasBuild() {
  return (
    existsSync(join(API_DIR, 'dist/index.js')) && existsSync(join(PORTAL_DIR, 'dist/index.html'))
  );
}

export function hasSnapshot() {
  return (
    existsSync(join(API_BUILD, 'dist/index.js')) && existsSync(join(PORTAL_BUILD, 'index.html'))
  );
}

/** Copy the current build, with the migrations it was built against, into the frozen copies. */
export function snapshot() {
  rmSync(API_BUILD, { recursive: true, force: true });
  cpSync(join(API_DIR, 'dist'), join(API_BUILD, 'dist'), { recursive: true });
  cpSync(join(API_DIR, 'drizzle'), join(API_BUILD, 'drizzle'), { recursive: true });
  rmSync(PORTAL_BUILD, { recursive: true, force: true });
  cpSync(join(PORTAL_DIR, 'dist'), PORTAL_BUILD, { recursive: true });
  log('Froze the current build.');
}

/** First run only: start from the data the dev servers have been using. */
export function seedData() {
  if (existsSync(DATA_DIR)) return;
  if (existsSync(DEV_DATA_DIR)) {
    cpSync(DEV_DATA_DIR, DATA_DIR, { recursive: true });
    log(`Copied ${DEV_DATA_DIR} to ${DATA_DIR}.`);
  }
}

function connects(host, port) {
  return new Promise((done) => {
    const socket = createConnection({ host, port });
    const finish = (ok) => {
      socket.destroy();
      done(ok);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/** Whether anything is listening on the port, over IPv4 or IPv6. */
export async function isListening(port) {
  return (await connects('127.0.0.1', port)) || (await connects('::1', port));
}

/** Start a hidden, detached process that outlives this script, logging to LOG_DIR. */
export function launch(name, args, cwd, env = {}) {
  mkdirSync(LOG_DIR, { recursive: true });
  const out = openSync(join(LOG_DIR, `${name}.log`), 'w');
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  log(`Started ${name} (pid ${child.pid}).`);
  return child.pid;
}

export function readPids() {
  try {
    return JSON.parse(readFileSync(PID_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function writePids(pids) {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(PID_FILE, JSON.stringify(pids, null, 2) + '\n');
}

/** Whether the pid is still a node process, so a reused pid is never killed. */
export function isNodeProcess(pid) {
  try {
    if (process.platform !== 'win32') {
      process.kill(pid, 0);
      return true;
    }
    const row = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return row.toLowerCase().includes('"node.exe"');
  } catch {
    return false;
  }
}

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
