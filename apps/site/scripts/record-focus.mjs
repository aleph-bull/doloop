// The homepage's screen recording of starting a focus session, in the real app (Jerry in the
// seeded sandbox): the dashboard, Start a session, Problem set 3, Pomodoro, Start, then the
// focus screen counting down. Writes public/clips/focus-start.mp4 and focus-start.webp.
//
// Frame by frame on the page's own clock (record-lib.mjs says how), so nothing stutters.
// While a page loads its clock runs by itself, and the focus tab's runs slowly then, so its
// clock reads 25:00 when it is shown, as it would a moment after Start.
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
import {
  COMPUTER,
  BASE_THEME,
  POMODORO,
  Film,
  pageClock,
  settled,
  stopTimeline,
  glassReady,
  launch,
} from './record-lib.mjs';

/** How long the focus screen runs in the video, in seconds. */
const FOCUS_SECONDS = 6;
const VIEW = COMPUTER;
const LOOK = { ...BASE_THEME, backgroundId: 'harbour-lights', accent: 'amber' };

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

const film = new Film('focus-start');
const browser = await launch();
let dashFrames = 0;
let ticks = [];
try {
  const { ctx, page } = await newPage(browser, { ...VIEW, init: pageClock({ '/focus': 0.05 }) });
  await stopTimeline(ctx, page);
  await go(page, '/', 3000);
  // Out of the way, so nothing is hovered (the sidebar opens under the pointer).
  await page.mouse.move(VIEW.width - 40, VIEW.height / 2);
  await settled(page);
  await glassReady(page);
  await page.waitForTimeout(3000);
  await settled(page);
  await page.evaluate(() => window.__clock.hold());

  // ---- The dashboard, then the start card ----
  await film.hold(page, 700, 'dashboard');
  await film.click(page, page.getByRole('button', { name: 'Start a session' }).first(), 'start');
  await film.hold(page, 900, 'card');
  const card = page.locator('.start-dialog');
  await film.click(page, card.locator('.start-subject'), 'subject');
  await film.hold(page, 850, 'picker');
  await film.click(page, card.getByText('ECO220', { exact: true }), 'ECO220');
  await film.hold(page, 800, 'course');
  await film.click(page, card.getByText('Problem set 3', { exact: true }), 'Problem set 3');
  await film.hold(page, 900, 'picked');
  await film.click(page, card.locator('.start-pill', { hasText: 'Pomodoro' }), 'how you work');
  await film.hold(page, 650, 'menu');
  await film.click(page, page.locator('.start-option', { hasText: 'Pomodoro' }), 'Pomodoro');
  await film.hold(page, 650, 'ready');
  const opened = ctx.waitForEvent('page', { timeout: 60_000 });
  await film.click(page, card.locator('.start-go'), 'Start', { hover: 400 });
  dashFrames = film.n;

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
  await film.hold(focus, FOCUS_SECONDS * 1000, 'focus');
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
console.log(`dashboard ${dashFrames} frames, focus screen ${film.n - dashFrames}`);
await film.finish({ cq: 23, tuned: false, extra: { dash: dashFrames, ticks } });
