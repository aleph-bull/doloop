// The link preview (public/og.jpg): the hero at 1200x630, logo and headline over the photo
// with the laptop and phone, without the nav links, buttons or paragraph.
// Run the site, then: CAPTURE_DEPS=<folder with playwright-core> node scripts/og.mjs [url]
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const need = createRequire(
  process.env.CAPTURE_DEPS ? join(process.env.CAPTURE_DEPS, 'noop.js') : import.meta.url,
);
const { chromium } = need('playwright-core');

const url = process.argv[2] ?? 'http://localhost:5190/';
const out = fileURLToPath(new URL('../public/og.jpg', import.meta.url));

const CSS = `
  .site-nav-links, .site-nav-actions, .lede, .cta-row { display: none !important; }
  .site-nav { margin-top: 30px; width: 1200px; padding: 0 44px; box-sizing: border-box; }
  .hero { min-height: 0; padding-top: 96px; }
  .hero-photo { inset: 0; mask-image: none; }
  .hero h1 { font-size: 72px; }
  .devices { margin-top: 40px; width: 1040px; }
  body { overflow: hidden; }
`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
await page.addInitScript(() => {
  document.documentElement.dataset.motion = 'off';
});
await page.goto(url, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: CSS });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(2500);
await page.screenshot({
  path: out,
  type: 'jpeg',
  quality: 90,
  clip: { x: 0, y: 0, width: 1200, height: 630 },
});
await browser.close();
console.log('wrote', out);
