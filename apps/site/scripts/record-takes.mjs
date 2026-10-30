// The homepage's screen recordings of the real app beside focus-start (record-focus.mjs), each
// a named take in its own look (the theme is put back afterwards). See record-lib.mjs for how
// a frame is made. Writes public/clips/<take>.mp4 and <take>.webp.
//
// Computer, 1280 x 800 at 1.25 (1600 x 1000):
//  - plan-week: the calendar's week, Plan my week, its suggestions, Add all. The blocks it
//    adds are deleted again afterwards, so a second run starts from the same week.
//  - analytics-scroll: Analytics as it opens (the hero counting up), a slow scroll down to
//    the streaks and personal bests, a pause, and back up.
//  - xp-buy: Achievements, a short scroll to the Shop, buying a streak freeze (the coins fly
//    from the XP into the card), then down to RNG Rolls. The machine is never opened. This
//    buys a real freeze for 150 XP, so it needs fewer than the most held (2). REHEARSE=1
//    answers the purchase in the browser instead and shows the shop one short of the most
//    if need be, so nothing is spent and it can be taken again (the 2026-10-29 take bought
//    Jerry's second freeze for real).
// Phone, an iPhone 14 Pro (393 x 852 with its safe areas) at 2x (786 x 1704): a slow scroll
// down about two screens (or to the end), a pause and back to the top, so it loops:
//  - phone-feed, phone-groups, phone-jams, phone-board, phone-profile.
//  - phone-tasks: Tasks with the courses that hold something opened (every row starts
//    folded), their tasks, due dates and tags. The seed makes no tags: when Jerry has none,
//    three are added to a few tasks first, and kept.
// Also on a phone, not that scroll:
//  - phone-pomodoro: the focus screen in a Pomodoro work block counting down (the controls
//    fade when left alone), then, the page's clock moved on, the block's last seconds and the
//    break starting. Not recording: the timelapse is set not to ask, and any prompt is
//    declined. The session is real and is ended once it has run a minute, as in
//    record-focus.mjs.
//  - phone-together: Social › Groups on the group's week, a tap on Jams, its jams, a short
//    scroll down and back.
//
// CAPTURE_DEPS=<playwright-core + jose> FFMPEG=<ffmpeg with h264_nvenc>
//   node scripts/record-takes.mjs [take ...]      (every take when none is named)
// The frames stay in scripts/out/<take>-frames for checking, with frames.json.
import { api, newPage, PORTAL } from './capture-lib.mjs';
import {
  COMPUTER,
  PHONE,
  BASE_THEME,
  POMODORO,
  Film,
  pageClock,
  settled,
  stopTimeline,
  glassReady,
  launch,
  theme,
} from './record-lib.mjs';

const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.includes(name);
const REHEARSE = process.env.REHEARSE === '1';

// No toasts or badge banners in a recording (Add all says how many blocks it added).
const QUIET = `.toast-stack, .achievement-stack { display: none !important; }`;

/**
 * A signed-in page on the clock, loaded and settled with its clock held, ready for frames.
 * `gate` holds back the requests it matches until `release()`, so what they bring in arrives
 * on camera; `setup` runs before the page loads (requests to answer in the browser);
 * `before` runs while the page's clock still runs by itself.
 */
async function open(browser, view, path, { gate = null, setup = null, before = null } = {}) {
  const { ctx, page } = await newPage(browser, { ...view, css: QUIET, init: pageClock() });
  const cdp = await stopTimeline(ctx, page);
  // After the timeline: the safe areas set before it were dropped (2026-10-29).
  if (view.insets) await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: view.insets });
  let release = () => {};
  if (gate) {
    const opened = new Promise((r) => (release = r));
    await page.route(gate, async (route) => {
      await opened;
      await route.continue();
    });
  }
  if (setup) await setup(page);
  await page.goto(PORTAL + path, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  // Out of the way, so nothing is hovered (the sidebar opens under the pointer). A phone has
  // no pointer: it is never moved there.
  if (!view.mobile) await page.mouse.move(view.width - 40, view.height / 2);
  await page.waitForTimeout(2500);
  await settled(page);
  await glassReady(page);
  await page.waitForTimeout(2500);
  if (before) await before(page);
  await settled(page);
  await page.evaluate(() => window.__clock.hold());
  return { ctx, page, release };
}

