# Notes for AI agents working on Komogon

Read this before changing anything. It holds what isn't obvious from the code: how the owner
works, the rules the app keeps, and the traps that have already cost time. The longer record
of every product decision is [DECISIONS.md](DECISIONS.md); keep adding to it.

## About the app

Komogon is a study app: plan courses and tasks, run focus sessions (Pomodoro, open-ended or
until a time), and see progress the way a running app shows runs: streaks, personal bests,
weekly recaps, XP and levels. The design idea is that a runner's "beat last time" discipline
carries over to studying. It is in a **closed alpha** with a handful of testers.

- `apps/portal`: the web app (React 19, Vite, React Router, TanStack Query, Tailwind 4 plus
  a large hand-written `src/index.css`). Installable as a PWA (`public/manifest.webmanifest`,
  `public/sw.js`, registered only on hosted addresses).
- `apps/api`: Fastify + Drizzle on Postgres. Locally it runs on PGlite (in-process Postgres).
  Migrations live in `apps/api/drizzle` and run on start-up.
- `apps/extension`: Chrome extension (timer remote, site blocking). Built for one portal and
  API address at build time (`VITE_PORTAL_URL`, `VITE_API_URL`).
- `packages/core`: pure logic shared by everything (pace, XP, streaks, badges, recap, quotes,
  greetings). Most unit tests are here.
- `packages/ui`: the design system (glass components, themes, logo, background catalogue).

More: [README.md](README.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/SETUP.md](docs/SETUP.md), [docs/ALPHA.md](docs/ALPHA.md) (hosting and testers),
[docs/IDEAS.md](docs/IDEAS.md) (the backlog).

## Where it runs

1. **Hosted alpha** at https://komogon.app: portal on Vercel (root `apps/portal`, config in
   `apps/portal/vercel.json`), API on Render (`render.yaml`), data in Neon Postgres, domain
   on Cloudflare. A push to `main` on GitHub (`aleph-bull/doloop`) redeploys both.
   cron-job.org pings `/api/health` every 10 minutes so Render's free plan doesn't sleep.
2. **The owner's always-on copy** on their own PC: a frozen build on localhost:5173 and :8787
   with their real data in `~/.komogon/pglite`. **Do not stop, restart or update it
   (`pnpm local:stop|start|update`) without asking first.** They study on it, sometimes
   while you are working. To read its data, copy the folder or use a backup in
   `~/.komogon/backups`; never point scripts or tests at the live folder.
3. **Sandboxes** for checking changes in a browser, with throwaway data (launch configs in
   `.claude/launch.json`): `sandbox-api`/`sandbox` (8797/5183, dev sign-in),
   `sandbox-2-api`/`sandbox-2` (8798/5184), `sandbox-password-api`/`sandbox-password`
   (8799/5185, the real email-and-password sign-in, admin `admin@komogon.test`). Other agent
   sessions may already be using one; pick a free one.

## Sign-in and accounts

- The hosted app uses the API's own **email-and-password accounts**: `password_accounts`
  (scrypt hashes), `POST /api/auth/signup|signin`, tokens signed with `AUTH_SECRET`. The
  portal uses them when no Supabase and no dev variables are set (`authMode` `'server'` in
  `apps/portal/src/lib/auth.tsx`). Supabase sign-in still works if both sides get its keys.
- Dev sign-in (`DEV_AUTH_SECRET` / `VITE_DEV_AUTH_SECRET`) is local only and must never be
  set on Vercel or Render.
- `ADMIN_EMAILS` (the owner) unlocks `/admin`: every account, a JSON download of each one's
  data, and setting a new password. Testers are told on the sign-in page that the owner can
  see accounts and study data, and are asked not to reuse a personal password.
- The owner asked to be able to read passwords. That was refused by a permission check;
  passwords stay hashed. Don't add plaintext storage unless the owner has explicitly
  overridden that check.
- The API allows cross-site requests from `CORS_ORIGINS` and needs GET, POST, PUT, PATCH and
  DELETE listed explicitly (`@fastify/cors` defaults to GET/HEAD/POST only, which once broke
  onboarding on the hosted site with "Failed to fetch"). Locally Vite proxies `/api`, so
  cross-site bugs only show up when hosted.

