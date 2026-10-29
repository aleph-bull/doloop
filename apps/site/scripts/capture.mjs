// Every screenshot the homepage uses, from the seeded sandbox (Jerry). PNGs land in ./out;
// convert.mjs turns them into the site's webp files.
import { api, openBrowser, newPage, go, outDir, fakeCamera } from './capture-lib.mjs';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = outDir(process.env.SHOTS_OUT ?? fileURLToPath(new URL('./out', import.meta.url)));
const only = process.argv.slice(2);
const want = (n) => only.length === 0 || only.some((o) => n === o || n.startsWith(`${o}-`));

const BASE_THEME = { mode: 'dark', backgroundId: 'cotton-candy', accent: 'sky', panel: 'glass' };
const POMODORO = { workMin: 25, shortBreakMin: 5, longBreakMin: 15, cyclesBeforeLong: 4 };

await api('PATCH', '/api/me/settings', {
  quote: { appTips: false },
  visualizer: { promptDismissed: true },
  timelapse: { record: 'never' },
  theme: BASE_THEME,
  pomodoro: POMODORO,
});
// Clear the nudge so the dashboard reads cleanly.
await api('POST', '/api/social/nudges/seen').catch(() => {});

const browser = await openBrowser();

async function shoot(name, path, opts = {}) {
  if (!want(name)) return;
  const {
    width = 1440,
    height = 900,
    scale = 2,
    mobile = false,
    css = '',
    init = null,
    before,
    wait = 1800,
    // A selector: the shot is that element alone (locator.screenshot), not the window.
    el = null,
  } = opts;
  const { ctx, page } = await newPage(browser, { width, height, scale, mobile, css, init });
  await go(page, path, wait);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  if (before) await before(page);
  const target = el ? page.locator(el).first() : null;
  // Scrolled to first, so the glass has settled before the shot.
  if (target) await target.scrollIntoViewIfNeeded();
  await page.mouse.move(width - 6, height - 6);
  await page.waitForTimeout(900);
  if (target) await target.screenshot({ path: join(OUT, `${name}.png`) });
  else await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('shot', name);
  await ctx.close();
}

const theme = (t) => api('PATCH', '/api/me/settings', { theme: { ...BASE_THEME, ...t } });
const PHONE = { width: 390, height: 844, scale: 3, mobile: true };
// The username notice, then the notifications ask, if either shows.
const dismiss = async (page) => {
  for (const name of ['Keep it', 'Not now']) {
    const button = page.getByRole('button', { name, exact: true });
    if (!(await button.count())) continue;
    await button.first().click();
    await page.waitForTimeout(1200);
  }
};
// ---- The app as it is: the hero and the feature sections ----
await shoot('today', '/');
await shoot('today-phone', '/', { width: 390, height: 844, scale: 3, mobile: true });
await shoot('feed-phone', '/social', { ...PHONE, before: dismiss });
await shoot('analytics', '/analytics');
await shoot('start-dialog', '/', {
  before: async (page) => {
    await page.getByRole('button', { name: 'Start a session' }).first().click();
    await page.waitForTimeout(1500);
  },
});
// The calendar: the week as it stands, then the same week with Plan my week's suggestions.
const morning = (hour) => async (page) =>
  page.evaluate((h) => {
    const el = document.querySelector('.cal-scroll');
    if (el) el.scrollTop = (el.scrollHeight / 24) * h;
  }, hour);
// A taller window so a whole day shows. "Add all" saves the blocks, so they are taken off
// again afterwards and a second run starts from the same week.
const CAL = { height: 1040, before: morning(8) };
const planIt = (add) => async (page) => {
  await page.getByRole('button', { name: 'Plan my week' }).first().click();
  await page.waitForTimeout(1200);
  if (add) {
    await page.getByRole('button', { name: 'Add all' }).first().click();
    await page.waitForTimeout(5200);
  }
  await morning(8)(page);
};
await shoot('cal-week', '/calendar', CAL);
await shoot('cal-plan', '/calendar', { ...CAL, before: planIt(false) });
if (want('cal-added')) {
  const ahead = async () => {
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const { blocks } = await api('GET', `/api/planned-blocks?from=${from}&to=${to}`);
    return blocks.filter((b) => b.source === 'app').map((b) => b.id);
  };
  const before = new Set(await ahead());
  await shoot('cal-added', '/calendar', { ...CAL, before: planIt(true) });
  for (const id of await ahead())
    if (!before.has(id)) await api('DELETE', `/api/planned-blocks/${id}`);
}
await shoot('cal-phone', '/calendar', {
  width: 390,
  height: 844,
  scale: 3,
  mobile: true,
  before: morning(9),
});

