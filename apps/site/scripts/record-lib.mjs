// Shared bits for the homepage's screen recordings of the real app (Jerry in the seeded
// sandbox): record-focus.mjs (focus-start) and record-takes.mjs (the rest).
//
// Headless Chrome on the CPU renderer takes anything from 40 ms to several seconds to paint a
// frame, so filming it in real time (or even slowed down) drops frames. Instead the page's time
// only moves when the recorder moves it, one frame at a time:
//  - an init script replaces the page's clock: Date, performance.now, timers and animation
//    frames all run on a page time that `__clock.step(ms)` advances, firing whatever is due;
//  - the document timeline is stopped (CDP Animation.setPlaybackRate 0) and every CSS and web
//    animation is set to where it should be at that page time;
//  - then the frame is painted and screenshotted, however long that takes.
// So every frame of a video is exactly 1/30 s of the app after the one before, at the app's
// own speed, with nothing dropped. Clicks, pauses and scrolls are counted in frames. While a
// page loads its clock runs by itself (`free`, real speed unless listed per path).
//
// A scroll moves the page's own scroller (the window, or an element) to where it should be
// for that frame, lets the browser send the scroll event, then steps the clock, so whatever
// the page does on scroll lands in the same frame, as it would on a real screen.
//
// No cursor is drawn; what is pointed at shows by its hover state.
import { api } from './capture-lib.mjs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const { chromium } = createRequire(join(process.env.CAPTURE_DEPS ?? '.', 'noop.js'))(
  'playwright-core',
);
const sharp = createRequire(new URL('../../../package.json', import.meta.url))('sharp');

export const FPS = 30;
export const FRAME = 1000 / FPS;
/** 1280 x 800 at 1.25: a 1600 x 1000 video. */
export const COMPUTER = { width: 1280, height: 800, scale: 1.25 };
/**
 * An iPhone 14 Pro, 393 x 852 with its safe areas (59 top for the Dynamic Island, 34 bottom
 * for the home indicator) as capture.mjs's phone shots, at 2x: a 786 x 1704 video.
 */
export const PHONE = {
  width: 393,
  height: 852,
  scale: 2,
  mobile: true,
  insets: { top: 59, bottom: 34, left: 0, right: 0 },
};
export const BASE_THEME = {
  mode: 'dark',
  backgroundId: 'cotton-candy',
  accent: 'sky',
  panel: 'glass',
};
export const POMODORO = { workMin: 25, shortBreakMin: 5, longBreakMin: 15, cyclesBeforeLong: 4 };

/** Where the videos and posters go (CLIPS_OUT for a trial run elsewhere). */
export const CLIPS =
  process.env.CLIPS_OUT ?? fileURLToPath(new URL('../public/clips', import.meta.url));
const OUT = fileURLToPath(new URL('./out', import.meta.url));

/** A look over BASE_THEME (`{}` for the base look itself). */
export const theme = (t) => api('PATCH', '/api/me/settings', { theme: { ...BASE_THEME, ...t } });

/**
 * The installed Chrome on the CPU renderer (SwiftShader): never the GPU of the PC it runs on.
 * Pages are rastered in software too: SwiftShader's raster, while a page scrolls, now and then
 * left a tile showing content from somewhere else on the page (2026-10-29, on the phone takes),
 * and software raster never did.
 */
export const launch = () =>
  chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-rasterization'],
  });

/**
 * The page's clock, in every document of the context before its own scripts. Page time starts
 * at the real time and runs by itself at `free[path]` of real speed (1 unless listed) until
 * `__clock.hold()`; after that only `__clock.step(ms)` moves it. A step fires the timers due,
 * then the animation-frame callbacks, then sets every animation to its time.
 */
export const pageClock = (free = {}) => ({
  arg: { free },
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

    /** The page's scroller: an element by selector, or the window's. */
    const scroller = (sel) => (sel ? document.querySelector(sel) : document.scrollingElement);

    let busy = false;
    const step = async (ms, paint = false, scroll = null) => {
      busy = true;
      if (scroll) {
        // Instant, whatever scroll-behavior the page sets; then a real frame, in which the
        // browser sends the scroll event, so the page's handlers run before this step.
        scroller(scroll.sel)?.scrollTo({ top: scroll.y, behavior: 'instant' });
        await new Promise((r) => realFrame(() => r()));
      }
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
      step: async (ms, scroll = null, sel = null) => {
        await step(ms, true, scroll);
        return { at: now, y: scroller(sel)?.scrollTop ?? null };
      },
      hold: async () => {
        running = false;
        while (busy) await tick();
      },
      now: () => now,
    };
  },
});

/** Until the page's finite animations have finished (its clock running by itself). */
export const settled = (page) =>
  page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
    null,
    { timeout: 60_000, polling: 200 },
  );

/** Stop the document timeline: from here the page clock places every animation. */
export async function stopTimeline(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
  return cdp;
}

/** Until the backdrop's blurred photo is made, so glass cards show their panes. */
export const glassReady = (page) =>
  page.waitForFunction(() => 'glassImage' in document.documentElement.dataset, null, {
    timeout: 60_000,
    polling: 200,
  });

/** Slow out, slow in: a hand on a trackpad more than a fling. */
export const easeInOutSine = (t) => (1 - Math.cos(Math.PI * t)) / 2;

/**
 * One recording: frames as JPEGs in scripts/out/<name>-frames (RECORD_TMP to put them
 * elsewhere), with frames.json saying what each frame was (label, page time, scroll).
 */
