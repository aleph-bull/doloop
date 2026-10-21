# Notes for AI agents working on Komodon

Read this before changing anything. It holds what isn't obvious from the code: how the owner
works, the rules the app keeps, and the traps that have already cost time. The longer record
of every product decision is [DECISIONS.md](DECISIONS.md); keep adding to it.

## About the app

Komodon (renamed from Komogon on 2026-10-20) is a study app: plan courses and tasks, run focus sessions (Pomodoro, open-ended or
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
- "Continue with Google" for those accounts: Google's own button (Identity Services) gives
  the portal an ID token, `POST /api/auth/google` checks it against Google's keys and
  `GOOGLE_SIGNIN_CLIENT_ID`, and joins the account with that email or starts one. The
  portal shows the button only when `GET /api/auth/google` answers a client id. Try it in
  the `sandbox-google` sandbox (8800/5186; placeholder id, so the popup itself fails).
- Sign-in tries are limited in memory (`services/rate-limit.ts`): failed sign-ins per email
  and per address, sign-ups per address, 429 with Retry-After. Addresses come from
  `TRUST_PROXY_HOPS` (1 on Render); never set `trustProxy: true`, it trusts forged headers.
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
- **Committing only your own work from a shared checkout.** When another session has
  uncommitted edits in the same files, stage HEAD's copy plus only your edits: rebuild the
  file in a Node script, `git hash-object -w` it, `git update-index --cacheinfo`. Then
  format the staged copy (`git show :<file> | npx prettier --stdin-filepath <file>`, run
  from `apps/portal` so it finds the repo's settings). If the checkout has also drifted
  from `origin/main` (it often has), don't pull or rebase over the other session's work:
  add a temporary worktree on `origin/main` in your scratchpad, `git apply --3way` your
  commit's code diff, append your DECISIONS.md section by script, typecheck and build
  there, push `HEAD:main`, then remove the worktree. Cherry-picking tends to conflict in
  DECISIONS.md and drag the other session's lines along.
- **Write your DECISIONS.md section into the file on disk too**, not only the staged copy.
  Otherwise the working file silently lacks it, and the other session's next commit of
  DECISIONS.md deletes it.
- Don't run `prettier --write` on whole folders: some files are deliberately left
  unformatted, and it rewrites other sessions' work. Format only the files you changed.
- Ideas they mention but don't ask to have built go in `docs/IDEAS.md`. Don't build them
  unasked.
- **Open copy audit:** [docs/COPY-AUDIT.md](docs/COPY-AUDIT.md) lists flagged wording still
  to fix (wordy, abrupt or AI-sounding copy) and how the owner likes to go through it, in
  numbered batches. Work on it only when they ask, and tick items off there as they ship.
- Verify UI changes in a sandbox and show a screenshot; the owner expects it checked, not
  described.
- Record each change of direction in DECISIONS.md, with the date.
- **Settings about what a page shows or how it is laid out go in Settings › Pages**, under a
  sub-panel for that page (`<h3 className="settings-group-head">Dashboard</h3>` and so on).
  Add the words people might search for to the `pages` entry in `SettingsNav.tsx`. The one
  exception, at the owner's request, is the top bar or sidebar choice: it is in Appearance.

## Rules the app keeps

**Voice.** Calm and sincere, like the Opal app: plain and warm. Fragments are fine; don't
explain what the screen already shows. A little quirky is fine if it sounds like a person
talking, never corporate or AI-polished (no narrator sentences, no "X lives here", no
em-dash flourishes). Never flirty or salesy, and never pushy (no nagging about rest or gaps).
Keep the owner's own wording verbatim, "!" included.
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
- **Never a thin, sectioned page**: panels take the page's full width. A narrow centred
  column of cards with empty sides on both reads as chopped (the owner's word, 2026-10-21,
  on the first Jams page). Use the width: columns side by side, a bento, wider rows.
- Inter for everything; Satoshi only for the "Komodon" wordmark in the nav.

**Product.**

- XP amounts appear only on Achievements (and the "+N XP" on ticking a routine). Not on
  Today, Routines, Settings, Analytics or the session overlay.
- Analytics shows wins only: never a discouraging or zero-value card.
- Pomodoro lengths have no limits and can change mid-session. Don't add locks or minimums.
- People are compared in two places, both asked for by the owner: the leaderboard (Social ›
  Leaderboard, global or friends, top 10 by focused time) and jams (Social › Jams, a timed
  game people choose to enter). Don't add comparison elsewhere.
- "Pomodoro" is the timer's name; never rename it in the app renames.
- **Internal names still say komogon** on purpose: the `@komogon/*` packages, storage keys
  (`komogon.*`), IndexedDB names, extension message types, the `~/.komogon` data folder, the
  local scripts, the startup shortcut and the komogon.app domain. Renaming them would drop
  saved browser state or break the always-on copy. Only the name people see is Komodon.

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
- Never write `-webkit-backdrop-filter` beside `backdrop-filter`. The production CSS pass
  (Lightning CSS, through Tailwind's Vite plugin) then keeps only the prefixed one, which
  Chrome no longer understands, and the hosted site silently lost every blur (found
  2026-10-21). Write the unprefixed property alone; the build adds the prefix for Safari.
- The browser preview only paints during screenshots: animations and IntersectionObserver
  effects stall. Set `document.documentElement.dataset.motion = 'off'` to see the finished
  state. ResizeObserver and requestAnimationFrame callbacks wait for a screenshot too, so
  take one before reading layout after a resize, or you read the old state.
- In the preview, an emulated width wider than the pane is shrunk into a corner of the
  screenshot and comes out unreadable. Emulate about 800px wide (still the computer layout)
  to look closely, and measure wider layouts with JavaScript instead. The preview tool
  starts at most five dev servers per folder; another chat may already hold the sandbox API
  port, and this chat's sandbox portal will use it.
- **Check edges, shadows and glass on a mid-tone photo** (Cotton Candy, dark theme, glass
  panels), not the dark city photo: on a dark photo a clipped shadow or a lost blur is
  invisible. To see whether glass is blurring, put sharp stripes behind the page with a
  fixed element (`#main` above it) and look through the cards.
- **A sideways scroller clips everything outside its padding box**, card shadows included.
  CSS blurs a shadow along a bell curve whose faint tail runs about twice the blur value,
  so the dark glass shadow is still visible 40px below a card. `.rail-track` keeps 12px
  above, 46px at the sides and 72px below, pulled back with negative margins; give any new
  scrolling row of cards the same, or make it a grid (the "That's enough time to" row on
  Analytics is a grid for this reason).
- **A mask, clip-path, filter or opacity below 1 on an ancestor turns off the glass blur
  of everything inside it** (in Chrome that ancestor becomes the backdrop). So the
  dashboard rail has no mask on its track; `CardRail` gives each card its own share of the
  edge fade on scroll and resize. Don't fade a row of glass cards with a mask on the row.
- Sideways overflow is clipped on `#root` (`overflow-x: clip`). Not on html or body: those
  pass it to the window as hidden, which blocks the scroll wheel but still lets
  `scrollIntoView` shift the whole page sideways with no way back.

## Recent changes (2026-10-20)

- Social (2026-10-21): the feed, groups, jams, the leaderboard, nudges and kudos. The whole
  thing is written up in "Social: how it works" below.

- Your profile (2026-10-21): `/profile` is your own profile (`pages/Profile.tsx`), `/profile/:id`
  someone else's (with the friend button). It is not a page tab: the link sits where Sign out was (end of the top bar,
  last sidebar row), and Sign out is a button on the profile itself and in Settings › Account. Picture, name, Ontario university (`settings.profile.university`, ids in
  `packages/core/src/universities.ts`), bio, the study-days grid and totals in one card, then the person's posts (see Social
  above). The gear on your own profile opens `ProfileSettingsDialog`; its fields are
  `ProfileFields`, shared with Settings › Account. Profiles are visible
  to anyone signed in; the API route (`routes/profiles.ts`) shares only chosen fields and
  finished-session totals, never the email.
  The university is set only by `routes/university.ts` after a code emailed to an address
  on that university's domain comes back, through the same mailer as account email
  (`RESEND_API_KEY` + `MAIL_FROM`; with `LOCAL_TEST_ACCOUNTS=true` the local inbox page
  shows it; with neither, the route answers 503).
  One address can verify only one account (checked in the route and by a partial unique
  index).
- Navigation (2026-10-21): the top bar is the default; Settings › Appearance › Navigation
  can switch a computer to a sidebar (`.sidenav` in AppShell; `.rail` is the dashboard card
  row, not the nav). New pages go in the `links` list (`group: 'more'` puts them under the
  sidebar's divider). The top bar always shows page names; when they don't fit, the tabs
  scroll with an arrow on each side that hides one. With under 480px of room for tabs that
  don't fit, the pages move to the bottom icon bar (`data-tabbar` on html, set in AppShell
  for phones and for a crowded bar); the spacer that keeps the controls right counts as
  zero width in that measurement, or the bottom bar never goes away. The bar's sliding pill
  eases out with no spring. There is no "More" menu on purpose.
- The sidebar (same day, owner's requests): the page stays centred in the window and never
  moves when the sidebar is pinned or collapsed (`.page` margins in sidebar mode, clearing
  the open sidebar on narrow windows). After Collapse is clicked with the pointer on it, the
  sidebar rests shut (`is-resting`) until the pointer leaves. Its streak and level pills
  are sized in `RailStats` from the measured icon and text, so both get the same padding
  on every side (`--stat-streak`, `--stat-shift-a`, `--stat-shift-b`). The owner checks
  this spacing to the pixel.
- Removed the weekly review page. `/analytics/review` redirects to Analytics; the API route
  and the `weekly_reviews` table are still there, unused by the portal.
- Background pickers in Settings open minimized every time ("Show all backgrounds" opens
  them).
- Leaderboard tab, onboarding can skip the first task, name placeholder "e.g. John".
- Settings › Pages now has a Dashboard sub-panel with the daily card and "Tips about the app"
  (they used to sit in Pace and streaks).
- The Level pill's hover card opens on hover and keyboard focus only (`:has(:focus-visible)`),
  so it no longer stays open after a click.

## Social: how it works (built 2026-10-21)

Social is the part of the app where people see each other: a feed of shared sessions, study
groups, jams (timed games), the leaderboard, friends, nudges and kudos. It was built in one
day from the owner's instructions and reshaped several times; this is the state as pushed.

**Pages and routes (portal).**

- `/social` is a nav tab (after Analytics; Settings › Pages › Social hides it along with
  the profile link). `pages/Social.tsx` reads `?tab=`: `feed` (default), `groups`,
  `jams`, `leaderboard`. Old `?tab=friends` goes to the feed and `?tab=compare` to
  jams. The Feed tab shows a count of friend requests waiting; Jams shows how many are
  running.
- `/profile` is your own profile, `/profile/:id` someone else's (`pages/Profile.tsx`;
  `/social/:id` still redirects). A profile is the head card (picture, name, university,
  joined, friend count), then three panels (the day grid, strongest days, totals), then the
  person's posts. On someone else's profile the `FriendButton` sits in the head: Add friend,
  Requested (click takes it back), Accept and Decline, or a Friends chip that opens a small
  card with "Friends since <date>" and a Remove friend that asks "Are you sure?" first.
- Everything under `components/social/`: `Feed.tsx` (the three-column layout),
  `FeedSide.tsx` (your card, the friends card, the small leaderboard), `Composer.tsx`,
  `PostCard.tsx`, `GroupsTab.tsx`, `JamsTab.tsx`, `LeaderboardTab.tsx`,
  `CompareBento.tsx`, `DayLines.tsx` (the shared running-total line chart),
  `FriendButton.tsx`, `Avatar.tsx`. The dashboard's `components/NudgesCard.tsx` shows
  nudges in both dashboard layouts. Styles are all in `apps/portal/src/social.css`,
  imported from `index.css`.
- Hooks are in `lib/queries.ts` (`useFeed`, `useFriends`, `useGroups`, `useJams`,
  `useLeaderboard`, `useLeaderboardStats`, `useCompare`, `useNudges` and the
  mutations); types and calls in `lib/api.ts`. The leaderboard, groups and jams query keys
  carry a version number (`['leaderboard', 2, scope]`): the persisted query cache once
  served an older response shape and crashed the tab, so bump the number when a response
  shape changes.

**The feed.** Three columns like LinkedIn's home, sized by the page's own width (container
queries on `.feed-wrap`): your card and the friends card on the left, the composer and
posts in the middle, the first five of the leaderboard on the right (Global or Friends). Under
880px of page width the left column moves under the posts (it holds the requests, so it must
stay reachable); under 660px the board goes (it has its own tab). Cards are deliberately
dense: 40px pictures on posts and the composer, 26px in lists, 12-16px padding, 14px text.
The owner called the first version "massive"; don't let it grow back.

**Posts.** A post is always about one finished session (`sessionId` is required, the
composer's Post button waits for one) and carries the session's minutes and the task's title
as they were when shared (`posts.minutes`, `posts.subject`), optionally a line of text
(500 characters) and one file: a video (MP4/WebM under 5 MB, with a JPEG poster the portal
makes from a frame) or a picture (JPEG/PNG/WebP under 2 MB). The bytes live in `post_media`
as base64; `GET /api/posts/:id/media` serves them, and the portal fetches with the token and
plays or shows a blob URL, because a plain `<video src>` cannot send the header. The focus
screen's timelapse export has "Share to Social", which posts the video with the session
attached. Kudos are the like routes relabelled (`post_likes`, one per person); comments are
`post_comments` (500 characters, deletable by their author or the post's author). Only the
author deletes a post. Counts come with every post; liking patches the caches rather than
refetching (`patchPost` in queries.ts).

**Friends.** `friendships` holds one row per pair with `status` pending or accepted;
declining deletes the row so the same person can be asked again, and asking someone who
already asked you is the same as accepting. The friends card beside the feed: search by name
(`GET /api/social/people?q=`), the friends list (each with a nudge bell and a remove), then
"Friend requests" split into Inbound (the first three, the rest fading behind "Show all") and
Outgoing (folded until opened). The API refuses a request to someone who turned requests off.

**Sharing settings (Settings › Social, `settings.social`).** Who sees your posts
(everyone signed in or friends only; the feed and profiles both filter), study totals on
your profile (off, the profile answers null for stats, grid and weekdays and the page says
they keep their study time to themselves), which leaderboards count you (`'global'` = both,
`'friends'` = only your friends' boards, `'off'` = neither; older rows held true/false,
normalised in `withDefaults`), and whether you take friend requests. Everything is on by
default. The API enforces each of these in `routes/social.ts`, `profiles.ts` and
`leaderboard.ts`: any new place that shows someone's numbers must check them too. Jams and
groups have no setting because joining is the consent.

**Leaderboard.** `GET /api/leaderboard?scope=global|friends`: all-time focused time, top
ten, test accounts and admins left out of the global board. Each row carries eight weeks of
minutes, this week, the streak and days of the last 28, so the tab shows the first three as
tiles with a sparkline and the rest as rows with a small one. Under the global board,
"You and everyone" (`GET /api/leaderboard/stats`): your focused time and days this week
against the average, plus session length and streak as plain figures. The average is over
people with at least 15 minutes in the week; when nobody else reaches that this week, last
week's numbers are used and the card says so; session length and streak averages are over
the same people. Under the friends board, the Compare bento (`routes/compare.ts`,
`GET /api/social/compare`): your weeks beside your friends' in Monday weeks in your timezone.

**Jams (`routes/jams.ts`, tables `jams`, `jam_members`).** A timed game, like a
Spotify jam: start one for a day, three days or a week; friends see it under "Friends are in"
and join; anyone with its six-letter code (no vowels or confusable letters, `newJamCode`)
joins from outside. Focused minutes count from the moment each person joined, so a late
joiner has no head start. The host can end it early; members can leave; the most minutes at
the end wins and the card names the winner. Each member comes with `byDay` (running total
over the jam's days) and their top subjects, shown when the card is opened with its chevron.

**Groups (`routes/groups.ts`, tables `groups`, `group_members`, `nudges`).** A
lasting set of friends. A group's card is the last seven days ending today (a group younger
than that starts on its first day): the total "together", a line per person of their running
total (`DayLines`, yours in the accent, the others in greys, starting on the first day's
value so there is no climb from zero), and everyone ranked with their minutes and a segmented
bar of their biggest subjects named beneath. "Live now" lists friends in a session right
now: a session with no end and `last_seen_at` within ten minutes, with a clock running since
it started and what they are on. Nudges: a friend or a fellow group member can be nudged to
study once every two hours per pair (a second one inside the window is a 409 that says when);
"Nudge" appears next to a group member under half the group's average. The nudged person
sees them on the dashboard until "Got it", and they expire after a day.

**Traps.**

- Drizzle drops the table from `posts.id` in a select list, so the count subqueries in
  `loadPosts` are written by hand with aliases (`post_comments c where c.post_id =
  posts.id`); a bare `"id"` there would be the comment's own.
- The side columns on the feed must not be scroll boxes (overflow clips the glass shadows);
  the board is sticky, your card and friends scroll with the page.
- Panels take the page's full width (see the Look rules); the first Jams page was a narrow
  centred column and read as chopped.
- The API tests for these are `social.test.ts`, `groups.test.ts`, `jams.test.ts`,
  `compare.test.ts`, `leaderboard.test.ts` and `profiles.test.ts`.

**Sandbox with people on it.** `apps/api/seed-social-demo.tmp.ts` (untracked, like the
site seed) wipes and rebuilds `apps/api/.pglite-sandbox-social` with six people, eight weeks
of sessions, friendships, posts, a group, jams, a nudge and two live sessions; pass
`SEED_MEDIA_DIR` pointing at a folder of `v1.mp4`..`v3.mp4` with `v*-poster.jpg` and
`pic1.jpg`, `pic2.jpg` to get media posts (there is no ffmpeg on this PC; a scratch
`ffmpeg-static` made the samples). Then the `social-sandbox-api` / `social-sandbox`
launch configs (8802/5188) and sign in as jerry@komodon.demo. The configs run from the
`social` worktree folder; point them at the checkout you are working in.

## The homepage (`apps/site`, 2026-10-21)

- `apps/site` is the marketing site (`@komogon/site`): plain HTML, CSS and a small script on
  Vite, port 5190 (launch config `site` in the parent folder's `.claude/launch.json`, which is
  the one the preview tool reads). It deploys on Vercel as its own project with Root
  Directory `apps/site`, the same way the portal does from `apps/portal`.
- **The look the owner settled on, after rejecting a lot:** like cluely.com. The Cotton Candy
  photograph runs edge to edge behind the hero and fades out at the bottom only, into a
  light gradient page. The dashboard screenshot sits on a CSS-drawn laptop with the phone
  view in front (no island on the phone); the Track, Focus and Share sections show plain
  screenshots of the portal. Satoshi for headings, Inter for everything else; no eyebrow
  labels, captions or quotes. `src/main.js` does the entrance motion: the headline first,
  the devices about 1.3 s later or on the first scroll, each section as it arrives.
- **Rejected, in order:** hand-built UI mockups ("fake"), the photo feathered on every side,
  photo stages behind every section, rendering the portal's real React components into the
  page ("go back to using screenshots"), device renders from the mockup PSDs, a flat dark
  page. Change exactly what is asked and nothing beside it; the owner says so sharply.
- **Screenshots** come from a seeded sandbox account, jerry@komodon.demo, in dark mode.
  `apps/api/seed-site-demo.tmp.ts` wipes and rebuilds `apps/api/.pglite-sandbox-site` with
  numbers tuned to the owner's reference shots (4.6 h this week over 6 sessions, 9.8 h last
  week, 192 h all time, a 7-day streak with a best of 17, the STATS203 midterm due in 7 days,
  six other people for the leaderboard). `apps/site/scripts/capture.mjs` drives the installed
  Chrome through `playwright-core` (install it and `jose` in a scratch folder) against the
  sandbox on 8801/5187 (`site-sandbox-api` / `site-sandbox` launch configs; the preview tool
  allows five servers per folder, so they may have to run from a shell). It hides the tip and
  hint cards with injected CSS and declines the focus screen's two prompts (visualizer, then
  timelapse); both must go or the shot shows a dialog. Convert the PNGs to webp with sharp.
- Images pasted into the chat never reach the disk. Ask the owner to save files into the
  folder (the PSD mockups and reference shots live in `apps/site/design`, gitignored).