/** The username notice, then the notifications ask, if either shows: tapped, on a phone. */
async function dismiss(page) {
  for (const name of ['Keep it', 'Not now']) {
    const button = page.getByRole('button', { name, exact: true });
    if (!(await button.count())) continue;
    await button.first().tap();
    await page.waitForTimeout(1200);
  }
}

const top = (page, sel) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.getBoundingClientRect().top + window.scrollY : null;
  }, sel);

/**
 * A finger on the middle of an element, between two frames. By its box rather than
 * `locator.tap()`, whose checks wait on animation frames the held clock doesn't run.
 */
async function tapOn(page, locator, label) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Nothing to tap: ${label}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** Tags on a few of Jerry's tasks for phone-tasks, when there are none (the seed makes none). */
async function tagTasks() {
  if ((await api('GET', '/api/tags')).tags.length) return;
  const tag = async (name, color) => (await api('POST', '/api/tags', { name, color })).tag.id;
  const reading = await tag('Reading', 'blue');
  const graded = await tag('Graded', 'green');
  const exam = await tag('Exam', 'purple');
  const on = {
    'Weekly reading': [reading],
    'Problem set 3': [graded],
    'Reading response': [reading, graded],
    Midterm1: [exam],
    'Case write-up': [graded],
  };
  for (const n of (await api('GET', '/api/nodes')).nodes)
    if (on[n.title]) await api('PATCH', `/api/nodes/${n.id}`, { tagIds: on[n.title] });
}