// ---- The line-up: three phone screens, each in its own look ----
// The calendar's day: the latest day up to today with both a class and a session on it,
// preferring one where nothing overlaps (overlaps get a warning edge) and it all fits in the
// phone's six hours, opened just before the first of them.
const TZ = { timeZone: 'America/Toronto' };
const dayOf = (ms) => new Date(ms).toLocaleDateString('en-CA', TZ);
const hourOf = (ms) => {
  const [h, m] = new Date(ms).toLocaleTimeString('en-GB', { ...TZ, hour12: false }).split(':');
  return Number(h) + Number(m) / 60;
};
async function busyDay() {
  const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 86_400_000).toISOString();
  const { blocks } = await api('GET', `/api/planned-blocks?from=${from}&to=${to}`);
  const days = [];
  for (let back = 0; back < 7; back++) {
    const day = dayOf(Date.now() - back * 86_400_000);
    const on = blocks
      .filter((b) => !b.cancelled && dayOf(Date.parse(b.startAt)) === day)
      .map((b) => ({ source: b.source, s: Date.parse(b.startAt), e: Date.parse(b.endAt) }))
      .sort((a, b) => a.s - b.s);
    const classes = on.filter((b) => !['app', 'session'].includes(b.source));
    if (!classes.length || !on.some((b) => b.source === 'session')) continue;
    let end = 0;
    let apart = true;
    for (const b of on) {
      if (b.s < end) apart = false;
      end = Math.max(end, b.e);
    }
    const fits = end - on[0].s <= 6 * 3_600_000;
    days.push({ back, day, first: on[0].s, clean: apart && fits });
  }
  const pick = days.find((d) => d.clean) ?? days[0];
  if (!pick) return { path: '/calendar', hour: 9 };
  return {
    path: pick.back ? `/calendar?date=${pick.day}` : '/calendar',
    hour: hourOf(pick.first) - 0.6,
  };
}
const plan = want('lineup-plan') ? await busyDay() : { path: '/calendar', hour: 9 };
const lineup = [
  ['lineup-plan', plan.path, { mode: 'light', backgroundId: 'cloud-valley' }, morning(plan.hour)],
  ['lineup-track', '/', { mode: 'light', backgroundId: 'sea-glass', accent: 'mint' }],
  ['lineup-xp', '/achievements', { backgroundId: 'neon', accent: 'violet' }],
];
for (const [name, path, t, then] of lineup) {
  if (!want(name)) continue;
  await theme(t);
  await shoot(name, path, {
    ...PHONE,
    before: async (page) => {
      await dismiss(page);
      if (then) await then(page);
    },
  });
}
await theme({});

// ---- Achievements: the XP figures, the shop, and RNG Rolls after one ×10 roll ----
await shoot('achievements', '/achievements');
await shoot('xp-hero', '/achievements', { el: '.ach-hero' });
await shoot('shop', '/achievements', { el: 'section[aria-labelledby="shop-h"]' });
const ROLLS = 'section[aria-labelledby="rolls-h"]';
let rolled = false;
// Opens the machine and pulls once for ten (100 XP), waits for the reel to stop, the coins to
// land and any badge banners to leave, keeps that as rolls-machine.png (not on the site), then
// closes it.
const rollTen = async (page) => {
  await page.getByRole('button', { name: /^Roll for / }).click();
  await page.getByRole('button', { name: '×10', exact: true }).click();
  // The lever (the machine around it is aria-hidden, so it has no role to find it by).
  await page.locator('.roll-slot-card .jack-lever').click();
  await page.locator('.roll-slot-layer.is-result').waitFor({ timeout: 30_000 });
  const settled = () =>
    !document.querySelector('.jack-coin, .achievement-stack, .toast-stack .toast');
  await page.waitForTimeout(1500);
  await page.waitForFunction(settled, null, { timeout: 60_000 });
  // The confetti's last pieces.
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, 'rolls-machine.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await page.waitForFunction(settled, null, { timeout: 60_000 });
  // Closing hands focus back to Roll, which would show its focus ring.
  await page.evaluate(() => document.activeElement?.blur());
  rolled = true;
};
await shoot('rolls', '/achievements', {
  before: async (page) => {
    await rollTen(page);
    await page.evaluate((sel) => {
      const top = document.querySelector(sel).getBoundingClientRect().top;
      window.scrollTo(0, window.scrollY + top - 20);
    }, ROLLS);
  },
});
// The same section on its own, after that roll (or after one of its own when run alone).
await shoot('rolls-panel', '/achievements', {
  el: ROLLS,
  before: async (page) => {
    if (!rolled) await rollTen(page);
  },
});

await shoot('feed', '/social');
await shoot('feed-tall', '/social', { height: 1560 });
await shoot('leaderboard', '/social?tab=leaderboard');
await shoot('groups', '/social?tab=groups');
await shoot('jams', '/social?tab=jams');

