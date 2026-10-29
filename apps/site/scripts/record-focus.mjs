// The homepage's screen recording of starting a focus session, in the real app (Jerry in the
// seeded sandbox): the dashboard, Start a session, Problem set 3, Pomodoro, Start, then the
// focus screen counting down. Writes public/clips/focus-start.mp4 and focus-start.webp.
//
// Headless Chrome on the CPU renderer takes anything from 40 ms to several seconds to paint a
// frame, so filming it in real time (or even slowed down) drops frames. Instead the page's time
// only moves when this script moves it, one frame at a time:
//  - an init script replaces the page's clock: Date, performance.now, timers and animation
//    frames all run on a page time that `__clock.step(ms)` advances, firing whatever is due;
//  - the document timeline is stopped (CDP Animation.setPlaybackRate 0) and every CSS and web
//    animation is set to where it should be at that page time;
//  - then the frame is painted and screenshotted, however long that takes.
// So every frame of the video is exactly 1/30 s of the app after the one before, at the app's
// own speed, with nothing dropped. Clicks and pauses are counted in frames. While a page loads
// its clock runs by itself (`free`), and the focus tab's runs slowly then, so its clock reads
// 25:00 when it is shown, as it would a moment after Start.
//
// The focus screen opens in its own tab, as it does on a computer; the video cuts to it the way
// a browser switches to a new tab. The session it starts is real: it is ended once the take is
// done (after a minute, as in capture.mjs), and the theme and "open the focus screen" setting
// go back to what they were. No cursor is drawn; what is pointed at shows by its hover state.
//
// CAPTURE_DEPS=<playwright-core + jose> FFMPEG=<ffmpeg with h264_nvenc> node scripts/record-focus.mjs
// (CapCut's: ls /c/Users/<you>/AppData/Local/CapCut/Apps/*/ffmpeg.exe). The frames stay in
// RECORD_TMP (default scripts/out/focus-start-frames) for checking, with frames.json.
import { api, newPage, go } from './capture-lib.mjs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const { chromium } = createRequire(join(process.env.CAPTURE_DEPS ?? '.', 'noop.js'))(
  'playwright-core',
);
const sharp = createRequire(new URL('../../../package.json', import.meta.url))('sharp');
const FFMPEG = process.env.FFMPEG;
if (!FFMPEG) throw new Error('Set FFMPEG to an ffmpeg.exe with h264_nvenc');

const FPS = 30;
const FRAME = 1000 / FPS;
/** 1280 x 800 at 1.25: a 1600 x 1000 video. */
const VIEW = { width: 1280, height: 800, scale: 1.25 };
/** How long the focus screen runs in the video, in seconds. */
const FOCUS_SECONDS = 6;

const CLIPS = fileURLToPath(new URL('../public/clips', import.meta.url));
const TMP =
  process.env.RECORD_TMP ?? fileURLToPath(new URL('./out/focus-start-frames', import.meta.url));
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const BASE_THEME = { mode: 'dark', backgroundId: 'cotton-candy', accent: 'sky', panel: 'glass' };
const LOOK = { ...BASE_THEME, backgroundId: 'harbour-lights', accent: 'amber' };
const POMODORO = { workMin: 25, shortBreakMin: 5, longBreakMin: 15, cyclesBeforeLong: 4 };

/**
 * The page's clock, in every document of the context before its own scripts. Page time starts
 * at the real time and runs by itself at `free[path]` of real speed (1 unless listed) until
 * `__clock.hold()`; after that only `__clock.step(ms)` moves it. A step fires the timers due,
 * then the animation-frame callbacks, then sets every animation to its time.
 */
