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
   `apps/portal/vercel.json`), API on Render (`render.yaml`), data in Neon Postgres, post
   videos and pictures in Cloudflare R2 ([docs/R2.md](docs/R2.md)), domain on Cloudflare. A push to `main` on GitHub (`aleph-bull/doloop`) redeploys both.
   cron-job.org pings `/api/health` every 10 minutes so Render's free plan doesn't sleep.
2. **The always-on copy is gone** (removed 2026-10-21 at the owner's request; they study on
   komogon.app now). It was a frozen build on localhost:5173 and :8787 started at sign-in.
   The owner then deleted its data folder (`~/.komogon/pglite`); only the backups in
   `~/.komogon/backups` remain, and the `pnpm local:*` scripts are still in the repo. Don't
   start it again or offer `local:update` unless the owner asks.
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
- "Continue with Google" for those accounts: our own button (not Google's, which turned into
  "Continue as <name>") opens Google's account popup (Identity Services' token client) and
  gets an access token; `POST /api/auth/google` asks Google's tokeninfo whether it was issued
  to `GOOGLE_SIGNIN_CLIENT_ID` (it still takes the older ID token too), and joins the account
  with that email or starts one. The portal shows the button only when
  `GET /api/auth/google` answers a client id. Try it in
  the `sandbox-google` sandbox (8800/5186; placeholder id, so the popup itself fails).
- Sign-in tries are limited in memory (`services/rate-limit.ts`): failed sign-ins per email
  and per address, sign-ups per address, 429 with Retry-After. Addresses come from
  `TRUST_PROXY_HOPS` (1 on Render); never set `trustProxy: true`, it trusts forged headers.
- Dev sign-in (`DEV_AUTH_SECRET` / `VITE_DEV_AUTH_SECRET`) is local only and must never be
  set on Vercel or Render.
- **"I'm a dev"** (2026-10-21) is different and does run on komogon.app: small grey text on
  the sign-in page takes the shared dev password (the owner has it; the code keeps only its
  scrypt hash, `DEV_PASSWORD_HASH`) and makes a throwaway **Fresh account** or **Jerry** (a
  long-time user with friends, posts, a group and jams, `services/dev-world.ts`). Each lives in
  its own world (`users.dev_world`): dev worlds and real people never see each other, and any
  new Social query that shows other people must use `inWorldOf` / `ownerInWorldOf` /
  `sameWorld` from `services/dev-accounts.ts`. No email, no admin, deleted after a day
  (`dev_expires_at`). Tests: `dev-login.test.ts`. `DEV_LOGIN=off` turns it off. Agents use it
  in a local sandbox run with `AUTH_SECRET`; signing in to the live site is the owner's to do.
- `ADMIN_EMAILS` (the owner) unlocks `/admin`: every account, a JSON download of each one's
  data, and setting a new password. Testers are told on the sign-in page that the owner can
  see accounts and study data. The "don't reuse a password" hint was dropped on 2026-10-24
  (passwords are salted scrypt hashes), and so was the emailed code at sign-up: the account
  is made at once (`requireEmailVerification` is off; the tests still turn it on).
- Admin tools (2026-10-21): each account's Manage dialog adds study time, takes time off or
  deletes a session, restarts onboarding, and suspends or deletes the account; the page also
  has Dev tools (go through onboarding again on your own account) and Blocked emails. A
  suspension is `users.banned_at` plus the address in `blocked_emails`, kept in step
  (`services/moderation.ts`); it is checked where every sign-in token is issued
  (`accountSession`) and on every request (the auth plugin answers 403
  `account_suspended`, and the portal signs out with a message). Suspended accounts are left
  off the leaderboard, the feed and people search. Admins can't be suspended, deleted or
  blocked from there.
- **Usernames** (2026-10-22): every account has a unique @username (`users.username`, stored
  without the @; rules in core `names.ts`: a to z, numbers and `_ - ! .`, no two symbols
  together; names take no symbols). Accounts get two random words when made, and migration
  0033 gave every older account some; the first-time setup opens with "Pick a username" (no
  skip), and older accounts are asked once to change theirs (`UsernameNotice`). A chosen one
  holds for 14 days. DECISIONS.md has the details.
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
- **The changelog** (`apps/site/src/content/changelog.html`, `/changelog/` on the site) is updated
  only when the owner tells you to, never as part of other work. It is written by hand from
  the commits: one entry per day, newest first, in plain words for people using the app, and
  it only ever calls the app Komodon (never Doloop or any older name). The page shows only the
  last three days; never delete older entries, they stay in the file and the sidebar on purpose.
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

**Basic labels, for every feature** (owner, 2026-10-22): "do not explain what the user does
not need to know and text can be simple and incomplete". A label, not a sentence ("Focus 42
min", "Start 9:10 AM", "Nothing yet."); no hints that explain a rule or concept.

**Focus and elapsed** (same day): *focus* is work time only; *elapsed* is focus and breaks
together, never pauses. Label every time shown as one or the other ("focus", "elapsed"),
and never explain the difference on screen.

**Look.**

- Matte and flat: no glossy sheens, glows, or gradients inside panels. Every card on a page
  uses the same surface.
- **Cards keep their content 20px from every edge**: `padding: var(--card-pad)` (the token in
  `packages/ui/tokens.css`, beside the 22px `--radius-lg` corner every card has). Anything
  closer sits inside the rounded corner and looks cramped (the owner, 2026-10-21, on the
  Social cards at 12-14px). Use the token on every new card, dense ones too: a card stays
  dense through smaller pictures and text, never tighter padding. A grid or table that runs
  edge to edge (the calendar, the Tasks table) keeps its text 20px in from the sides and top
  instead. A card's header that might not fit wraps (`flex-wrap`) rather than running past
  the edge.
- **Every card is the same card** (the owner, 2026-10-21: "proper consistency with every
  card"): the 22px corner, exactly `--card-pad` (never roomier either: heroes, empty states
  and banners like the hint included), and the Panels setting's one surface (no lighter
  fill for a locked or quiet card; say that with the text and an icon). Not cards: the
  nav bar, sidebar and settings bar, toasts, menus and dialogs, the focus screen, and the
  sign-in card.
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

- XP amounts appear only on Achievements (and the "+N XP" on ticking a routine, and the
  50 XP asked before another uploaded background is added). Not on Today, Routines,
  Settings, Analytics or the session overlay.
- **The level is lifetime XP's** (`users.xp_earned`, 2026-10-25): earning and taking XP back go
  through `addXp`, which moves the balance and the lifetime total together (a roll's winnings
  count as gained); spending writes the balance only. Every level and level bar reads `xpEarned`, never `xp`, so buying never
  lowers a level. Profiles show the lifetime total beside the level (owner); the balance
  stays on Achievements.
- Analytics shows wins only: never a discouraging or zero-value card.
- Pomodoro lengths have no limits and can change mid-session. Don't add locks or minimums.
- People are compared in two places, both asked for by the owner: the leaderboard (Social ›
  Leaderboard, global or friends, top 10 by focused time) and jams (Social › Jams, a timed
  game people choose to enter). Don't add comparison elsewhere.
- "Pomodoro" is the timer's name; never rename it in the app renames.
- **Internal names still say komogon** on purpose: the `@komogon/*` packages, storage keys
  (`komogon.*`), IndexedDB names, extension message types, the `~/.komogon` data folder, the
  local scripts and the komogon.app domain. Renaming them would drop saved browser state.
  Only the name people see is Komodon.

## Checks and traps

- `pnpm check` runs lint, types, tests, the contrast audit and the build. On this PC run the
  API tests one at a time: `cd apps/api && npx vitest run --maxWorkers=1` (parallel forks
  crash at random; it's not the code).
- After changing the database schema, run `npx drizzle-kit generate --name <what>` in
  `apps/api` and commit the new SQL and snapshot.
- **Never put a JavaScript `Date` inside a hand-written Drizzle `sql` template.** The hosted
  API talks to Neon through postgres.js, and Drizzle switches off postgres.js's date
  conversion, so a raw `Date` there fails the whole query. Tests and sandboxes run on PGlite,
  which takes the `Date` happily, so nothing catches it before komogon.app (it broke the Jams
  tab, found 2026-10-21). Use Drizzle's own comparisons (`gt(jams.endsAt, now)`, `lte`,
  `or`), which convert through the column, or pass `date.toISOString()`.
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
  **That includes a fade.** While anything holding cards fades, they show the photo
  unblurred, and the frost arrives when the fade ends (the owner saw it half a second late on
  every page). Held at its end (`both` or `forwards`), the fade kept every card on
  komogon.app unblurred, with frosted patches wherever something repainted (2026-10-22). So
  pages, Analytics sections and "See all" grids rise in without fading (transform only);
  never animate opacity on something that holds glass. The browser tools can't see any of
  this, because their screenshots repaint the whole page.
