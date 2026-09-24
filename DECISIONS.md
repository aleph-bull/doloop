# Decisions

Running log of defaults chosen without a spec answer, and kickoff decisions from the user. Newest at the bottom.

## Kickoff (2026-09-20, decided by user)

- **Backend: Supabase** for Postgres + Auth (magic link and Google sign-in). The Fastify API stays the only boundary; clients never talk to Supabase's DB directly. Clients do use Supabase Auth JS for the sign-in handshake, then send the JWT to the API.
- **Glass level: heavier than §8.** Glass also on node cards, the daily quote card, and analytics highlight cards. Task tree, tables, charts, and settings forms stay on opaque panels.
- **Default theme: dark** when the system preference cannot be read. `mode: 'system'` still follows the OS; manual override in settings.
- **Workflow:** run every phase that needs no credentials, commit each phase on `main`, stop only when blocked on Supabase or Google credentials.

## Phase 0

- **Workspace packages export TypeScript source** (`exports` point at `src/index.ts`). Vite and `tsx` consume TS directly, so no build step is needed to develop. The API bundles `@komogon/core` with tsup for production.
- **Tailwind v4** via `@tailwindcss/vite` for layout only. All visual values come from `packages/ui/tokens.css` custom properties.
- **Inter** loaded from rsms.me in the portal. The extension popup uses the system font stack to avoid a network fetch in a popup.
- **API port 8787**, portal 5173, extension dev 5174. Portal proxies `/api` to the API in dev.
- **ESLint** enforces purity in `packages/core`: no DOM globals, no Node built-ins, no React imports.
- **Coverage thresholds** for core: 90% lines/functions/statements, 85% branches (branches are noisier; the spec's 90% is for lines).
- **Extension icons** are generated PNGs checked into `apps/extension/public/icons` so the manifest builds without an asset pipeline.

## Phase 1

- **A session is credited to the local calendar day it started**, even if it runs past midnight. This is what a late-night studier expects ("today's" session).
- **Streak evaluation advances `lastCountedDate` through every judged day** (counted, rest, frozen, reset), which is what makes lazy re-evaluation idempotent. A freeze is never spent when `current` is already 0. A quiet "today" is left unjudged until it is over.
- **Parent aggregation:** a node's own estimate always wins - children are a breakdown of the parent's work, not a replacement for it, so estimating one unit at 1 h leaves the 16 h test above it at 16 h. Only a node with _no_ estimate of its own is aggregated, from the sum of its **direct** children's (already effective) estimates against every session logged in the subtree. A node with neither gets no percentage, just hours logged. A parent with its own estimate takes the worst of its own status and its children's, so an overdue unit is not hidden by a comfortable parent deadline; a completed parent is `done` regardless of children. Anything that wants one row per piece of work (daily plan, estimate accuracy, weekly highlights) filters on `standsInForChildren`, not `aggregated`. _(Reversed 2026-09-22: the parent's estimate used to be discarded whenever a child carried one.)_
- **A node with no estimate** is `no-estimate`, except `done` when completed and `overdue` when past due and not completed.
- **Due today with nothing studied recently** yields `behind` (the §3 formula: required exceeds 1.25 x 0 and study days remaining is 0 <= 3). `critical` still wins if required exceeds the comfortable maximum.
- **Rest-day edit limit** counts weekly-pattern changes and vacation additions. Vacation removals and purchased break-day applications do not count (removal is "anytime" per spec; break days already cost XP). A weekly pattern must leave at least one study day. Unchanged submissions are no-ops and are not logged.
- **Break-day monthly pricing** needs a count of purchases in the calendar month, so the API keeps an `xp_transactions` ledger (also useful for analytics and data export).
- **Cosmetic catalogue** (accent presets with level gates, 10 backgrounds with two purchasable) lives in core as metadata; the visuals live in `packages/ui`.
- **Quotes are placeholders** (4 verified attributions from Wikiquote-sourced material) until the Phase 8 sourcing task replaces `packages/core/data/quotes.json`. Research tips are likewise a 5-entry placeholder until Phase 8 writes 30+.
- **Phrase bucket priority** when several apply: node completed > streak milestone > distracted a lot > late night > assessment buckets > behind > first session > default.

## Phase 2

- **The API owns the timer.** A session row stores a `TimerState` (from `@komogon/core/timer`) and the server materializes pomodoro/scheduled transitions lazily on every read (`advance(state, now)`). Clients only send events (pause, resume, skip-break, idle-start, idle-answer, extend, end) and render `viewTimer()` against their own clock. This keeps the portal and extension in agreement without a cron or websockets.
- **Idle detection is client-reported.** The client sends `idle-start` with `idleSince` (when idleness actually began); the server credits work up to that instant and books the gap to `idleSeconds` when the user answers "Still studying?". Answering "no" ends the session.
- **Scheduled sessions auto-end** at `plannedEndAt` (work is credited only to the planned end, not the 60 s grace). Whoever reads the session next finalizes it (XP, streak) so nothing is lost if the tab was closed.
- **Node completion is explicit.** Reaching 100% of the estimate sets status `done` but does not set `completedAt`; the user marks it complete (from the end-of-session screen via `markComplete`, or by editing the node).
- **Timestamps are `timestamptz` columns read as `Date`** and converted to ISO strings at the API boundary. Reading them as text gave Postgres' session-timezone format.
- **Auth:** the API verifies Supabase JWTs against the project's JWKS, falling back to the legacy HS256 secret. Without `SUPABASE_URL`, `DEV_AUTH_SECRET` enables locally minted HS256 tokens so the app runs end to end with no credentials.
- **Database:** `DATABASE_URL` (Supabase pooler) in production; without it the API boots an in-process PGlite database so development and tests need nothing installed. Migrations are generated by drizzle-kit into `apps/api/drizzle` and applied on boot.
- **Users are created on first authenticated request** with the timezone from the `X-Timezone` header. Rest-day policy row is created alongside.
- **Streak is re-evaluated on every `/api/me` read and at session end**, never by a scheduler. The pending weekly rest-day pattern is materialized in the same pass.
- **Badges are stubbed** (`badges: []`) until Phase 7.

## Phase 3

- **Stop banks work before the review.** Clicking Stop sends `pause` first, then shows the review, then `end`. Time spent filling in the review is never counted as work.
- **The reward overlay is owned by the Today page**, not the timer card, because the card unmounts as soon as the session clears.
- **Dev sign-in** mints an HS256 token in the browser with `VITE_DEV_AUTH_SECRET` (must equal the API's `DEV_AUTH_SECRET`). The user id is derived from the email so data persists across reloads while the API is up. Never set in production.
- **Data fetching** uses TanStack Query; the active session is polled every 20 s and ticked locally every second with the shared timer state machine.
- **Idle detection** in the portal watches mouse, keyboard, scroll, touch, and wheel events plus tab visibility; the threshold comes from settings.
- **Backgrounds** are pure CSS gradient stacks defined in `packages/ui/src/backgrounds.ts` with light and dark variants. Two are level-gated (Tide 3, Nebula 8) and two are purchasable (Prism, Monolith); the shop arrives in Phase 7.
- **Custom accent** is stored as `custom:<h>,<s>,<l>` in `settings.theme.accent`; saturation and lightness are clamped so text on the accent stays readable.
- **Inter** is loaded from rsms.me; the system stack is the fallback.

## Phase 4

- **Extension auth is handed over by the portal.** A content script on the portal origin receives the session via `window.postMessage` and stores it in `chrome.storage.local`. For Supabase the refresh token is included so the background worker can refresh; for dev mode the 30-day token is enough. No separate sign-in inside the extension.
- **The background worker polls every minute** (`chrome.alarms` minimum) and ticks the badge every minute; the popup ticks every second locally with the shared timer state machine.
- **Idle in the extension uses `chrome.idle`**, which fires after the detection interval has already elapsed, so `idleSince` is set to now minus the interval. The "Still studying?" question is a notification with Yes/No buttons, and the popup shows it too.
- **Blocking uses dynamic `declarativeNetRequest` redirect rules** on `main_frame` for `||domain`, applied only while the phase is `work` and cleared otherwise. Off by default.
- **Ending from the extension asks only "Distracted?"** (a reduced quick review). Full review lives in the portal. Skip is always available.
- **Scheduled mode is not offered in the popup** (it needs a time picker); start it from the portal and the badge tracks it.

## Phase 5

- **Highlights are pure and week-relative except `goal-progress` and `streak`**, which describe the current state; the landing page always shows the current week, so this reads naturally.
- **Sessions are attributed to weeks by the local day they started** (same rule as streaks). Weeks start on Monday.
- **`planned-kept`** counts a block as kept when any session on that block's node overlaps the block's time range; only blocks that have already ended count.
- **Freezes used per week** come from a `streak_events` table the API writes during lazy streak evaluation (the state alone cannot recover history).
- **Charts are hand-rolled SVG** with a validated five-colour categorical palette (`--chart-1..5`, light and dark steps checked with the dataviz validator), direct labels, legends for multi-series, and a table view alongside every chart for accessibility.
- **Post-assessment follow-up** appears on Today one day after an assessment's due date, once; answering stores `outcomeRating` on the node, skipping stores `outcomeAskedAt` so it is never asked again.

## Phase 6

- **Google Calendar sits behind a `GoogleCalendarClient` interface.** Production uses the REST implementation; tests use an in-memory fake that models sync tokens, external edits, revocation, and token expiry. The sync service never imports `fetch`.
- **Refresh tokens are encrypted at rest** with AES-256-GCM using `TOKEN_ENCRYPTION_KEY`. The OAuth `state` is an HMAC-signed, 15-minute user id so the public callback can identify the user without a session.
- **App edits propagate immediately** (best effort) and a full sync reconciles: push app blocks lacking an event, delete events for cancelled blocks, then pull with the sync token (full 30-day window on first sync or `410`).
- **Events created directly in the Study calendar are imported as blocks with no node**; the calendar page prompts to link them. Deleting an event in Google marks the block cancelled rather than deleting it, so history stays intact.
- **Busy times are read live** from the primary calendar (free/busy) and never stored.
- **The week view snaps to 15 minutes**, shows 6:00 to 24:00, and drag-creates a block prefilled with the top item of the daily plan. "Suggest a block" uses `findFreeSlots` (busy times, existing blocks, rest days, 8:00 to 22:00).
- **The .ics feed URL is a per-user secret** exposed to the owner in Settings; regenerating it invalidates the old URL immediately.

## Phase 7

- **Badges are evaluated at session end and whenever the shop or achievements page loads.** Streak badges use the best of current and longest streak so a past run still counts. `no-freeze-30` requires the current streak to be at least 30 with no freeze consumed in the last 30 days (from `streak_events`).
- **Break-day pricing counts purchases per local calendar month** from the `xp_transactions` ledger, so the ledger is the source of truth for both the price and the audit trail.
- **Level and purchase gates are enforced server-side** when settings are saved: a locked accent preset or an unowned background is rejected with a 400. Custom accents are never gated.
- **Badge toasts** respect `effects.badgeToasts`; the extension shows badge names in its end-of-session summary only.

## Phase 8

- **Quotes: 40 kept from 170 candidates** on the two source pages. Dropped: non-clinicians (journalists, athletes, actors, novelists, philosophers, politicians), anything over ~28 words, anything about illness or trauma, and the "Between stimulus and response" line whose attribution to Frankl is widely disputed. Each entry cites the page it came from.
- **Research tips are original one-liners** (35) written for this app, each with a named researcher or paper. Wording was checked to avoid copying sentences from any source.

## Phase 9

- **Contrast audit is part of `pnpm check`.** `packages/ui/scripts/contrast-audit.ts` estimates the colour under each surface by compositing every background's gradient stops, then checks primary and muted text on glass, strong glass, and panels in both themes (80 combinations, all above 4.5:1 with margin). The script mirrors the token values; update both together.
- **Chip text** is a 45–50% mix of the status colour and the foreground so it reads on the tinted chip in both themes.
- **Every page renders an error panel with a retry** when its main query fails, and an error boundary around the outlet keeps one page's crash from blanking the app.
- **Route-level code splitting**: only sign-in and Today are in the initial bundle; every other page loads on demand.
- **Keyboard paths**: a skip link, arrow-key movement between task rows, and a "New block" button so calendar blocks can be planned without dragging. Row actions stay visible on touch devices.
- **Reduced motion**: every non-essential animation reads a `--dur-*` token, which the `data-motion` attribute and the OS preference zero out; confetti checks both before drawing.

## Panel surfaces and image upload (user request, 2026-09-20)

- **Panel surface is a theme setting** (`theme.panel`: opaque, glass, custom). Glass reuses the strong-glass recipe. Custom takes any hex colour plus opacity (min 20%); the panel text colour is chosen from the composited luminance so a light panel gets dark text and vice versa, and the muted/subtle/border tokens are re-scoped inside `.panel` only.
- **Uploaded backgrounds live in the API** (`user_assets`, base64 in Postgres, 5 MB cap, JPEG/PNG/WebP). The portal downsizes to 2048 px on the long edge before uploading and reads the image back as a data URL, which also keeps the luminance sampler CORS-free. `theme.customBackgroundUrl` becomes the sentinel `upload`; removing the upload clears it. The URL option remains for hosted images.
- **The extension follows the portal's appearance.** `applyUserTheme()` in `@komogon/ui` is the single place that applies theme mode, accent (preset or custom), motion, and panel surface; the portal shell and the extension popup/options both call it. The popup renders the same `Backdrop`. The background worker caches an uploaded background in `chrome.storage` and re-downloads it only when `/api/me` reports a new `backgroundUpdatedAt`.

## XP rework and early cancellation (user request, 2026-09-20)

- **XP is proportional to focused time.** Base is 2 XP per focused minute; every bonus is a percentage of the base (review +10%, focus +20%/+5%, planned block +10%, on pace +10%, estimate beat +20%). Under a minute of focus earns nothing. This replaces the spec's flat bonuses, which read as arbitrary next to the time term.
- **The streak bonus is fixed**: +1 XP per streak day, capped at 30, added once per session that earned a base. The multiplier is gone.
- **Ending early earns no XP.** A pomodoro cancelled before its first work interval completes, or a scheduled session stopped before its planned end, logs the minutes (they still count toward progress and streaks) but awards zero XP and no confetti. The portal asks "End early?" first. Unlimited sessions are never early.
- **Pomodoro durations are locked** to 25/5/15 with a long break every 4, shown read-only in Settings, so short intervals cannot be used to collect the interval-completion threshold quickly. Auto-start and timer-visibility toggles remain editable. The API still accepts the fields; the constant lives in `DEFAULT_SETTINGS`.
- **Level divisor raised to 100** so levelling pace stays close to before despite higher per-session XP. Shop prices are unchanged.
- **Extension background** is a theme setting: same as the portal (default), the uploaded image, or its own preset. Resolved by `resolveExtensionBackdrop()` in `@komogon/ui`; the background worker caches the upload whenever either surface needs it.

## Parent path on task surfaces (user request, 2026-09-21)

- **Why**: two tasks can share a title ("Test 1"), so the Up Next card was ambiguous.
- **What**: `ancestorTitles`/`pathLabel` in core build "Course › Topic" from any id map. Shown above the title on the Up Next card, prefixed in the "Also today" list, under the running task in the timer card, and in the extension popup's task picker and active view.
- **Extension snapshot** now carries every non-archived node with `parentId` (parents included) so the popup can resolve paths; the picker filters to startable leaves itself.

## Custom rewards, routines, analytics, local cache (user request, 2026-09-21)

### Tab logo, backgrounds, interval lengths

- **Favicon** is `apps/portal/public/favicon.svg`, drawn to match the existing extension icon (gradient squircle, open white loop with the gap at 1 o'clock). The gradient stops were sampled from `icon128.png` so tab and extension icon read as the same mark. `apple-touch-icon.png` reuses that PNG.
- **Custom backgrounds are upload-only.** `theme.customBackgroundUrl` narrows to `'upload' | null` and the settings schema rejects anything else, so a remote image URL can no longer be stored or rendered. This reverses the earlier "the URL option remains for hosted images" decision, at the user's request.
- **Pomodoro durations are freely editable, with no restriction at all.** The user asked for the durations to be unlocked and then, when offered a narrower reading, for the restriction to be removed outright. `POMODORO_LIMITS` is now sanity bounds only (work 1–180 min, matching the original schema) shared by the settings form and the API schema; there is no active-session check.

  This is safe because a pomodoro session writes `pomodoroConfigSnapshot` at start and every later operation reads `advanceOptions(user, row.pomodoroConfigSnapshot)`, i.e. `snapshot ?? settings.pomodoro` — so changing the setting mid-session cannot move the running timer's contract. It applies to the next session. Verified against a live session: the PATCH returns 200 and the running snapshot stays 25/5/15/4.

  The dropped 10-minute floor was there so the "no XP before the first work interval" gate could not be cleared with a 1-minute interval. Accepting that: XP is proportional to focused minutes, so a 1-minute pomodoro earns 2 XP base and nothing is farmed — the only thing a short interval buys is avoiding the ended-early penalty on work you genuinely did not do, which only cheats the user. This supersedes both the "durations are locked" decision and the "editable between sessions only" one.

### Custom rewards

- **The user defines the reward; Komogon only enforces the price.** Minimum 150 XP, roughly an hour of focused work, so XP always has to be earned before it buys anything. No content judgement — "doomscroll for an hour" is a legitimate reward.
- **Optional cooldown** (0–90 days) so a reward can be once-a-week rather than whenever affordable. Counted in whole local calendar days from the last redemption.
- **Redemptions are written to `xp_transactions`** (`kind: 'reward'`, `ref` = reward id), so history survives deleting the reward and the badge counts come from the ledger rather than a denormalised field.
- **The redeem animation is deliberately different from the session overlay**: an emoji burst keyed to the reward's own icon (`fireRewardBurst` in `@komogon/ui`) over confetti a beat later. Both respect `data-motion` and the OS reduced-motion preference.

### Recurring tasks (routines)

- **Ticked off, not timed.** A routine carries an estimate and earns XP per tick at 1 XP per estimated minute — half the focused-session rate, because it is self-reported — capped at 60 XP per tick and 120 XP per day.
- **XP is banked against the occurrence's own date**, not today, so catching up on a backlog draws on each day's budget instead of bypassing the daily cap. Ticks are idempotent by `(routine, date)` via a unique index; future dates are refused; unticking refunds exactly what was paid.
- **Recurrence is DAILY/WEEKLY/MONTHLY with an interval and an optional day selector.** Monthly days that do not exist in a month (the 31st in February) simply produce no occurrence rather than shifting.
- **ICS import matches on UID**, so re-importing a calendar updates what it created instead of duplicating. Only recurring events become routines; everything else is reported in a skipped list rather than dropped silently. `parseIcs` is a narrow RFC 5545 reader in core: VEVENT only, unfolding and escaping handled, malformed lines skipped rather than thrown on.

### Analytics

- **Three tabs**: "This week" (wins only, unchanged), "All time" (new), "By task" (the old Advanced). Each says at the top what it is for.
- **The contribution grid ramps off quartiles of the user's own studied days**, not a fixed minute scale, so it stays readable at twenty minutes a day and at three hours. Comparisons are strictly-less so the heaviest day always lands in the top step. Future days render as placeholders, never as missed days. `--heat-0..4` derive from the accent hue so the ramp follows the user's accent in both themes.
- **Every insight carries its evidence.** `buildInsights` returns a claim plus the figures behind it, so a reader can check it. Tone is descriptive: no targets, no "you should". A time-of-day preference is only claimed when one band holds 35% or more; the cadence line waits for a fortnight of history.
- **"Since you started" counts from `users.created_at`**, not the first session, because that is what the user asked for.
- **Sub-hour durations read in minutes** across charts, the heatmap tooltip and the lifetime headline. `0.0 h` told the reader nothing about a twenty-minute day.

### Local persistence

- **The query cache is mirrored to IndexedDB and restored before first paint**, so the app opens on last-known data and keeps working read-only when the API is unreachable. Verified by stopping the API and reloading.
- **Cache, not outbox.** Mutations are never dehydrated or replayed; an offline banner says edits will not be saved rather than letting them fail silently. Cloud sync was explicitly deferred by the user.
- **Scoped to one account.** The record stores whose data it holds and is discarded unread if a different account signs in, wiped on sign-out, and expired after seven days or a `CACHE_VERSION` bump. `komogon.user` in localStorage is what makes that check possible synchronously at boot.
- **Never persisted**: `['sessions','active']`, because only the server can be right about a running timer, and `['me','background']`, a multi-megabyte data URL that would be rewritten on every cache change.
- **No new dependencies** — `dehydrate`/`hydrate` ship with TanStack Query, and the IndexedDB wrapper is about eighty lines. Everything degrades to the previous behaviour when IndexedDB is missing, blocked or slow.

### Badges

- **Seventeen added** across volume (hours, sessions, deep work), rhythm (night owl, weekend warrior, full week, marathon), habits (routine ticks, a perfect routine week), reflection (reviews, weekly notes) and rewards. Twenty-nine total. A "perfect week" only counts weeks that have finished and that actually had something due.

## Backgrounds, highlights, session types (user request, 2026-09-21)

### Backgrounds

- **Only Graphite survived.** The other nine gradients were dropped at the user's request and replaced by nineteen supplied photographs, plus five new siblings for Graphite (Slate, Ash, Onyx, Basalt, Fog) built to its recipe: one soft light source over a quiet two-stop base, neutral hues only.
- **Photographs ship as 2560px WebP**, 5.0 MB for all nineteen, produced by `packages/ui/scripts/prepare-backgrounds.ts`. The pipeline is committed so the set can be regenerated; the source photos are not in the repo.
- **Average colour and a 20px LQIP are baked in at build time** (`src/photos.generated.ts`). That is what lets a twenty-five-tile picker render with zero network requests, a chosen background paint without a flash, and the contrast audit check photos without the images present.
- **`adaptGlassToBackdrop` in contrast.ts is the single place** the glass fill and text colour are derived from a backdrop colour — used live for a user's upload, ahead of time for shipped photos, and by the audit. Every photo clears 4.5:1 at the base 45% fill.
- **Ids resolve through `resolveBackgroundId`.** Every existing user had a now-deleted id, so an unknown id reads as Graphite, in core and normalised server-side in `settingsOf`. Graphite is also the new default.
- **The extension takes an `assetBase`** so photo paths resolve against the portal origin instead of `chrome-extension://`. Photos are not bundled into the extension.
- **Licensing**: the Unsplash photographs are used under the Unsplash License and credited in `public/backgrounds/CREDITS.md`. `still-water` was supplied by the user from an unidentified source and its licence is not verified — flagged rather than assumed.

### Weekly highlights

- **Wins only, enforced at source.** Relative thresholds with no absolute floor let a week of seconds beat a previous week of seconds, producing "You studied 0 hours this week" and "biggest study day yet — 0 hours". Everything time-based now clears `MIN_WIN_MINUTES`; increases need an absolute delta as well as a ratio; a record day needs a real day and a margin.
- **`fmtDurationWord` drops to minutes under the hour**, shared by highlights and the all-time insights, so no card can read "0 hours".
- **Progress is stated as ground covered, never ground remaining.** "You're 60% through Test 1", not "40% from finishing" — and only once a real dent has been made. A live streak is never compared unfavourably with a longer past one, and "back on track" does not name the status it recovered from.

### Session types

- **Style and length are separate axes.** Style is pomodoro or continuous; length is unlimited, a number of minutes, or a clock time. This replaces the single Pomodoro / Unlimited / Until-a-time choice, which had no way to express a pomodoro with an end time.
- **No migration.** `SessionMode` still stores the three original combinations unchanged; the new one is mode `pomodoro` with `plannedEndAt` set. `modeForPlan`/`styleForMode` map between the plan and the stored mode.
- **A planned end applies to either style.** `advance()` ends any session at its planned end, and `isEndedEarly` judges a session with a planned end against that end; an open-ended pomodoro still promises one work interval.
- **A length that does not land on a block boundary asks first**: "Are you sure? This will end your work block 15 minutes early", with a one-click snap to the clean length below, and an explicit second click to start. Continuous sessions have no blocks, so they never warn.
- **Glass highlight halved** (0.5 to 0.26 light, 0.12 to 0.06 dark) — the top sheen read as a visible band on panels over the photographic backgrounds.

## Pomodoro visualizer / focus screen (user request, 2026-09-21)

- **A route, not a mode.** `/focus` renders outside `AppShell` so there is no nav or page chrome, and leaves with Escape or the close button. The timer is not reimplemented: the server still owns `TimerState` and the screen ticks the same `advance()` the card does, so switching between them cannot drift.
- **Subject and child come from the node tree.** The subject is the root course, the child is the task under it. A task with no parent is its own subject and has no child line. Hours remaining uses the studied task when there is a child, and the first item of the daily plan otherwise — the "next best option".
- **System audio, never the microphone.** The only browser route to it is `getDisplayMedia({ video: true, audio: true })`, which is a screen-share prompt: it needs a user gesture, the video track is stopped immediately, and the audio is analysed but never connected to the destination so nothing echoes. Four ordinary failures — unsupported, dismissed, shared without audio, stopped from the browser's own banner — are states the screen reports, not errors.
- **No bars, ever.** The silhouette is a Catmull-Rom spline through the band amplitudes, filled and blurred by 5.5% of the viewport width, then masked with a horizontal gradient that fades both sides out by 42% of the width. Points are extended past both ends of the bottom half so the shape tapers into the corners instead of ending on a flat edge.
- **Motion lives in core, not the component.** `packages/core/src/glow.ts` holds the attack/decay, the breathing wave and the reach curve. An animation frame only fires when the page is being painted, so a canvas cannot be used to verify any of it — in the Claude browser pane `requestAnimationFrame` fires zero times a second. Seventeen unit tests cover it instead.
- **Settings split as asked**: on/off, intensity and opacity in Settings only; colour in both Settings and a swatch on the focus screen that appears with the chrome and auto-hides. Both write `settings.visualizer.color`, so the two are the same value rather than two copies kept in step.
- **Reduced motion** renders one frame at a flat resting level and stops the loop, rather than animating more slowly.

## Extension catch-up: routines, rewards, session lengths (2026-09-21)

The extension had not moved since the timer-and-blocking build, so it was a phase or two
behind the portal. Four things changed.

- **The popup is tabbed now: Focus, Routines, Rewards.** The canvas stays 360x480, so the
  section scrolls and the tab bar is pinned. The chosen tab is stored, because a glance at
  what is due should survive closing the popup. Routines carries a count badge; the other
  two do not, since neither is something you are behind on.
- **Routines are ticked from the popup, not managed there.** Only what is outstanding is
  listed — today's occurrences plus the grace window — with the estimate and, when overdue,
  the date the tick banks against. Creating, editing and importing stay in the portal.
  The window is pinned to `from=to=today` so the response stays small; `due` is computed
  from its own grace period and does not depend on it.
- **Rewards are redeemed from the popup, not created there.** The server has already
  resolved affordability and cooldown, so the popup renders the verdict rather than
  recomputing it — including the shelf returned by the redeem call itself, which is how the
  new cooldown appears without a refetch.
- **Both are secondary to the timer.** They are fetched outside the poll's `Promise.all` and
  each failure is swallowed, keeping the last known values: a routines outage must not stop
  the badge from counting down. A poll carries the previous values forward rather than
  blanking the tabs while it refetches.
- **Session style and length reached the popup.** Same two axes as the portal, same
  `modeForPlan`, and the same block-boundary warning with its one-click snap and explicit
  second press. All of it comes from `packages/core/src/session-plan.ts`; none of it was
  reimplemented.

### Two bugs found on the way

- **The extension kept its own copy of the pomodoro defaults**, which still said
  `autoStartWork: false` after core changed to `true`. The badge and popup therefore showed
  a session paused after every break while the server had already looped back into work.
  Both sites now read `DEFAULT_SETTINGS.pomodoro`, so there is no second copy left to drift.
- **`.card p` is as specific as a bare class**, so `.error` inside a card lost to it and
  error text rendered muted grey instead of red. The utility classes now name the element
  as well. This was pre-existing, not introduced by the tabs.

### What was already fine

The background work needed nothing: `backgroundById` falls back to Graphite for an unknown
id and photos already resolve through `assetBase`, so the new ids and the five new Graphite
siblings work in the extension as they stand.

## Trackers, grades, greeting, settings navigation (user request, 2026-09-22)

- **Custom trackers are a general contribution grid, not a second heatmap.** `trackers.ts`
  holds `buildGrid`, which turns any map of day -> number into the same grid shape the
  study heatmap uses, so "pages read" and "days focused" render through one component.
  `insights.studyHeatmap` keeps its own copy over session minutes rather than being
  rewritten, because it also produces analytics fields (`longestRun`, `activeDays`) that
  the overview endpoint's response shape already promises.
- **A tracker's ramp follows its daily goal when it has one**, and quartiles of the user's
  own logged days when it does not. A fixed scale washes out anyone who logs 5 of something
  a day; quartiles alone mean a good day and a bad day can look the same once the history
  is long enough. With a goal, hitting it always looks the same shade.
- **One entry row per tracker per day.** Logging is `set` by default (the widget's field
  writes the day's total) with `add` for the +/- buttons, and an amount of zero deletes the
  row, so an empty day is empty rather than a zero that still counts as "active".
- **Grades hang off course nodes**, with `gradeMode` choosing between one final mark and
  weighted components. Ungraded components are excluded from the running mark rather than
  counted as zero: two weeks in, "88% of the 20% that has been marked" is true and "17.6%"
  is not. `weightGraded` rides along so the UI can say how much of the course that is.
- **The grading scale is a list of bands (floor percentage, name, points)** stored in
  settings, defaulting to the U of T undergraduate scale. That shape covers other
  universities and a plain pass/fail scheme without a second concept.
- **The greeting is bucketed like session phrases**, in `greetings.ts`, and seeded with the
  local date so it is one greeting per day rather than a new one per render. The bucket
  order runs rarest-first, so a 100-day streak is never buried under "what are we working
  on?". Signals are computed on the client from data Today already has, which costs no
  extra request.
- **Dismissals moved from localStorage to `settings.dismissed`.** Closing a prompt means
  never again; a new browser or a cleared cache is not the user asking to see it a second
  time. localStorage stays as a mirror so a dismissal takes effect before the request
  lands.
- **Settings is a sidebar of groups plus search, showing one group at a time.** Search
  reads an explicit keyword list per group rather than rendered text, so "dark mode" finds
  Appearance even though those words never appear together on screen. Hash links
  (`/settings#rest-days`) still select a group.
- **Small all-caps eyebrows are gone.** Two were redundant with the heading directly below
  them ("Up next", "Follow-up") and were deleted; the ones that carry real information (the
  timer phase, the weekly-review stat labels) kept their words and lost the shouting.

### Bugs found while building this

- `updateNodeSchema` was `createNodeSchema.partial()`, and Zod applies a field's `.default()`
  even through `.partial()`. Every PATCH that left `kind` out therefore rewrote the node to
  `task` — renaming a course silently demoted it. The shared fields now live in a
  `nodeFields` schema with no defaults, and `.default('task')` is applied only on create.
- `updateSettings` merged every object-valued key with a spread, and an array is an object,
  so a list setting persisted as `{"0": "xp"}`. Arrays and scalars now replace outright.

## Dashboard merge, calendar semantics, session logging (user request, 2026-09-22)

- **Today and Dashboard are one page, named Dashboard.** `/dashboard` redirects to `/`.
  The page is the day (greeting, plan or timer, what is coming up, routines) followed by
  the long view (the grids). Upcoming due dates sit under the plan, filtered the same way
  the daily plan is: a parent standing in for its children is a heading, not a deadline.
- **The greeting is two lines.** "Hello Zachary" is the heading; the chosen line is body
  text under it. The phrase bank holds only the line, each written as its own sentence, so
  the salutation is composed once rather than baked into fifty templates.
- **Grids size themselves to the history.** `weeksForHistory` picks the number of columns
  from the first day anything was logged, with a floor of 8 weeks and the chosen range as
  the ceiling. A year of empty squares on someone's second day reads as "you have done
  nothing", which is not what a contribution grid is for. The range control defaults to
  "So far"; the fixed ranges are still there once there is something to look back on.
- **The shading explainer is gone.** A legend that needs a paragraph is not a legend.
- **Grading can be switched off per course** (`gradeMode: 'off'`) for an audit or a
  pass/fail elective. Such a course is still _listed_ on the Grades page - hiding it would
  hide the switch that turns it back on - but carries no grade and is skipped by the
  average.
- **"Weights add to 0%" is replaced by what it meant**: "Your items are worth 70% of the
  final grade, so 30% of the course is still unaccounted for", and, when nothing has a
  weight yet, a sentence saying what a weight is for.

### The calendar, in one direction

An imported calendar says where the user has to _be_. It says nothing about when they
intend to study, and treating it as though it does is how a study app ends up scheduling
revision during someone's shift. So:

- **Komogon -> external is the only direction that carries study time.** Blocks the user
  plans here (`source: 'app'`) and sessions they finish (`source: 'session'`) are pushed to
  the Study calendar. Nothing else is.
- **External -> Komogon imports commitments** (`source: 'google'`), which are drawn on the
  grid as hatched, muted, unclickable bands. They are never linked to a task - `updateBlock`
  rejects it outright - never counted in `plannedMinutes`, never counted as "kept to the
  plan" for XP, and never re-exported to the .ics feed (which would be an echo, and with a
  subscribed feed, a loop). They _are_ fed to the free-slot suggester as busy time, which
  is the whole point of importing them: planning around them.
- **Only the routines ICS import creates anything that asks for the user's time.** That is
  a separate, explicit flow.
- **Overlaps are marked, not prevented.** A block that shares time with another gets a
  coloured edge. There is no warning, no confirmation and no refusal: studying through a
  lecture you have decided to skip is a legitimate choice.
- **A finished session is written to the calendar** as the block of study it was, carrying
  its session id so re-finalising updates rather than duplicates. Under a minute is not
  recorded. Controlled by `calendar.logSessions` (on by default); the push to Google also
  respects `calendar.syncPlannedBlocks`. The write is best effort in a try/catch - a
  calendar that will not accept it must never cost the user the session or its XP.

### Bug found while building this

- Modal dialogs opened in the top-left corner. A native `<dialog>` is centred by the user
  agent's `margin: auto`, and Tailwind's preflight zeroes the margin on every element, so
  the centring has to be re-declared. `.modal` now sets `margin: auto` and caps its height
  to the viewport.

## Routine sessions, XP out of the way, new logo, sharp thumbnails (user request, 2026-09-22)

### Routines can run under the timer

- **A session belongs to a task or a routine, never both.** `sessions.node_id` is now
  nullable, with `routine_id` and `routine_date` beside it and a CHECK that exactly one of
  node and routine is set (migration `0006_routine_sessions`). `routine_date` is the
  occurrence the session is for, so an overdue one ticks the right day.
- **Same flow as a task.** The play button on a due routine (Today's card, the Routines
  page, the extension's Routines tab) opens the same Start-a-session dialog, which now also
  lists due routines under their own group. It defaults to the routine's estimate as a
  "for a while" length, continuous when that is shorter than a work block. The timer card,
  review and reward overlay are the same ones a task uses.
- **Ticking happens at the end.** The review's "Mark as done" becomes "Tick off", on by
  default because starting a routine's session is the intent to do it. With reviews off, a
  routine session still asks "Done with …?" instead of ending silently.
- **Never paid twice, never worth less than a plain tick.** The session earns session XP
  for its minutes as usual. The tick then only tops up to what a plain tick would have
  paid (`max(0, plainTick - sessionXp)`), so running the timer is never a worse deal than
  ticking, and a long session does not collect the tick on top.
- **Study is study.** Routine sessions count toward the streak, the calendar log (titled
  with the routine) and daily totals, but toward no task: pace, per-task analytics, the
  estimate badge and the per-node highlights skip sessions with no node.
- Fixed on the way: the "kept to the plan" badge counted a session's own calendar record
  as a plan. `overlapsBlock` now only looks at blocks the user set aside (`source: 'app'`),
  matching the API's `overlapsPlannedBlock`.

### XP lives on Achievements

- Outside Achievements (and the extension's Rewards tab, which is its shop), nothing quotes
  XP amounts any more — with one exception the user asked back for: the "+N XP" pop-up when
  a routine is ticked (portal toast, extension tick note). Gone: the XP breakdown or "N XP
  to level" after a session, no XP column in the per-task session table, no XP prices on locked
  backgrounds in Settings ("In the shop" instead), no "N XP a tick" hint, no daily routine
  XP cap line. The end-of-session overlay leads with the minutes focused and keeps the
  level bar and a level-up chip. Levels are still named where they unlock something.
- The weekly highlight "Most XP you've earned in a week" became "Your biggest study week
  yet", measured in time, so the wins pool keeps its size.

### Logo

- _Superseded 2026-09-23 by the KomodoIt dragon (see "Doloop becomes KomodoIt" below), and
  later that day by the Komogon face (see "KomodoIt becomes Komogon"); the tile treatment
  still holds._
- The mark is the user's looped ribbon, from their `doloop.svg`: one path, used verbatim in
  its own coordinates, with a gap where the stem crosses the bar. It replaced a first
  version traced from a PNG with a painted shadow at the crossing. The source of truth is
  `packages/ui/src/logo.ts`.
- **It keeps the rounded indigo-to-violet tile** the app always had, at the user's request.
  The favicon, apple-touch icon and extension icons are the white mark on that tile
  (`#5b55eb` to `#8a5cf6`, corners 14.5 of 64), all written by
  `pnpm --filter @komogon/ui prepare:icons`. The apple-touch icon has square corners because
  iOS rounds it itself.
- In the app, `.brand-mark` is the same 22px tile as before, in the user's accent gradient,
  with `LogoMark` (white, `currentColor`) inside instead of the old CSS-drawn ring.

### Background thumbnails

- Pickers painted each photo from its 20px LQIP, which is a placeholder, not a preview.
  Each photo now has a 640px WebP thumbnail (`public/backgrounds/thumbs/`, 435 KB for all
  19), lazy-loaded over the placeholder. `prepare:thumbs` derives them from the shipped
  2560px images, so it runs without the source photos; `prepare:backgrounds` calls it.

## More backgrounds, scrollable nav and task row (user request, 2026-09-22)

### Backgrounds

- 29 more photographs, 48 in all. The originals were in the user's Downloads, so they were
  processed from full resolution and credited by the name or handle in each filename
  (Unsplash, Pexels, Pixabay — all free to use without attribution). `CREDITS.md` says so.
- **A new Abstract category** holds the gradients: the eight Codioful gradients plus the
  green light-leak and the teal wave. It sits right after Minimal in the pickers.
- **All of the new ones are free** (level 0, no price): the user picked them to use, not
  to earn. The existing locked ones keep their locks.
- No id is `aurora`: the tests (and old settings) rely on it falling back to Graphite.
- All 288 contrast checks still pass; the glass adapts to each photo's average colour.

### Scrolling rows

- **Nav:** when the bar is too narrow for every tab, the tabs scroll sideways and a round
  arrow appears on each side that hides a tab — only that side, only while something is
  hidden — over a fade. Arriving on a tab from elsewhere scrolls it into view. The streak
  and level no longer wrap onto two lines when the bar is tight.
- **Today's tasks** are one row (`CardRail`): fixed-width cards that snap as they scroll,
  the same edge arrows, and "See all N" to unfold the row into a wrapping grid ("Show
  less" folds it back). The old cap of six cards is gone — the row holds them all.
- **Finished tasks stay off Today**: marked done, or with the estimate used up (pace
  status "done").
- Both use one hook, `useScrollEdges`, and one set of styles (`.scroll-edges`,
  `.scroll-arrow`), so any future sideways list behaves the same way.

## Focus screen, second attempt: its own tab, a visualizer, Spotify (user request, 2026-09-22)

The parked first attempt (`docs/parked/focus-visualizer`, 2026-09-21) is superseded and
deleted; git still has it. Nothing from it was moved back: the screen, the capture, the
analysis and the drawing were all rebuilt to the new brief.

### A tab, not a page

- **`/focus` is a browser tab of its own, not a section of the app.** It renders outside
  `AppShell` (no nav, no page chrome) and has no link in the navigation. Starting a session
  anywhere opens it: the Start dialog (Today, Tasks, Routines), the timer card's expand
  button, and the extension popup (`chrome.tabs`). Closing the tab changes nothing: the
  server owns the session, so the dashboard card carries on and the tab can be reopened.
- **One tab, reused.** Before opening, the caller pings a `BroadcastChannel` and waits
  180 ms. A tab this page opened is a named window (`komogon-focus`) and can be focused
  through `window.open('', name)`; one opened by the extension or typed in by hand
  answers the ping but cannot be pulled forward (browsers do not let a background tab take
  focus), so the caller says "open in another tab" rather than opening a second. The
  focus tab refetches the session when pinged, so a session started on the dashboard
  appears there at once rather than on the next poll.
- **The focus tab owns the alert sounds while it is open.** It heartbeats every two
  seconds; the dashboard mutes its own chimes while it hears one, so a block boundary
  rings once, not twice.
- **`useSessionController` is the timer; the card and the screen are views.** The tick,
  the events, idle detection, sounds and the whole end flow with its four dialogs moved
  out of `TimerCard` into `lib/session-controller.tsx`. The focus screen runs the same hook,
  so neither surface holds timer state the other lacks, and a pause on one shows on the
  other on its next fetch.
- **Leaving:** Escape or the X calls `window.close()`, which only works on a tab a script
  opened; a hand-opened tab falls through to the dashboard 150 ms later.

### What the screen says

- **Subject and child come from the node tree** (`focusContext` in core): the root course
  and the task under it. A root task is its own subject with no child line; a routine
  session shows the routine's title alone. Rendered as "ECO220 / for Unit 1".
- **Elapsed is this session's focused time**, ticking on independently of the pomodoro
  countdown. **Expected** is the task's estimate; without one, a length the user chose for
  the session; without that, a routine's estimate; otherwise nothing, and there is no bar
  (`expectedMinutes`, `focusProgress` in core). Going past the expectation fills the bar,
  turns it amber and says "past the 1:00:00 expected" rather than clamping quietly.
- An unlimited session's clock already is the elapsed time, so the elapsed line is
  dropped there unless there is an expectation to measure it against.
- **Ending on the focus screen** shows the minutes and, with phrases on, the phrase, then
  offers "Start another" or "Close". The reward overlay stays on Today; a second copy of it
  is not what a focus room is for.

### The visualizer

- **No bars.** Four ribbons drift across the bottom fifth of the screen and two fainter
  ones across the top, three fluid rings sit around the clock, a bloom behind the digits
  lifts on a kick, and a single ring rolls out from the centre on a drop, with the rings
  splitting briefly into the two palette colours. Everything is stroked with
  `shadowBlur` and composited with `lighter`, then masked so nothing ends on a hard edge.
  The ribbon bands were moved out to 5-19% and 73-94% of the height after the first pass
  crossed the progress text.
- **Ring noise uses whole-number harmonics of the angle** so a ring closes on itself;
  the free-running ribbon noise left a visible seam at the rightmost point.
- **Analysis lives in core** (`visualizer.ts`, 19 tests) and drawing in
  `packages/ui/src/visualizer-render.ts` as a pure function over a context; the React
  component owns only the canvas, its size and the loop. That split is what let the
  picture be checked at all: the Claude browser pane never fires an animation frame, so
  the renderer was driven by hand on a full-size canvas with a scripted drop.
- **The low end is 20-140 Hz**, RMS over those bins, never the spectrum's mean. A hit is
  the low end at 1.4x its rolling average over the last 1.5 s _and rising this frame_
  (a sustained kick is one hit, not one per refractory period); 2.1x is a drop. A
  brickwalled track sits at ratio 1 and fires nothing, which the tests pin down.
- **Attack is near-immediate, release exponential** (`smooth()`, 40/s up and 4.5/s
  down), frame-rate independent; a stalled frame after a hidden tab is clamped to 100 ms
  so nothing snaps. Pulse and shock are envelopes that only ever decay.
- **Idle breathes**: three sines that never line up, so silence drifts rather than
  freezing or pulsing. Under audio the breath stays as a floor so a quiet passage never
  goes still.
- **Intensity scales amplitude, glow and alpha only**; the analysis does not change.
  **Colour** is accent (read back from `--accent`, so a custom accent counts), a custom
  hex, or a gradient from the accent to a hue 70 degrees on (`visualizerPalette` in core).
- **Performance:** typed arrays and a fixed ring buffer, no per-frame allocations beyond
  the mask gradient; colour strings and the bloom gradient rebuilt only when the palette
  changes; DPR capped at 1.5 and dropped to 1 after 45 slow frames; the loop stops on a
  hidden tab and restarts on show; the first frame is drawn synchronously so the light is
  there with the canvas. Reduced motion draws that one frame and stops.

### Audio permission

- **Display audio, never the microphone.** `getDisplayMedia({ video, audio })`, video track
  stopped at once, audio never connected to the output. Browsers do not remember the share,
  so the state is idle on every visit and capture only starts from a click.
- **The modal is the click.** It appears 900 ms after the timer, once per visit, with
  **Yes / No / Never ask again**. Yes turns the visualizer on (if it was off) and starts
  the browser's picker on that same click; No closes it until next visit; Never sets
  `visualizer.promptDismissed`, which only stops the automatic prompt. The controls sheet
  and Settings can still turn the visualizer on and share audio afterwards.
- **Four failures are states, not errors:** unsupported, dismissed, shared without audio,
  stopped from the browser's banner. Each is a line under the Share button; the picture
  idles through all of them. Turning the visualizer off releases the share.
- **Settings** has the on/off toggle, "Never ask again", intensity and colour, under a
  new "Focus screen" group; the focus screen's controls sheet shows the same component
  plus Share audio, since the share belongs to the tab that draws.

### Spotify

- **The API owns the tokens, like Google Calendar.** Same separate consent flow, same
  signed `state` (now `services/oauth-state.ts`, shared with the calendar route and
  carrying a return-to so the callback lands on the focus screen or Settings), refresh
  token encrypted with `TOKEN_ENCRYPTION_KEY`, in a `spotify_connections` table
  (migration `0007_spotify`). The access token is cached encrypted with its expiry so a
  poll every five seconds refreshes once an hour, not every time; a token that dies early
  is retried once with a fresh one; a refresh that fails marks the row revoked and the
  card offers Reconnect.
- **Scopes are the three playback ones** and nothing about the library. Play, pause and
  skip show only for a Premium account (`product` from `/me`); Spotify's refusals
  (no active device, not premium) come back as 409 with a reason and become a toast.
- **The portal polls `/api/spotify/now-playing` every 5 s only while the focus tab is
  visible**, keeps the last answer on an error ("last known"), and never persists it to
  disk (`['spotify']` is volatile). The progress bar moves by the clock between polls.
- **Not configured on the server means not shown at all**: no "Connect" that cannot
  work. Not connected is one quiet link; connected with nothing playing is one line.
  Twelve API tests cover the flow with an in-memory Spotify.

### Verified in the browser pane

Starting from the dashboard reused the already-open focus tab; the tab picked the session
up on the ping; countdown, elapsed and the 1:00:00 expectation from the task's estimate;
the prompt, Yes (enable + share request), Never ask again and the reload without a prompt;
gradient and intensity written through the sheet and read back from the API; pause on the
focus screen showing as Paused on the dashboard, and resume; phone width and a 960x460
window; closing the tab with the session carrying on; the stop flow through "End early?"
and the review to the saved state. The renderer was checked by driving `renderFrame`
directly: idle, a scripted drop (shock ring, bloom) and a loud gradient passage with no
false hits. Not checkable here: a real screen share (the pane blocks capture), a real
Spotify account, a new tab actually opening (the pane navigates in place), and the
extension inside Chrome (it builds).

## Velvet is the default background (user request, 2026-09-22)

- **New accounts start on Velvet** (`DEFAULT_SETTINGS.theme.backgroundId`). It is free at
  level 0, so nothing about unlocking changes. Existing users keep whatever they chose.
- **Graphite stays the fallback** for an id that no longer exists (`DEFAULT_BACKGROUND_ID`
  in core and ui): that path is about reading old settings safely, not about taste, and the
  earlier decision to make it the quiet neutral still holds.

## Due dates on the calendar, focus-screen prompt, visualizer polish (user request, 2026-09-22)

- **A due date set on a task shows on the week view** under the day it falls on, as a
  small chip ("Due · Unit 1"; an assessment shows its title alone), struck through once
  the task is done. It is drawn from the task itself, not from a block, so no sync or
  import can touch it. The `.ics` feed and download publish the same dates as all-day
  events on the user's local day (`due-<id>@komogon`), so a subscribed calendar shows them
  too. They are not pushed to Google as events: the Google sync moves study blocks, and a
  deadline is not a block of time.
- **Nothing on the calendar is deleted by an import or a sync.** Checked rather than
  changed: an `.ics` import upserts routines by UID; a Google sync only ever marks a block
  cancelled when the user deleted that event in Google, and `disconnect` keeps every
  imported block. Due-date chips are outside all of it.
- **The clock is medium weight (500)**, up from the thin 300, which read as faint at
  fourteen rem over a photograph.
- **"Open the focus screen?" after a start**: Yes / No / Never ask again, governed by
  `focusScreen.openOnStart` (`ask` | `always` | `never`) in Settings > Focus screen. The
  question keeps the page mounted, so a start from Tasks or Routines asks first and goes
  to the dashboard after the answer. The extension popup cannot ask, so `ask` opens the
  tab there and only `never` holds back. The timer card's expand button ignores the
  setting: pressing it is the answer.
- **The accent colour is computed from the setting** (`accentHexFor` in packages/ui) rather
  than read back from `<html>`. The first pass read the DOM during render, before the
  theme effect had applied the accent, and so always saw the boot-time indigo.
- **More bloom:** every ribbon and ring is stroked twice, a wide faint pass with double
  the blur under the thin bright line. **Opacity** (`visualizer.opacity`, default 0.85)
  multiplies every alpha in the frame; intensity still governs amplitude and glow.
- **Six more backgrounds are gated** so levels and XP keep something to open: Summit Glow
  (level 3), Polar Lights (5), Tokyo Haze (8), Prism (10), Kualoa (500 XP), Nebula
  (700 XP). Velvet, the default, stays free. Anyone already on one of them keeps it;
  availability is only checked when a background is chosen.

## Glass is the default panel surface (user request, 2026-09-22)

- **New accounts start with `theme.panel: 'glass'`** instead of opaque, so dense panels
  (tasks, tables, settings) are frosted over the background like everything else. Opaque
  and custom remain a choice in Appearance; existing users keep what they have.

## Focus screen round three: progress from prior work, the prompt, the edge, achievements (user request, 2026-09-23)

- **Elapsed starts where the task stands.** The focus screen's elapsed figure and bar
  include the work already logged on the task (`loggedWorkMinutes` from pace, which counts
  finished sessions only, so it is stable during a session) plus this session's focused
  time. Thirty-five minutes logged earlier means the bar opens at 35:00 against the estimate.
- **The audio share lives for the whole visit.** Turning the visualizer off no longer stops
  the capture; only "Stop listening", the browser's own sharing bar, or closing the tab
  do. Toggling the visualizer off and on therefore keeps reacting to the music. This is
  what read as "broken": the picture came back idle because the share had been dropped.
- **Opening the tab is synchronous now.** The first version pinged other tabs and waited
  180 ms before `window.open`, and when a focus tab already existed it only tried to focus
  it, which browsers often ignore, so "Yes" appeared to do nothing. `openFocusTab` now
  runs `window.open('', 'komogon-focus')` on the click itself: an existing tab this page
  opened comes back and is brought forward, otherwise the fresh window is sent to `/focus`.
  A tab opened by the extension or by hand cannot be found this way, so a start from the
  portal in that case opens a second one; the extension still reuses through `chrome.tabs`.
- **The prompt has four answers**: Yes, No, Always open it, Never open it. Always and Never
  write `focusScreen.openOnStart`; Settings > Focus screen shows the same three-way choice.
- **A glowing edge** is the fourth layer: a rounded frame just inside the viewport, in the
  palette's two colours, breathing with the level and brightening on a hit, drawn as a
  wide faint halo under a thin line. The ribbon mask now applies to the ribbons alone, so
  the edge and the rings keep their sides. **Waves, circles and the border can each be
  turned off** (`visualizer.ribbons` / `rings` / `border`).
- **Achievements arrive like a console's**: a banner slides in at the top ("Achievement
  unlocked", the badge, its description) with confetti, one at a time, from wherever a
  badge is earned: a session ending on the dashboard or the focus screen, a routine ticked.
  It is driven by a window event (`announceAchievements`), so callers need no provider and
  the focus tab works the same. The Badge toasts setting turns the banner off, Confetti
  the confetti. The extension popup throws confetti and names the badge in its summary.
- **The end of a session is a score sheet**, shared by the dashboard overlay and the focus
  screen: the XP earned as the score with its bonus lines, focused / break / idle time,
  streak with the best, the level with the XP to the next and its bar, the achievements
  unlocked, revealed in turn. This deliberately shows XP at the end of a session, which the
  earlier "XP lives on Achievements" decision had removed: the user asked for a score.
- **Dashboard tidy-up:** the daily quote sits inside the timer or plan panel under a rule
  instead of as its own card at the bottom; "About 33 m across 1 item today" moved from
  under the greeting into the plan card. The routines adherence caption has more room
  above it.

## Doloop becomes KomodoIt, with a dragon mark (user request, 2026-09-23)

- **The app is KomodoIt** everywhere: display text, the extension name, workspace packages
  (`@komodoit/*`), storage keys (`komodoit.*`), window messages (`komodoit:*`), the ICS
  `PRODID` and UIDs, the Google event marker (`komodoitBlockId`, write-only, so no
  matching breaks) and `KOMODOIT_BACKGROUND_SRC`. "Pomodoro" is a different word and was
  left alone. A brief "Pomodo" name was dropped before it shipped.
- **Old browser storage carries over once**: `lib/rename-migration.ts` moves `doloop.*`
  localStorage keys to `komodoit.*` before anything reads them (so a dev sign-in survives)
  and drops the old `doloop` IndexedDB cache, which refills on the first fetch.
- **The mark is the user's dragon** from `POMODO.svg`, verbatim, in `packages/ui/src/logo.ts`.
  It is wider than tall, so the square box holds its width and centres it vertically. It
  keeps the white-on-indigo-to-violet tile. Icon insets were tightened by about 2 units
  of 64 because the wide shape otherwise sat small in the tile.
- Folder names on disk (`Documents\Doloop\Doloop`) were not renamed.

## KomodoIt spelling, and ninety-odd more quotes (user request, 2026-09-23)

- **The brand is written KomodoIt**, capital I, everywhere it is shown: nav, titles, the
  extension manifest, calendar descriptions, the mark's alt text. Package scopes
  (`@komodoit/*`), storage keys and event names stay lowercase; they are identifiers.
- **The quote pool grew from 40 to about 130** with the list from Kevin Kruse's Forbes
  "Top 100 Inspirational Quotes" (2013), each carrying that page as its source. Left out:
  seven that run past the card's 30-word limit, two attributed to "Unknown" (the card never
  shows a quote without an attribution), and the one attributed to Bill Cosby. "Jesus" on
  the page is cited as Matthew 7:7. Attributions are as the page gives them; several are
  popularly attributed rather than verified, which was already the case for the list.

## Ticking off a routine plays a small celebration (user request, 2026-09-23)

- **The tick itself**: the box squashes on press and springs back past full size, a ring
  pulses out of it, the check draws itself in, and a strike draws across the title. A
  handful of sparks (`fireSparks` in `@komogon/ui`) fly from the box: accent with a little
  gold and green, under 0.7 s, on a canvas only as big as the burst. Deliberately smaller
  than confetti or the reward burst; a tick is a small win and can come several times a
  minute.
- **In a due list the row then slides off and the list closes up** (Today's routines card,
  "Due now" on Routines). The refetch after a tick would unmount the row within
  milliseconds, so `useTickedRoutines` holds the list still until the last tick has played
  (about 0.95 s). The row is drawn done straight away, before the server answers; a failed
  tick puts it back with the error toast. The week grid ticks in place without folding.
- **The "+N XP" toast is unchanged** and still arrives when the server answers.
- **Motion rules as before**: every duration and delay is a multiple of `--dur-slow`, so the
  motion setting and the OS reduced-motion preference jump straight to the end state, and
  the sparks check both before drawing.
- **Not added**: a tick sound. The alert sounds belong to sessions; ask before adding one.

## KomodoIt becomes Komogon, with a new mark (user request, 2026-09-23)

- **The app is Komogon** everywhere KomodoIt was: display text, the extension name,
  workspace packages (`@komogon/*`), storage keys (`komogon.*`), window messages
  (`komogon:*`), the IndexedDB cache, the ICS `PRODID` and UIDs, the Google event marker
  (`komogonBlockId`, write-only, so nothing that matches on it breaks) and
  `KOMOGON_BACKGROUND_SRC`. The two sections above are left as written, as history.
- **Old browser storage still carries over once**: `lib/rename-migration.ts` now moves both
  `komodoit.*` and `doloop.*` localStorage keys to `komogon.*`, newest name first so a key
  saved under both keeps its later value, and drops both old IndexedDB caches.
- **The mark is the user's `komo21.svg`**, verbatim, in `packages/ui/src/logo.ts`: Komogon's
  face, front-on, with the eyes and nostrils cut out and the jaw as a band beneath. It is
  nearly square (857 x 827 of its 1095 units), so the box holds its width and centres it
  vertically. It keeps the white-on-indigo-to-violet tile. The icon insets went back to
  their pre-dragon values (favicon 11, apple-touch 12, extension 6 / 10 / 11 of 64): at the
  dragon's tighter insets the square face crowded the tile.