const takes = {
  async 'plan-week'(browser) {
    await theme({ mode: 'light', backgroundId: 'lilac-sky', accent: 'rose' });
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const ahead = async () =>
      (await api('GET', `/api/planned-blocks?from=${from}&to=${to}`)).blocks
        .filter((b) => b.source === 'app')
        .map((b) => b.id);
    const had = new Set(await ahead());
    const film = new Film('plan-week');
    const { ctx, page } = await open(browser, COMPUTER, '/calendar', {
      // Where the suggestions will land, so the grid opens on them: asked for once and
      // discarded (nothing is saved until kept).
      before: async (page) => {
        await page.getByRole('button', { name: 'Plan my week' }).first().click();
        await page.waitForTimeout(800);
        const span = await page.evaluate(() => {
          const sc = document.querySelector('.cal-scroll');
          const base = sc.getBoundingClientRect().top - sc.scrollTop;
          const rs = [...sc.querySelectorAll('.cal-ev.is-proposal')].map((e) =>
            e.getBoundingClientRect(),
          );
          return {
            from: Math.min(...rs.map((r) => r.top - base)),
            to: Math.max(...rs.map((r) => r.bottom - base)),
            view: sc.clientHeight,
            n: rs.length,
          };
        });
        if (!span.n) throw new Error('Plan my week suggested nothing');
        await page.getByRole('button', { name: 'Discard' }).first().click();
        await page.mouse.move(COMPUTER.width - 40, COMPUTER.height / 2);
        // The grid from an hour or so before the first suggestion (48 px an hour), so the
        // day's blocks show beside them, unless the last would then be cut off.
        const y = Math.max(span.from - 60, span.to + 30 - span.view);
        await page.evaluate(
          (y) => {
            document.querySelector('.cal-scroll').scrollTop = y;
          },
          Math.max(0, y),
        );
        console.log('suggestions', span);
        await page.waitForTimeout(800);
      },
    });
    try {
      film.trackNetwork(page);
      await film.hold(page, 2300, 'week');
      await film.click(page, page.getByRole('button', { name: 'Plan my week' }).first(), 'plan', {
        hover: 450,
      });
      await film.hold(page, 3300, 'suggested');
      await film.click(page, page.getByRole('button', { name: 'Add all' }).first(), 'add all', {
        hover: 500,
      });
      // The pointer moves off, as a hand would, rather than resting on a new block.
      await page.mouse.move(COMPUTER.width - 40, COMPUTER.height / 2);
      await film.hold(page, 4800, 'added');
    } finally {
      await ctx.close();
      for (const id of await ahead())
        if (!had.has(id)) await api('DELETE', `/api/planned-blocks/${id}`);
    }
    // Mostly still, so small even this sharp.
    await film.finish({ cq: 20 });
  },

  async 'analytics-scroll'(browser) {
    await theme({ backgroundId: 'golden-hour', accent: 'amber' });
    const film = new Film('analytics-scroll');
    // The week's figures held back until the clock is: the page opens on camera.
    const { ctx, page, release } = await open(browser, COMPUTER, '/analytics', {
      gate: '**/api/analytics/recap**',
    });
    try {
      release();
      // The data comes in with page time standing still: steps of no time run what it sets
      // off (the query's notice is a timer) until the page has drawn it and its first
      // effects have run (the counts start when seen).
      const since = Date.now();
      for (;;) {
        await page.evaluate(() => window.__clock.step(0));
        const drawn = await page.evaluate(
          () =>
            !!document.querySelector('.rc-hero-number') && !!document.querySelector('.rc-streaks'),
        );
        if (drawn) break;
        if (Date.now() - since > 60_000) throw new Error('Analytics never drew its figures');
        await page.waitForTimeout(100);
      }
      for (let i = 0; i < 5; i++) {
        await page.waitForTimeout(150);
        await page.evaluate(() => window.__clock.step(0));
      }
      await film.hold(page, 1800, 'counting');
      const streaks = await top(page, '.rc-streaks');
      const max = await page.evaluate(
        () => document.scrollingElement.scrollHeight - window.innerHeight,
      );
      const to = Math.min(max, Math.round(streaks - 36));
      console.log('analytics scroll to', to, 'of', max);
      await film.scroll(page, to, 6000, 'down');
      await film.hold(page, 2000, 'streaks');
      await film.scroll(page, 0, 3400, 'up');
      await film.hold(page, 800, 'top');
    } finally {
      await ctx.close();
    }
    // Under about 3 MB: the cap holds the scrolls' bitrate down. The poster is the week
    // counted up, not the page opening on 0.5 h with empty charts.
    await film.finish({
      cq: 23,
      bitrate: '1600k',
      maxrate: '1900k',
      bufsize: '3800k',
      posterFrame: 52,
    });
  },

  async 'xp-buy'(browser) {
    await theme({});
    const shop = await api('GET', '/api/shop');
    const { cost, max: most } = shop.freeze;
    if (!REHEARSE && shop.freeze.held >= most)
      throw new Error(`xp-buy buys a streak freeze, but ${most} are held already (REHEARSE=1)`);
    // Rehearsing: the purchase is answered in the browser and the shop reads as it would
    // around it, one short of the most held if need be. Nothing is spent.
    const held = Math.min(shop.freeze.held, most - 1);
    let bought = false;
    const rehearse = async (page) => {
      await page.route('**/api/shop/freeze', async (route) => {
        bought = true;
        const me = await api('GET', '/api/me');
        const streak = { ...me.user.streak, freezesHeld: held + 1 };
        await route.fulfill({ json: { xp: shop.xp - cost, streak } });
      });
      await page.route('**/api/shop', async (route) => {
        const res = await route.fetch();
        const json = await res.json();
        json.xp = bought ? shop.xp - cost : shop.xp;
        json.freeze.held = bought ? held + 1 : held;
        await route.fulfill({ response: res, json });
      });
    };
    const film = new Film('xp-buy');
    const { ctx, page } = await open(browser, COMPUTER, '/achievements', {
      setup: REHEARSE ? rehearse : null,
    });
    try {
      film.trackNetwork(page);
      await film.hold(page, 1800, 'xp');
      // Down to the Shop with the whole XP card still in view: the coins leave from its
      // XP to spend (off screen, a pill would drop in for it instead).
      const hero = await top(page, '.ach-hero');
      await film.scroll(page, Math.max(0, Math.round(hero - 12)), 1300, 'to the shop');
      await film.hold(page, 600, 'shop');
      const buy = page.locator('#shop-freeze').getByRole('button', { name: /^Buy for/ });
      await film.click(page, buy, 'buy', { hover: 450 });
      await page.mouse.move(COMPUTER.width - 40, COMPUTER.height / 2);
      await film.hold(page, 3400, 'coins');
      const rolls = await top(page, 'section[aria-labelledby="rolls-h"]');
      const max = await page.evaluate(
        () => document.scrollingElement.scrollHeight - window.innerHeight,
      );
      await film.scroll(page, Math.min(max, Math.round(rolls - 24)), 3200, 'to the rolls');
      await film.hold(page, 3000, 'rolls');
    } finally {
      await ctx.close();
    }
    // Under about 3 MB: the cap holds the scrolls' bitrate down.
    await film.finish({ cq: 23, bitrate: '1600k', maxrate: '1900k', bufsize: '3800k' });
  },

  async 'phone-pomodoro'(browser) {
    if ((await api('GET', '/api/sessions/active')).active)
      throw new Error('A session is already running; end it first.');
    const before = (await api('GET', '/api/me')).user.settings;
    await api('PATCH', '/api/me/settings', {
      timelapse: { record: 'never' },
      pomodoro: { ...before.pomodoro, ...POMODORO, autoStartBreaks: true },
    });
    await theme({ backgroundId: 'golden-hour', accent: 'amber' });
    const nodes = (await api('GET', '/api/nodes')).nodes;
    const task =
      nodes.find((n) => n.title === 'Problem set 3') ?? nodes.find((n) => n.kind !== 'course');
    const film = new Film('phone-pomodoro');
    let session = null;
    let started = 0;
    let ticks = null;
    try {
      // While it loads, the focus screen's clock runs at a twentieth of real speed (as in
      // record-focus.mjs), so it still reads about 25:00 when filming starts.
      const { ctx, page } = await newPage(browser, {
        ...PHONE,
        css: QUIET,
        init: pageClock({ '/focus': 0.05 }),
      });
      try {
        const cdp = await stopTimeline(ctx, page);
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: PHONE.insets });
        const a = await api('POST', '/api/sessions', { nodeId: task.id, mode: 'pomodoro' });
        session = a.active.session;
        started = Date.now();
        const blockEnds = Date.parse(a.active.timer.phaseEndsAt);
        await page.goto(PORTAL + '/focus', { waitUntil: 'load' });
        await page.waitForFunction(
          () => /\d:\d\d/.test(document.querySelector('.focus-time')?.textContent ?? ''),
          null,
          { timeout: 60_000, polling: 100 },
        );
        await page.evaluate(async () => {
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
        await page.waitForTimeout(1500);
        await dismiss(page);
        // As `settled`, less the progress bars, which ease to a new width every second.
        await page.waitForFunction(
          () =>
            document
              .getAnimations()
              .every(
                (a) =>
                  a.playState !== 'running' ||
                  a.effect?.getTiming().iterations === Infinity ||
                  /(^| )focus-bar-/.test(a.effect?.target?.classList?.value ?? ''),
              ),
          null,
          { timeout: 60_000, polling: 200 },
        );
        await page.evaluate(() => window.__clock.hold());
        // The phase and clock as the screen shows them, against page time, for the check.
        await page.evaluate(() => {
          const read = () =>
            `${document.querySelector('.focus-phase')?.textContent} ${document.querySelector('.focus-time')?.textContent}`;
          window.__ticks = [{ at: Date.now(), text: read() }];
          new MutationObserver(() => {
            const text = read();
            if (text !== window.__ticks.at(-1).text) window.__ticks.push({ at: Date.now(), text });
          }).observe(document.querySelector('.focus-screen'), {
            subtree: true,
            characterData: true,
            childList: true,
          });
        });
        film.trackNetwork(page);
        // Counting down; left alone, the controls fade after four seconds.
        await film.hold(page, 4500, 'work');
        const cut = film.n;
        // On to a few seconds before the block ends, unfilmed, half a minute at a time: the
        // app reads a jump of ten minutes or more as the phone having slept.
        for (;;) {
          const left = blockEnds - 3600 - (await page.evaluate(() => Date.now()));
          if (left <= 0) break;
          await page.evaluate((ms) => window.__clock.step(ms), Math.min(left, 30_000));
        }
        await film.quiet();
        await film.hold(page, 6400, 'end of the block');
        ticks = { cut, blockEnds, log: await page.evaluate(() => window.__ticks) };
      } finally {
        await ctx.close();
      }
    } finally {
      // The session, once it has run a minute (shorter ones can't be ended).
      if (session) {
        const left = started + 62_000 - Date.now();
        if (left > 0) await new Promise((r) => setTimeout(r, left));
        await api('POST', `/api/sessions/${session.id}/end`, {
          review: { distracted: 'no', mood: 4 },
        });
      }
      await api('PATCH', '/api/me/settings', {
        timelapse: { record: before.timelapse.record },
        pomodoro: before.pomodoro,
      });
    }
    await film.finish({
      cq: 30,
      bitrate: '600k',
      maxrate: '680k',
      bufsize: '1400k',
      extra: { ticks },
    });
  },

  async 'phone-together'(browser) {
    await theme({ backgroundId: 'neon', accent: 'violet' });
    const film = new Film('phone-together');
    const { ctx, page } = await open(browser, PHONE, '/social?tab=groups', { before: dismiss });
    try {
      film.trackNetwork(page);
      // The group's week sits under the views, so Jams is a tap away.
      await film.hold(page, 2400, 'groups');
      await tapOn(page, page.locator('.social-tab', { hasText: 'Jams' }).first(), 'Jams');
      await film.hold(page, 1400, 'jams');
      const max = await page.evaluate(
        () => document.scrollingElement.scrollHeight - window.innerHeight,
      );
      const to = Math.min(max, 640);
      console.log('phone-together scroll', to, 'of', max);
      await film.scroll(page, to, 2000, 'down');
      await film.hold(page, 1600, 'below');
      await film.scroll(page, 0, 1700, 'up');
      await film.hold(page, 700, 'top again');
    } finally {
      await ctx.close();
    }
    await film.finish({ cq: 30, bitrate: '600k', maxrate: '680k', bufsize: '1400k' });
  },
};