const pageClock = {
  arg: { free: { '/focus': 0.05 } },
  fn: ({ free }) => {
    const perf = performance.now.bind(performance);
    const RealDate = Date;
    const later = window.setTimeout.bind(window);
    const realFrame = window.requestAnimationFrame.bind(window);
    const p0 = perf();
    const d0 = RealDate.now();
    let now = p0;
    const tick = () => new Promise((r) => later(r, 0));

    // Timers on page time. A timer set during a step's callbacks with no delay runs in the
    // same step (a few rounds), like the next task would.
    let seq = 1;
    let order = 0;
    const timers = new Map();
    const add = (fn, d, args, repeat) => {
      const ms = Math.max(0, Number(d) || 0);
      const id = seq++;
      timers.set(id, { due: now + ms, fn, args, every: repeat ? Math.max(ms, 1) : 0, at: order++ });
      return id;
    };
    window.setTimeout = (fn, d, ...a) => add(fn, d, a, false);
    window.setInterval = (fn, d, ...a) => add(fn, d, a, true);
    window.clearTimeout = (id) => void timers.delete(id);
    window.clearInterval = (id) => void timers.delete(id);
    const fire = () => {
      let ran = 0;
      for (;;) {
        let next = null;
        for (const [id, t] of timers)
          if (
            t.due <= now &&
            (!next || t.due < next.t.due || (t.due === next.t.due && t.at < next.t.at))
          )
            next = { id, t };
        if (!next || ran > 500) return ran;
        const { id, t } = next;
        if (t.every) {
          t.due = Math.max(t.due + t.every, now + 1e-3);
          t.at = order++;
        } else timers.delete(id);
        ran++;
        try {
          if (typeof t.fn === 'function') t.fn(...t.args);
        } catch (e) {
          reportError(e);
        }
      }
    };

    let frames = [];
    window.requestAnimationFrame = (cb) => {
      const id = seq++;
      frames.push({ id, cb });
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      frames = frames.filter((f) => f.id !== id);
    };
    const runFrames = () => {
      const list = frames;
      frames = [];
      for (const f of list)
        try {
          f.cb(now);
        } catch (e) {
          reportError(e);
        }
    };

    performance.now = () => now;
    const wall = () => d0 + (now - p0);
    function PageDate(...a) {
      if (!new.target) return new RealDate(wall()).toString();
      return a.length ? new RealDate(...a) : new RealDate(wall());
    }
    PageDate.prototype = RealDate.prototype;
    PageDate.now = () => Math.floor(wall());
    PageDate.parse = RealDate.parse;
    PageDate.UTC = RealDate.UTC;
    window.Date = PageDate;
    Object.defineProperty(Event.prototype, 'timeStamp', { get: () => now, configurable: true });

    // Animations: each is placed at (its time when first seen) + (page time since), unless the
    // page moved or paused it itself, which starts it over from there.
    const seen = new WeakMap();
    const seek = () => {
      for (const a of document.getAnimations()) {
        const s = seen.get(a);
        const cur = a.currentTime;
        if (cur === null) continue;
        if (!s || a.playState === 'paused' || Math.abs(cur - s.set) > 0.5) {
          seen.set(a, { t: now, c: cur, set: cur });
          continue;
        }
        const to = s.c + (now - s.t) * a.playbackRate;
        a.currentTime = to;
        s.set = a.currentTime;
      }
    };

    let busy = false;
    const step = async (ms, paint = false) => {
      busy = true;
      now += ms;
      for (let round = 0; round < 4 && fire(); round++) await tick();
      runFrames();
      await tick();
      seek();
      await tick();
      // Painted with all of that before the screenshot.
      if (paint) await new Promise((r) => realFrame(() => realFrame(r)));
      busy = false;
    };
    const rate = free[location.pathname] ?? 1;
    let running = true;
    let last = perf();
    const run = async () => {
      if (!running) return;
      const t = perf();
      await step((t - last) * rate);
      last = t;
      later(run, 16);
    };
    later(run, 0);
    window.__clock = {
      step: (ms) => step(ms, true),
      hold: async () => {
        running = false;
        while (busy) await tick();
      },
      now: () => now,
    };
  },
};

/** Until the page's finite animations have finished (its clock running by itself). */
const settled = (page) =>
  page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
    null,
    { timeout: 60_000, polling: 200 },
  );

/** Stop the document timeline: from here the page clock places every animation. */
async function stopTimeline(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
  return cdp;
}

let n = 0;
const log = [];
/** One frame: the page a frame later, screenshotted. */
async function frame(page, label = '') {
  await page.evaluate((ms) => window.__clock.step(ms), FRAME);
  const file = join(TMP, `${String(n).padStart(5, '0')}.jpg`);
  // Playwright hides the text caret, whose blink runs on real time.
  await page.screenshot({ path: file, type: 'jpeg', quality: 95 });
  log.push({ n, label, at: await page.evaluate(() => window.__clock.now()) });
  n++;
}
const hold = async (page, ms, label) => {
  for (let i = 0; i < Math.round(ms / FRAME); i++) await frame(page, label);
};
/** Point at an element, then press and let go, in frames. */
async function click(page, locator, label, { hover = 330, press = 100 } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Nothing to click: ${label}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await hold(page, hover, `${label}: hover`);
  await page.mouse.down();
  await hold(page, press, `${label}: press`);
  await page.mouse.up();
}

const before = (await api('GET', '/api/me')).user.settings;
const running = await api('GET', '/api/sessions/active');
if (running.active) throw new Error('A session is already running; end it first.');

