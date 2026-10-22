# Komodon homepage

The marketing site for Komodon, beside the portal in this repo. Plain HTML and CSS,
served and built with Vite.

```bash
pnpm install
pnpm dev        # http://localhost:5190
pnpm build      # static output in dist/
```

## Page

- `index.html` and `src/styles.css`: the app's default photograph (Cotton Candy, frostroomhead
  on Pexels) runs edge to edge behind the hero and fades out at the bottom into a light
  gradient page. The real dashboard screenshot sits on a CSS laptop and phone over it. Below,
  each section has its heading on the left and its paragraph on the right, then plain
  screenshots with one corner (`.panel`): Analytics; the focus screen over three timelapses;
  the feed beside the leaderboard.
- `public/fonts`: Satoshi for headings and the wordmark. Inter loads from rsms.me like the app.
- `public/shots/*.webp`: screenshots of the portal from a seeded sandbox account (Jerry, dark
  mode). To retake them, see below. Replacing a file with the same name is all the page needs.
  The section shots are crops of 1280x800 captures at 2x (in device pixels: analytics
  472,40 1928x1084; focus 0,220 2560x1100; feed from Social 952,184 904x950; leaderboard from
  Social › Leaderboard 492,184 1888x1416). Keep a new crop's shape, or change its
  `width`/`height` in `index.html` and, for the two Social shots, the column ratio in
  `.share-grid`.
- `public/clips`: the owner's own timelapses, each a whole session sped up to ten seconds,
  720 px wide, H.264 with no sound (about 1 MB each), and a webp poster from 3 s in.
  `main.js` plays them only while they're on screen.

## Retaking the screenshots

1. In `../api`, run `npx tsx seed-site-demo.tmp.ts`. It wipes and reseeds
   `.pglite-sandbox-site` with Jerry's history (4.6 h this week over 6 sessions, 9.8 h last
   week, 192 h all time, a 7-day streak with a best of 17, the STATS203 midterm due in 7 days).
2. Start the `site-sandbox-api` and `site-sandbox` launch configs (ports 8801 and 5187), or
   run the sandbox scripts with `SANDBOX_API_PORT=8801 SANDBOX_PORTAL_PORT=5187
   SANDBOX_DATA=.pglite-sandbox-site`.
3. Run `scripts/capture.mjs` from a folder that has `playwright-core` and `jose` installed.
   It drives the installed Chrome headless at 1440x900 (2x), signs in as `jerry@komodon.demo`
   with a dev token, hides the dashboard's tip and hint cards, declines the focus screen's
   prompts, and writes PNGs to `public/shots`. Convert them to webp with sharp.

