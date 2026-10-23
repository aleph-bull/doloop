// Shared bits for driving the seeded sandbox portal through the installed Chrome.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// playwright-core and jose aren't the site's dependencies: install them in a scratch folder
// and point CAPTURE_DEPS at it.
const need = createRequire(
  process.env.CAPTURE_DEPS ? join(process.env.CAPTURE_DEPS, 'noop.js') : import.meta.url,
);
const { chromium } = need('playwright-core');
const { SignJWT } = need('jose');

/** The repo root, for the API's dev secret. */
const APP = fileURLToPath(new URL('../../..', import.meta.url));
export const PORTAL = 'http://localhost:5302';
export const API = 'http://127.0.0.1:8902';
export const EMAIL = 'jerry@komodon.demo';

const envText = readFileSync(join(APP, 'apps/api/.env'), 'utf8');
const SECRET = /^DEV_AUTH_SECRET=(.+)$/m.exec(envText)[1].trim();
const hex = createHash('sha256').update(EMAIL.toLowerCase()).digest('hex');
export const ID = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
export const token = await new SignJWT({ email: EMAIL })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(ID)
  .setIssuedAt()
  .setExpirationTime('30d')
  .sign(new TextEncoder().encode(SECRET));

export const api = async (method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'x-timezone': 'America/Toronto',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

const HIDE = `.tip-fold, .tip-card, .hint, .hint-card, [class^="hint"], [class*=" hint"] { display: none !important; }`;

export async function openBrowser() {
  return chromium.launch({ channel: 'chrome', headless: true });
}

/**
 * A signed-in page at the given size. `css` is extra CSS injected on load; `init` is an
 * extra script (`{ fn, arg }`) that runs before the page's own, such as a fake camera.
 */
export async function newPage(
  browser,
  { width = 1440, height = 900, scale = 2, mobile = false, css = '', init = null } = {},
) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    colorScheme: 'dark',
    timezoneId: 'America/Toronto',
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  });
  await ctx.addInitScript(
    ({ token, email, css }) => {
      localStorage.setItem('komogon.dev.token', token);
      localStorage.setItem('komogon.dev.email', email);
      document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = css;
        document.head.appendChild(st);
      });
    },
    { token, email: EMAIL, css: HIDE + css },
  );
  if (init) await ctx.addInitScript(init.fn, init.arg);
  const page = await ctx.newPage();
  return { ctx, page };
}

export async function go(page, path, wait = 1800) {
  await page.goto(PORTAL + path, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(wait);
}

export function outDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * A camera for the phone's camera screen: a still photo (a data: URL) drawn on a canvas and
 * streamed, with the back camera chosen so the picture isn't mirrored.
 */
export function fakeCamera(dataUrl) {
  return {
    arg: dataUrl,
    fn: (url) => {
      localStorage.setItem('komogon.timelapse.facing', 'environment');
      const img = new Image();
      img.src = url;
      const canvas = document.createElement('canvas');
      canvas.width = 720;
      canvas.height = 1280;
      const ctx = canvas.getContext('2d');
      const draw = () => {
        if (!img.naturalWidth) return;
        const s = Math.max(720 / img.naturalWidth, 1280 / img.naturalHeight);
        const w = img.naturalWidth * s;
        const h = img.naturalHeight * s;
        ctx.drawImage(img, (720 - w) / 2, (1280 - h) / 2, w, h);
      };
      img.onload = draw;
      setInterval(draw, 100);
      const devices = [
        { kind: 'videoinput', deviceId: 'front', label: 'Front camera', groupId: 'a' },
        { kind: 'videoinput', deviceId: 'back', label: 'Back camera', groupId: 'b' },
      ];
      const media = navigator.mediaDevices ?? {};
      media.getUserMedia = async () => {
        draw();
        return canvas.captureStream(10);
      };
      media.enumerateDevices = async () => devices.map((d) => ({ ...d, toJSON: () => d }));
      if (!navigator.mediaDevices)
        Object.defineProperty(navigator, 'mediaDevices', { value: media });
    },
  };
}