await api('PATCH', '/api/me/settings', {
  quote: { appTips: false },
  visualizer: { promptDismissed: true },
  timelapse: { record: 'never' },
  pomodoro: POMODORO,
  theme: LOOK,
  focusScreen: { openOnStart: 'always' },
});
await api('POST', '/api/social/nudges/seen').catch(() => {});

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let dashFrames = 0;
let ticks = [];
try {
  const { ctx, page } = await newPage(browser, { ...VIEW, init: pageClock });
  await stopTimeline(ctx, page);
  await go(page, '/', 3000);
  // Out of the way, so nothing is hovered (the sidebar opens under the pointer).
  await page.mouse.move(VIEW.width - 40, VIEW.height / 2);
  await settled(page);
  await page.waitForFunction(() => 'glassImage' in document.documentElement.dataset, null, {
    timeout: 60_000,
    polling: 200,
  });
  await page.waitForTimeout(3000);
  await settled(page);
  await page.evaluate(() => window.__clock.hold());

  // ---- The dashboard, then the start card ----
  await hold(page, 700, 'dashboard');
  await click(page, page.getByRole('button', { name: 'Start a session' }).first(), 'start');
  await hold(page, 900, 'card');
  const card = page.locator('.start-dialog');
  await click(page, card.locator('.start-subject'), 'subject');
  await hold(page, 850, 'picker');
  await click(page, card.getByText('ECO220', { exact: true }), 'ECO220');
  await hold(page, 800, 'course');
  await click(page, card.getByText('Problem set 3', { exact: true }), 'Problem set 3');
  await hold(page, 900, 'picked');
  await click(page, card.locator('.start-pill', { hasText: 'Pomodoro' }), 'how you work');
  await hold(page, 650, 'menu');
  await click(page, page.locator('.start-option', { hasText: 'Pomodoro' }), 'Pomodoro');
  await hold(page, 650, 'ready');
  const opened = ctx.waitForEvent('page', { timeout: 60_000 });
  await click(page, card.locator('.start-go'), 'Start', { hover: 400 });
  dashFrames = n;

  // ---- The focus screen, in the tab Start opened ----
  // The card's own timers (the start call, then opening the tab) on the page's time meanwhile.
  let tab = null;
  opened.then((p) => (tab = p)).catch(() => {});
  const since = Date.now();
  while (!tab && Date.now() - since < 60_000) {
    await page.evaluate(() => window.__clock.step(50)).catch(() => {});
    await new Promise((r) => setTimeout(r, 150));
  }
  const focus = tab ?? (await opened);
  await stopTimeline(ctx, focus);
  await focus.waitForURL('**/focus', { timeout: 60_000 });
  await focus.waitForFunction(
    () => /\d:\d\d/.test(document.querySelector('.focus-time')?.textContent ?? ''),
    null,
    { timeout: 60_000, polling: 100 },
  );
  await focus.evaluate(async () => {
    await document.fonts.ready;
    // The photo behind it, decoded (it shows its small placeholder until then).
    const urls = [...document.querySelectorAll('.focus-screen div[style]')]
      .map((d) => /url\("([^"]+)"\)/.exec(d.style.backgroundImage)?.[1])
      .filter((u) => u && !u.startsWith('data:'));
    await Promise.all(
      urls.map((u) => {
        const img = new Image();
        img.src = u;
        return img.decode().catch(() => {});
      }),
    );
  });
  await focus.waitForTimeout(1000);
  await focus.evaluate(() => window.__clock.hold());
  // The clock as the focus screen shows it, against page time, for the check.
  await focus.evaluate(() => {
    const el = document.querySelector('.focus-time');
    window.__ticks = [{ at: Date.now(), text: el.textContent }];
    new MutationObserver(() =>
      window.__ticks.push({ at: Date.now(), text: el.textContent }),
    ).observe(el, { subtree: true, characterData: true, childList: true });
  });
  await hold(focus, FOCUS_SECONDS * 1000, 'focus');
  ticks = await focus.evaluate(() => window.__ticks);
  await ctx.close();
} finally {
  await browser.close();
  // The session Start began, once it has run a minute (shorter ones can't be ended).
  const { active } = await api('GET', '/api/sessions/active');
  if (active) {
    const left = Date.parse(active.session.startedAt) + 62_000 - Date.now();
    if (left > 0) await new Promise((r) => setTimeout(r, left));
    await api('POST', `/api/sessions/${active.session.id}/end`, {
      review: { distracted: 'no', mood: 4 },
    });
  }
  await api('PATCH', '/api/me/settings', {
    theme: before.theme,
    focusScreen: { openOnStart: before.focusScreen.openOnStart },
  });
}

// ---- The video and its poster ----
writeFileSync(
  join(TMP, 'frames.json'),
  JSON.stringify({ fps: FPS, frames: n, dash: dashFrames, ticks, log }, null, 1),
);
const mp4 = join(CLIPS, 'focus-start.mp4');
// prettier-ignore
execFileSync(FFMPEG, [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-framerate', String(FPS), '-i', join(TMP, '%05d.jpg'),
  '-vf', 'format=yuv420p',
  '-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-profile:v', 'high',
  '-rc', 'vbr', '-cq', '23', '-b:v', '2000k', '-maxrate', '4000k', '-bufsize', '8000k',
  '-g', String(FPS * 2), '-an', '-movflags', '+faststart',
  mp4,
], { stdio: 'inherit' });
// The poster is the first frame, so the page shows exactly what the video starts on.
const poster = join(CLIPS, 'focus-start.webp');
await sharp(join(TMP, '00000.jpg')).webp({ quality: 80, effort: 5 }).toFile(poster);
console.log(
  `${n} frames (${dashFrames} + ${n - dashFrames}), ${(n / FPS).toFixed(2)} s,`,
  `mp4 ${Math.round(statSync(mp4).size / 1024)} KB, poster ${Math.round(statSync(poster).size / 1024)} KB`,
);