/**
 * A phone page: a slow scroll down about two screens (or to its end), a pause, back up.
 * `setup` runs first (data through the API); `before` on the loaded page, its clock running.
 */
const phoneTake = (name, path, look, more) => async (browser) => {
  const { setup = null, before = null } = more ?? {};
  if (setup) await setup();
  await theme(look);
  const film = new Film(name);
  const { ctx, page } = await open(browser, PHONE, path, {
    before: async (page) => {
      await dismiss(page);
      if (before) await before(page);
    },
  });
  try {
    const max = await page.evaluate(
      () => document.scrollingElement.scrollHeight - window.innerHeight,
    );
    const dist = Math.min(max, 1700);
    const down = Math.min(3400, Math.max(2400, 1800 + dist));
    const up = Math.round(down * 0.8);
    // At least 8.4 s in all, the rest at the top before and after.
    const rest = Math.max(0, 8400 - (down + up + 1300 + 1500));
    console.log(name, 'scroll', dist, 'of', max);
    await film.hold(page, 800 + rest / 2, 'top');
    await film.scroll(page, dist, down, 'down');
    await film.hold(page, 1300, 'bottom');
    await film.scroll(page, 0, up, 'up');
    await film.hold(page, 700 + rest / 2, 'top again');
  } finally {
    await ctx.close();
  }
  // Under about 0.8 MB: the cap holds the scroll's bitrate down; text stays readable.
  await film.finish({ cq: 30, bitrate: '600k', maxrate: '680k', bufsize: '1400k' });
};
takes['phone-feed'] = phoneTake('phone-feed', '/social', {});
takes['phone-groups'] = phoneTake('phone-groups', '/social?tab=groups', { backgroundId: 'fuji' });
takes['phone-jams'] = phoneTake('phone-jams', '/social?tab=jams', {
  backgroundId: 'neon',
  accent: 'violet',
});
takes['phone-board'] = phoneTake('phone-board', '/social?tab=leaderboard', {
  mode: 'light',
  backgroundId: 'wheatland',
  accent: 'lemon',
});
takes['phone-profile'] = phoneTake('phone-profile', '/profile', {
  mode: 'light',
  backgroundId: 'sea-glass',
  accent: 'mint',
});
takes['phone-tasks'] = phoneTake(
  'phone-tasks',
  '/tasks',
  { mode: 'light', backgroundId: 'pier', accent: 'rose' },
  {
    setup: tagTasks,
    // Every row starts folded: each course with something in it opened, as a hand would.
    before: async (page) => {
      const folded = page.locator('li.tree-root > .tree-row .tt-toggle[aria-expanded="false"]');
      for (let i = 0; i < 12 && (await folded.count()); i++) {
        await folded.first().tap();
        await page.waitForTimeout(700);
      }
      // Then on the title, so the last row tapped doesn't keep its hover (a phone's stays).
      await page.locator('h1').first().tap();
      await page.waitForTimeout(500);
    },
  },
);

for (const name of only)
  if (!(name in takes)) throw new Error(`No take "${name}": ${Object.keys(takes).join(', ')}`);

const was = (await api('GET', '/api/me')).user.settings.theme;
await api('PATCH', '/api/me/settings', {
  quote: { appTips: false },
  visualizer: { promptDismissed: true },
});
await api('POST', '/api/social/nudges/seen').catch(() => {});

const browser = await launch();
try {
  for (const [name, take] of Object.entries(takes)) if (want(name)) await take(browser);
} finally {
  await browser.close();
  await api('PATCH', '/api/me/settings', { theme: { ...BASE_THEME, ...was } });
}
