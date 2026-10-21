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
  gradient page. The real dashboard screenshot sits in a glass window over it; the sections
  below show the profile, leaderboard and focus screen as screenshots.
- `public/fonts`: Satoshi for headings and the wordmark. Inter loads from rsms.me like the app.
- `public/shots/*.webp`: screenshots of the portal from a seeded sandbox account (Jerry, dark
  mode). To retake them, see below. Replacing a file with the same name is all the page needs.

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