## How the owner likes to work

- **Ask before committing**, unless they've just said to commit. Commit messages end with
  the co-author line the session gives you. Push only when asked; pushing deploys.
- Another agent session may be editing the same files at the same time. Check
  `git status` / `git diff` before touching a file, make small targeted edits rather than
  rewriting whole files, and never revert changes you didn't make.
- Don't run `prettier --write` on whole folders: some files are deliberately left
  unformatted, and it rewrites other sessions' work. Format only the files you changed.
- Ideas they mention but don't ask to have built go in `docs/IDEAS.md`. Don't build them
  unasked.
- Verify UI changes in a sandbox and show a screenshot; the owner expects it checked, not
  described.
- Record each change of direction in DECISIONS.md, with the date.
- **Settings about what a page shows or how it is laid out go in Settings › Pages**, under a
  sub-panel for that page (`<h3 className="settings-group-head">Dashboard</h3>` and so on).
  Add the words people might search for to the `pages` entry in `SettingsNav.tsx`.

## Rules the app keeps

**Voice.** Calm and sincere, like the Opal app: plain, warm, full sentences. Never cheeky,
quirky, flirty or salesy, and never pushy (no nagging about rest or gaps, no pep talks).
`greetings.test.ts` and `phrases.test.ts` reject "!", emoji and nag words.

**Look.**

- Matte and flat: no glossy sheens, glows, or gradients inside panels. Every card on a page
  uses the same surface.
- Never black text on buttons or the logo; accent buttons keep white labels and the fill
  deepens instead. Solid accent fills are muted (saturation capped at 45%).
- No all-caps labels (except on the focus screen); labels are in sentence case.
- Weights: labels 400, headings 600, big figures 700. Big number with a small unit and a
  tight gap.
- Charts use shades of the accent, not a rainbow. No emoji in the UI; use lucide icons.
- No sparse full-width panels with two lonely values; fold small values into an existing
  row as pills.
- Inter for everything; Satoshi only for the "Komogon" wordmark in the nav.

**Product.**

- XP amounts appear only on Achievements (and the "+N XP" on ticking a routine). Not on
  Today, Routines, Settings, Analytics or the session overlay.
- Analytics shows wins only: never a discouraging or zero-value card.
- Pomodoro lengths have no limits and can change mid-session. Don't add locks or minimums.
- The leaderboard (Analytics › Leaderboard, top 10 by focused time, by chosen name) is the
  one place people are compared; the owner asked for it. Don't add more comparison.
- "Pomodoro" is the timer's name; never rename it in the Komogon renames.

## Checks and traps

- `pnpm check` runs lint, types, tests, the contrast audit and the build. On this PC run the
  API tests one at a time: `cd apps/api && npx vitest run --maxWorkers=1` (parallel forks
  crash at random; it's not the code).
- After changing the database schema, run `npx drizzle-kit generate --name <what>` in
  `apps/api` and commit the new SQL and snapshot.
- Never pipe `pnpm local:start|update` output: the servers inherit the pipe and the command
  never returns.
- `python` is the Windows Store alias here and hangs. Write helper scripts in Node.
- Inline `node -e` with backticks gets mangled by the shell; write scripts to a file.
- Files may have CRLF line endings; match them when editing by script.
- The browser preview only paints during screenshots: animations and IntersectionObserver
  effects stall. Set `document.documentElement.dataset.motion = 'off'` to see the finished
  state.

## Recent changes (2026-10-20)

- Removed the weekly review page. `/analytics/review` redirects to Analytics; the API route
  and the `weekly_reviews` table are still there, unused by the portal.
- Background pickers in Settings open minimized every time ("Show all backgrounds" opens
  them).
- Leaderboard tab, onboarding can skip the first task, name placeholder "e.g. John".
- Settings › Pages now has a Dashboard sub-panel with the daily card and "Tips about the app"
  (they used to sit in Pace and streaks).
- The Level pill's hover card opens on hover and keyboard focus only (`:has(:focus-visible)`),
  so it no longer stays open after a click.