- The glass's colour, weight, blur and colour boost are settings (Appearance › Advanced ›
  Glass, `settings.theme.glass*`); the defaults are the owner's pick, 11px blur and no boost.
  Use `--glass-blur` and `--glass-saturate` in new glass, never fixed numbers.
- **Glass panes** (2026-10-23, `packages/ui/src/glass-image.ts`): cards on the photo don't
  blur on every frame; each shows its slice of the photo blurred once, pinned to the window,
  and the real blur comes back while anything moves. New `.panel` and `.glass` cards get it
  by themselves. To keep it working: hold no transform on a card or anything around it after
  an entrance (`backwards`, never `both` or `forwards`); a card under a scroller, filter or
  mask keeps the real blur; and anything that floats over other content must be
  `glass-strong`, positioned or in a dialog, and a sticky card must never have content
  scrolling under it, or it would show the photo instead of what is behind it. Accent buttons
  on such cards get a worked-out colour under their tint (`.btn-primary.pane-under`), which
  copies the glass-mode `.btn-primary` tints: change both together. Check it in
  headless Chrome screenshots: deleting `data-glass-image` from <html> brings the real blur
  back for a side-by-side.
- **The background's own blur** (2026-10-23, Appearance under the background): the photo is
  blurred on a canvas once and kept in Cache Storage (`packages/ui/src/backdrop-cache.ts`),
  with the cards' blurred image beside it; visits and reloads read it from there. While the
  slider moves, the browser blurs it live (`backdrop-tuning.ts`); leaving Appearance blurs it
  for good. Brightness is a flat black or white layer, never baked. Bump `CACHE` in
  backdrop-cache.ts when the way it is blurred changes, or old copies keep showing.
- **Preset themes** (2026-10-22): Settings › Appearance › Themes, from `THEME_PRESETS` in
  `packages/core/src/theme-presets.ts` (Dawn Skies is the default, built from
  `DEFAULT_SETTINGS`; only free backgrounds, tested). **Matte panels on a solid colour are
  shaded from it** (`tonalSurfaces` in contrast.ts, set by `applyUserTheme` as `--tone-*`
  and `data-tonal`, mapped onto the theme tokens in styles.css): new surfaces should use
  the usual tokens (`--ink`, `--matte-fill`, `--glass-solid`, `--accent-text`), which
  follow it, not fixed colours. A flat colour from one of the owner's palettes brings its own
  main text colour (`SOLID_TEXT` in theme-presets.ts, used where it reads). `--tone-*` has one writer, `applyUserTheme`. Theme names
  never use another company's name (owner).