// ---- Looks: the same app dressed differently ----
const LOOK = { width: 1280, height: 800, scale: 1.5 };
const looks = [
  ['look-fuji', '/', { backgroundId: 'fuji' }],
  ['look-lilac', '/', { mode: 'light', backgroundId: 'lilac-sky', accent: 'rose' }],
  ['look-milky', '/', { backgroundId: 'milky-way', accent: 'violet' }],
  ['look-golden', '/analytics', { backgroundId: 'golden-hour', accent: 'amber' }],
  ['look-seaglass', '/', { mode: 'light', backgroundId: 'sea-glass', accent: 'mint' }],
  ['look-neon', '/analytics', { backgroundId: 'neon', accent: 'violet' }],
  ['look-graphite', '/', { backgroundId: 'graphite', panel: 'matte' }],
  ['look-valley', '/calendar', { mode: 'light', backgroundId: 'cloud-valley' }],
  ['look-harbour', '/social?tab=groups', { backgroundId: 'harbour-lights', accent: 'amber' }],
  [
    'look-panels',
    '/',
    { backgroundId: 'blue-ridges', panel: 'custom', panelColor: '#1e2740', panelAlpha: 0.72 },
  ],
  [
    'look-wheat',
    '/social?tab=leaderboard',
    { mode: 'light', backgroundId: 'wheatland', accent: 'lemon' },
  ],
];
for (const [name, path, t] of looks) {
  if (!want(name)) continue;
  await theme(t);
  await shoot(name, path, LOOK);
}
await theme({});

// ---- The focus screen: a running Pomodoro, then a break ----
const nodes = (await api('GET', '/api/nodes')).nodes;
const task =
  nodes.find((n) => n.title === 'Problem set 3') ?? nodes.find((n) => n.kind !== 'course');
if (only.length === 0 || only.some((o) => o.startsWith('focus') || o.startsWith('look-focus'))) {
  const a = await api('POST', '/api/sessions', { nodeId: task.id, mode: 'pomodoro' });
  const started = Date.now();
  await shoot('focus-work', '/focus', { wait: 2600 });
  // The same screen while a timelapse records it (camera only). CAMERA_PHOTO is the picture
  // the fake camera shows (any photo of a desk); on a phone that is the camera screen.
  const photo = process.env.CAMERA_PHOTO
    ? `data:image/png;base64,${readFileSync(process.env.CAMERA_PHOTO).toString('base64')}`
    : null;
  if (want('focus-rec') && photo) {
    await api('PATCH', '/api/me/settings', { timelapse: { record: 'always' } });
    await shoot('focus-rec', '/focus', {
      wait: 2600,
      init: fakeCamera(photo),
      before: async (page) => {
        const camOnly = page.getByRole('button', { name: 'Just the camera' });
        if (await camOnly.count()) await camOnly.first().click();
        await page.waitForTimeout(2500);
      },
    });
    await api('PATCH', '/api/me/settings', { timelapse: { record: 'never' } });
  }
  if (want('focus-phone') && photo) {
    await api('PATCH', '/api/me/settings', { timelapse: { record: 'always' } });
    await shoot('focus-phone', '/focus', {
      width: 390,
      height: 844,
      scale: 3,
      mobile: true,
      wait: 4000,
      init: fakeCamera(photo),
    });
    await api('PATCH', '/api/me/settings', { timelapse: { record: 'never' } });
  }
  const focusLooks = [
    ['look-focus-canyon', { backgroundId: 'canyon-stars' }],
    ['look-focus-rain', { backgroundId: 'rain-front', accent: 'mint' }],
    ['look-focus-lanterns', { backgroundId: 'lanterns', accent: 'amber' }],
    ['look-focus-autumn', { backgroundId: 'autumn', accent: 'rose' }],
    ['look-focus-milky', { backgroundId: 'milky-way', accent: 'violet' }],
  ];
  for (const [name, t] of focusLooks) {
    if (!want(name)) continue;
    await theme(t);
    await shoot(name, '/focus', { ...LOOK, wait: 2600 });
  }
  await theme({});
  // Sessions under a minute can't be ended.
  const left = 62_000 - (Date.now() - started);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
  await api('POST', `/api/sessions/${a.active.session.id}/end`, {
    review: { distracted: 'no', mood: 4 },
  });

  if (want('focus-break')) {
    // A one-minute Pomodoro, so the break comes round while we wait.
    await api('PATCH', '/api/me/settings', { pomodoro: { ...POMODORO, workMin: 1 } });
    const b = await api('POST', '/api/sessions', { nodeId: task.id, mode: 'pomodoro' });
    await api('PATCH', '/api/me/settings', { pomodoro: POMODORO });
    await new Promise((r) => setTimeout(r, 75_000));
    await shoot('focus-break', '/focus', { wait: 2600 });
    await api('POST', `/api/sessions/${b.active.session.id}/end`, {
      review: { distracted: 'no', mood: 4 },
    });
  }
}

await browser.close();
console.log('done');
