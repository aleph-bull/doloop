// Screenshots of the seeded sandbox portal for the homepage, through the installed Chrome.
// Needs playwright-core and jose: run from a folder that has them installed (see README).
import { chromium } from 'playwright-core';
import { SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = 'C:/Users/zachz/Documents/Doloop/Doloop';
const OUT = 'C:/Users/zachz/Documents/Doloop/komodon-site/public/shots';
const PORTAL = 'http://localhost:5187';
const API = 'http://127.0.0.1:8801';
const EMAIL = 'maya@komodon.demo';

const envText = readFileSync(join(APP, 'apps/api/.env'), 'utf8');
const SECRET = /^DEV_AUTH_SECRET=(.+)$/m.exec(envText)[1].trim();
const hex = createHash('sha256').update(EMAIL.toLowerCase()).digest('hex');
const ID = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
const token = await new SignJWT({ email: EMAIL })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(ID)
  .setIssuedAt()
  .setExpirationTime('30d')
  .sign(new TextEncoder().encode(SECRET));

const api = async (method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'x-timezone': 'America/Toronto',
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};

mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const want = (n) => only.length === 0 || only.includes(n);
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function shoot(name, path, { width = 1440, height = 900, scale = 2, before } = {}) {
  if (!want(name)) return;
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    colorScheme: 'light',
    timezoneId: 'America/Toronto',
  });
  await ctx.addInitScript(
    ({ token, email }) => {
      localStorage.setItem('komogon.dev.token', token);
      localStorage.setItem('komogon.dev.email', email);
    },
    { token, email: EMAIL },
  );
  await ctx.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.id = 'hide-tips'; st.textContent = '.tip-fold, .tip-card, .hint, .hint-card, [class^="hint"], [class*=" hint"] { display: none !important; }'; document.head.appendChild(st); }); });
  const page = await ctx.newPage();
  await page.goto(PORTAL + path, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  if (before) await before(page);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('shot', name);
  await ctx.close();
}

await api('PATCH', '/api/me/settings', { quote: { appTips: false } });
const dismissTip = async (page) => { const found = await page.waitForSelector('button[aria-label="Close this tip"]', { state: 'attached', timeout: 8000 }).then(() => true).catch(() => false); if (found) { await page.evaluate(() => { const b = document.querySelector('button[aria-label="Close this tip"]'); const box = b.closest('.tip-fold') || b.closest('section'); box.remove(); }); console.log('  tip removed'); } else console.log('  no tip'); await page.waitForTimeout(600); };
await shoot('today', '/', { before: dismissTip });
await shoot('today-phone', '/', { width: 390, height: 844, scale: 3, before: dismissTip });
await shoot('analytics', '/analytics');
await shoot('leaderboard', '/analytics', {
  before: async (page) => {
    await page.getByText('Leaderboard', { exact: true }).first().click();
    await page.waitForLoadState('networkidle');
  },
});
await shoot('profile', '/social');
await shoot('achievements', '/achievements');
await shoot('tasks', '/tasks');

// The focus screen needs a running session.
if (want('focus') || want('today-active')) {
const nodes = (await api('GET', '/api/nodes')).nodes;
const task = nodes.find((n) => n.title === 'Chapter 6 problem set') ?? nodes[0];
const started = await api('POST', '/api/sessions', { nodeId: task.id, mode: 'pomodoro' });
const sessionId = started.active.session.id;
await shoot('focus', '/focus', { before: async (page) => { for (let i = 0; i < 4; i++) { await page.waitForTimeout(1200); const b = page.getByRole('button', { name: 'Never ask again' }); if (await b.count()) { await b.first().click(); console.log('  declined a prompt'); } else break; } await page.waitForTimeout(2500); } });
await shoot('today-active', '/', { before: dismissTip });
// Sessions under a minute cannot be ended, so wait it out, then close it.
await new Promise((r) => setTimeout(r, 62_000));
await api('POST', `/api/sessions/${sessionId}/end`, { review: { distracted: 'no', mood: 4 } });
}

await browser.close();
console.log('done');