- **The background never picks light or dark** (owner, 2026-10-23). There is no Recommended
  mode any more (0035 gave stored rows the light or dark picked in setup); photo themes keep the mode already chosen,
  and only the flat colours set one. Text straight on a photo is the mode's own (white in
  dark, black in light), and the photo is washed darker or lighter under it (`adaptToPhoto`).
  Don't bring back a switch that follows the photo. An account starts on the light or dark it picks in
  setup (Dark until then or if skipped, never the device's); only a person who picks System
  follows their device (owner, 2026-10-23).
- Sideways overflow is clipped on `#root` (`overflow-x: clip`). Not on html or body: those
  pass it to the window as hidden, which blocks the scroll wheel but still lets
  `scrollIntoView` shift the whole page sideways with no way back.

## Recent changes (2026-10-20)

- Fonts (2026-10-25): Settings › Appearance › Fonts picks the timer, heading and text fonts
  (`theme.fontTimer`/`fontHeading`/`fontText`), each Inter by default, one of the free fonts
  (core `fonts.ts`, files in portal `lib/fonts.ts`) or one they upload. Uploaded fonts stay in
  the browser (`lib/local-fonts.ts`), never sent to the API. They set `--font-timer`,
  `--font-display` and `--font-sans` on <html>: new UI keeps using those variables, never a
  named font, and a big clock uses `--font-timer` with `ClockDigits`. DECISIONS.md has the details.
- Your own backgrounds (2026-10-25): Settings › Appearance › Background has Upload and a
  "Yours" row; the first is free, each one kept beside it 50 XP (asked first). **The pictures
  stay in the browser** (owner: "make sure custom background storage is local"): IndexedDB
  through `lib/local-backgrounds.ts`; the API only records an id and a fingerprint per
  background (`custom_backgrounds`, routes in `routes/assets.ts`) to count and charge. Never
  send the pictures to the API or R2. Another browser shows "Not on this device", and the
  extension can't show them. Uploads from before, kept in `user_assets`, are moved into the
  browser on first sight (`adopt`). DECISIONS.md has the details.
- Jack mode (2026-10-22, slot machine 2026-10-25): an opt-in Pomodoro mode in Settings ›
  Timer where a slot machine after each work block sets the break (0x to 3x of it in tenths,
  1x 30% of the time, average 0.9x), seeded in `timer.jack` so every client spins the same.
  The timer then waits for the lever (`jack.waiting`, ended by the `jack-pull` event, or by
  resume or skip break). The result bursts into coins that fly into the break clock
  (`data-jack-target`), which waits at 0:00 and counts up as they land (`JackSlot.tsx`). Its badges show only to people
  using it, and its die emoji on the profile is the one emoji in the UI, at the owner's
  request. See DECISIONS.md.
- Buying on Achievements (2026-10-25): every purchase there (streak freeze, break day,
  backgrounds, your own rewards) goes through `usePurchase` in `components/Purchase.tsx`,
  which runs the coin show in `components/slot/spend.ts`: XP coins burst out of the total and
  fly into what was bought, and the caches are patched as the last one lands. A new thing to
  buy on that page should use it too (a card selector, a goal inside it, the call, the patch).
  See DECISIONS.md.
- RNG Rolls (2026-10-25): on Achievements below the Shop, 10 XP a roll (×1, ×10 or ×100) spins a
  slot machine for a rarity, 1/2 to 1/32768 (core `rolls.ts`, drawn by `POST /api/rolls`). Each
  rarity has a title and a look that gets louder the rarer (`.roll-fx-*`, `fxLevel`): plain,
  then from 1/32 a flowing gradient, a shine, a glow and a colour cycle. A name wears one by
  choice, from Sapphire up (`settings.rolls.name`, `nameTier` on every person; render names with `named()` from
  `lib/rolls.ts`). Gambling feats and rarities past 1/256 are badges (`rollBadges`,
  `users.roll_stats`). Rolls are held per rarity (`roll_holdings`) and prestige turns five of
  one into one of the next (`POST /api/rolls/prestige`). The machine shares its lever, motion and coins with Jack mode's
  (`components/slot/`): change them there for both. See DECISIONS.md.
- Tags (2026-10-21): tasks carry Notion-style tags (`tags` table, `nodes.tag_ids`, palette
  `TAG_COLORS` in core): a Tags column with a tag menu and a Tags card under the table
  (`components/Tags.tsx`), tags on the dashboard task cards, and a play button on courses.
  There is no colour sort on purpose. See DECISIONS.md.
- Timelapse on phones (2026-10-21): recording on a phone turns the focus screen into the
  camera, and Settings › Timelapse has a Phone and a Computer preset; see "The timelapse"
  below.
- Calendar (2026-10-21): rebuilt from scratch; see "The calendar" below.
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
- Navigation (2026-10-21): the sidebar is the default (since the night of 2026-10-21; the top
  bar was before); Settings › Appearance › Navigation can switch a computer to the top bar (`.sidenav` in AppShell; `.rail` is the dashboard card
  row, not the nav). New pages go in the `links` list (`group: 'more'` puts them under the
  sidebar's divider). The top bar always shows page names; when they don't fit, the tabs
  scroll with an arrow on each side that hides one. With under 480px of room for tabs that
  don't fit, the pages move to the bottom icon bar (`data-tabbar` on html, set in AppShell
  for phones and for a crowded bar); the spacer that keeps the controls right counts as
  zero width in that measurement, or the bottom bar never goes away. The bar's sliding pill
  eases out with no spring. There is no "More" menu on purpose.
- The sidebar (same day, owner's requests): the page stays centred in the window and never
  moves when the sidebar is pinned or collapsed (`.page` margins in sidebar mode). On narrow
  windows it clears the slim sidebar and sits centred beside it; only a pinned sidebar keeps
  the open one's room (2026-10-25). After Collapse is clicked with the pointer on it, the
  sidebar rests shut (`is-resting`) until the pointer leaves. Its streak and level pills
  are sized in `RailStats` from the measured icon and text, so both get the same padding
  on every side (`--stat-streak`, `--stat-shift-a`, `--stat-shift-b`). The owner checks
  this spacing to the pixel.
- Removed the weekly review page. `/analytics/review` redirects to Analytics; the API route
  and the `weekly_reviews` table are still there, unused by the portal.
- Background pickers in Settings open minimized every time ("Show all backgrounds" opens
  them), and so does Themes (2026-10-26, "Show all themes"). Backgrounds use the themes'
  tabs (All, Yours, Minimalist, Nature, Cities, Night, Abstract; `TAB_OF` in
  BackgroundPicker.tsx puts each category under one): a new category needs a tab there.
- Leaderboard tab, onboarding can skip the first task, name placeholder "e.g. John".
- Settings › Pages now has a Dashboard sub-panel with the daily card and "Tips about the app"
  (they used to sit in Pace and streaks).
- The Level pill's hover card opens on hover and keyboard focus only (`:has(:focus-visible)`),
  so it no longer stays open after a click.

## First-time setup (2026-10-22)

New accounts go through three parts, each skippable on its own (never all at once): the
questions on `/onboarding` (`pages/Onboarding.tsx`), then a look around the app and the
timelapse in Settings (`components/onboarding/Tour.tsx`, stage kept in `lib/tour.ts`), then
"All done". The answers are for the owner only (`onboarding_answers`, Admin › Onboarding
answers); never show them in the app. The two looks offered first map to preset themes in
`lib/onboarding-looks.ts` (the owner's picks; dark is its own theme where the owner chose
one). A new nav page that should be in the look around goes in `STOPS` in Tour.tsx.
DECISIONS.md has the details.

## On a phone (2026-10-22)

The phone layout is designed for the phone, not the computer's shrunk; DECISIONS.md has the
reasons. What to keep doing:

- **Dialogs**: a question or short form is a sheet from the bottom (the default); a form with
  more than a few fields passes `phone="full"` to `Modal` and becomes a screen of its own
  (title bar with close, actions pinned at the bottom, sized above the keyboard). Phone width
  is `NARROW_QUERY` (560px) in `lib/media.ts`, the same as the sheets' CSS. A dialog's own
  `max-width` goes inside `@media (min-width: 561px)`, or the phone sheet comes out narrower
  than the screen, flush left.
- **No keyboard before a tap**: never focus a text field on open on a touch screen (`Modal`
  already doesn't). Fields are at least 16px on touch screens, or iOS zooms the page in.
- **Starting a session** on a phone is its own screen with a pushed picker
  (`StartSessionDialog`'s phone branch, `SubjectPages`); the computer keeps the card.
- **The nav** shows a tap at once (`useNavTarget` in AppShell), because navigations are
  transitions; the pages it links to load through `lib/page-loaders.ts`, so they can be
  warmed up. A new nav page gets a loader there.
- **The focus screen** on a phone opens in the same tab (`openFocusTab` returns `'here'`), and
  whether it is the camera is settled before the first paint. While it rests, `FocusWake`
  takes the first tap (so it can't hit Stop) and, while recording, dims by the preset's
  `dim`. The camera screen is a grid inside the safe area; its picture can be made small
  (`komogon.focus.camera`) without stopping the camera.
- **The bar** (2026-10-22): Home, Tasks, Start, Social and You (`phoneTabs` in AppShell), with
  Start a round button in the middle. The other pages live inside Tasks (Calendar, Routines,
  Plans) and You (your profile, Stats, Grades, Settings; Achievements through the Level pill),
  switched by a row of pills at the top of the page (`PhoneSwitcher`). A new page goes in
  `PHONE_TASKS` or `PHONE_YOU` as well as `links`. A phone held sideways is still a phone
  (`PHONE_QUERY` in `lib/media.ts`: touch and under 600px tall), so it never gets the sidebar.
- **Safe areas**: the page is `viewport-fit=cover`, so anything fixed to an edge keeps to
  `env(safe-area-inset-*)`.
- **Social** (2026-10-22, the owner asked for it like the photo-sharing apps): friends, the
  title and the bell across the top, the views as plain words, Live now as a row of ringed
  pictures, and posts straight on the page (no card), the picture or video big under the head. The
  phone styles are the last block of `social.css`; posts keep the computer's markup, so change
  a phone post in CSS. Your card and the friends card aren't on a phone's feed: the friends
  button opens the friends card in a sheet. The whole page sits on one big card
  (2026-10-23): the Backdrop's `sheet` (`.backdrop-sheet`, turned on by AppShell), the
  cards' blurred photo and colour over the window, fading in and out with the page, with
  card text (`.social-page`) and the cards on it a step lighter or darker. Tapping a post
  (or its comments button) opens it on a screen of its own with every comment and the box
  pinned at the bottom (2026-10-25, `PostSheet`); the computer keeps comments under the post.

## Streaks: how they work (weekly streak added 2026-10-21)

There are two streaks, a daily one and a weekly one, and both count the same thing: **streak
days**. All the logic is in `packages/core/src/streak.ts`; the API only loads and saves.

- **A streak day** is a day with at least one finished session of
  `settings.streak.minMinutes` of work (default 15), credited to the day the session started.
  The day begins at `settings.streak.dayStartHour` (0 to 8, default 4), so 1:30am still counts
  for the night before (`streakDay`, `qualifyingDays`). The server lets that hour change
  once a day, so it can't be moved around to save a streak. Calendar and analytics keep
  midnight; only the streaks use the day start.
- **Daily streak** (`evaluateStreak`): streak days in a row. A missed day spends a streak
  freeze if one is held (bought in the shop), otherwise the streak resets. Today stays open
  until it ends, so a quiet morning never shows a broken streak. Milestones (7, 14, 30, 60,
  100) feed the end-of-session line and confetti.
- **Weekly streak** (`evaluateWeekStreak`): Monday-to-Sunday weeks in a row with at least
  `settings.streak.daysPerWeek` streak days (1 to 7, default 1, "Days a week for the weekly
  streak" in Settings › Pace and streaks). A week counts the moment it reaches its days; the
  current week stays open until Sunday ends; a week that ends short resets the run. Freezes
  are the daily streak's only. No milestones or banners for weeks.
- **Rest days don't protect either streak** (owner's choice, 2026-10-21, over removing rest
  days altogether). Weekly rest days, vacations and break days still shape the daily plan and
  pace (`pace.ts`, `scheduler.ts`), but a quiet rest day is missed like any other, and a
  week of vacation ends the weekly streak. So shop break days now only give the plan a day
  off. Don't bring back rest-day protection, or copy that promises it, without asking.
- **Stored, not recomputed.** Both live in the `users.streak` jsonb (`StreakState`):
  `current`, `longest`, `lastCountedDate`, `freezesHeld`, `breakDaysHeld`, and `weeks`
  (`current`, `longest`, `lastCountedWeek`, a Monday). There is no table of days.
  `syncStreak` (`apps/api/src/services/users.ts`) brings them up to date lazily: on every
  `/api/me` read, the analytics, recap and shop routes, and at session end. It loads finished
  sessions from the earlier of the last judged day and the first unjudged week (two days
  earlier for time zones), judges every day and week since, and writes only when something
  changed. `lastCountedDate` and `lastCountedWeek` move past every judged day or week
  (counted, frozen or reset), so running it twice changes nothing.
- **Old rows.** A streak saved before 2026-10-21 has no `weeks`. The first sync reads every
  session once and works the weekly streak and its best out of the whole history. That is why
  `weeks` is optional in the type: read it with `weekStreakNumbers()` in the API, and with
  `?.` / `?? 0` in the portal, whose offline query cache (IndexedDB, `lib/persist.ts`) can
  hand back a response from before.
- **A session that doesn't count** (2026-10-25, "Don't count this session" at the end of
  the summary): `sessions.counted` false. It adds no streak day, hours or XP; everything that
  totals time must read counted sessions only (`loadCompletedSessions`, or
  `eq(sessions.counted, true)` beside `isNotNull(sessions.endedAt)` in a new query). The
  streak is wound back from the copy each session keeps of it from just before it ended
  (`streak_before`, `rewindStreak` in services/users.ts) and judged again, so keep writing
  `streakBefore` in `finalize`.
- **Settings changes** (minimum minutes, days per week) apply to days and weeks not yet
  judged. What already counted stays counted.
- **Events.** Only the daily streak's freeze uses and resets are logged (`streak_events`),
  and `describeStreakEvents` turns them into the dashboard banner. Weekly resets are silent.
- **Where they show:** the top bar flame and the sidebar pill (the day count; the tooltip
  names both), the dashboard's numbers (Daily streak beside Weekly streak), the Analytics
  "Streaks and consistency" card (flame, then a calendar badge once there has been a counted
  week), the end-of-session summary (weekly only when above zero) and the profile. The
  leaderboard, Compare and groups use the daily streak only.
- **Tests:** `packages/core/src/streak.test.ts` (both evaluators) and
  `apps/api/src/test/weekly-streak.test.ts` (through the API, with a moving clock).

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
  joined, friend count, and a running daily streak as a flame badge on the picture's corner), then three panels
  (the day grid, strongest days, totals in one row: the weekly streak tile, then the figures,
  with the level bar under the title), then the person's posts at exactly the feed's width
  with their top four badges and the "Peak study hours" clock in a column beside them (the
  side column is the feed's two side columns wide, so keep the two in step). On someone else's profile the `FriendButton` sits in the head: Add friend,
  Requested (click takes it back), Accept and Decline, or a Friends chip that opens a small
  card with "Friends since <date>" and a Remove friend that asks "Are you sure?" first.
- Everything under `components/social/`: `Feed.tsx` (the three-column layout),
  `FeedSide.tsx` (your card, the friends card, the small leaderboard), `Composer.tsx`,
  `PostCard.tsx`, `GroupsTab.tsx`, `JamsTab.tsx`, `LeaderboardTab.tsx`,
  `CompareBento.tsx`, `DayLines.tsx` (the shared running-total line chart),
  `FriendButton.tsx`, `Avatar.tsx`. The dashboard's `components/NudgesCard.tsx` shows
  nudges in both dashboard layouts. Styles are all in `apps/portal/src/social.css`,
  imported from `index.css`.
- **The bell** (2026-10-22): the third figure on your card beside the feed (`NotificationsBell`
  in `components/social/Notifications.tsx`) opens kudos, comments and nudges in BeReal's
  layout (`GET /api/social/notifications`, `routes/notifications.ts`), and @mentions in comments on other people's posts; new means after
  `users.notifications_seen_at`, set on opening. Its dialog is portalled to the body: a
  dialog rendered inside a card's text inherits that text's styles. Rows link to
  `/profile#post-<id>` (`-comments` opens them), which `PostCard`'s `focus` scrolls to.
- **Browser notifications** (2026-10-25): the bell's four kinds also pop up through Web Push,
  sent by `services/push.ts` (own RFC 8291 encryption and VAPID on Node's crypto, keys from
  the API's secret: nothing to configure) from the like, comment and nudge routes via
  `app.push.notify`; a new kind that should pop up goes through it too, with its words in
  `pushMessages` matching the bell's line. Shown by `public/push-sw.js` (its own worker at
  scope `/push/`, every host, never caches; silent while an app window is in front).
  On or off is per browser (`lib/push.ts`, a push subscription in `push_subscriptions`); which
  kinds is `settings.notifications`. Social asks once (`NotificationsAsk`), Settings ›
  Notifications switches. Real pushes need a real Chrome profile: Playwright's
  `browser.newContext()` is incognito, where Chrome has no Push API, so use
  `launchPersistentContext`; headless Chrome shows notifications but never lists them.
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
dense: 40px pictures on posts and the composer, 26px in lists, 14px text. The owner called
the first version "massive"; don't let it grow back. Padding is not where density comes from:
every card has the standard 20px (`--card-pad`, see the Look rules), since 12-16px crowded
the rounded corners. The small leaderboard also has more room between its rows.

**After a session** (2026-10-25): closing the summary goes to Social with that session
picked in the post box (`/social?post=<id>`, read and dropped by `Composer.tsx`), on by
default (`settings.review.openSocial`, Settings › Timer › After each session), only while the
session is still postable (`useSocialAfterSession` in `lib/after-session.ts`). A focus screen
in its own tab sends the tab that opened it there and closes (`sendOpenerTo` /
`useOpenerRequests` in `lib/focus-tab.ts`). The button that posts from the timelapse's Share
to Social preview says "Social" (owner); the feed's composer still says Post.

**Posts.** A post is always about one finished session (`sessionId` is required, the
composer's Post button waits for one) and carries the session's minutes and what it was on,
"Course · Task" (root course and the task itself, never the units between; `focusLabel`),
as they were when shared (`posts.minutes`, `posts.subject`), the session's start and end
(`posts.started_at`, `ended_at`, small at the end of the session row) and, when the post
asks for it, the time elapsed (`posts.elapsed_minutes`, focus and breaks; the composer's
"Elapsed" chip, `showElapsed`), optionally a line of text
(500 characters) and up to four files, one video (MP4/WebM up to 40 MB, with a JPEG poster the
portal makes from a frame) and three pictures (JPEG/PNG/WebP up to 2 MB each), shown as a
carousel (2026-10-22: `post_media.position`, `files` on the post, `?n=` on the file routes;
`media` stays as the first file for older portals). A post can be **friends only**
(`posts.friends_only`, on top of Settings › Social); every query that shows posts must check
it. **Only a session that ended in the last 7 days and has no post yet can be posted**
(`GET /api/social/postable`); never explain that rule on screen (owner). **The files live in Cloudflare
R2** when the API has the `R2_*` variables (2026-10-21; how it works and how to set it up:
[docs/R2.md](docs/R2.md)): the browser uploads through a signed link and plays from one, so
the bytes never pass through Render. Uploads are capped at 250 MB a day per account and stop
for everyone once the bucket holds 10 GB (`services/upload-quota.ts`, see docs/R2.md); any new
way of putting files in R2 must go through the same quota. Without R2, and for posts made before it, the bytes are
in `post_media.data` as base64 (videos capped at 5 MB) and the portal fetches them with the
token into a blob URL. `GET /api/social/uploads` tells the portal which applies. A file over
the limit is not refused: the composer and "Share to Social" offer to compress it in the
browser (`lib/compress.ts`, mediabunny). Files follow the feed's visibility rule, and go
when their post or account does. The focus screen's timelapse export has "Share to Social",
which posts the video with the session attached. Kudos are the like routes relabelled (`post_likes`, one per person; the button is the thumbs-up and count, no word); comments are
`post_comments` (500 characters, deletable by their author or the post's author). There are no threads: Reply on a comment puts "@username " in the box, and an @username in a comment tells that person under the bell (2026-10-25, `comment_mentions`, matched by `findMentions` in core `names.ts`, only people who can see the post). Only the
author edits a post (the words only, `PATCH /api/posts/:id`), trims its video (2026-10-23: Trim video, `TrimVideo.tsx`; the browser cuts it with mediabunny, `lib/video-cut.ts`, and `PUT /api/posts/:id/video` swaps the file and poster) or deletes it, from the ⋯ under it.
A post also shows what its session earned: one award naming the session's badges on hover
(`sessions.badges_awarded`) and the daily streak when it ended (`sessions.streak`, kept since
0034), only when the author shares study stats, like the profile. Counts come with every post; liking patches the caches rather than
refetching (`patchPost` in queries.ts).

**Friends.** `friendships` holds one row per pair with `status` pending or accepted;
declining deletes the row so the same person can be asked again, and asking someone who
already asked you is the same as accepting. The friends card beside the feed: search by name
(`GET /api/social/people?q=`), the friends list (each with a nudge bell and a remove), then
"Friend requests" split into Inbound (the first three, the rest fading behind "Show all") and
Outgoing (folded until opened). The API refuses a request to someone who turned requests off.

**Sharing settings (Settings › Account › Social, `settings.social`).** Who sees your posts
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

**Studying now (2026-10-21).** Friends in a session show on the feed ("Live now" above the
composer, `components/social/LiveNow.tsx`, shared with the Groups tab), first in the friends
card with a dot and "Studying · 24 min", and as a pill on their profile. `GET
/api/social/live` (in `routes/groups.ts`, beside `liveAmong`) and the profile's `live` field
carry them; each has `state` (`focus`, `break`, `paused`). Settings › Account › Social › "Show friends
when I'm studying" (`settings.social.live`) hides you from friends everywhere except your
groups' own cards (`sharingLive`). "Live" means `last_seen_at` within ten minutes; the
session view refreshes it once a minute (`SEEN_EVERY_MS` in `services/sessions.ts`) because
an open-ended timer never changes and so was never saved, and `useActiveSession` keeps
polling from a background tab while a session runs. Tests: `live.test.ts`.

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

## The timelapse (built 2026-10-21): why it can't use the iPhone's camera, and the phone's camera screen

The owner asked for this in one long chat that was then deleted; this section is the record.
The decisions, in order, are in DECISIONS.md under the three "Timelapse" sections of
2026-10-21.

**The files.**
- `packages/core/src/timelapse.ts`: pacing, thinning, the plan from stills to frames,
  deflicker, size estimates, `trimIndices`. Tests beside it.
- `packages/core/src/timelapse-layout.ts`: the layout model (pieces, boxes, shapes,
  defaults, `normalizeTimelapseLayout`, `alignBox`, `fitBoxToRatio`). Tests beside it.
- `apps/portal/src/lib/timelapse.ts`: `useTimelapseRecorder` (camera and screen capture)
  and `renderTimelapse` (stills to MP4).
- `apps/portal/src/lib/timelapse-compose.ts`: `composeFrame`, which draws one frame. The
  video and the settings preview both use it, so the preview is exactly what comes out.
- `apps/portal/src/components/focus/TimelapseLayoutEditor.tsx`: the editor in Settings ›
  Timelapse.
- `apps/portal/src/components/focus/Timelapse.tsx`: the two questions, the recording pill,
  the recording settings, and the "Your timelapse" export card with trim.
- `apps/portal/src/pages/Focus.tsx`: wires it together (when to ask, the task name, the
  screen answer for the session, phone or computer, the camera screen).
- `apps/portal/src/components/focus/PhoneCamera.tsx`: the phone's camera screen.
  `TimelapseTrim.tsx`: the Photos-style trim, on a phone and a computer.
  `TimelapsePresets.tsx`: the two folded presets in Settings › Timelapse.
- `packages/core/src/timelapse-presets.ts`: phone or computer, upright or sideways
  (`timelapseLook`, `phoneAspectRatio`, the phone's shapes and defaults). Tests beside it.
- `apps/portal/src/lib/device.ts`: `isPhone`, `isUpright`, `useWakeLock`.
- Settings live in `settings.timelapse` (the computer's preset, plus `record`, which both
  share) and `settings.timelapsePhone` (the phone's) (`packages/core/src/types.ts`, defaults
  in `defaults.ts`, API schema in `apps/api/src/validation.ts`).

**Recording.**
- On the focus screen, `useTimelapseRecorder` takes JPEG stills from the camera (960 px
  wide), plus a shared screen (1280 px wide, `getDisplayMedia`) when the person said yes to
  it this session. It takes them during focus only, unless "Record breaks too" is on. The
  stills stay in the tab's memory: nothing is uploaded, and closing the tab loses them (the
  focus screen asks before it closes with unsaved stills).
- Each still carries the session's focused time, break time, running time, the time of day,
  and the task name as the focus screen shows it ("Course · Task").
- Pacing works like a phone timelapse. Auto mode starts at one still every 0.5 s. Each time
  the stills reach twice the target (600), every other one is dropped and the interval
  doubles, so a session of any length ends up as a video of about 20-40 s. "Set length" and
  "Speed" modes exist too.
- **When it asks.** `timelapse.record` is ask / always / never. With ask, "Record a
  timelapse?" opens once per session. Then, whenever a recording starts in a session, "Record
  your screen this time?" opens (Record my screen / Just the camera). That answer lasts for
  the session only; there is no saved screen setting, on purpose (the owner wants to be asked
  every time). The browser's screen picker needs a click, so the Yes button calls
  `recorder.requestScreen()` inside the click. A recording that started on its own and
  missed the click shows "Share screen" in the recording pill instead, which also picks a
  share back up after it is stopped from the browser's bar.
- Saying no to the screen leaves the full camera picture: when a still has no screen image,
  nothing is drawn in the screen's box. There is never a black space for it.
- **Live clip** (2026-10-22): while recording, a button on the recording pill (L on a
  computer, a pill on the phone's camera screen) films the camera at full speed, up to 30
  frames a second, for up to 30 s a clip and 60 s a recording, and the video plays that part
  at real speed. Clip frames are stills with `clip` set, never thinned; `planTimelapse`
  takes `liveMarks(stills)` and slots each clip in where it was filmed. The why and the
  details are in DECISIONS.md, "Live clip".

**The layout (Settings › Timelapse, `/settings#timelapse`).**
- **Two presets, Phone and Computer**, each folded until clicked (`/settings#timelapse-phone`
  or `#timelapse-computer` opens one); the device's own comes first, marked "This device".
  Each holds its own layout, shape, length, fps, breaks, smoothing and deflicker; "When a
  session starts" sits above them and is shared. A recording follows the preset of the
  device it is made on (`presetOf` in `Timelapse.tsx`; `presetPatch` saves to the right
  group). The phone's has an Upright and a Sideways layout, switched in its editor and saved
  together; it never has a screen, and its shapes are the camera's, 9:16, 4:5, 1:1 upright
  and the camera's, 16:9, 4:3, 1:1 sideways (the API refuses others). The editor takes a list
  of `LayoutTarget`s (one per layout) and one Save writes every changed one.
- The **camera is a fixed backdrop**: it always fills the whole frame and can't be moved,
  resized or removed (the owner was emphatic). It has no box in the editor. Stored layouts
  are mended to a full-frame camera by `normalizeTimelapseLayout`.
- On top sit the **screen**, **current time**, **focus time** (the piece's id is still
  `elapsed`; it draws "Focus 42:17", "Break 3:10"), **time elapsed** (`total`, "Elapsed
  51:02": focus and breaks), **start time** and **end time** (`start`, `end`: the
  session's, "Start 9:10 AM"; until it ends, the end is the last still), **task name**,
  **progress bar** (fills as the video plays through the session) and the **Komodon mark**
  (can't be removed). The time elapsed, start and end start out of the layout, as chips to
  add (2026-10-22); the looks leave them where they are. Each is a box in fractions of the frame (0-1), so one layout fits any size.
- The editor's boxes are **exactly** the drawn pieces: `composeFrame` returns where it drew
  each one, and the boxes come from that. Text pieces are placed by their top left and sized
  by their height; their width is the text's. Resizing from a corner keeps the shape of the
  screen, the texts and the mark; the progress bar stretches freely. There is **no
  snapping** (removed at the owner's request).
- **Line up:** the chosen piece has Left, Centre and Right buttons (4% in from the edge).
  Text pieces store that side as `align`, so a real task name longer than the preview's
  grows away from it (a right-aligned name grows leftwards), and a piece that would run off
  the frame is pushed back in.
- **Add back:** removed pieces wait as chips under the preview. The screen starts there.
- **Shape:** Match camera (the default), Match screen, 16:9, 9:16, 1:1, 4:5, 4:3. The video
  is 1280 px on its long side at full size (see Resolution below). The camera's and screen's
  shapes are remembered in localStorage (`komogon.timelapse.cameraRatio` / `screenRatio`;
  the camera's size too, `cameraWidth` / `cameraHeight`); the screen falls back to
  the monitor's shape (`window.screen`), which needs no permission. The screen box keeps the
  screen's shape, refits when the video's shape changes, and has "Fit the screen to its
  shape". A layout still at a shape's starting places moves to the new shape's defaults; an
  arranged one stays, and "Reset the layout" starts over.
- **Save and Revert:** nothing in the editor saves until Save. A toast-style bubble stays at
  the bottom of the window after the first change, with Revert and Save, and closing the tab
  with changes asks first. On Save each text piece is stored exactly where it was drawn. The
  recording settings below the editor (length, fps, breaks, smooth, deflicker) still save
  on change.
- **How each piece is drawn** (2026-10-25): every text piece has a `pill` (dark, solid
  "Colour", outline, none), a `font` (sans, geometric = Satoshi, mono, serif) and a
  `color` (white, gold, mint, sky, rose, lilac); the progress bar has a colour only and the
  mark none. They sit on the layout box, absent meaning dark / sans / white, and only what
  differs is stored (`clampBox`, `restyleBox`, `pieceStyle` in core). The editor shows
  them under the chosen piece's line-up buttons (`PieceLook`). `composeFrame` draws a
  clock's label and time-of-day ending smaller than its number, on one baseline, and
  measures a clock's digits as zeros so its pill keeps one width as the time runs. Set per
  piece: the owner said not to make things global.
- **Story / Reel on a computer** (2026-10-25): `settings.timelapse.storyLayout` is a second,
  9:16 layout (starts as `defaultStoryLayout()`, the Story look) and `timelapse.format`
  ('normal' | 'story') which one a video is made with. The editor's computer targets are
  Normal and Story / Reel (a "Video" switch above it; a story has no Shape field). The
  "Your timelapse" card's Video switch (`FormatChoice`) saves the format and remakes a made
  video; `timelapseLook(settings, 'computer', o, format)` gives the story's aspect and
  layout. Phones are unchanged: they already have upright and sideways.
- `showTimer` / `showClockTime` are old switches kept in the type only so a row saved
  before the layout existed seeds the two clock pieces.

**Making the video.**
- The "Your timelapse" card (end-of-session screen and the focus screen's controls) shows
  the stills, a **Trim** (`TimelapseTrim`, the same on a phone and a computer: a viewer, a
  strip of stills with a handle at each end, a playhead and play; "Keep it all" to undo),
  the length settings, the text on the video (once the recording has stopped), then Make
  the video.
- **Resolution and compression** (2026-10-22, `timelapse-output.ts` in core): a
  Resolution slider (percent of full size, `resolution` on each preset) sits under frames
  per second, on the card and in Settings, and the made video shows its size and weight
  under it. The slider stops at a floor it never explains (owner's rule): 360 px on the
  short side and 640 on the long, lowered to the camera's own size when the remembered
  camera records smaller (`minTimelapseResolution`). The render clamps the same way. Every
  video is encoded compressed in one pass at `timelapseBitrate` for its size (2.5 Mbps at
  1280 × 720 and 30 fps, was 8 Mbps), rather than made big and re-encoded after.
- The trim is held in session seconds, not still indices, because thinning halves the
  stills while recording; an end never moved follows the recording as it grows. The viewer
  keeps its decoded stills by still for the same reason.
- `renderTimelapse` blends the stills behind each frame for the camera and the screen
  separately (smooth motion, deflicker on the camera only), then `composeFrame` lays out
  the frame. The mark is black or white, picked from the brightness behind it on frame 30.
  Where the browser has WebCodecs, frames are encoded to an H.264 MP4 with `mp4-muxer`;
  elsewhere MediaRecorder records the canvas in real time; both at `timelapseBitrate`. The person can download it,
  "Share to Social" (`lib/post-media.ts`; the poster is the middle kept still), or post it
  on Instagram, TikTok or X (2026-10-22, `postTo`): on a phone or tablet the share sheet
  carries the video to the app (a phone that can't share files downloads it and opens the
  app by its link, `appLink`); on a computer it downloads and the site's upload page opens
  in a new tab. **A video downloads once** (`downloadOnce`): whichever of Save, Instagram,
  TikTok and X asks first downloads it, and the rest say it's already in the downloads.
  Nothing is posted through the sites' APIs. The why and the checks (WebM, X's 2 min 20 s)
  are in DECISIONS.md, "Posting the timelapse on Instagram, TikTok and X" and "One
  download, and the apps on a phone".
- **Posting it in few steps** (2026-10-25): after a finished session the card has "Share to
  Social" before the video is made too (makes it, then opens the preview). Closing the
  summary for Social takes the made video along into the post box with the session picked:
  `onVideo` on `TimelapseExport` keeps the file in Focus.tsx, `handTimelapse` /
  `takeTimelapse` (`lib/after-session.ts`) carry it within a tab, and `sendOpenerTo(path,
  file)` posts it to the tab that opened the focus screen (AppShell hands it over).
- **Share to Social is previewed first** (`PostPreview.tsx`): the post as the feed shows it,
  with a line to say, a "Show time" switch (`showTime: false` posts no minutes, task or
  times) and a "Time elapsed" switch (`showElapsed`).
  The text box must stay quick: the post beside it follows a deferred copy of the text in a
  memoised card, and its video doesn't play until pressed. Instagram, TikTok and X have **no
  preview** (owner, 2026-10-22): their buttons go straight to the app or site, where the post
  is written. **Your text** (the layout's `note` piece) is the person's own line on the
  video the whole way through, like the clocks; empty, it's left out. It is written after
  the session, on the card and in "Change layout?", and belongs to that one video (owner,
  2026-10-22): the presets' `noteText` is kept but no longer used. There is no end card
  (built, then removed the same day). **Looks**
  (`timelapse-styles.ts`: Classic, Minimal, Big timer, Headline, Story, Mono, Corner, Clean)
  place the pieces for any shape and say how the texts are drawn (their pill and font, also
  for the time elapsed, start and end they leave in place); `matchTimelapseStyle` reads a
  saved layout back as its look, pills and fonts included. **"Change
  layout?"** beside a made video opens the layout editor in a dialog over a moment of that
  video (`RelayoutDialog.tsx`; not the Settings page, which would drop the stills) and
  remakes the video with what was saved. DECISIONS.md has both 2026-10-22 timelapse
  sections.

**Links.** The focus screen's controls, the "Record a timelapse?" question ("Change what it
looks like"), the screen question and the export card link to `/settings#timelapse`. From
the focus screen they open in a **new tab**, because leaving the focus screen drops the
stills; the setting reaches the focus tab when it is looked at again (TanStack Query
refetches on focus). Settings › Focus screen keeps a one-line link to the Timelapse group.

**Testing it.**
- The Claude browser pane blocks the camera and the screen picker, so a real recording and a
  real share can't be tested there; the owner has to try those. Everything else can be: the
  editor works in the preview, and `renderTimelapse` can be run from the page with fake
  stills made from the background photos (`fetch('/backgrounds/<id>.webp')` gives real
  image blobs; encoding blobs on a canvas in a hidden pane stalls).
- A sandbox API runs the code it loaded at start: restart it after changing
  `validation.ts`, or saves of new layout fields come back 400.
- The editor redraws on a canvas; to read where boxes are, measure `.tl-box` elements
  against `.tl-stage` with JavaScript rather than trusting a screenshot.

- **The iPhone camera (owner's question, 2026-10-21).** On a phone, can the site use the
  iPhone's own camera and Time-Lapse mode instead of ours? No:
  - A web page reaches the iPhone camera only through a file input with `capture`. iOS offers
    Photo and Video there, never Time-Lapse, and no link opens the Camera app in Time-Lapse.
  - Plain Video mode is no substitute. The camera covers the timer, and an hour of footage
    (3-4 GB) is too much for Safari to turn into a timelapse.
  - What would work is an import: the person films with the Camera app's Time-Lapse, then
    picks the video from Photos after the session, and Komodon adds the mark. A running clock
    can't line up with the study time, because the Camera app can't pause for breaks and
    chooses its own speed.
- **So a phone gets Komodon's own camera screen instead** (built 2026-10-21, the owner's
  choices in DECISIONS.md, "The phone's camera screen"). A phone is a touch screen whose
  short side is under 600 px (`isPhone`, read once). On a phone, recording is the camera
  screen; without a recording it is the normal focus screen.
  - `FocusSession` (in Focus.tsx) renders `PhoneCamera` instead of its clock when given
    `camera`, so the same session controller (and its dialogs) runs either way and turning
    the recording on or off never touches the timer.
  - The live camera fills the screen (`.pcam`, fixed, z-index 55: toasts at 60 and dialogs
    stay above it). On it: a pill saying what is happening (Recording, Not filming the break,
    Paused, The camera stopped), swap camera and stop recording top right, then the phase,
    timer and task, then hide the clock, a big round pause/resume and stop the session.
    Skip break and +15 min show above them when they apply. Controls fade with stillness like
    the focus screen; the pill stays. Light text always, whatever the theme.
  - **Horizontal or vertical** (2026-10-23, owner's words): before the camera opens, a sheet
    asks "Record horizontally or vertically?" (`OrientationPrompt`, once a session, also when
    recording is switched on from the controls), with a "Remember my decision" switch that
    saves the answer to `timelapsePhone.orientation` ('ask', 'upright', 'sideways'; Settings
    › Timelapse › Phone, "Horizontal or vertical", puts it back to Ask). Closing the sheet
    records nothing. Focus.tsx holds the answer per session (`picked`), and the camera and
    recorder wait for it (`recording` = asked to record and, on a phone, a direction known).
  - **It turns with the phone** by CSS alone (`@media (orientation: landscape)`): sideways,
    the controls run down the right side and the timer sits bottom left. The video keeps the
    direction picked whichever way the phone is held: `TimelapseExport` takes `orientation`
    for the upright or sideways layout (`timelapseLook`) and puts it on the look, so the
    render and the trim turn the camera's shape to match (`lookRatio`) and the blend buffer
    is turned too (`blendBuffer`); a still the other way round is cropped to the middle by
    `fillBuffer` rather than squashed. Without a picked direction (older code paths), the
    first kept still's `portrait` decides as before. Held the other way from the pick, the
    camera screen says "Turn your phone sideways." (or upright) once.
  - **Dimming:** `.pcam-dim` (40% black) while the phase is `work`, off for breaks and
    pauses. It is a layer over the preview only; stills come from the camera track.
  - **Breaks** always show; the phone preset's `recordBreaks` decides whether they're filmed.
  - **Cameras:** front by default, `facing` passed to `useTimelapseRecorder` (changing it
    swaps the camera), remembered in `komogon.timelapse.facing`; the swap button shows when
    `enumerateDevices` lists two cameras (re-checked once the camera is on, since phones list
    them all only after permission). The front preview is mirrored, the back one isn't.
  - **Staying alive:** `useWakeLock` holds the screen on while the camera screen records. The
    recorder watches the camera track: `ended` sets status `'ended'` (a note offers to start
    it again, and it restarts when the page becomes visible), `mute` stops stills until
    `unmute`. `restartCamera()` starts it again.
  - Phones never get the screen question (iPhones have no `getDisplayMedia` anyway).
  - **After the session**, `TimelapseExport` shows `TimelapseTrim`: a viewer drawn with
    `composeFrame` (no blending, so playing is quick), stills in a strip (nine on a phone; on
    a computer, `wide`, as many as fit at the camera's shape), a handle at each end, a
    playhead, play. "Save the video" opens the share sheet on a phone or tablet (where "Save
    Video" goes to Photos) and falls back to a download.
- **Not built.** Importing an Apple Time-Lapse from Photos is still in `docs/IDEAS.md`.
- **Testing the camera screen in the preview.** The pane has no camera, so give it one before
  the recording starts: replace `navigator.mediaDevices.getUserMedia` with a function that
  returns `canvas.captureStream(10)` of a canvas redrawn on a `setInterval` (draw it 720×1280
  to act as an upright phone), and `enumerateDevices` with two `videoinput`s for the swap
  button. Do it on the dashboard and start with its Timelapse switch on: that navigates to
  `/focus` in the same tab, so the replacement survives. Use the mobile preset (it emulates a
  coarse pointer and a 375 px screen, so `isPhone` is true); a custom size wider than 768 px
  is not a phone. Media-query `change` events (turning the phone) fire only when a
  screenshot is taken, so take one before checking for the turn toast.

## The calendar (`/calendar`, rebuilt 2026-10-21)

The owner called the old page "a mess, ugly and useless" and asked for the best calendar we
could make. Asked first, they chose: a **week planner** and a **deadline overview** (they turned
down a running-app "training log"); **finished sessions, rest days and study-plan topics** on it
(not routines); and every way of planning offered: **drag to move and resize, Plan my week,
start from a block, a one-day view on phones**. They disliked all of the old page: useless,
an ugly grid, a cluttered header, and the "Planned vs needed" list (now gone). The decisions
are in DECISIONS.md under "The calendar, rebuilt".

### Files

- `apps/portal/src/pages/Calendar.tsx`: the page. Reads the view and date from the address,
  loads the data, works out the To plan list and Plan my week, and owns every dialog (plan a
  block, start a session, edit a task). Also the phone's day strip (`DayStrip`).
- `apps/portal/src/components/calendar/TimeGrid.tsx`: the time grid for a week (7 columns) or
  a phone's day (1 column). Draws the day names, the "Due" row, hours, blocks, busy bands, the
  now line, and handles every drag on the grid. Exposes `hit(x, y)` through a ref so the page
  can drop To plan items onto it. Also exports `DueChip`.
- `components/calendar/MonthGrid.tsx`: the month. `SidePanels.tsx`: `PlanTray` (To plan, beside
  the week) and `DueList` (Due this month, beside the month). `calendar.css`: all the styles
  (imported by the page; the old `.cal-block` and `.plan-row` rules were removed from index.css).
- `apps/portal/src/lib/calendar.ts`: pure helpers. Time maths (`isoAt`, `minutesOf`, both
  wall-clock and DST-safe), labels (`periodLabel`, `timeRange`, `hourLabel`), `buildItems` (what
  sits in each day column), `deadlinesByDay`, `restByDay`, `totals`, `minutesByDay`, and
  `trayItems` (the To plan maths).
- `packages/core/src/week-planner.ts`: `planWeek` (Plan my week) and `layoutLanes` (side-by-side
  overlap layout). Tested in `week-planner.test.ts`.
- `lib/queries.ts`: `useBlocks` and `useBusy` keep the previous range on screen
  (`placeholderData: keepPreviousData`) so changing week doesn't flash a spinner. Only the
  calendar uses them.

No API or database change was made: it uses the existing planned-blocks, busy, pace, plans,
rest-days, nodes and active-session endpoints.

### Views and navigation

- `?view=month` switches to the month; `?date=YYYY-MM-DD` picks the day (week = its Monday
  week). Both are dropped from the address when they're the defaults, and navigation replaces
  the history entry rather than adding one.
- Keys (ignored in text fields and while a dialog is open): ← → move a week, a month or (phone)
  a day; T today; W week; M month.
- Phones (`max-width: 767px`, the same breakpoint as AppShell) get one day: "Week" is labelled
  "Day", the week is a strip of days above the grid with dots (grey = something due, accent =
  something planned), and a quick sideways flick (under 350 ms, so it never collides with a
  long-press drag) changes day. The month shows dots and flags instead of names.
- The header is the title, then one line: the period ("Oct 19 – 25", "October 2026",
  "Wednesday, Oct 21") and the totals for exactly that period: planned, studied, due (from today
  on). A total of zero is left out. On phones the totals wrap under the period.
- The side panel sits beside the grid from 1100 px wide and under it below that.

### What sits in a day column (`buildItems`)

Every block is a `PlannedBlock` from `/api/planned-blocks` for the visible range. Its
`source` and timing decide its kind, and the kind decides its look (`.cal-ev.is-<kind>`):

- **planned**: `source: 'app'`, still ahead. Light tint of the course colour, coloured left edge.
- **kept**: an app block with a session on the same task overlapping it (the same rule the API
  uses for "kept to the plan"). Not drawn as a block: it's a dashed outline (`.cal-kept`) behind
  the session, so a plan of 9:00 against a session from 9:15 shows the difference by itself.
  Kept outlines are left out of the lane layout.
- **missed**: an app block that has ended with no session in it. Faint, never flagged in
  warning colours (the app never guilt-trips).
- **session**: `source: 'session'`, the record the API writes for every finished session
  (setting `calendar.logSessions`, on by default; with it off, no history shows). Stronger fill
  and a check. A routine session has no task, so its title comes from the block's `title`.
- **commitment**: `source: 'google' | 'outlook'`, an imported event. Neutral grey, not
  clickable, never linked to a task.
- **proposal**: a Plan my week suggestion, held only in page state until kept. Dashed outline,
  with keep (✓) and drop (✕) buttons.
- **live**: the running session (`useActiveSession`), drawn from its start to now.

Free/busy times from Google or Outlook (`/api/calendar/busy`) are plain grey bands behind
everything. Anything that crosses midnight is split per day. Colours come from the task's own
colour or the nearest ancestor's (`effectiveColor`; only tasks coloured before 2026-10-22 have one,
since the setting was removed); the subtitle is the root course or plan.
Blocks mix the colour into `--glass-solid` (the theme's opaque surface) rather than into
transparency, so hour lines never show through them, and text uses `--ink`. Overlapping
blocks sit side by side (`layoutLanes`) and get a warning-coloured right edge: overlaps are
shown, never refused (an older decision). Days in the rest-day policy are shaded and labelled
"Rest day" (or "Time off" for a vacation). Due dates come from the tasks themselves
(`deadlinesByDay`: anything with `dueAt` that isn't a course); clicking one opens the task.

The grid scrolls inside its panel and opens at 7:00, or earlier if something starts earlier,
or (on today's week) about five hours before now so the evening is in view.

### Planning by hand (TimeGrid gestures)

All with pointer events on `.cal-cols`; `hit(x, y)` turns a point into a day and minutes.

- Drag over empty time: make a block (snaps to 15 min; the block dialog opens to confirm).
  A plain click or tap on empty time opens the dialog for an hour there.
- Drag a planned block or a suggestion: move it, to another day too. Drag the strip at its
  bottom (`.cal-ev-resize`, hidden on touch screens): change its length. History, imported
  events and the live session don't move.
- A mouse drag starts after 4 px of movement. On touch, a press held for 380 ms starts the
  drag; moving earlier is treated as a scroll and cancels it. Once a touch drag has started, a
  non-passive `touchmove` listener stops the page scrolling. Holding near the top or bottom
  edge scrolls the grid.
- After a drag, the click that follows is swallowed (`suppressClick`) so it doesn't open the
  dialog; a click without dragging opens the edit dialog (keyboard users get the same through
  the block's button).
- A moved block is drawn at its new place at once (the page's `moved` overrides) and saved
  with `useUpdateBlock`, which records the inverse for Ctrl+Z. The override is dropped when the
  server's copy agrees, or on error with a toast. Don't patch the query cache for this instead:
  `useUpdateBlock` reads the cached block to build its undo, and a patched cache makes the undo
  restore the new times.

### To plan (`trayItems`)

What still wants time in the visible week, from now on (a past week shows "This week is
over"). Two kinds:

- **Tasks** from the pace daily plan (`/api/pace` `plan`), skipping study-plan topics and
  anything without a due date. Its need for the week = the minutes per study day its pace asks
  for (`requiredPerDay`) × the study days left in the week up to its due day, less what is
  already planned in the week, and never more than is left on it (`remainingMinutes` −
  `plannedMinutes`, where planned means future app blocks). Overdue tasks need everything left.
- **Study plans** (`/api/plans`): the weekly budget less what was studied this week
  (`pacing.thisWeekMinutes`) and what is planned this week on its topics (the plan node's
  children), planned against `upNext`.

Needs are rounded down to 15 minutes. Something fully covered stays listed as "Set aside"
(wins only, no warning colours). Dragging an item onto the grid (mouse and pen; the page
listens on window and asks the grid's `hit`) makes a block straight away, one block long
(45 to 120 min from the pace suggestion; 60 for a plan). Clicking one opens the block dialog on
the first free slot, found with `planWeek` for just that item. The "Connect Google or Outlook"
link at the foot ("Add your timetable to plan around your classes") shows while no calendar
is added or connected.

### Plan my week (`planWeek`)

Takes every To plan item needing 30 minutes or more and returns blocks to propose:

- Window: from now (or the week's start, for a future week) to the end of the week, between
  8:00 and 22:00 (`PLAN_DAY_START`/`PLAN_DAY_END`, the same hours as the old suggester).
- Never on rest days; never over imported events, Google/Outlook busy times, existing blocks
  or the running session, keeping 15 minutes' gap either side; at most 4 h of planned study a
  day counting what's already there; nothing shorter than 30 minutes.
- Order: overdue first (a past deadline sorts first), then soonest deadline, then no deadline.
  Each block goes on the lightest day before its deadline that the task has no block on yet
  (loads within half an hour count as even, so earlier days win); overdue work takes the first
  day with room instead. A task only doubles up on a day once every other day is used or full.
  Within a day it takes the first free stretch, trying shorter lengths down to 30 minutes.
- The result is shown as dashed suggestions with a bar ("3 suggested blocks · 2 h", Discard,
  Add all). They can be moved, then kept one by one or all at once. Nothing is saved until
  kept, and they're cleared when the week or view changes.

### Start from a block

A planned block today that hasn't ended, on a task, gets a round play button when no session
is running. It opens `StartSessionDialog` locked to that task with the minutes left in the
block as a "for a while" length.

### Month and Due this month

`MonthGrid` shows whole Monday-first weeks covering the month. Each day: due chips (up to 3,
then "N more"; assessments carry a flag), the time studied on days gone by (with a check), the
time planned on days ahead, both on today, and rest-day shading. Days outside the month are
dimmed. Clicking a day opens its week. `DueList` beside it lists the month's deadlines grouped
by week ("This week", "Next week", "Last week", or the dates).

### Calendars added by link (2026-10-21)

Settings › Calendar › "Your calendars" (`components/CalendarFeedsSettings.tsx`, styles in
`components/calendar-feeds.css`). Paste an .ics or webcal link; the events become
commitments like Google or Outlook ones (block source and import provider `'ics'`, the
`calendar_feeds` row's id as the calendar id). Why: Google and Outlook need OAuth keys on
the server, which komogon.app doesn't have, so their rows now hide until it does.

- API: `routes/calendar.ts` (`/api/calendar/feeds`: list, add, PATCH name or tasks, `/sync`,
  DELETE) and `services/calendar-feeds.ts` (the safe fetch, `syncFeed`, `removeFeed`). The
  worker refreshes each feed when `checked_at` is over 15 minutes old.
- The link is encrypted with a key derived from the calendar `stateSecret`
  (`TOKEN_ENCRYPTION_KEY`, else `AUTH_SECRET`, else the dev secret). Changing that secret
  makes stored links unreadable; the feed then says "This calendar needs adding again."
  The portal never gets the link back, only the host.
- The fetch refuses private, loopback, link-local and other internal addresses at connect
  time (`safeLookup`), odd ports, links with passwords, over 5 MB and over 15 seconds, and
  re-checks every redirect. Node's `BlockList` matches IPv4 against the IPv4-mapped IPv6
  range, so v4 and v6 live in separate lists; keep them apart.
- `importCalendarSnapshot` takes `{ calendarId, tasks }`: a feed is imported on its own, so
  one feed's refresh never cancels another's events, and `tasks: false` skips recognition.
  `free` events (TRANSP:TRANSPARENT) and due moments under a minute long aren't commitments.
- The reader is `readIcsFeed` in `packages/core/src/ics-feed.ts` (tests beside it): time
  zones, repeats, exceptions. `parseIcs` in `ics-parse.ts` is the older, narrower reader for
  turning a file into routines; they share the line helpers.
- Tests: `calendar-feeds.test.ts` (through the API, with a fake fetcher passed as
  `calendar.fetchFeed` to `buildServer`).
- In the portal, `isImported(source)` in `lib/calendar.ts` is the one test for "an imported
  event"; use it rather than listing the sources.

### Checking it

- Sandbox launch configs in the parent folder's `.claude/launch.json` (untracked):
  `calendar-sandbox-api` (8806, data in `apps/api/.pglite-sandbox-calendar`) and
  `calendar-sandbox` (5193). They run from the `Documents/Doloop/calendar` worktree folder;
  point them at another checkout if that worktree is gone.
- Sample data: `apps/api/seed-calendar-demo.tmp.ts` (untracked, kept in the main checkout's
  `apps/api` like the other seeds). Stop the sandbox API, run `npx tsx seed-calendar-demo.tmp.ts`
  from `apps/api` (it rebuilds `.pglite-sandbox-calendar` with three courses, tasks due around
  this week, a study plan, finished sessions and planned blocks, Saturday as a rest day), start
  the API again and sign in as cal@komogon.test. It's written for Toronto time.
- The preview shrinks wide layouts into a corner: check the side-by-side layout (1100 px and
  up) by measuring with JavaScript, and look at the page at the pane's own width. Drags can be
  tried with the preview's click-and-drag.
- Lint traps hit while building it (React's newer hook rules): don't write `ref.current`
  during render (update "latest props" refs in an effect), keep `useMemo` dependencies plain
  variables (memoise derived arrays rather than writing `days.join()` in the list), and
  `--ring` is a box-shadow value, not a colour, so focus outlines use `--accent`.

## The homepage (`apps/site`, 2026-10-21)

- `apps/site` is the marketing site (`@komogon/site`): plain HTML, CSS and a small script on
  Vite, port 5190 (launch config `site` in the parent folder's `.claude/launch.json`, which is
  the one the preview tool reads). It deploys on Vercel as its own project with Root
  Directory `apps/site`, the same way the portal does from `apps/portal`.
- **The look the owner settled on, after rejecting a lot:** like cluely.com. The Cotton Candy
  photograph runs edge to edge behind the hero and fades out at the bottom only, into a
  light gradient page. The dashboard screenshot sits on a CSS-drawn laptop with the phone
  view in front (no island on the phone); the Track, Focus and Share sections show plain
  screenshots of the portal. Below the devices (redone 2026-10-22: the owner liked the hero
  and devices, but called the rest bad and asked for a clean start-up look that keeps the
  brand): each section is its heading left and paragraph right, then tightly cropped
  screenshots with one corner, and Focus has three of the owner's own timelapses under the
  focus screen. The closing is the logo, heading and buttons on the page, no card.
  Redone again later on 2026-10-22 around the scroll (see README in `apps/site` and
  DECISIONS.md): a ruled page, a pinned Track tour (Analytics, feed, leaderboard), a dusk
  interlude of floating timelapses (no clocks: the owner disliked them), a drum of sixteen
  looks, a focus screen that grows to fill the window, a Share bento, then the calendar. The
  devices now show with the headline. No pastel fields behind screenshots (the owner
  disliked them). The closing reads "Try it out!" (the owner found the hand-drawn
  underline ugly). Three clips are made from YouTube videos the owner downloaded; see
  apps/site/README.md before publishing.
  The docs are off for now (owner, 2026-10-22: not built, `/docs` redirects home, no links;
  how to turn them back on is in `apps/site/vite.config.js`). Their text lives in
  `apps/site/src/content/docs.html`, written from the code:
  when a feature's labels or where it lives change, update its topic there too. Keep formulas,
  thresholds and planning rules out of it (the owner doesn't want a blueprint for a copy).
  Satoshi for headings, Inter for everything else; no eyebrow
  labels, captions or quotes. `src/main.js` does the entrance motion: the headline first,
  the devices with it, each section as it arrives, and the pinned scenes (`[data-scrub]`).
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