export class Film {
  constructor(name, { tmp = process.env.RECORD_TMP ?? join(OUT, `${name}-frames`) } = {}) {
    this.name = name;
    this.tmp = tmp;
    this.n = 0;
    this.log = [];
    this.inflight = new Set();
    this.waitNet = false;
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
  }

  /**
   * Requests to the API answer between two frames, never across them: the page's time stands
   * still while they are out, as if the API answered at once. Long requests (none of the
   * app's) would hold a frame back for at most 15 s.
   */
  trackNetwork(page) {
    this.waitNet = true;
    const api = (r) => /\/api\//.test(r.url()) && ['fetch', 'xhr'].includes(r.resourceType());
    page.on('request', (r) => api(r) && this.inflight.add(r));
    const done = (r) => this.inflight.delete(r);
    page.on('requestfinished', done);
    page.on('requestfailed', done);
  }

  async quiet() {
    const since = Date.now();
    let calm = 0;
    while (Date.now() - since < 15_000) {
      if (this.inflight.size === 0) {
        if (!calm) calm = Date.now();
        // A beat of nothing out, so a request sent in answer to the last one is caught too.
        if (Date.now() - calm >= 80) return;
      } else calm = 0;
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /** One frame: the page a frame later (scrolled to `scroll.y` first), screenshotted. */
  async frame(page, label = '', { scroll = null, sel = null } = {}) {
    if (this.waitNet) await this.quiet();
    const s = scroll === null ? null : { y: scroll, sel };
    const { at, y } = await page.evaluate(
      ([ms, s, sel]) => window.__clock.step(ms, s, sel),
      [FRAME, s, sel],
    );
    const file = join(this.tmp, `${String(this.n).padStart(5, '0')}.jpg`);
    // Playwright hides the text caret, whose blink runs on real time.
    await page.screenshot({ path: file, type: 'jpeg', quality: 95 });
    this.log.push({ n: this.n, label, at, y, ...(scroll === null ? {} : { want: scroll }) });
    this.n++;
  }

  async hold(page, ms, label) {
    for (let i = 0; i < Math.round(ms / FRAME); i++) await this.frame(page, label);
  }

  /** Point at an element, then press and let go, in frames. */
  async click(page, locator, label, { hover = 330, press = 100 } = {}) {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Nothing to click: ${label}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await this.hold(page, hover, `${label}: hover`);
    await page.mouse.down();
    await this.hold(page, press, `${label}: press`);
    await page.mouse.up();
  }

  /** Scroll the window (or `sel`) to `to` over `ms`, eased, a frame at a time. */
  async scroll(page, to, ms, label, { sel = null, ease = easeInOutSine } = {}) {
    const from = await page.evaluate(
      (sel) => (sel ? document.querySelector(sel) : document.scrollingElement).scrollTop,
      sel,
    );
    const frames = Math.round(ms / FRAME);
    for (let i = 1; i <= frames; i++)
      await this.frame(page, label, { scroll: from + (to - from) * ease(i / frames), sel });
  }

  /**
   * The video (H.264 High, yuv420p, 30 fps, no audio, faststart) and its poster, the first
   * frame (or `posterFrame`), so the page shows what the video starts on. `cq` and
   * `maxrate` set the size: lower cq is sharper and bigger. `tuned` adds what makes a scroll cheap (B-frames,
   * two passes, lookahead, a keyframe every 5 s) and evens out flat areas (spatial AQ);
   * focus-start was made without it.
   */
  encode({
    cq = 23,
    bitrate = '2000k',
    maxrate = '4000k',
    bufsize = '8000k',
    tuned = true,
    extra = {},
  } = {}) {
    writeFileSync(
      join(this.tmp, 'frames.json'),
      JSON.stringify({ fps: FPS, frames: this.n, ...extra, log: this.log }, null, 1),
    );
    const FFMPEG = process.env.FFMPEG;
    if (!FFMPEG) throw new Error('Set FFMPEG to an ffmpeg.exe with h264_nvenc');
    mkdirSync(CLIPS, { recursive: true });
    const mp4 = join(CLIPS, `${this.name}.mp4`);
    // prettier-ignore
    execFileSync(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-framerate', String(FPS), '-i', join(this.tmp, '%05d.jpg'),
      '-vf', 'format=yuv420p',
      '-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-profile:v', 'high',
      '-rc', 'vbr', '-cq', String(cq), '-b:v', bitrate, '-maxrate', maxrate, '-bufsize', bufsize,
      ...(tuned
        ? ['-spatial-aq', '1', '-rc-lookahead', '32', '-bf', '3', '-b_ref_mode', 'middle',
           '-multipass', 'fullres', '-g', String(FPS * 5)]
        : ['-g', String(FPS * 2)]),
      '-an', '-movflags', '+faststart',
      mp4,
    ], { stdio: 'inherit' });
    return mp4;
  }

  async poster(frame = 0) {
    const poster = join(CLIPS, `${this.name}.webp`);
    await sharp(join(this.tmp, `${String(frame).padStart(5, '0')}.jpg`))
      .webp({ quality: 80, effort: 5 })
      .toFile(poster);
    return poster;
  }

  async finish({ posterFrame = 0, ...opts } = {}) {
    const mp4 = this.encode(opts);
    const poster = await this.poster(posterFrame);
    const kb = (f) => Math.round(statSync(f).size / 1024);
    console.log(
      `${this.name}: ${this.n} frames, ${(this.n / FPS).toFixed(2)} s,`,
      `mp4 ${kb(mp4)} KB, poster ${kb(poster)} KB`,
    );
  }
}
