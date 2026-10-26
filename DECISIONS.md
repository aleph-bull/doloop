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
- **Licensing**: the Unsplash photographs are used under the Unsplash License and credited in `public/backgrounds/CREDITS.md`. `still-water` (macOS Tahoe's "Tahoe Beach Night" wallpaper, Apple's copyright) was removed on 2026-10-19; anyone who had it picked falls back to the default through `resolveBackgroundId`.

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

## Komogon runs on this PC whenever it is on (user request, 2026-09-23)

- **Just for the user, not hosted**: a `Komogon` shortcut in the Windows Startup folder runs
  `scripts/local/start.mjs` at sign-in. It starts the API and `vite preview` hidden and
  detached, bound to this PC only, on the dev ports 5173 and 8787, because the extension
  only talks to the portal on 5173.
- **It runs a frozen copy of the last build** (`apps/*/.local-build`), not `dist`, so the
  builds `pnpm check` makes during development never change the app in use.
  `pnpm local:update` builds, then swaps the copy only if the build passed.
- **Its data is separate from dev data**: `%LOCALAPPDATA%\Komogon\pglite`, copied once from
  `apps/api/.pglite` on first start. Dev servers and tests keep `apps/api/.pglite`, so
  testing cannot touch what the user relies on.
- **The dev portal now fails on a taken port** (`strictPort`) instead of moving to 5174,
  where it would still proxy to the always-on API and its real data.
- **Two fixes the built API needed**, since only `tsx` had ever run it: the migrations folder
  is found from `dist` as well as `src/db`, and PGlite is left external in tsup because
  bundled it cannot find its `.wasm` and `.data` files.

## Focus bar in two parts, and Tasks above Routines (user request, 2026-09-23)

- **The focus bar keeps earlier work and this session apart**: white (the screen's text
  colour, so near-white on the dark default) for work logged on the task before this
  session, accent for this session. The fill as a whole is the total.
- **Two figures, shorter words**: "27:36 of 1:00:00" (the total studied for the task
  against its expectation; "past" once over, "total" with no expectation) and
  "● 3:00 this session", the accent dot keying it to the accent part. The words are
  smaller and quieter than the figures. Over the expectation, the words, dot and accent
  part turn the warning colour; the white part stays white.
- An unlimited session with no expectation now shows the figures when the task has earlier
  work, since the total then says something the clock does not.
- **Today puts the Tasks row directly above Routines** (after "Upcoming due").
- **A sandbox for testing**: `sandbox-api` (8797) and `sandbox` (5183) in launch.json run
  the API from source on throwaway data (`apps/api/.pglite-sandbox`) and the portal against
  it, clear of the always-on copy's ports and the real data.

## Neon bars replace the glowing border, and a mirrored line (user request, 2026-09-24)

The "no bars" line of 2026-09-22 is superseded: the user found the glowing frame blocky and
asked for a bar visualizer in its place, with plenty of bloom, and separately for a mirrored
line like the oscilloscope traces in music-video visualizers.

- **The border is gone**, not hidden: the `border` setting, its layer and its drawing were
  removed. A stored `border` key is ignored (the API strips unknown visualizer keys).
- **Neon bars** stand along the bottom of the screen: the loudest bin of each band,
  log-spaced from 35 Hz to 14 kHz so an octave is the same number of bars wherever it
  sits (`barBins`, `updateBars` in core, 5 tests), tilted up toward the treble because byte
  spectra roll off there, with a 30/s attack and 6/s release per bar. One path holds the
  row and is filled three times with a narrowing `shadowBlur`, then a thinner whiter core,
  so each bar reads as a tube of light rather than a rectangle. The colour climbs from the
  palette's first colour at the base to its second at the top of the tallest bar.
- **Their own settings**, all flat under `settings.visualizer` so the one-level merge in
  `withDefaults` keeps whichever the user has not touched: `barCount` (8-96, default 48),
  `barHeight` (the tallest bar as a fraction of the screen, default 0.22, so a full-scale
  row stays under the progress line), `barGap`,
  `barGlow`, `barReflection` (the row hung upside down under a hairline shelf, fading over
  half its height; without it the base glows instead) and `barSymmetric` (bass in the
  middle, mirrored outward; only half the bands are analysed and the renderer mirrors them).
- **The mirrored line** is the time-domain waveform (`AnalyserNode.getByteTimeDomainData`,
  read through a new `readWaveform` on the capture), resampled to 160 points by averaging
  windows and softened with a three-tap blur so it flows (`waveformShape` in core, 3 tests).
  A wide soft pass and a near-white core, with the same shape hung under the axis in the
  palette's second colour, or a hue 45 degrees on when the palette is a single colour, so
  the mirror is always a different colour from the line. Both fade over the outer 14% of
  the width through a gradient stroke, so no mask pass is needed.
- **"Where on the x axis it is"** was read as where the line's axis sits vertically:
  `waveformPosition` (0..1 from the top, default 0.18, between the upper waves and the
  clock). Off by
  default, since it is an addition; the bars are on by default, as the border was.
- **In silence** the bars breathe on a swell that wanders along the row (`idleBars`) and the
  line drifts on the ribbon noise, so neither ever lies flat.

## The last routine ticked off fades in place (user request, 2026-09-24)

Ticking the last due routine folded its row away, shrinking the card, then the "nothing
outstanding" line appeared and grew it back: a bounce. Now the tick that empties a due list
(`last` in `useTickedRoutines`) fades and slides without folding, and the empty line fades
in at that row's measured height (`emptyHeight`), so the card never moves. Every other tick
folds away as before. A ticked row on the Routines page keeps its Start button, disabled,
while it leaves, as the dashboard card already did: dropping it shrank the row 44 to 36 px.

## Fun, never pushy, and a new quote every six hours (user request, 2026-09-24)

The user found lines like "Late, but done. Close the laptop now." annoying: nobody wants a
script telling them to sleep, stop, or that they are having a hard day.

- **Greetings and session phrases rewritten** in a playful voice ("Time to shake the
  jello.", "Early grind?", "Start the day off doing what you hate?", "Goblin hours, well
  spent."). Gone: bedtime and rest advice, "do another tomorrow", "try a shorter block next
  time", guilt about gaps ("Don't let today be the gap"), comparisons ("Most people never
  get past three"), and the pep-talk tone of the distracted-session set. Buckets, their
  priority and the placeholders are unchanged. A test in each file fails on the nagging
  words, so they cannot creep back. The research tips (cited, opt-in) were left alone,
  including the four about sleep.
- **Quotes change every six hours**, on local 0/6/12/18 (`QUOTE_PERIOD_HOURS`,
  `quoteSlot`). The slot key, "2026-09-24T12", goes in `quotes_seen.date`, a text column,
  so there is no migration, and it sorts after the bare dates of the one-a-day rows. The
  30-day no-repeat window stays. Four a day takes 33 days to use the 133 quotes, so nothing
  repeats in quotes mode; the 35 tips run out in nine days, after which the half seen
  longest ago comes back into play, never the one just up. `/api/quote` returns `nextAt`,
  and the portal holds the quote fresh until then and refetches on the dot. The extension
  popup shows each slot's quote once, where it used to show one a day.

## Cloud mist, a beat-drop switch, folding visualizer settings (user request, 2026-09-24)

- **Cloud mist** is a new layer along the bottom edge, on by default: a bank of light that
  brightens toward the edge in the palette's second colour, with seven wide soft discs
  drifting through it, each on its own noise so they never move as one. It breathes with
  the same smoothed low end as everything else (`motionLevel`), swells on a hit, and
  settles to a faint slow breath in silence. It is gradients only, no strokes and no
  `shadowBlur`, so it is the cheapest layer on the screen. Settings: `mistHeight` (how far
  up it reaches, default 0.3) and `mistDrift` (speed, default 0.5). It is drawn after the
  ribbon mask and before the rings, so it fades at nothing and everything else stays crisp
  over it.
- **Beat drop circle is its own switch** (`shockwave`, on by default). It only gates the
  ring that rolls out on a drop; detection runs regardless, and the circles' colour split on
  a drop is part of the circles layer, not this one.
- **Defaults**: mist, waves and the beat-drop ring on; circles, sound bars and the mirrored
  line off. Anyone who has saved visualizer settings keeps what they had, since the merge
  only fills keys that are missing.
- **Each visualizer folds its own settings away while off.** The list is one switch per
  layer; a layer with more to say (mist, bars, the line) drops those controls down under its
  switch when turned on and folds them up when turned off. `Reveal` in the UI package does
  this with a grid row going 0fr to 1fr, so nothing is measured and nothing jumps; the
  folded content is `inert` and hidden from readers. Reduced motion turns the fold off.
  Intensity, opacity and colour stay above the list: they are the visualizer's, not any
  one layer's.
- **No small all-caps labels outside the focus screen.** "Session complete" over the score
  sheet is gone (the title and the score already say it); "Achievement unlocked" on the
  toast stays, in sentence case. The focus screen's phase label keeps its tracking: it is a
  clock face, not a heading.

## The beat-drop ring needs a loud low end, not just a jump (user report, 2026-09-24)

Singing without instruments set the ring off constantly: the low end there is nearly empty,
so its rolling average is tiny and a soft note or a breath is many times that average while
being nowhere near loud. Two changes in `analyseFrame`: the ratio is now taken against an
average floored at 0.04, and a drop also has to clear an absolute `dropFloor` of 0.24 in the
low band (a hit still only needs 0.06). A real kick over a real bed is unchanged, and the
new test pins the quiet case.

## Wave count, and clouds that look like clouds (user request, 2026-09-24)

- **`waveCount`** (1-12, default 4) sets the lower band's waves; the upper band carries
  half as many, at least one. The palette's colour steps are built once (18 shades) and
  picked by position along the row, so a row of any length still sweeps from one colour to
  the other. A fuller band dims each wave by the square root of the crowding so twelve
  waves read as light rather than a wall.
- **The mist is a texture now, not shapes.** The user wanted a realistic cloud, not a
  cartoon one, and drawn discs or puffs can only ever be the latter. `makeMistTexture`
  (ui) renders fractal value noise (`cloudNoise` in core, five octaves, periodic in x so it
  tiles) into a 768x192 picture shaped to be dense at the screen edge, thin upward and end
  in a wandering top with holes and wisps at every scale, tinted from the palette's second
  colour at the base to the first at the top and lightened where dense. Two such banks,
  different seeds, are scrolled along the bottom at different widths and speeds in
  opposite directions, so they slide past each other as cloud layers do; the low end lifts
  and brightens both, a hit swells them. Built lazily on the first mist frame (a few tens
  of milliseconds) and kept per palette.

## The mist has its own opacity (user request, 2026-09-24)

`mistOpacity` (0.1-1, default 1) scales the cloud layer on top of the visualizer's opacity,
so the clouds can be faded on their own without dimming the waves or the ring. It is the
third slider under the Cloud mist switch.

## Spotify is gone (user request, 2026-09-24)

The user did not want the now-playing card or the connect flow, so the whole feature was
removed rather than hidden: the routes, the two services, the portal card and settings, the
API client and query keys, the volatile-cache rule, the CSS, the env variables and the
setup notes. Migration `0008_drop_spotify` drops the `spotify_connections` table; the 0007
migration stays so existing databases replay cleanly. `oauth-state` stays, since Google
Calendar's consent flow uses it. The visualizer settings test that lived in the Spotify test
file moved to `visualizer-settings.test.ts`.

## Templates, free sessions, undo, and a quieter focus screen (user request, 2026-09-24)

- **A template for the items under a node** (`childDefaults`, a JSON column on `nodes`,
  migration 0009): type, estimated hours, due time, count unit and colour. Set from the
  template button on any row of the task tree, at any level; a new item's dialog fills in
  from the nearest ancestor that has one, walking up from the chosen parent, and refills
  when the parent is changed while creating. Every field is optional and only what is set
  is a default; the node's own fields and anything already saved are untouched. A row with
  a template shows a "Template" chip. Saving a template with nothing set clears it.
- **A rule between top-level items** in the task tree (`.tree-root + .tree-root`), so one
  course ends where the next begins.
- **Free sessions**: the start dialog's "Start without a task" line runs the timer for
  nothing in particular. The session has neither a task nor a routine (the check
  constraint is now "at most one", not "exactly one"); its title is "Free session", the
  minutes count toward streak and level as always, and the calendar block carries the
  title. There is no review, since there is nothing to review. The dialog also opens as a
  free session when there is nothing to pick, rather than refusing to start.
- **"Open the focus screen"** sits in small text under the dashboard's Start button.
- **Ctrl+Z and Ctrl+Y** (or Ctrl+Shift+Z) undo and redo the small reversible things:
  editing, adding (taken back by archiving, never deleting), ticking and archiving a task,
  ticking a routine, logging a tracker for today, and planning, editing or removing a
  block. Each entry carries its own inverse call (`lib/undo.ts`, recorded from the
  mutation hooks in `lib/queries.ts`). Deliberately not undoable: settings, rewards and
  purchases, routine and tracker edits, ICS imports, grade components, account actions,
  anything touching many rows at once. The shortcut yields to a text field or an open
  dialog, where the browser's own undo is the right one. The stack lives for the tab.
- **The clock waits for the audio question**: while the share prompt or the browser's
  picker is up, the focus screen pauses a running clock and resumes it once the question
  is answered or the picker closes, however that went. A pause the user chose before the
  question is left to them to end.
- **Try again after a share fell short**: a dismissable line under the top bar says why
  (no audio ticked, or nothing shared) with a "Try again" that reopens the picker. It never
  shows once "Never ask again" has been chosen, and each new attempt earns it back if it
  fails again.
- **Hide now hides everything that stays on screen when the hands are still**: the clock,
  the task and the progress go; the phase word ("Paused", "Focus · cycle 2") stays, a
  touch larger, and the visualizer and background are untouched. The controls still come
  back on movement, so the eye button is always reachable. It is the same per-session
  `showTimer` flag, so the dashboard card still just hides its digits.
- **Idle detection is gone**: the portal hook, the setting, the "Still studying?" dialogs,
  the extension's chrome.idle listener and its permission, and the two timer events. The
  timer has no idle phase any more; a session saved mid-idle by an older build reads as
  paused, about to resume into work (`normalizeTimer`). `idleSeconds` stays on sessions
  as a record of old rows and is 0 on every session since.
- **Early ends still pay**: ending before the first work interval or the planned end is
  still "early", but the XP is only withheld while the session is under ten focused
  minutes (`XP.MIN_REWARDED_MINUTES`) and nothing was finished. Ten solid minutes pay for
  ten minutes; marking the task done or ticking the routine pays however short it was.
  The "End early?" warning only appears when stopping would actually earn nothing, and the
  score sheet's note says why. Confetti follows the XP, not the early flag.
- **Visualizer presets** (`visualizer.preset`): how it listens. "Bass heavy" is the
  original analysis. "Balanced" listens to a wider low end (20 to 200 Hz), counts a
  smaller jump as a beat and settles a little slower. "Calm and mellow" reaches to
  260 Hz, hears a gentle swell as a beat, needs far less for a drop, and lets the light
  linger. "Custom" builds a tuning from six sliders: sensitivity, drop threshold,
  smoothness, memory (the window a beat is judged against, 0.5 to 4 s) and the band's two
  edges in Hz (20 to 500, at least 10 Hz apart). The bars' attack and release follow the
  same preset. It all lives in core (`visualizerTuning`, `customTuning`, tested), the
  sliders flat under `settings.visualizer` like the rest.

## The dashboard panel is the start button, and things fade out (user request, 2026-09-27)

- **The plan panel no longer picks a task for you.** Where it showed the top of the day's
  plan with "Start 2 h 59 m", it now says "Ready when you are", the day's total, one big
  "Start a session" (the general dialog, nothing chosen in advance) with "Open the focus
  screen" beside it, and under a rule the four most pressing tasks in small text with
  their status, suggested minutes and due date. The header's own Start button and focus
  link moved into the panel. Clicking a pressing task scrolls its card in the Tasks rail
  into the middle of the screen (sideways within the rail too) and rings it with the
  accent for a moment (`.node-card.is-spotlit`); a task with no card there goes to the
  task tree. Smooth scrolling and the ring both respect reduced motion.
- **Toasts fade before they go**: the last 260 ms of a toast's time plays `toast-out`
  (`is-leaving`), so "+12 XP" sinks away instead of blinking out.
- **Modals fade before they close**: `Modal` adds `is-closing`, plays `modal-out` with the
  scrim lifting, and only then calls `close()`; reduced motion closes at once. The score
  sheet keeps its last summary mounted through the fade so the Done button is not a
  vanish. Every other dialog gets the same exit for free.
- **"Most pressing" folds** (user request, same day): the heading is a button with a
  chevron that turns as the list drops down or folds away through `Reveal`. Folded by
  default (the user found it open too busy) and drawn as an accent pill so it reads as a
  control; once toggled, the choice is kept in this browser (`komogon.pressing-open`), a per-device
  convenience rather than a setting.
- **The start dialog's "Studying" is a tree, one page at a time** (user request, same
  day): `SubjectPicker` replaces the flat select. It opens on the courses (or on the page
  of whatever is already chosen), a course's arrow turns the page to its children with the
  count beside it, clicking a name chooses it at any level (a course can be studied as
  itself), and Back and Reset sit above the list with the path between them. Routines are
  a folder at the top level. The chosen item is named under the list, since it may be on
  another page. "Start without a task" stays where it was.
- **The picker, second pass** (user request, same day): it always opens on "All courses"
  rather than on the chosen item's page; the "Studying" label is gone; "See all courses"
  replaces Reset, and Back and it only show once inside a course. A line above the list
  names what is chosen and where it lives, since that may be on another page. Rows with
  things inside open on click (with "n items" and a chevron); a small mark at their right
  studies the course or unit as a whole. "Just the timer" is the first row at the top,
  replacing the separate free-session box and its link, and Routines the last.
- **Nothing is chosen until the user chooses** (user request, same day): the dialog no
  longer preselects the first task. The chosen line reads "Nothing chosen yet" in a quiet
  grey until a row is picked, and Start stays disabled until then. A task handed in from
  a card's own Start button is still preselected.

## Analytics becomes a recap, and the dashboard gets its numbers (user request, 2026-09-28)

The Analytics tab was a grid of same-weight text cards that often said the same thing, with
a stray "Fewer" toggle and a hole in the grid. The user asked for something closer to a
Wrapped-style recap: visual, celebratory, encouraging.

- **Tabs**: This week, This month, All time, By task. "By task" is the old advanced view,
  unchanged. `?tab=overview` still lands on All time. The old highlight grid and the
  `AnalyticsOverview` component are gone; the week highlights endpoint stays for the API
  tests and the extension, and its cards now only feed "Worth knowing".
- **One call per range**: `GET /api/analytics/recap?range=week|month|all` returns
  everything the page draws, computed in core (`recap.ts`, 24 tests) from completed
  sessions, nodes, planned blocks, the streak, grades and XP. A range switch keeps the last
  render up, dimmed (`keepPreviousData`), rather than flashing a skeleton.
- **Hierarchy**: a hero (one count-up number, a change chip, one sentence, the weekly goal
  ring, level progress, "Share my week"), then the equivalents strip, then a bento of
  charts, then streaks, the trophy shelf, "Worth knowing" (at most four), and a proper
  weekly review button.
- **Encouraging by construction**: `recapSummary` never words a drop as a drop. A lower
  week gets a neutral grey chip naming last week's total and "Every session counts. You
  showed up N times." A range whose previous one had under 30 minutes (`MIN_BASELINE_MINUTES`)
  is a first: "Your first week is on the board. Here's where you started." and a "First
  week" chip, never "2.8 hours vs 1 minute". A month in progress is compared with the same
  stretch of last month, not all of it.
- **No redundant cards**: the highlight keys the charts already make (hours total and up,
  best week and day, streak, planned kept, sessions up) are filtered out of the insights.
- **No holes**: the bento's rows are packed in code (`packTiles`): each wide tile shares a
  row with a normal one, alternating sides; the rest go three to a row; a leftover pair
  becomes normal plus wide, a lone leftover takes the row. Below 900 px it is one column.
  There is no tall tile size; it could not be packed without gaps.
- **Charts are hand-drawn SVG** in `@komogon/ui` (`components/Recap.tsx`), not Recharts or
  Chart.js: the existing charts were already dependency-free, and the radial clock, gauge
  and rings are simpler drawn than configured. Week or month bars with last period as
  ghost bars and the best day labelled; a 24-hour radial clock with a label ("You're a
  night owl 🦉"); a course donut; stacked days by course (week); the cumulative climb with
  milestone dots at 10/25/50/100… hours (all time, from two studied days); the six-month
  heatmap (all time); a planned-kept gauge; a focus-quality ring from review answers;
  session-length histogram; weekday columns (month and all time); study against grades
  (only once three courses have both a mark and study time, worded gently).
- **Chart rules** (from the dataviz guidance): one series in the accent; several in the
  existing `--chart-1..5`, which passed the palette validator on the dark panel (worst
  adjacent CVD ΔE 8.4). A course's colour follows its place in the task tree, not its rank
  this week, so it keeps its colour across ranges; time with no course is neutral grey.
  Tooltips on hover and keyboard focus, a "Show as a table" fold under every chart, text
  in text tokens, 4px rounded bar ends, hairline grids.
- **Equivalents** (`equivalents.ts`, one config file, 11 tests): songs, albums, podcasts,
  pizzas, bread, novels, nights of sleep, marathons (4.5 h), walking at 5 km/h with a named
  distance ("Toronto to Niagara Falls"), and the Toronto to Tokyo flight (13 h). Each has a
  range of totals it reads well for, so small totals get small units. Films and TV seasons
  come from a curated list of 21 titles with their TMDB ids; runtimes and posters are
  fetched by the API (`services/tmdb.ts`) with `TMDB_READ_TOKEN` or `TMDB_API_KEY`, cached a
  week in memory and a day plus the on-disk query cache in the portal, with TMDB's
  attribution line under the strip. Without a key, or when TMDB fails, the listed runtimes
  are used with "~" and an icon replaces the poster; a broken image also falls back to the
  icon. The dice deals a new hand.
- **Streaks**: a flame that grows and reddens with the run, this week as seven dots with
  today ringed, the next milestone ("2 more days to a 7-day streak 🔥"), days studied out of
  the last 30 as a ring, and a line about freezes on hand. Streak freezes already existed
  (the shop), so no new grace-day mechanism was added; "a study day" is the existing
  streak rule, a session of at least the streak minimum in the user's timezone.
- **Trophy shelf**: biggest day, biggest week, longest session, longest streak, most tasks
  in a week, earliest start and latest finish (these two only after three sessions, and
  ignoring any session left running for 12 hours or more). A record set this week wears
  NEW with a shimmer, and sparks fly off it the first time it is seen (remembered in this
  browser only).
- **Personality**: Night owl, Early bird, Weekend warrior, Deep diver, Sprinter or
  Consistent climber, from at least five sessions and two hours, with the reason on hover.
  **Forecast**: "At this pace you'll hit 100 hours by October 24 🎯" from the last 28 days.
- **Share my week**: a 1080 px square drawn on a canvas in the browser and downloaded as a
  PNG; nothing is uploaded.
- **Dashboard strip** (`GET /api/analytics/dashboard`): all-time hours counting up, this
  week in a ring against the new **weekly goal** (`settings.goals.weeklyMinutes`, default
  5 hours, set in Settings under Pace and streaks), the streak beside the best, a seven-day
  sparkline, and one comparison that changes daily and links to Analytics.
- **Motion**: count-ups, staggered rise-in, bars grow from the baseline and rings fill when
  scrolled into view, hover lift. The app's motion setting and the OS preference show the
  finished state at once. Skeletons while loading; every tile has an empty state.
- **Not done, left for later**: a TMDB logo image in the attribution (the text line is
  there); seasonal or yearly recaps; badges tied to equivalents; progress rings per unit on
  Analytics (the task tree already shows progress bars).

## Deleting time from sessions, session history, and the computer falling asleep (user request, 2026-09-28)

The user left a pomodoro running overnight: with breaks and work starting on their own it
logged 5 h 30 m of focus and 728 XP, with three badges.

- **Delete time** (`POST /api/sessions/:id/trim`, `trimFocus` in core `session-edit.ts`):
  the user says how much focus to take off; it comes off the end with the breaks that ran
  alongside it, at the session's own focus-to-break mix, since a session stores totals and
  not a timeline. That mix is exact for the case this exists for, a forgotten session
  cycling on its own, and one for one on a session without breaks. The dialog says where
  the end lands before anything changes ("This means you ended at 3:12 AM"), what focus is
  left, and the XP that comes off. A session always keeps its first minute.
- **XP** scales with whole focused minutes (new over old), so every bonus that was a share
  of the base comes off in step; the difference is taken from the user's total with a
  negative `session` ledger row, and the level recomputed. **Badges**: of the ones that
  session unlocked, any that no longer hold are taken back (`revokeLapsedBadges`); badges
  earned elsewhere, or still true on other study, stay. The calendar block that records
  the session is shortened, and pushed to Google if it was synced. The streak is left as
  it was: a day already counted stays counted. Not undoable with Ctrl+Z; it is confirmed
  in its own dialog instead.
- **Session history** is a section of Settings (`#history`, searchable as history, delete
  time, forgot to stop): finished sessions grouped by day, what each was for, when, focus,
  XP and badges, thirty at a time with "Show older sessions" (`GET /api/sessions/history`,
  paged by start time). A session that ran past midnight names the day it ended. The
  score sheet at the end of a session also offers "Didn't study all of that? Delete time".
- **The computer falling asleep**: the session keeps running (no pause). The portal's
  one-second tick notices when the clock jumps ten minutes or more while the timer was
  running, which only happens when the machine slept, and logs it on the session
  (`sessions.sleeps`, migration 0010; `logSleep` merges the same sleep seen by two tabs).
  On waking, a dialog asks "Your computer went to sleep at 3:12 AM. Did you keep studying
  until now, or did you stop at 3:12 AM?". "I kept studying" marks it answered and changes
  nothing. "I stopped at…" runs the normal end flow (review if on) and ends the session
  back then (`endAt` on `/end`, `trimByWall`), so the XP is for the time before the
  sleep. It is not the removed idle detection: stillness never triggers it, only a clock
  that jumped. Needs a Komogon tab open during the sleep; the extension does not report
  sleeps yet.
- **The user's session was corrected** with the same code, from a one-off script run
  against the always-on data after a backup (`%LOCALAPPDATA%\Komogon\pglite-backup-*`):
  1 h 30 m focused, ending 3:12 AM, 198 XP (530 removed, level 3 to 2), Marathon and Deep
  work taken back, Perfect week kept.

## Recap spacing, and dragging courses (user request, 2026-09-29)

- **Section headings on Analytics** ("Trophy shelf", "Worth knowing") now sit 16px above
  their panels. They used Tailwind's `mb-3`, which the app's own heading reset overrides
  (unlayered CSS beats Tailwind's layered utilities), so they had no gap at all; a plain
  `.rc-section-title` class carries the margin. The equivalents strip's heading gap went
  from 12 to 16px to match.
- **Courses can be dragged into a new order** on Tasks. A grip appears in a course row's
  left margin on hover (always shown on touch screens, where it still cannot drag: native
  HTML drag and drop is mouse only). An accent line shows where it will land; the whole
  course moves with its tasks. Alt with the up or down arrow on the grip moves a course
  one place from the keyboard. Only the moved course is written: its sort order becomes
  the midpoint of its new neighbours. The new order shows at once and is replaced by the
  server's copy when it arrives. Ctrl+Z says "Moved Accounting" and puts it back. Tasks
  inside a course do not drag yet.
- **A new streak flame** (user request, with two hand-animated fire references): the flat
  two-tone icon that wobbled is replaced by `StreakFlame.tsx`, drawn like cartoon fire. A
  round white-hot bulb narrows into a thin tip that leans and hooks; three layers (deep
  red, orange, yellow) each morph through five poses at their own speed with SVG path
  animation, inside a blurred dark-red halo and a pulsing glow. Small tongues break off
  the tip, rise and shrink to nothing (shrinking, not fading: half-transparent orange over
  the dark reads as brown), and sparks drift up. It grows with the streak in five steps:
  at 1-2 days it is small with one breakaway, past 30 days it is tall, fast, glowing, with
  three breakaways and four sparks. At 0 it is a grey, still ghost. Reduced motion draws
  it still. Used on the dashboard strip and Analytics.
- **No gold coins on the trophy shelf**: the coin discs are gone; each record keeps its
  emoji, plain, above its
  figure (a size larger), then the label and date.

## Burst, bar placement, wave bands, and a few conveniences (user request, 2026-09-29)

- **Burst** is a new layer, off by default, after a reference the user sent: a ring around
  the clock (`burstRadius`) with a spectrum spike on every step of it (`burstSpikes`, 16-192,
  `burstReach` for the longest), the two halves mirrored about the vertical so the picture
  is symmetric. The spikes share the bars' band analysis through a second `BarState`, with
  only the bands from the top round to the bottom computed. Behind the ring, when
  `burstBlob` is on, three organic shapes (the two palette colours turned against each
  other and a smaller near-white one) whose edges follow a seven-spike smoothing of the
  spectrum, so the overlaps pile into a lit core, cut away again inside the ring
  (`destination-out`, soft-edged) so the clock sits on the background and not on a disc of
  colour, as in the reference; `burstRays` adds fine hairlines reaching past the spikes. The spikes are stroked in six wedges so the palette sweeps around.
  Drawn over the bloom and under the bars and the line.
- **Bars** can be placed: `barPosition` (fraction of the height, default 0.92) and
  `barWidth` (share of the width, centred, default 0.9). The reflection no longer moves the
  baseline on its own; the position slider does.
- **Waves** have `waveTop` and `waveBottom` switches for the two bands.
- **Conveniences**: `speed` scales the clock the drifting parts run on (0.25x to 2x);
  `fadeWhenSilent` eases the whole picture to a third while nothing is playing;
  `ringCount` (1-6) for the circles, with the palette sweeping across however many there
  are; `waveformMirror` for the line's reflection; and a reset button that puts every
  visualizer setting back to its default while leaving the on switch and the audio prompt
  preference alone.

## Bar opacity, spike opacity, and a burst without spikes (user request, 2026-09-29)

`barOpacity` scales the sound bars on top of the visualizer's opacity, as the mist's does.
The burst gets `burstShowSpikes` (off leaves the glowing shapes and rays, with the ring line
gone too, so the centre reads as a halo) and `burstSpikeOpacity` for the spikes and ring.
The user also asked for a review of user-facing copy that sounded written for the developer;
several hints were deleted or shortened (see the settings panel and Settings page).

## Missed routines leave Today (user request, 2026-09-29)

- **Today's Routines card lists only today's occurrences.** A day that went by unticked no
  longer follows the user onto Today with a "missed" chip. The API's `due` list is
  unchanged: "Due now" on the Routines page, the extension popup and the start dialog's
  routine picker still offer the past week's unticked days, so one can be ticked late.

## The always-on copy moves to ~/.komogon (fix, 2026-09-29)

- **What went wrong**: Claude's desktop app is an MSIX-packaged app, and Windows redirects
  a packaged app's AppData writes, and those of every process it starts, into
  `AppData\Local\Packages\Claude_<id>\LocalCache`. Every always-on copy a Claude session
  started (every `pnpm local:update` since 09-23) read and wrote that private copy of
  `%LOCALAPPDATA%\Komogon`, and died whenever the Claude app restarted. Started from
  outside Claude, the launcher saw no data folder and seeded a new one from `apps/api/.pglite`.
- **Now**: the home is `~/.komogon` (the profile folder is not redirected), so sign-in, a
  terminal and a Claude session all use the same files. The user's data was copied there from
  Claude's private copy as of 14:14:45 (1,084 files, byte-identical; no writes after that).
  Kept, untouched: Claude's private copy, the 09-28 backup (also copied to
  `~/.komogon/backups`), and the copy seeded from test data, renamed
  `%LOCALAPPDATA%\Komogon\pglite-made-from-test-data-20260929`.
- **The launcher never seeds from dev data any more**: with no data folder it logs and
  leaves the API off.
- **`local:start` and `local:update` start the servers through WMI** (`Win32_Process.Create`),
  so they belong to Windows rather than to the terminal or session that asked. The Startup
  shortcut still runs `start.mjs` directly.

## Design philosophy (user, 2026-10-05)

- **Komogon is modelled on running apps and run trackers.** The thesis: the discipline runners build (beat last time, watch your splits, keep the streak, see your progress) carries over to studying and makes people more focused and motivated. When a design choice is open, ask how a good running app would handle the equivalent: sessions are runs, compare against your own past rather than other people, and make progress visible.

## Focus screen readability, smoother visualizer (user request, 2026-10-06)

- **Focus-screen panels are more opaque than elsewhere.** `.glass` and `.glass-strong` inside `.focus-screen` mix 30–38% of `--panel-fill` into their fill, which takes dark strong glass from about 0.60 to 0.73 alpha. Mixing keeps the tint a photo backdrop gives the glass, rather than overriding it with a flat colour.
- **All three named visualizer presets are smoother.** Rise rates are cut by about 20% and fall rates (release, pulse, shock, bars) by about 25%, so the relationships between presets hold (mellow is still the calmest). The custom preset is unchanged, since its smoothing slider already covers that range.

## Review fixes, Tasks play button, QoL, timelapse (user request, 2026-10-06)

### Bugs from the 2026-10-05 review

- **A session is finished once.** `persistTimer` writes the end only `WHERE ended_at IS NULL` and reports whether this request `claimed` it; only the claimant runs `finalize`. `view()` itself finalizes an auto-ended scheduled session it claims, so every path (polling, sleep, events, a new start over a stale one) shares the guard. A second End gets 409. Tests in `session-races.test.ts`.
- **XP changes are one statement.** `addXp(db, userId, delta, { withLevel })` in `services/users.ts` does `xp = greatest(0, xp + delta)`, used by session end, trim, and routine tick/untick. Shop and reward spending still write a computed total: they check the balance first, and a double-spend race there is unlikely and bounded by the price.
- **Two starts at once** map the one-active index's unique violation (23505, possibly wrapped by Drizzle) to the usual 409.
- **The start dialog fills once per open,** reading its props through a ref, so a refetch no longer resets it. It remembers the last style and length in `localStorage` (`komogon.start.last`, tasks and free sessions only; a routine brings its own length). "Until a time" that has already passed says it means tomorrow.

### Tasks

- **Play sits right after the tick,** with 14 px after it (8 px on a phone). Rows without one keep a same-size spacer so titles line up. Opening the dialog from it passes `lockSubject`: the picker gives way to the task's name and path.
- **On a phone** (≤640 px) the edit actions wrap onto their own line, and each meta item (`0 min / 3 h`) never breaks inside itself.

### QoL

- **Durations say "min"**, not "m", everywhere (`fmtMinutes`, `fmtHours`, greetings, chart axes). Per-day needs round up to 5 like the plan does (`fmtPerDay`).
- **First run:** with nothing studied yet the stat strip is one welcoming line, and the heatmap says what its squares are for instead of "0 h across 0 days".
- **Focus screen keys:** Space pauses or resumes, H hides or shows the clock. Ignored while typing, on a focused button, with a modifier, or with any dialog open.

### Timelapse

- **Local only.** Stills live in the focus tab's memory; nothing is uploaded. Leaving with unsaved stills asks first (`beforeunload`).
- **Asked once per session,** after the audio question: Record / Not now / Always record / Never ask again (`settings.timelapse.record`, `ask | always | never`), also in the focus sheet and Settings > Focus screen. The clock waits while the question is up.
- **Capture, Apple-style:** a still every 0.5 s to start; when the buffer passes its cap the stills are thinned to every other and the interval doubles. Thinning one past the cap keeps the newest still, so spacing stays even (a test caught the uneven version). Speed mode captures at `speed / fps` seconds. Stills are 960 px JPEGs, taken in focus only (not breaks or a pause), and saved unmirrored so writing reads the right way round; only the live preview is a mirror.
- **Steady light:** exposure and white balance are locked after 2.5 s where the camera allows it, and a deflicker evens each still's brightness against its neighbours (gain clamped 0.75–1.35).
- **Output:** auto (one still per frame, about 20–40 s for a long session), a set length (spare stills blended into each frame), or a speed. The fps slider tops out at what the stills can fill (`plan.maxFps`). Made with `MediaRecorder` from a canvas in real time, MP4 where the browser can and WebM otherwise. Optional studied-time clock in the corner; smooth motion blends stills.
- The arithmetic is in `packages/core/src/timelapse.ts` with tests; the camera and encoding are in `apps/portal/src/lib/timelapse.ts`.

## Finished items fold away (user request, 2026-10-06)

- **A ticked-off item is never overdue.** Its row on Tasks, and a node card, say "Done <date>" in place of the due line.
- **Finished items move into a folded "Done · N" group** at the bottom of their parent, closed by default, and come back up when unticked. Top-level courses are left in place, since their drag and Alt+arrow ordering counts every course.

## Visual and UX overhaul (user request, 2026-10-08)

- **Liquid-glass shell, solid content, running-app numbers.** Full write-up, critique and plan in `docs/REDESIGN.md`. No features, settings or personalization options were added.
- **Three materials**: chrome (nav, phone tab bar), glass (cards, sheets), content panel (lists, tables, charts). The user's Panels setting still overrides the content material.
- **Text on the backdrop follows the backdrop.** `.on-backdrop`, `.glass` and glass panels read `--fg-on-glass*`; opaque panels read the theme's `--ink*`. Components only use `--fg`, `--fg-muted`, `--fg-subtle`, `--border`, `--accent-text`.
- **Photo text colour is measured** against the photo under the theme's scrim (`adaptToPhoto`), not picked by a luminance threshold; glass thickens until 64% text clears 4.5:1; a page wash only when titles need it.
- **Accent as text and the label on accent buttons are computed** (`readableAccent`, `accentForeground`), so mint and sky buttons now carry dark labels.
- **System fonts** (SF Pro / Segoe UI Variable); Inter was never loaded.
- **Phone navigation** is a floating seven-tab bar (Home, Tasks, Routines, Grades, Calendar, Stats, Awards).
- **"Done" for a used-up estimate reads "Estimate met"**; Tasks shows status chips only for statuses that need a look (not "On track").

## Redesign review fixes (user request, 2026-10-08)

- **No black labels**: accent buttons always carry white text on `--accent-fill` (the accent, deepened only as far as white needs). Logo back to the plain accent mark.
- **Matte, flat buttons; no glows; no radial gradients in panels**; weights capped at 600 (labels 500), smaller hero numbers.
- **Every card follows the Panels setting** (glass cards included), so cards side by side always match. New Panels option **Matte**: solid cards, top bar, tab bar and dialogs.
- **Tasks is a Notion-style table** (Name, Due, Time, Status), every row folded on arrival; edit actions on hover; play stays beside the tick.
- **Charts use accent shades**; Streaks panel uses the line flame, no emoji. Focus-screen panels near-opaque; its Komogon name links home. Days focused grid back to its original size. Grades footer aligned.

## Study plans, first version (user request, 2026-10-09)

- **A plan is a node, its topics are its children.** The plan root is a course-kind node with grading off (kept off the Grades page), its target date is the node's due date, and each topic is a task with the planned hours as its estimate. So sessions, the start dialog, pace, streaks, the Tasks tree and Analytics all work on plans with no special cases. What a course lacks lives beside it: `study_plans` (weekly budget, start day, method, mastery bar) and `plan_topics` (resource, drilled or not). Migration 0011.
- **Drills are rounds plus named misses.** A round is a tally of ✓ / shaky / ✗ (`drill_rounds`); only the misses you choose to name become queue items (`drill_items`), so drilling out loud does not mean typing every question. Shaky counts as half right.
- **Miss queue is a three-box Leitner.** A miss or a wobble comes back the next day, from box 0; a clean answer moves it out 1, 3, then 7 days and retires it. Answered from the plan page's Due back list.
- **Learned means accuracy, not hours.** A drilled topic is marked learned automatically when its last two rounds pooled reach the bar (85% by default, editable) and every named miss has been redone cleanly. Hours-only topics are ticked by hand. A topic that crosses the bar early frees its leftover hours from the remaining total.
- **Pacing against a weekly budget.** Projected finish assumes the budget from today; status is ahead / on track / needs more time against the target. When it needs more time the page offers the two honest fixes as buttons (more hours a week, or a later target), never a nag. The chip reads "Needs more time", not "Behind".
- **Two ways in, one structure.** "Paste an outline" reads a table or list (`parseOutline`, hours and resources picked up when present) into editable rows; "Build it" is the same rows by hand. The optional daily top-up is an ordinary daily routine linked to the plan, and its ticks count as plan time and plan days.
- **"Describe it" generation is not built yet.** It needs a model call from the API; the paste path covers the case where the user already has a syllabus. Next steps are in `docs/IDEAS.md`.
- Plans tab added to the nav and the phone tab bar (now eight tabs; the bar sizes its columns to the tab count).

## The post-session review becomes "save session" (user request, 2026-10-12)

- **Like saving a workout**: the sheet leads with what you did (focused time, breaks, pomodoros), then one-tap chips. Save hands over to the score sheet; Skip still costs nothing.
- **Focus**: Locked in / A few drifts / Scattered (stored as distracted no / a-little / a-lot). **Readiness** (under an assessment, naming that assessment): Not yet / Shaky / Getting there / Mostly / Ready (1-5).
- **Effort replaces mood** (full mode): Easy / Moderate / Hard / Very hard / All out, stored as `review.effort` 1-5 and shown on the score sheet. Mood is no longer asked; old values stay.
- **Count only when the task has a unit; "needs more time" is +30 min / +1 h / +2 h; the note is folded.**

## Notes from 2026-10-17, built the same day (user request)

- **One session at a time, asked not refused.** Starting while one runs opens "<Session> is still running. Cancel to start <new>?". Cancel and start ends the running one (minutes saved, no review) and starts the new one; Keep it running leaves it. A 409 from a session started elsewhere asks the same question. Play buttons on Routines, the dashboard Routines card and Plans no longer hide while a session runs, so the question can be asked.
- **Focus end screen scrolls** when taller than the window; auto margins keep it centred while it fits.
- **Clear missed routines**: one button on Routines › Due now sets `settings.routines.missedClearedThrough` to yesterday, and `routinesDue` leaves out missed days on or before it (today always shows). The four-week figure still counts them as missed. Ctrl+Z puts the previous date back.
- **Grades target is remembered** (`settings.grading.targetPercent`) and, only when set, each by-weight course ends its note with "You need X% on average from the rest of your grades to get an average of Y%." Weights not entered yet count as part of the rest (`neededOnRemaining` treats the course as at least 100%).
- **Dashboard weights**: "Ready when you are", the Coming up and Routines card headings and the task card time are 500, due task names 450. Headings elsewhere stay 600.
- **Trophy shelf: twelve records** (added biggest month, most sessions in a day, most courses in a week, most routines in a week, focused in a row). The grid balances its columns so no medal sits alone on a row.
- **Badges: 40** (added Getting going, Five hundred sessions, Long haul, Two weeks, Focused 100, Ultramarathon, Ahead of time, Ten done, Fifty done, Four perfect weeks, Thoughtful).
- **No saturated accent fills**: `accentFill` no longer raises saturation as it darkens and caps it at 45% (`FILL_MAX_SATURATION`), so medals, primary buttons and pills are a muted shade of the accent. Badge unlock dates are grey. Text, tints and chart marks keep the accent as chosen.

## Closed alpha hosting, 2026-10-19 (user request)

- **Vercel for the portal, Render for the API, a new Supabase project for data and sign-in.** Config in `apps/portal/vercel.json` and `render.yaml`; steps in docs/ALPHA.md › Hosting it. A separate Supabase project keeps the user's own data (and the IB plan) on this computer.
- **Invite-only twice over**: sign-ups off in Supabase, plus `ALLOWED_EMAILS` on the API (addresses or `@domain`), checked before an account row is created; a refused account gets 403 `invite_only`, and the portal signs it out with a calm "small private test" message. Empty list = open.
- **Installable web app** rather than app stores: manifest, 192/512/maskable icons from `prepare:icons`, and a hand-written `public/sw.js` (pages network-first, `/assets` cache-first, `/api` never cached). Registered only on hosted addresses, never localhost, where the always-on copy and dev share port 5173.
- **Feedback link and Sentry are env-only** (`VITE_FEEDBACK_URL`, `VITE_SENTRY_DSN`). Sentry is errors only, loaded on demand, and left out of the bundle when no DSN is set. No product analytics or session replay.
- Preflight reads `.env.alpha` first: a local copy of the hosted values for the check, which Vite never loads (unlike `.env.production`, which would point `pnpm local:update` at the hosted project).
- **Sign-in is the API's own email and password** (same day, user: "dont worry about security right now"). `password_accounts` (migration 0013, scrypt hashes, cascades with the user), public `POST /api/auth/signup|signin` answering a 30-day HS256 token signed with `AUTH_SECRET`. The portal uses it when neither Supabase nor dev variables are set (`authMode` `'server'`, token in `komogon.token`); the same password form also works against Supabase. No reset or email check by design for now. The hosted database is Neon; Supabase is optional.
- **Admin page** (`ADMIN_EMAILS`, set to the user's email in `render.yaml`): `/api/admin/me|accounts|accounts/:id/export|accounts/:id/password`, portal `/admin` behind a shield icon shown only to admins. Members are told on the sign-in page that the person running it can see accounts and study data, and asked not to reuse a personal password. An admin email signing up attaches the password to an existing password-less account with that email, so the user's own data moved from the local copy keeps its settings. Passwords stay hashed: storing them readable was refused by the permission check and is waiting on the user.

## Leaderboard and onboarding skip, 2026-10-20 (user request)

- **Leaderboard**: top 10 by focused time (sum of `work_seconds` on finished sessions), shown by the name each person chose (`settings.profile.name`, "Someone" if none), never email. `GET /api/leaderboard`; a Leaderboard tab on Analytics, the viewer's own row tinted. The name hint now says it's shown on the leaderboard; placeholder "e.g. John".
- **Onboarding can skip the first task**: "Skip, I'll add tasks later" on the due-date step makes only the course; Start then runs a free session.
- Sign-in notice reads "I can see the accounts and study data saved here."

## Weekly review removed, backgrounds open minimized, agent notes, 2026-10-20 (user request)

- **Weekly review page removed** from the portal: the page, its bar at the end of each recap, its app tip, and the portal's query helpers. `/analytics/review` redirects to `/analytics`. The API's `/api/analytics/weekly-review` routes and `weekly_reviews` table stay, unused by the portal, so no data is lost.
- **Background pickers open minimized every time** Settings opens; the remembered minimized state (`komogon.bgPicker.*` in local storage) is no longer read.
- **CLAUDE.md** (with an AGENTS.md pointer) holds notes for future AI agents: the app, where it runs, sign-in, the owner's working preferences, the design rules and known traps.
- **Settings › Pages holds all layout settings**, one sub-panel per page. First: Dashboard, with the daily card and "Tips about the app" (moved out of Pace and streaks; the tips toggle now says tips show under the start panel). Future settings about what a page shows or how it's laid out go there too (user, 2026-10-20).
- **Level pill hover card** opens on hover and keyboard focus only; `:focus-within` kept it open after a click on the pill.

## Copy pass and a reward minimum of your own, 2026-10-20 (user request)

- **Explainer lines removed** across Achievements, Rewards, Settings and Analytics (the user's list). Kept but reworded where the UI needs a line: the Analytics hero on a quieter week, the review-mode hint, the export hint, the Pages hint, the presets hint, the session XP hint, and the Google Calendar "not configured" state. "Worth knowing" is now "Good to know".
- **Quieter-week hero**: "You completed N sessions this week." plus, in order, "You hit your goal!" (weekly goal met), "Almost there!" (75% of the goal and the week still running), "Good work!" (less than 30% below last week), or nothing. The "!" is the user's own wording.
- **The reward minimum is a setting** (`settings.rewards.minCostXp`, 10 to 5000, default 150), in Settings › Pace and streaks. Like the streak's day start, it may change once a day: the server stamps `minCostChangedAt` and refuses another change for 24 hours. A raised minimum applies to new prices only; a reward priced under it can still be renamed or archived. This puts an XP figure in Settings, which the "XP only on Achievements" rule otherwise keeps out; the user asked for it.

## Renamed to Komodon, 2026-10-20 (user request)

- **The app is now called Komodon** everywhere people see it: the portal and extension text, page titles, the installed-app name, the logo's label, calendar event descriptions, the .ics feed, and download file names (`komodon-export-…`, `komodon-week-…`, `komodon-timelapse-…`).
- **Internal names stay komogon**: packages, storage keys, IndexedDB names, extension message types, the `~/.komogon` data folder, the local scripts and startup shortcut, and the komogon.app domain (the user said to leave the address for now). Changing them would drop saved browser state or break the always-on copy.
- Earlier entries keep the name they were written under.

# 2026-10-21: Start with a session

After account creation or sign-in, new users enter the dashboard directly. No name,
course, task or due date is required, and no placeholder study items are created.
The initial dashboard shows Start with inline Pomodoro, timelapse and timer visibility
options. Timelapse is opt-in and opens the focus screen in the same tab. Audio sharing,
timelapse and focus-screen questions are suppressed for these accounts.
Planning, progress, hints and secondary navigation stay hidden until the user chooses
"Show planning and progress", or turns off "Focus on the timer" in Settings > Pages >
Dashboard. This account setting persists across devices. Existing onboarded accounts
retain their layout and preferences.

## 2026-10-21: Calendar courses and deadlines

Google imports now read all accessible calendars except the app-owned Study calendar,
which keeps its existing two-way block sync. Outlook imports use Microsoft Graph with
read-only calendar permission, offline access, PKCE and encrypted refresh tokens.
Both providers refresh automatically about every 15 minutes while the API runs, plus
on connection and manual sync. The rolling import window is 30 days back and 180 ahead.
Course codes and existing course names group imported tasks. Assessment and deadline
keywords create assessments or tasks; other events remain calendar commitments and
never count as study time. Date-only deadlines last through their local day.
Provider event identity prevents repeat imports; matching courses and tasks are reused.
Changes update untouched imported fields, preserving manual edits, completions and
user deletions. Removed events cancel commitments and archive untouched imported work.
Disconnecting stops refreshes and keeps imported data. Connection controls live in
Settings > Calendar, with a link from Calendar. No extra onboarding step is introduced.

## 2026-10-21: Keep navigation during onboarding

The simplified first dashboard only reduces dashboard content and session prompts.
The full top bar, mobile navigation, streak and Achievements entry remain visible,
respecting the user's individual page visibility settings. Users can explore planning,
calendars, progress and future social features without first switching dashboard modes.
The dashboard action now says "Show full dashboard"; its setting is "Simplify the
dashboard" in Settings > Pages > Dashboard. No new social feature is added here.

## 2026-10-21: Local test accounts and a public landing page

Signed-out visitors now land on a public page describing coursework, calendars, timers
and progress. Create an account opens signup; Sign in opens login. Signed-in visitors
still enter their dashboard at the home URL. /welcome provides a landing-page preview.
Copy describes the available features directly, without a narrated product tour.
The localhost password sandbox seeds onboarding@komodon.test and admin@komodon.test.
Sign-in shows their credentials and actions only when this test mode is enabled.
Reset onboarding clears that account only. Test accounts and configured admins are
excluded from the leaderboard; their personal study records remain usable for tests.
Local test mode requires an isolated sandbox database and a loopback listener outside
production. Requests for test accounts also check loopback IP, hostname and origin.
Normal hosted signup cannot create the reserved test identities.

## 2026-10-21: Landing, email codes and Social

The public landing uses the dashboard's rounded cards, pill navigation and neutral
surfaces, with no photo background. Cluely supplies the broad centered headline and
product-preview composition; no assets or marketing claims are copied. Copy names
the available features directly. The full app navigation remains available after login.

Resend is the initial mail provider on its free plan. The user chose the existing
komogon.app domain; the default sender is Komodon <noreply@komogon.app>. DNS verification
and a private API-server RESEND_API_KEY are required before live sending. Emails are
plain text with a code, purpose and expiry. Local test mode uses a loopback-only inbox
and never sends real email. Hosted code flows fail clearly if mail is unconfigured.

Password signup creates the account only after email verification. Codes are random,
keyed hashes at rest, expire after ten minutes, allow five guesses and are redeemed
atomically once. Resends invalidate prior codes. Database counters limit recipients,
IPs and total outbound mail. Password reset uses the same mailer and revokes existing
sessions. Pending signup stores a password hash, never a plaintext password.

Social profiles carry a display name and school/organization label. A separate email
proof verifies access to the organization domain; it does not change the sign-in email
or calendar OAuth connection and makes no claim about an official role. Sharing is
opt-in and limited to people with the exact same verified domain. Directory responses
exclude private email addresses, study data, test accounts and configured admins.
Removing or replacing the proof resets sharing. No product tour or modal is introduced.

## Navigation: top bar by default, sidebar as a choice, 2026-10-21 (user request)

- **Top bar stays the default.** Settings › Pages › Navigation offers **Top bar** or **Sidebar** (`settings.nav.style`, saved on the account). It only changes a computer; phones always use the bottom bar.
- **The sidebar** is a slim icon rail down the left (60px) that opens over the page to 212px with labels on hover or keyboard focus, after a 120ms pause. "Keep open" pins it and moves the page over; that choice is kept in this browser (`komogon.rail.pinned`). Daily pages on top (Dashboard, Tasks, Calendar, Analytics), the rest under a divider (Routines, Plans, Grades), then streak, Level and Settings at the bottom.
- **A crowded top bar turns into icons** instead of scrolling: when the labels no longer fit, every page shows as an icon and the current one keeps its name. It goes back to labels once there is room.
- **The phone bar shows every page as an icon, and the current one widens into a pill with its name.** This replaced a "More" menu the user didn't like: nothing is hidden, and every page is one tap away. It holds about nine pages before it would need to scroll.
- **Sign out** is also a labelled button in Settings › Account, beside "Signed in as" (the sidebar has no sign-out icon).
- Considered and set aside: grouping pages into Today/Plan/Progress tabs, reaching pages only from dashboard cards (the dashboard would get too long), and a "More" menu.

## Continue with Google, 2026-10-21 (user request)

- **Google sign-in for the API's own accounts**, beside email and password. The portal shows Google's own button (Google Identity Services, popup); it hands back an ID token, and `POST /api/auth/google` checks the signature against Google's published keys, the issuer, and that the token was made for our client id (`GOOGLE_SIGNIN_CLIENT_ID`, a separate env var from the calendar's `GOOGLE_CLIENT_ID`). Only the client id is needed: no secret, no redirect.
- **Accounts join by email.** A Google sign-in whose email Google has confirmed goes to the account that already uses that address (one with a password, or one moved over from a local copy), so testers can use either way in. Otherwise it starts a new account. The invite list applies the same as for sign-ups. No new table: the email is the link.
- **The button appears only when the API offers it** (`GET /api/auth/google` answers the client id), so turning it on is one Render variable and nothing on Vercel.
- **Google's button keeps Google's look** (dark fill, pill shape to match the Sign in button), since Google's terms ask for it; it sits under a divider below the password form.

## Limits on sign-in tries, 2026-10-21 (user request)

- **Passwords were already salted and hashed** (scrypt, a random 16-byte salt each, compared in constant time); nothing changed there. The gap was that nothing slowed down guessing.
- **Wrong passwords are limited**: 10 per email in 15 minutes from anywhere (so one account can't be guessed from many addresses), and 30 per address in 15 minutes whatever the email. Only failed tries count, and a right password clears that email's count, so people signing in normally never meet it. Failed Google sign-ins count toward the per-address limit too.
- **Sign-ups are limited to 20 per address an hour**, generous enough for a class signing up together on one school network.
- Over a limit, the API answers 429 with a Retry-After header and "There have been too many tries. Please wait a few minutes and try again."
- **Kept in memory, no new dependency** (`services/rate-limit.ts`). A restart forgets the counts, which is fine for slowing guessing on one Render instance.
- **The caller's address comes from the nearest proxy** (`TRUST_PROXY_HOPS`, 1 on Render), not `trustProxy: true`, which would take the leftmost X-Forwarded-For entry that callers can write themselves.
- **An unknown email takes as long as a wrong password**: sign-in checks against a stand-in hash when there is no account, so timing doesn't show which emails have accounts.

## One tip at a time on the dashboard, 2026-10-21 (user request)

- **The dashboard shows at most one tip.** While the rotating tip card is up, the one-time hints wait; otherwise only the first hint that is due shows (rest days, then XP, then the calendar), and the next one takes its place after it is closed.
- **The streak freeze hint became a regular tip** (user request, same day): it now rotates with the other tips, linking to the shop, instead of being its own card.

## 2026-10-21: Merge onboarding, calendar and Social with the latest main

The user requested a safe merge and push. Incoming Google sign-in, login rate limits,
top-bar/sidebar navigation, default-hidden Grades and single dashboard tips are retained.
Social is part of the main navigation in either layout. Google sign-in records Google's
email proof separately from organization verification and uses the same session version
as password sign-in, so password reset revokes sessions from both methods. Reserved local
test identities remain blocked from hosted signup and Google sign-in. Migrations 0014–0016
are additive; existing study records are preserved. Resend still requires a verified
komogon.app domain and private server key before hosted password signup can send codes.

## Sidebar sign out, top bar words, Navigation in Appearance, and the lost blur, 2026-10-21 (user request)

- **The sidebar has a Sign out row** under Settings, above the pin: the icon while slim, the label once it opens. It asks first, like the top bar's icon.
- **The top bar always shows page names.** The icons-when-crowded mode is gone: when the names do not fit, the tabs scroll sideways with faded edges, as they did before the sidebar arrived. Icons stay on the sidebar and the phone bar.
- **Top bar or sidebar is chosen in Settings › Appearance › Navigation**, moved out of Pages. It is the one layout setting outside Pages, because the owner sees it as part of the look.
- **The hosted site had no backdrop blur at all.** The source wrote -webkit-backdrop-filter beside backdrop-filter; the production CSS pass (Lightning CSS, through Tailwind's Vite plugin) kept only the prefixed one, and Chrome no longer understands the prefix. So glass bars and cards were flat translucent fills, and switching Panels to Matte barely changed the top bar or sidebar. The prefixed lines are gone from the source; the build adds the prefix for Safari itself. The dev server never minified, so sandboxes always looked right.

## Social: a profile page, 2026-10-21 (user request)

- **Social opens your own profile** (`/social`; the top bar, sidebar and phone bar all have it, after Analytics, and Settings › Pages can turn it off). Someone else's is `/social/<user id>`, reached from the leaderboard, whose names now open profiles.
- **A profile shows** the picture, the chosen name ("Someone" when none), the Ontario university if one was chosen, a line about them, when they joined, then "Days studied" (the last 26 weeks as the same contribution grid Analytics uses), "Totals" (all-time study time, sessions, days studied, streak or best streak, longest session, the last 28 days; only values above zero, so a quiet start is one sentence rather than a row of zeros, in line with the wins-only rule), their strongest weekdays, and their posts.
- **Anyone signed in can open anyone's profile.** What is on it is only what a person chose to share plus study totals; the email, settings, tasks and sessions themselves never leave the account (`GET /api/profiles/:id` builds the response from the chosen fields and finished sessions). This supersedes the "friends-only by default" note from 2026-10-05 for the alpha, where everyone is a tester; friends and sharing choices stay in `docs/IDEAS.md`.
- **The gear on your own profile** opens a dialog for the picture (cropped to a square and shrunk to 256px in the browser, stored as a `user_assets` row of kind `avatar`, under 512 KB), the name (the same field as Settings › Account), the university (a fixed list of Ontario's universities in `packages/core/src/universities.ts`, stored as an id in `settings.profile.university`; "Not set" for anyone else) and a line about you (`settings.profile.bio`, up to 280 characters). The picture saves when chosen; the rest on Save.
- **Posts** are short text notes (up to 500 characters) on your own profile, newest first, with a delete for your own only (`posts` table, migration 0014). No likes, replies or feed: the profile is the whole social layer for now.
- Universities are limited to Ontario at the user's request; the list is the public universities plus the two French-language ones.

## University verified by email, 2026-10-21 (user request)

- **A university goes on a profile only after a code sent to a university address comes back.** The dialog asks for the address, `POST /api/me/university/send` works out the university from the domain (`universityForEmail` in `packages/core/src/universities.ts`; subdomains count, so `mail.utoronto.ca` is U of T) and emails a six-digit code; `POST /api/me/university/confirm` writes `settings.profile.university` when the code matches. The settings route refuses the field, so nothing else can set it.
- **Codes** last 15 minutes, allow five wrong tries, can be re-sent after a minute, and at most eight go out per account per day. Only a sha256 of the code is stored, emptied once used (`university_verifications`, migration 0015).
- **The address stays private.** The owner sees it in the dialog ("Verified with …"); the profile shows the university with a check mark and never the address. Remove takes the university off and forgets the address.
- **Sending** goes through Resend when `RESEND_API_KEY` is set (`MAIL_FROM` on a domain verified there; both are `sync: false` in `render.yaml`). Without a key the code is printed to the API's log, which is how local copies and sandboxes work. No SMTP dependency: it is one `fetch` to Resend's API (`services/mail.ts`).

## Nav pill without the spring, sidebar rests shut after Collapse, trophy on whole pixels, 2026-10-21 (user request)

- **The top bar's sliding pill no longer springs.** A long jump (Plans to Dashboard) overshot past the first tab and poked out of the bar. It now uses the plain ease-out over the same 320ms.
- **After Collapse, the sidebar rests shut until the pointer leaves.** The pointer is still over the sidebar when Collapse is clicked, so hover kept it open as an overlay while the page slid under it, hiding the left of the page. An is-resting class turns hover-opening off until mouseleave.
- **The sidebar trophy is 16px, not 15px**, so it lands on whole pixels inside the 44px cell and the ring; at 15px its half-pixel left edge read as a shift to the right.
- **The same fields in Settings › Account** (user request, same day): picture, name, university and the line about you are one component, `components/ProfileFields.tsx`, used by the gear dialog (name and bio save on Save) and by Settings › Account (each saves as you leave it). Account search also answers "picture", "university", "verify" and "bio".

## Card rail shadows, 2026-10-21 (user request)

- **The dashboard card rail no longer clips card shadows.** The rail scrolls sideways, and a scroller clips anything past its padding box; its 6px of room was less than the glass shadow (about 12px out at the sides, 36px down on the dark theme), so cards showed a hard edge at the right and bottom. The track now keeps 14px at the sides and 40px below, pulled back with matching negative margins so nothing else moves.

## Scrolling tabs and the bottom bar on a crowded top bar, 2026-10-21 (user request)

- **The top bar's tabs scroll again when they do not fit**, with the faded edge and an arrow on each side that hides a tab, as before the sidebar arrived. The current tab is kept in view, also when the streak and level counters load and take some of the room.
- **A top bar too small for a scrolling row hands the pages to the bottom bar.** When the tabs do not fit and have under 480px of room, the pages move to the phone-style icon bar along the bottom (centred, no wider than 560px) and the top bar keeps only the brand, counters and controls. The width the tabs need is remembered so the bar knows when there is room again. The bottom bar's rules key off a data-tabbar attribute set by AppShell (phones, or a crowded bar) instead of a media query alone.
- **Fix (same day):** once the bottom bar had shown, it stayed for good. The spacer that keeps the controls to the right fills the bar while the tabs are hidden, and the room measurement counted its width as a control, so the tabs never seemed to fit again. The spacer now counts as zero width.

## The page stays put when the sidebar is pinned or collapsed, 2026-10-21 (user request)

- **Pinning and collapsing no longer move the page.** Pinning used to widen the page's left margin from the slim rail to the open one, sliding everything over. The page now always keeps room for the open rail, so the two only change the rail itself, and the rail opening on hover never covers the page either. The collapsed rail sits beside a wider margin as a result.

## Even spacing in the sidebar stats, 2026-10-21 (user request)

- **The streak and level numbers sit the same distance from their icons.** The flame is narrower than the level ring but both sit in the same 44px cell, so the streak number floated far from its flame while the level number crowded its ring. The numbers now shift (5px in for the streak, 2px out for the level) so each is about 7px from its icon; the icons, the slim rail and the open and close animations are unchanged.
- **Fix:** collapsing with the pointer away from the sidebar (from the keyboard, say) left hover-opening off until the pointer had gone in and out once. The sidebar now rests shut only when Collapse is clicked with the pointer on it.

## The page centred with the sidebar, and a wider level pill, 2026-10-21 (user request)

- **With the sidebar, the page sits in the middle of the window**, as it does with the top bar, whether the sidebar is pinned or collapsed. Only on a window too narrow for both does it step right, just far enough to clear the open sidebar. This replaces keeping a fixed left margin for the open sidebar, which pushed the page off centre.
- **The level pill takes more of the stats row.** Open, the streak pill is only as wide as its count needs (84px for one digit, 94px for two, 98px for three or more) and the level pill takes the rest, 110px while the streak is a single digit; before, the two split the row evenly and the level crowded its edge. The row is 196px, so a streak of 100 days or more is about 2px tight.

## Sidebar stats centred in their pills, 2026-10-21 (user request)

- **Each stat's icon and number sit centred in their pill.** The flame and the ring are different widths inside the same 44px icon cell, so the content leaned left in the streak pill and right in the level pill. RailStats now measures both after each change of count (and once fonts load), sizes the streak pill so both pills get the same padding on every side, and nudges each pill's content to match; the nudge glides with the sidebar's open and close animation, and the slim rail is unchanged. This replaces the fixed widths by digit count.

## Social profile follow-ups, 2026-10-21 (user requests)

- **Same day, three more asks**: the day grid and the strongest-days bars sit side by side in one card with the totals under both (one column on phones). The posts section is off the profile for now; the `posts` table and routes stay for later. The university email example is a generic `john@university.ca`, and **one address verifies one account**: the send and confirm routes refuse an address another account already verified, and a partial unique index on verified rows (migration 0016) holds the rule in the database too.
- **After a review, same day**: settings writes now merge in the database (`updateSettings` and the university routes build a `jsonb` merge instead of writing back the copy the request started with), so a bio saved on blur beside a code confirm keeps both. A verified address is never replaced in place: Remove first, then verify another. The verification mail goes out before anything is recorded, so a mail failure (502) costs no cooldown or daily send. The unique-index catch reads drizzle's wrapped error (`cause.code`). The profile dialog seeds its fields only when it opens, not on each refetch.
- **"Your profile" instead of a Social tab** (user request, same day): the profile link left the page tabs and took the sign-out button's place, at the end of the top bar and as the sidebar's last row (icon: a person; label "Your profile"). Sign out is now a labelled button on your own profile, beside the gear, and in Settings › Account as before. The Settings › Pages toggle is named "Your profile" and only hides the icon.
- **The nav shows your picture** (user request, same day): the profile link is the person's own picture once one is chosen, the person icon otherwise. It comes from a small `GET /api/me/avatar` (query key `['avatar','me']`, kept ten minutes, refreshed when the picture changes), which Settings › Account now uses too instead of loading the whole profile.

## Two Socials became one, 2026-10-21 (user decision)

- **Origin's main had a second Social** from another session (`social_profiles` with organization verification, a Social page and a people directory), already deployed. The user chose to keep the profile pages from this session. The merge keeps everything else origin added (simplified onboarding, calendar imports, local test accounts, account email verification, the marketing site) and drops only the other Social: its routes, page, API client calls and tests.
- **Nothing is dropped in the database.** `social_profiles`, `email_codes` and `email_rate_limits` stay (the first is unused; drop it in a later migration once the alpha data is not needed). This session's tables arrive as migration 0017, after origin's 0014 to 0016, so the hosted database applies them cleanly.
- **One mailer.** The university codes go through origin's `services/mailer.ts` (Resend, or the local inbox with `LOCAL_TEST_ACCOUNTS=true`); this session's console mailer is gone. With no mailer the university route answers 503 instead of printing codes.

## Card shadows in the scrolling rows, 2026-10-21 (user request)

- **The dashboard's Tasks row keeps its cards' whole shadow.** It scrolls sideways, and a scroller clips everything outside its box. CSS blurs a shadow along a bell curve whose faint tail runs well past the blur value, so the dark glass shadow is still about 8% black 40px below a card. The earlier 14px and 40px of room cut it into a hard line that showed on the cloud photos. The row now keeps 12px above, 46px at the sides and 72px below, where the shadow has faded to about 1%, pulled back with matching margins. The rail's edge fade grew by the same amount, so it falls on the cards as before.
- **"That's enough time to" is a grid now, not a scrolling row**: four cards across when there is room, two on a narrower page (a container query on the section), one on a phone. It had 4px of room, so its shadows were cut too, and giving it the same room would have floated its scrollbar 72px below the cards, over the next section, and let a cut-off fourth card show past the column. With no scroller nothing clips the cards, and every comparison shows at once; Shuffle still deals a new hand.
- **The page clips sideways overflow** (`#root { overflow-x: clip }`), so the wider rows never add a sideways scroll on a phone. It is on the app's root container rather than html or body: those pass it to the window as hidden, which blocks the scroll wheel but still lets scrollIntoView shift the page sideways (the dashboard centres the most pressing card with it). Checked: the page cannot be scrolled sideways, even from script.
- **Not a mask.** Fading the rows' edges with a mask would have hidden the line, but in Chrome a masked element becomes the backdrop for blur inside it, so the glass cards lost their blur (checked with stripes behind the page). The existing left and right fades on the dashboard rail are masks too, so its cards lose their blur while the rail has more cards than fit; that is left as it is for now.

## The homepage, 2026-10-21 (user request)

- **A marketing site in the repo, not a separate one.** `apps/site`, a static Vite page,
  deployed on Vercel from that folder. It started as a sibling folder and its own git repo;
  the owner asked for it to live here instead.
- **Cluely-style hero.** The app's default photograph (Cotton Candy) edge to edge behind the
  headline, fading out at the bottom only, then a light gradient page. Feathering the photo
  on every side, and putting photo stages behind every section, were both rejected.
- **Screenshots, on a CSS laptop and phone.** The dashboard sits on a laptop and a phone drawn
  in CSS (the first version; the owner liked it and asked for it back, minus the phone's
  island). The sections show plain screenshots. Hand-built UI mockups, the portal's real
  components rendered into the page, and device renders from mockup PSDs were all rejected.
- **Copy.** "Productive, every time." / Track your focus sessions / Stay accountable and
  focused / Share your wins with friends / "Better than last time." with "Free to use.
  Currently in alpha." and two buttons: Start for free (komogon.app) and a placeholder Get
  the extension. Satoshi headings, Inter text, no small eyebrow labels, no quotes.
- **Demo data.** The screenshots show a seeded account, Jerry, with numbers matched to the
  owner's own reference screenshots, in dark mode. See CLAUDE.md for how to retake them.
- **Motion.** Headline in on load, devices about 1.3 s later or on the first scroll, sections
  pop up as they arrive. Off under reduced motion.

## Glass blur kept in the scrolling Tasks row, and a shorter follow-up note, 2026-10-21 (user request)

- **The dashboard's Tasks row keeps its cards' glass blur when it has more cards than fit.** Its edge fades were a mask on the row, and in Chrome a masked element becomes the backdrop for the blur inside it, so the glass cards showed the background sharp through them. The row no longer has a mask; CardRail gives each card its own share of the fade instead, worked out from where the card sits in the row on every scroll and resize (a card fully inside the row has no mask at all). The fades look as before and follow the scroll. Other sideways scrollers, such as the nav tabs, keep the row mask; they hold no glass.
- **The after-task question no longer says "Asked once per task."** It now reads only "Your answer goes on the chart of how ready you felt as the due date came closer."

## Social: a feed, friends, a comparison and the leaderboard, 2026-10-21 (user request)

- **Social is a page tab again** (after Analytics; Settings › Pages › Social hides it and the profile link together), with four views in the URL (`?tab=`): **Feed**, **Friends**, **Compare** and **Leaderboard**. Profiles moved to `/profile` (yours) and `/profile/<id>`; `/social/<id>` still redirects. The leaderboard left Analytics (`?tab=leaderboard` there redirects to Social) and gained a podium for the first three, pictures, a "Friend" chip and bars against the leader.
- **A post** is any of: a line (up to 500 characters), one of your finished sessions shared as progress (the post keeps the minutes and the task's title as they were, so it reads the same if the session is edited or gone), and a video (MP4 or WebM, under 5 MB, stored in `post_media` as base64 with a small JPEG poster on the post; the portal fetches the bytes with the token and plays an object URL, so a feed never downloads a video until it is played). The focus screen's timelapse export has a **Share to Social** button that posts the video with the session attached and a still as the poster. Anyone signed in sees every post on the feed ("Everyone"; "Friends" narrows it) and on the author's profile; only the author can delete. This supersedes "no feed" from the same day: the owner asked for sharing timelapes and progress.
- **Likes and comments** (`post_likes`, `post_comments`): one like per person; a comment up to 500 characters, deletable by its author or the post's author. Counts come with every post; the portal patches its caches on like rather than refetching.
- **Friends** (`friendships`, one row per pair): Add friend sends a request, the other side accepts or declines (declining deletes the row, so a later request is possible), either side can take a request back or remove a friend later, and asking someone who already asked you is the same as accepting. Found by name in the Friends tab, or from any profile, feed post or leaderboard row. The Social tab shows how many requests are waiting.
- **Compare** puts your weeks beside your friends', all in your timezone and Monday-start weeks: this week and the last 28 days with your place among them and the friends' average, streaks, a bar per person for this week, days studied out of 28 and the longest session, and an eight-week sparkline each. It is only shown once you have a friend. This is a second place people are compared, which the owner asked for; the rule "the leaderboard is the one place" is retired.
- **Copy is short** on these pages, on the owner's instruction: fragments are fine, nothing explains itself twice.
- Data stays as before: names, pictures, university and finished-session totals are the only things shared; never the email. The seed for a look at it with people on it is `apps/api/seed-social-demo.tmp.ts` (sandbox `.pglite-sandbox-social`, launch configs `social-sandbox-api` / `social-sandbox` on 8802/5188). Migration `0018_social_feed`.

## Social feed in three columns, and sharing settings, 2026-10-21 (user request)

- **The feed is laid out like LinkedIn's home**: you on the left (picture, name, university, a line, streak, level and friend count, and a link to what you share), the composer and posts in the middle, and a **thinner leaderboard on the right** (the first five, with the way to the whole board). The columns go by the page's own width, not the window's (the sidebar takes some of it): under 880px the left card goes, under 660px the board too, and the posts have the page. The owner said the left column could hold anything; the right had to be the leaderboard.
- **Settings › Social says what other people get to see**, and the API holds to it (`settings.social`, strict in the settings schema): who sees your posts (everyone signed in, or friends only; the feed and the profile both filter), study totals on your profile (off, the profile answers null for the stats, grid and weekdays and the page says they keep their study time to themselves), appearing on the leaderboard, letting friends compare with you (left out of their Compare), and taking friend requests (a request to someone who turned it off is a 403, and the button says "Not taking requests"). Everything is on by default, as before; nothing is shared that was not already.

## Two leaderboards, pictures on posts, and no bio on the feed card, 2026-10-21 (user request)

- **A global board and a friends board.** `GET /api/leaderboard?scope=global|friends`; the Leaderboard tab and the small board beside the feed both switch between them. Settings › Social › Leaderboards is three-way: **Global and friends** (the default), **Friends only** (off the global board, still on your friends' boards) or **Neither** (your time counts nowhere). Stored as `settings.social.leaderboard` = 'global' | 'friends' | 'off'; the day-old true/false rows read as 'global' and 'off' in `withDefaults`.
- **Posts take a picture as well as a video** (JPEG, PNG or WebP under 2 MB, stored like a video in `post_media` and fetched with the token; shown at its own shape, no taller than sixty percent of the screen). The composer button is "Add a photo or video".
- **The card beside the feed shows no bio**: picture, name, university and the three numbers only; the line about you stays on the profile.
- The sandbox seed takes `SEED_MEDIA_DIR` with sample videos (made with a static ffmpeg: test patterns, 6 s, 640x360) and pictures, so media posts can be looked at.

## Jams instead of Compare, friends beside the feed, a tighter feed, 2026-10-21 (user request)

- **Compare is gone; in its place, jams**: a small game people enter, the way a Spotify jam is joined. Someone starts one (a name, and a day, three days or a week), friends see it under "Friends are in" and join, anyone with its six-letter code can join from outside the friend list, and from the moment each person joins their focused minutes count. The card ranks the members with bars, a crown on the leader, and names the winner once it has ended. The host can end it early; members can leave. Tables `jams` and `jam_members` (migration 0019), routes in `routes/jams.ts` (`GET /api/social/jams` gives active, open and the last five finished). Joining is the only way in, so the "Let friends compare with you" setting went with Compare.
- **The Friends tab is gone too**: friends live beside the feed, under your card (search, requests with accept and decline, the list with a remove, the ones you asked). On a narrow page the left column moves under the posts rather than disappearing, so requests stay reachable.
- **The feed is tighter**, after the owner found it massive: 40px pictures in the composer and on posts, smaller padding, 14px text, a smaller session strip, 26px pictures in the side lists, and the three numbers on your card in three equal columns so the icons sit symmetric. Everything beside the feed scrolls with the page in its own column.

## Full-width panels, one leaderboard list, you against everyone, Compare back under the board, 2026-10-21 (user request)

- **No thin, sectioned pages.** The Jams and Leaderboard panels take the page's full width; the centred 640px column read as chopped. Now a rule in CLAUDE.md.
- **The leaderboard is one list**, ranks one to ten alike, a crown on the first; the podium with its three heights was cut off at the card's edge and went.
- **Under the global board, "You and everyone"**: your focused time this week against the average, days studied, session length (last 28 days) and streak, each as two bars, plus your all-time place among everyone on the board and the share of people you are ahead of. The average leaves out anyone under **15 minutes** that week; when nobody else reaches that this week, **last week's** numbers are used and the card says so. Session length and streak averages are over the same people. `GET /api/leaderboard/stats`.
- **Compare's analytics are back, under the friends board** (the owner liked the page): the bento of tiles, side-by-side bars, streaks, eight-week sparklines, days studied and longest session, now `CompareBento` with `GET /api/social/compare` restored in `routes/compare.ts`. There is no sharing toggle for it: being friends is the consent.
- **Friends card**: the list comes first, then "Requests to answer" on a faint tint, then the ones you asked; before, requests sat on top and looked like friends. The side columns are no longer scroll boxes (a scroller clipped the glass shadows); the board stays sticky, your card and friends scroll with the page.

## Groups, live now, nudges and kudos, 2026-10-21 (user request)

- **Study groups** (Social › Groups): a lasting group of friends, unlike a jam. Start one with a name, pass on its six-letter code, or join a friend's from the list. A group's card is this week: the total "together" at the top right, a line per person of their running total through the week (yours in the accent, the others in greys), and everyone ranked with their minutes and a short segmented bar of their biggest subjects (the top three, then "Other"). Tables `groups` and `group_members`, routes in `routes/groups.ts`; the last person out closes the group.
- **Live now**: friends in a session right now (a session not ended whose timer reported in within ten minutes), each with a running clock since they started and what they are on, as a strip at the top of Groups; each group card also says who in it is studying now.
- **Nudges**: a friend, or someone in one of your groups, can be nudged to study, **once every two hours** per person (`nudges` table; a second one inside the window is a 409 that says when). From the bell on a friend's row beside the feed, and from "Nudge" on a group member who is under half the group's average this week. The nudged person sees them on the **dashboard** above the daily card, with a "Got it" that waves them away; a day later they go on their own.
- **Kudos, not likes**: the button on a post is a thumbs-up labelled "Kudos", as a runner gives on a run; the API still calls them likes underneath.

## A round of fixes on Social, 2026-10-21 (user request)

- **Group chart = the last seven days**, ending today, not a Monday-to-Sunday week with a fixed start and end. A group younger than a week starts on its first day. The lines begin on the first day's value (no climb from zero at the left edge, which drew a vertical stroke) and end on today with a dot. Under each member's segmented bar, the tasks are **named** with their time, one swatch each.
- **Friend requests** sit under the friends list as their own block: "Inbound · N" (the first three, the rest fading behind "Show all") and "Outgoing · N", folded away until opened.
- **Posts need a session**: the composer's Post button waits for one ("Which session?"), and the API refuses a post without `sessionId`. Posts got roomier (16 × 18 px) and the session figure lighter (600, 1.1 rem); the group and jam figures are 600 too.
- **The leaderboard reads as analytics**: the first three are tiles with the all-time total big, an eight-week sparkline, this week, days of the last 28 and the streak; the rest are rows with the same sparkline small, this week, the streak and the total. The API's entries carry `weekly`, `thisWeek`, `streak` and `activeDays28` for it.
- **Jams open**: a chevron on each card shows the running totals through the jam's days (same lines as groups) and, per person, sessions, time, when they joined and what they worked on. Members can leave. The code box fits six letters now.
- **Your card** beside the feed shows days and level only; the friend count went.

## Copy audit, batch 1: the dashboard, 2026-10-21 (user request)

The owner asked for an audit of wordy, abrupt or AI-sounding copy, worked through in batches. Fragments are fine; explanations of what the screen already shows are not.

- **The after-task question has no subtitle.** "How did {task} go?" and the 1 to 5 buttons say enough.
- **The empty stats card**, in the owner's words: "Your numbers are here after your first session. Run your first session!" over "Time studied this week vs. your goal."
- **The streak banner has no dates**, in the owner's words: "A streak freeze covered your streak. Let's continue working!" and "Your streak ended. Don't worry, you can begin another one today!" The "!" is the owner's choice.
- **The offline banner** reads "You're currently offline. Stats will update when you reconnect." (owner's wording).
- **Start panel:** "Add estimates and due dates to see a plan for today." The Focus screen button lost its tooltip, which repeated the label.
- **Hints and tips:** "pace" is gone from the rest-days line ("your daily plan works around them"); the level hint links to Achievements instead of saying "Achievements has the details"; the calendar hint is "Plan study blocks and sync Google Calendar in Calendar."; most tips no longer open with "You can", and "to see how far you have come" is cut.
- **First visit:** "Add a course and what's due in it, and Today plans your day."
- **Greetings cut:** "Brand new. Let's see what this button does.", "{hours} banked this week." and "The week is at {hours}." The other greetings flagged in the audit were kept on purpose.

## Timelapse: screen recording, a layout editor, shape, task name and progress bar, 2026-10-21 (user request)

The owner sent a sketch of the video: the time of day top left, the screen top right, the time elapsed bottom left, the task name bottom right, the camera behind, with arrows for moving and resizing.

- **The timelapse has its own Settings group, `/settings#timelapse`.** It was a block inside Focus screen; it moved so links can land on it. Focus screen keeps a one-line link. The focus screen's controls, the "Record a timelapse?" question and the export card link to it, opening in a new tab, since leaving the focus screen would drop the stills.
- **Layout editor.** The preview is drawn with the same code as the video (`lib/timelapse-compose.ts`), so it shows what comes out. Each piece (camera, screen, current time, time elapsed, task name, progress bar, Komodon mark) is a box in fractions of the frame: drag to move, pull a corner to resize, the cross removes it, and removed pieces wait under the preview as "Add back" chips. Edges settle onto the frame's edges, margins and middle; Alt places freely. Arrow keys move the chosen box, Shift resizes, Delete removes. The mark can't be removed, and one of camera or screen always stays.
- **Screen recording.** The screen piece doubles as the switch: in the layout, it is recorded (also "Record my screen too" in the settings). The browser's share picker needs a click, so a session that starts recording on its own shows a Share screen button in the recording pill; the same button picks a share back up after it is stopped from the browser's bar. Screen stills are kept 1280 px wide for readable text. Without the camera, the screen alone is recorded.
- **Shape.** 16:9, 9:16, 1:1, 4:5, 4:3, or Match camera, which asks for the camera once to read its shape (remembered in this browser). Videos are 1280 px on the long side. A layout still at a shape's starting places moves to the new shape's; an edited one stays, with Reset the layout to start over.
- **Task name and progress bar.** Each still carries the focus screen's task name; the progress bar fills as the video plays through the session.
- **"Show time studied" and "Show the time of day" are now the layout's two clock pieces.** A saved row without a layout seeds them from those switches, which stay in the type only for that.

## Timelapse follow-up: fixed camera, exact boxes, the screen asked each session, trim, 2026-10-21 (user request)

- **The camera can't be moved or removed.** It always fills the frame behind everything and has no box in the editor (a full-frame camera box sat over the screen and swallowed every click, so the screen couldn't be moved). Stored layouts are mended to a full camera.
- **No snapping.** Pieces go exactly where they are dropped.
- **Boxes hug what is drawn.** The editor's boxes come from where each piece was actually drawn. A text piece (clocks, task name, mark) is placed by its top left and sized by its height; its width is the text's, and it is moved in if a longer real task name would run off the frame. The screen, the texts and the mark keep their shape when a corner is pulled; the progress bar stretches freely.
- **The screen's shape.** The screen box starts at the screen's own shape (the last shared screen, or the monitor's, which needs no permission). "Fit the screen to its shape" reshapes it, and changing the video's shape refits it. There is a "Match screen" video shape beside "Match camera".
- **"Match camera" is the default shape.**
- **The screen starts under "Add back".** Recording it is asked every time a recording starts in a session ("Record your screen this time?": Record my screen / Just the camera). The persistent "Record my screen too" switch is gone. Saying no leaves the whole camera picture: no space is drawn for the screen. Saying yes with the screen not in the layout adds it where it was last placed. The recording pill offers Share screen whenever the screen isn't being shared.
- **Trim.** The "Your timelapse" card has Start and End sliders over the recorded session, with the first and last kept still shown above them and "Keep it all" to undo. The trim is held in session seconds, so it survives the stills thinning while recording; an end never moved follows the recording as it grows.

## Copy audit, batch 2: starting and running a session, 2026-10-21 (user request)

- **Time to focus screen:** the "Your session" card lost "Start now and stop whenever you like."; its toggles read "Pomodoro" and "Timelapse" (no "Enable"). "A little space for what you want to do." was kept on purpose.
- **Start dialog:** Pomodoro help ends "long break every 4 cycles."; the For hint is just the length ("1 h"); Until past today reads "Tomorrow, 4 h 59 min from now."; "Show the timer" has no description; the zero-length toast says "Pick a later time" or "Pick at least 1 minute" (also in the extension).
- **Replacing a running session:** "End ECO220 and start a new one?", button "End and start", body "Its time so far is kept."
- **Focus screen prompt** (owner's words): "Opens a new tab with a focus screen that just has the timer."
- **Cutting a block short:** "This ends your work block 10 minutes early." ("Are you sure?" dropped).
- **Focus screen:** no line under "Nothing running"; the shortcuts read "Esc to leave · Space to pause · H to hide the clock" under "Your session keeps running."; the hide button's tooltip matches its label.
- **After sleep** (owner's words): "The session kept running while your computer slept."
- **End early:** "Your time is saved, but it counts toward your level only after 10 minutes or when the task is done."
- **"Done with {task}?"** has no body, in the app and the extension.
- **Session summary streak line** (owner's words): "{n}-day streak. Keep it up!"

## Copy audit, batch 3: after a session, and the voice rule, 2026-10-21 (user request)

- **Voice:** a little quirky is fine if it sounds like a person, never corporate or AI-polished; fragments are fine. CLAUDE.md's voice rule now says so (it used to say "never quirky" and "full sentences").
- **End-of-session lines swapped:** "Bring on the exam.", "Feeling better about this one.", "Each one a bit better than the last.", "Chipping away at it." replace four coach-speak lines. "You've started. That's often the hardest part." stays (the owner turned down "One down"), as do the milestone and late-night lines.
- **Timelapse prompt** (owner's words): "We take stills from your computer's camera and give you a timelapse in the end." with a "Change what it looks like" link to Settings › Focus screen, opened in a new tab so the focus screen stays put.
- **Timelapse:** the two toggle descriptions are gone (one was wrong when breaks are recorded); storage hints say "Needs about 1.2 GB while recording. The video ends up around 40 MB."; "Stop recording to include the whole session."
- **Audio sharing:** one paragraph: "The visualizer needs to hear your music. Share a tab, window or your screen, and tick share audio in the browser's picker. We don't record anything, and it's optional."
- **Delete time:** "You'd have stopped at 3:10 AM." / "That's 1 h of focus, 10 min of breaks gone, and 120 XP off (25 left)." The achievements note and the "Time comes off the end…" hint were removed at the owner's request.
- **Session history:** "Finished sessions show up here." / "Left one running? Delete time trims the end, and the XP that came with it."

## Admins on the leaderboard, 2026-10-21 (user request)

The owner (zachzhao2015@gmail.com, the only `ADMIN_EMAILS` entry on Render) wasn't on either leaderboard: the earlier rule left configured admins off it along with test accounts. They asked to be on it. Admins are now ranked like anyone else on both boards and in `/api/leaderboard/stats`; test accounts (`is_test_account`, which both seeded local accounts carry) stay off. `leaderboardRoutes` no longer takes the admin list.

## Ticking a task ticks everything under it, 2026-10-21 (user request)

Marking a task done (the Tasks checkbox, or ending a session with "mark done") marks every unfinished item under it done at the same moment, at every depth. A subtask unticked afterwards stays open and the parent stays done. Unticking the parent reopens only the items finished with it (same timestamp), so subtasks finished earlier keep their own dates and Ctrl+Z puts everything back as it was. It lives in the API (`cascadeCompletion` in `services/nodes.ts`), so every client gets it.

## Closing a tip asks "Disable tips?", 2026-10-21 (user request)

Closing a tip on the dashboard raises a toast from the bottom: "Disable tips?" with a check and an X. The check turns off Settings › Pages › Dashboard › "Tips about the app" (the same `quote.appTips` switch); the X, or no answer within 8 seconds, keeps tips on. It asks every time a tip is closed. To make it, `toast()` in `@komogon/ui` now returns a function that takes that toast away early.

## Timelapse layout: line-up buttons, and Save and Revert, 2026-10-21 (user request)

- **Line up.** The chosen piece (screen, clocks, task name, progress bar, mark) has Left, Centre and Right buttons under the preview: against the left side, in the middle, or against the right side, 4% in from the edge. A text piece also remembers that side (`align` on its box), so a longer real task name grows away from it: a right-aligned name grows leftwards. The default task name and mark hold to the right.
- **Nothing saves until Save.** Moves, resizes, shape changes, add and remove all wait in a draft. After the first change a bubble stays at the bottom of the window ("You have unsaved changes to the timelapse layout.", Revert and Save) until one is pressed; ordinary toasts rise above it meanwhile, and closing the tab with changes asks first. The other timelapse settings below the editor still save as they change.

## Weekly streaks, and rest days out of the streaks, 2026-10-21 (user request)

- **A weekly streak sits beside the daily one.** A Monday-to-Sunday week counts once it has enough streak days, judged exactly as the daily streak judges a day (the minimum minutes, the day start hour). "Days a week for the weekly streak" in Settings › Pace and streaks sets how many, 1 to 7, default 1, the way running apps count a week with one run. This week counts as soon as it has its days and otherwise stays open until Sunday ends; a week short of its days ends the run. Freezes stay the daily streak's.
- **Stored with the daily streak**, in `users.streak.weeks` (current, longest, lastCountedWeek), and brought up to date lazily by `syncStreak` (`evaluateWeekStreak` in packages/core), so no migration. A streak saved before this has no `weeks`; the first sync reads every session once and fills in the best run from history.
- **Where it shows:** the dashboard's numbers (Daily streak beside Weekly streak), the Analytics streaks card (a calendar badge under the flame, once there has been a week), the end-of-session summary (when above zero) and the profile. The top bar and sidebar pills still show the day count; their tooltips name both.
- **Rest days no longer protect either streak.** The owner chose this over removing rest days altogether. They still shape the daily plan and pace, and vacations and break days work as before, but a quiet rest day is missed like any other: a freeze covers it or the daily streak ends, and a week of vacation ends the weekly streak. This replaces "rest days never break a streak"; the copy that promised it now reads "Your daily plan works around rest days." Days judged before the change stay as they were. Break days from the shop now only give the plan a day off; their price and description are unchanged for now.

## The always-on local copy is gone, 2026-10-21 (user request)

The owner asked to remove the always-on copy (the frozen build on 5173/8787 that started at sign-in). It was stopped and its startup shortcut moved to `~/.komogon/Komogon.lnk.disabled`. They study on komogon.app now; the last thing done on the local copy came before the snapshot that seeded the hosted data, so nothing was left behind. The data folder and the `pnpm local:*` scripts stay. CLAUDE.md no longer tells agents to keep their hands off it.

## The calendar, rebuilt, 2026-10-21 (user request)

The owner called the old page "a mess, ugly and useless" and asked for the best calendar we could make. Asked first, they chose a week planner and a deadline overview (not a training log); finished sessions, rest days and study-plan topics on it (not routines); and all four ways of planning offered: drag to move and resize, Plan my week, start from a block, and a day view on phones. Their complaints, all four: useless, the grid looked bad, a cluttered header, and the "Planned vs needed" list.

- **Week, month, and one day on a phone.** The view and date are in the address (`?view=month&date=…`), so a week can be linked to. Arrow keys move, T goes to today, W and M switch view. On a phone the week is a strip of days over a one-day grid, and a quick sideways flick changes day.
- **The header names the period** ("Oct 19 – 25", "October 2026") and folds the totals into the same line: planned, studied, due. A total that is zero is left out. The paragraph, the settings link and "Suggest a block" are gone; connecting Google or Outlook is a quiet link at the foot of the side panel, shown only while neither is connected.
- **What a block looks like says what it is.** The course's colour as a tint over the theme's solid surface, so grid lines never show through. Planned is light; studied is filled in with a check; time set aside and passed by is faint and never flagged; an imported event is neutral grey; a Plan my week suggestion is dashed. A planned block that a session kept is drawn as a dashed outline behind the session rather than as a second block beside it, so any gap between plan and reality shows on its own. The running session is drawn up to now. Free/busy time is a plain grey band; the hatching is gone. Overlaps still get a marked edge and are never refused.
- **Planning by hand.** Drag over empty time to make a block (a click makes an hour); drag a planned block to move it, to another day too; drag its bottom edge to change its length. On a touch screen a long press starts the drag, so scrolling still works. A move is drawn at once and saved behind it, and Ctrl+Z takes it back through the existing undo stack.
- **To plan replaces "Planned vs needed".** It lists what still wants time this week. A task gets its pace share of the week: the minutes per study day its pace asks for, times the study days left in the week before it is due, less what is already planned in the week, never more than is left on it. A study plan gets what is left of its weekly budget, planned against its next topic. Something already covered stays on the list as "Set aside", so the list shows the win; there are no warning colours. Drag an item onto the week, or click it and the dialog opens on the first free slot.
- **Plan my week** (`planWeek` in core, tested) proposes blocks for everything on To plan: overdue work first and on the first day with room, then soonest deadline first, each block on the lightest study day before its deadline that it has no block on yet. Between 8:00 and 22:00 like the old suggester, never on rest days, around imported events and Google or Outlook busy times with 15 minutes' room either side, at most 4 hours of planned study a day counting what is already there. The suggestions are dashed blocks that can be moved, then kept one by one, kept all at once, or dropped. Nothing is saved until it is kept.
- **Start from a block.** A planned block today that hasn't ended gets a play button; the start dialog opens on that task with the minutes left in the block.
- **Month is the deadline overview.** Due chips on each day (assessments carry a flag), studied time on days gone by and planned time on days ahead, rest days shaded; a click on a day opens its week. Beside it, "Due this month" lists the deadlines a week at a time ("This week", "Next week"), so a crunch shows before it arrives. A click on any deadline opens the task.
- The block and free/busy queries keep the last range on screen while the next loads, so moving between weeks doesn't flash a spinner.

## Adding calendars by link, 2026-10-21 (user request)

The owner asked for "the ability to add calendars". Settings › Calendar showed only Google and Outlook, both "Not configured" on komogon.app (connecting them needs OAuth keys from Google Cloud and Microsoft Entra on Render), with Google's two switches showing anyway.

- **Add a calendar by its link.** "Your calendars" at the top of Settings › Calendar, with "Add a calendar": paste the calendar's .ics or webcal link (Google's "Secret address in iCal format", Outlook's published ICS link, an iCloud public calendar, Moodle or Canvas exports), optionally name it, and choose whether its exams and deadlines become tasks (on by default, like Google and Outlook). It works on any server with no setup. Up to ten per account; the same link twice is refused.
- **Its events are commitments**, like Google and Outlook ones: grey blocks on the week, never study time, planned around by Plan my week. A new block source and import provider, `'ics'`. Time the calendar marks as free (most all-day events) is imported but not planned around, and a due moment with no length (Moodle's deadlines) goes in the due row rather than the grid.
- **Refreshed every 15 minutes** by the existing calendar worker, or with the refresh button. A failed read keeps the events as they were and shows why under the calendar. Removing a calendar removes its events; tasks made from it are kept.
- **The link is a secret** (it opens the whole calendar), so it is stored encrypted (a key derived from the server's existing secret, so no new setting) and never sent back to the portal; the page shows the host only. The API fetches it with no internal addresses (checked when connecting, so DNS tricks don't get past), only ports 80 and 443, at most 5 MB, 15 seconds and four redirects.
- **The reader** (`readIcsFeed` in core) places events in their own time zone (IANA, Windows names from Outlook, the calendar's X-WR-TIMEZONE, then the account's), expands repeats (daily, weekly, monthly, yearly; COUNT, UNTIL, BYDAY, BYMONTHDAY, BYSETPOS), and honours EXDATE, moved and cancelled occurrences and RDATE. It reads a month back and six months ahead, at most 3000 events.
- **Google and Outlook rows hide** when the server can't connect them and they aren't connected; they come back as soon as the keys are set. The feed going the other way was relabelled "See your plan in another calendar app (.ics)" so it isn't mistaken for adding one. The calendar page's foot link now reads "Add your timetable to plan around your classes" and shows while no calendar is added or connected.

## Seeing when friends are studying, 2026-10-21 (user request)

The owner asked to see when their friends are actively working and studying. The Groups tab already had "Live now"; it now shows where people look first.

- **On the feed**, "Live now" sits above the composer whenever a friend is in a session: their picture with a red dot, a clock running since they started, what they're on, and "On a break" or "Paused" (with a grey dot and clock) when the timer is. It refreshes every 30 seconds.
- **In the friends card**, friends in a session come first, with the dot on their picture and "Studying · 24 min", "On a break · …" or "Paused · …" under the name. Their nudge bell is hidden while they study.
- **On a friend's profile**, a "Studying now" pill with the clock.
- **A sharing setting**, Settings › Social › "Show friends when I'm studying" (`settings.social.live`, on by default like the others). Off, friends see nothing on the feed, the friends card, the profile or the Groups tab's friends list; people in a group with you still see you in that group's card, since joining is the consent.
- **Live stays live.** A session counts as live while it reports in within ten minutes. An open-ended session never changed its timer, so it stopped reporting in and dropped out of "Live now" ten minutes in (the Groups tab had this too). Now each look at the running session refreshes `last_seen_at` once a minute, and the portal keeps checking in from a background tab while a session runs.

## A tab from before a deploy reloads itself, and Jams works on the hosted site, 2026-10-21 (user request)

- **"Failed to fetch dynamically imported module".** Each page is its own file, renamed on every build. A tab opened before a deploy asks for the old name, Vercel answers with the app's HTML, and the page can't load ("Try again" asks for the same missing file). Now the error boundary reloads the tab once to pick up the new build, showing nothing in the meantime. If that tab already reloaded for this in the last minute, it says "Komodon was just updated. Refresh the page to load the new version." with a Refresh button instead, so it can never loop. Only page loads do this, and never while offline. A running session is kept by the server, so it carries on through the reload (checked in a sandbox with a deploy mid-session), and the focus screen loads nothing after it opens, so it never reloads under a timer or a recording.
- **"Could not load the jams."** on komogon.app: the jams list compared a column with a JavaScript `Date` inside hand-written SQL. The hosted database driver (postgres.js under Drizzle) can't send a raw `Date` there, while PGlite in tests and sandboxes can, so it only failed live. Now it uses Drizzle's `gt`/`lte`/`or`. The email-code rate limiter had the same mistake (it would have broken sign-up codes and password resets once email is switched on) and now passes the times as text. CLAUDE.md has the trap.

## Admin tools: onboarding again, study time, suspending and deleting, 2026-10-21 (user request)

The owner asked for dev tools such as starting onboarding again without losing data, adding or deleting other people's hours, and deleting or banning emails and accounts, all on the admin page for admins only.

- **Onboarding again keeps everything.** It clears `onboarded_at` and the closed first-visit hints (`settings.dismissed`); tasks, sessions, XP, streaks, friends and posts stay. Finishing onboarding now sets the new-account defaults (simple dashboard, focus screen not opening on start, timelapse off, visualizer prompt closed) only where the account hasn't stored a choice, so a brand-new account gets exactly what it did before and a returning one keeps its settings. Dev tools has it for your own account (it also clears this device's copy of the hints and goes straight to onboarding); each account's Manage dialog has it for someone else, who sees it next time they open the app.
- **Adding study time** makes a finished session with nothing picked, on the chosen day in that person's time zone: at noon on a past day, or ending now on today. It counts everywhere studied time does (analytics, leaderboard, profile, groups, a streak day not yet judged) but earns no XP, and it is logged on their calendar like any session. Its review is marked skipped so nothing asks them about it.
- **Taking time away** uses the existing trim (focused time off the end of a session, its XP scaled down, lapsed badges taken back) or deletes a session outright (its XP and lapsed badges go with it). As with trimming, a streak day already counted stays counted.
- **Suspending** an account sets `users.banned_at` and blocks its address; lifting it undoes both. Blocking an address that has an account suspends that account; unblocking lifts it. So a suspension and a block never disagree. A suspended account is refused on every request (403 `account_suspended`), can't get a new sign-in token by any route (password, Google, email code), and is left off the leaderboard, the feed and people search. Its data is kept. The portal signs it out and the sign-in page says "This account has been suspended. If that seems wrong, get in touch with whoever runs Komodon."
- **Deleting** an account removes it and everything in it for good, after typing its email to confirm. "Keep this email blocked" (on by default) stops the address signing up again.
- **Admins are protected:** an `ADMIN_EMAILS` account (yours included) can't be suspended, deleted or blocked from the page.
- **Migration numbering.** This shipped first as `0021_admin_moderation` (table `blocked_emails`, column `users.banned_at`). The unpushed `username` branch also has a `0021_usernames`, made earlier, so its journal `when` is older. Drizzle runs a migration only if its `when` is later than the last one applied, so merged as it is, the usernames migration would be skipped on the hosted database without any error. When merging that branch, delete its 0021 SQL, snapshot and journal entry, then run `npx drizzle-kit generate --name usernames` to make a fresh 0022.

## Social side cards, 2026-10-21 (user request)

- **The small leaderboard beside the feed is roomier.** The owner asked for larger margins and padding on it: 18px 20px padding (the other side cards keep 12px 14px), 14px between its parts and 6px between rows. It is the one exception to the dense side cards.
- **A nudged friend shows a crossed-out bell** until they can be nudged again (two hours, the same window the API already enforced). `GET /api/social/friends` now gives each friend `nudgeAgainAt` while that window is open, so it survives a reload; the bell comes back by itself when the time passes. Clicking the crossed-out bell says when they can be nudged again rather than sending anything.
- **Your card's figures are centred.** Days and level sat in the first two of three columns; the row now has one column per figure.

## The phone's camera screen, and a timelapse preset per device, 2026-10-21 (user request)

The owner asked that a phone open "the Apple timelapse feature" instead of the focus screen, with the times shown on the camera. A website can't open the iPhone's Camera app in Time-Lapse mode (see the CLAUDE.md timelapse section), so they were asked first and chose every recommended answer: Komodon's own camera, working like Apple's (rather than a native App Store app, or importing a video from Photos); the front camera with a swap button; the video's shape set when it starts; separate upright and sideways layouts on the phone; the camera screen only when recording; trimming like the Photos app; each preset holding everything; the dimming on the screen only.

- **On a phone, recording is the camera screen.** Saying yes to "Record a timelapse?" (or having it on Always) turns the focus screen into the live camera across the whole screen, with the phase, the timer and the task on it and the controls along the bottom: hide the clock, a large round pause and resume where the Camera app has its shutter, and stop the session. Skip break and +15 min appear above them when they apply. Saying no keeps the normal focus screen. "Stop recording" at the top goes back to it with the stills kept.
- **A phone** is a touch screen whose short side is under 600 px (`isPhone` in `lib/device.ts`). Tablets and touch laptops are computers.
- **It turns with the phone.** The page turns with the phone. Sideways, the controls go down the right side and the timer sits bottom left. The video keeps the shape it started in (the first kept still decides); a still taken the other way round is cropped to the middle rather than squashed, and turning the phone mid-recording says so once in a toast.
- **Breaks always show**, with the phase, the break clock and Skip break. Whether they are filmed is the phone preset's "Record breaks too" (off by default); the recording pill says "Not filming the break".
- **The picture dims a little while focus runs** (40% black over it) and comes back up for breaks and pauses. Only on the screen: the stills are taken from the camera, never from what is drawn.
- **Front camera by default, with a swap button** when the phone has two cameras; the choice is remembered in this browser (`komogon.timelapse.facing`). The front one shows as a mirror, the back one doesn't; stills are never mirrored.
- **The screen stays on** while the camera screen records (a wake lock, asked for again whenever the page comes back), since a phone stops its camera when it locks. If the camera stops anyway, the pill says so and a note offers to start it again; it also restarts by itself when the page is looked at again. A muted camera takes no stills.
- **Two presets in Settings › Timelapse: Phone and Computer**, both folded until clicked, the device's own one first and marked "This device". Each holds the layout, the shape, the length, the frame rate, breaks, smoothing and deflicker. "When a session starts" (ask, always, never) is shared and sits above them. The computer's preset is the old `settings.timelapse`, so nothing anyone saved moved; the phone's is `settings.timelapsePhone`, with `aspect`/`layout` for upright and `sidewaysAspect`/`sidewaysLayout` for sideways, and never a screen. Its editor has an Upright and Sideways switch; changes to both wait for the one Save. Upright shapes: the camera's, 9:16, 4:5, 1:1. Sideways: the camera's, 16:9, 4:3, 1:1. Links to `/settings#timelapse-phone` or `#timelapse-computer` open one preset.
- **Trimming on a phone is like the Photos app**: a viewer showing the frame as it will come out (the clocks and the mark included), a strip of nine stills with a handle at each end, a playhead that can be dragged between them, and a play button that runs through the kept part at the video's speed (without the blending, so it is quick). Computers keep the Start and End sliders.
- **Saving on a phone** opens the share sheet, so "Save Video" puts it in Photos; a plain download only reached Files. Closing the sheet saves nothing; if sharing files isn't possible it downloads as before.
- Back camera and wake lock were in IDEAS.md (2026-10-21) and are built as part of this. The Photos import stays an idea.

## The app's own landing page removed, 2026-10-21 (user request)

- **Signed-out visitors to the app go straight to sign in.** The portal's landing page ("Keep your coursework and study time together.") showed on a first visit from a new computer; the owner asked to delete it entirely so it never shows again. `pages/Landing.tsx` and its styles are gone, and `/welcome` (its preview) now redirects to sign in. The marketing site in `apps/site` is untouched.

## Post files on Cloudflare R2, 40 MB videos, and compressing what's too big, 2026-10-21 (user request)

The owner asked what hosting videos for Social would cost and whether it could be free. Kept in Postgres and served through the API, a video costs Neon storage (about 150 fit in the free 1 GB) and Render bandwidth on every play (the free 5 GB a month is about 1,000 plays, then Render suspends the API or bills $0.15/GB). They chose Cloudflare R2 (10 GB free, downloads never charged), then asked for the video limit to go to 40 MB and for files over it to be accepted and compressed rather than refused.

- **R2 behind signed links.** The browser uploads straight to the bucket through a 15-minute link the API signs for that exact type and size, and plays from one-hour links. Nothing passes through Render either way. The bucket stays private; a post kept to friends gives no link to anyone else (the bytes route now checks this too).
- **Uploads land under `uploads/`, posts live under `posts/`.** Making the post copies the file across inside the bucket; a lifecycle rule empties `uploads/` after a day, so a file nobody posted never stays. Deleting a post or an account deletes its files.
- **Postgres stays the fallback.** Without the `R2_*` variables, files go with the post as before and videos stay at 5 MB (base64 in a database row). Posts made before R2 keep playing from Postgres; there is no migration of old files.
- **40 MB for videos with R2**, 2 MB for pictures as before.
- **Over the limit, it offers to compress.** "This video is 62 MB, and posts take up to 40 MB." with Compress it and Cancel, in the composer and under "Share to Social". Videos are re-encoded in the browser (mediabunny over WebCodecs): the bitrate comes from the length, the size and frame rate drop when the bitrate is low, sound is kept, and it tries once more if the result still comes out too big. Pictures are redrawn as JPEG. A video too long to fit even at a low bitrate is refused with "A shorter clip would."
- Setup steps and how to check them: docs/R2.md (`node scripts/r2-check.mjs https://komogon.app`).

## Cards keep their content 20px from the edges, 2026-10-21 (user request)

The owner found text sitting too close to the rounded corners (the Friends card, Live now and the study group card on Social, at 12-14px padding inside a 22px corner) and asked for larger padding as a consistent rule. Every card now uses one token, `--card-pad: 20px` (packages/ui/tokens.css): the Social cards (side cards, composer, posts, Live now, groups, jams and their forms, the leaderboard's tiles and lists, nudges), the dashboard task cards, the Analytics insight cards, Achievements, the calendar's side panel and the profile's totals. Cards that run a grid or table to the edges keep their text 20px in instead: the calendar's day names and hour labels (its hour column is 6px wider), its suggestions bar, and the Tasks table's top and bottom. The small leaderboard's own 18px 20px went in favour of the token. Its header now wraps, so in a narrow column the Global/Friends toggle sits under the title instead of past the card's edge. In the friends card, a friend studying an hour or more reads "Studying · 1.5 h", so it fits the narrower card. The rule is in CLAUDE.md under Look.

## Tags on tasks, a Tags card, and sessions on a whole course, 2026-10-21 (user request)

The owner asked for tags on their parent tasks (the courses at the top of Tasks), tags on "the another card on tasks" (read as the dashboard's Tasks row of cards), and to be able to start a session on a top-level task. Then, the same night, to drop the colour sort and add a card below the table with a tags manager.

- **Tags, Notion-style.** A tag is a name and one of nine colours (`TAG_COLORS` in core: red, orange, yellow, green, blue, purple, pink, brown, grey). Colours are stored as names, not hex, so each theme tints them its own way; a chip is the colour at 24% over the surface with text mixed toward the page text. Tags live in their own table (`tags`, one list per person, names unique ignoring case) and each task holds an ordered list of ids (`nodes.tag_ids`, jsonb). Deleting a tag takes it off every task. A new tag takes the first colour nobody has yet. Any row can carry tags, not only courses, since the table is the same at every depth; the owner's use is the courses.
- **The Tags column** sits after Name. Clicking the cell opens the tag menu: the row's tags at the top with a search box, then every tag; typing a name that doesn't exist offers "Make" it; Enter picks the highlighted one, Backspace on an empty box takes the last tag off, Escape closes. The dots on a tag rename it, recolour it or delete it (asked first). The table shows a change before the server answers, and Ctrl+Z puts the old tags back.
- **The Tags card** sits under the table: a "New tag" field, then a tile per tag across the card's width with the tag, how many tasks have it and which ones by name, the nine colour dots (one click recolours), rename and delete (asked first: "Delete Economics? It comes off 3 tasks."). A tag can be made here before any task has it.
- **No colour sort.** A "Your order / Colour" switch that grouped rows by tag colour was built first and removed the same night: the owner didn't want ordering by colour. Rows keep the order they are dragged into.
- **Narrow tables.** The column needs about 960px of table. With less (a small window, a phone) the tags take their own line under the title and the row actions gain a Tags button; Due and Status give up 16px each so names don't lose room to that button.
- **Dashboard cards.** Each task card in the Tasks row shows its own tags and the ones it inherits from the course and units above it.
- **Sessions on a course.** Every unfinished row on Tasks now has the play button, courses included; a session on a course counts toward the whole course, as it already did when picked in the start dialog. A folded course's item count moves after its title, as other rows with a play button already had it. Finished rows keep the count in the play slot.
- **Migration** `0024_task_tags`, after the admin tools' 0021, the calendar feeds' 0022 and the R2 post files' 0023. The unpushed `username` branch also made a 0021 and must regenerate its migration before it lands (see the admin tools note on Drizzle's `when` ordering).

## A faster start: paste a term's deadlines from an AI chat, 2026-10-21 (user request)

The owner: onboarding had "too much friction"; a busy student has to add their calendar and "like a billion tasks". They asked for a faster path, "maybe involve ai but the ai like plans would not be native to the software".

- **Komodon has no AI of its own here.** "Copy a prompt for your AI" hands over a prompt (`studyListPrompt` in `packages/core/src/study-list.ts`, with today's date in it) for the chat the student already uses. They give that chat their course outlines or syllabi; it answers with one line per item, `Course | Item | Due | Hours | Type`; they paste that back. Nothing is sent anywhere by the app.
- **One paste box reads many shapes** (`parseStudyList`): the prompt's own format, a markdown table (columns in any order when it has a header), columns copied from a spreadsheet, and lines typed by hand that start with a course code ("CSC148 lab 5 due Nov 6", "ECO 101 midterm Nov 12 at 2pm 6h"). A line naming only a course ("MAT137", "Chemistry:") adds it and is the course for the lines under it. Dates: ISO or month names; a yearless date more than 60 days gone is next year's. Types are guessed from the title when missing (midterm, exam, quiz, test, final are assessments).
- **Everything shows before it's added**, grouped by course with dates, hours and "Already in Tasks" or "New course". Lines it can't use, and dates or estimates it can't read, are listed as "lines to check" rather than guessed.
- **`POST /api/nodes/import`** adds the whole list in one transaction (up to 60 courses and 500 items). Courses already at the top of Tasks are matched like the calendar import matches them ("ECO 101" is ECO101); an item already under that course with the same title and due date is skipped, so pasting twice adds nothing the second time. Not on the Ctrl+Z stack, like other imports.
- **Where it's offered:** a "Got a lot due?" card on the first ("Time to focus") screen, in place of the "Your session" card; the full dashboard's "Nothing to study yet" card (its wording kept); and "Paste a list" beside New course on Tasks, plus "Paste a whole list" in its empty state. The cards also offer "Add your calendar", which opens the same "Add a calendar" dialog as Settings › Calendar (an .ics or webcal link, "Turn exams and deadlines into tasks" on), so it works on komogon.app without Google or Outlook keys, and "Add them yourself". A session still needs none of it.
- **The "Your session" card is off the first screen** (its Pomodoro, Timelapse and Show the timer toggles and Start), replaced by "Got a lot due?" at the owner's request ("remove this card and replace it with the other card"). The greeting line stays "A little space for what you want to do."
- **The simplified first screen shows only while Tasks is empty.** The owner, on an earlier build: "this should never appear. when i add my first task or import things it should just show full dashboard". So `Today` shows `FocusDashboard` only when "Simplify the dashboard" is on and the account has no courses or items; the first one, added by hand, pasted or from a calendar, brings up the full dashboard on every device. The setting's description says so. A session can still be started from the full dashboard or the focus screen.

## The profile's day grid darkens the days before the account existed, 2026-10-21 (user request)

The owner asked for the days on the profile's "Days studied" grid from before the account existed to be darkened, so a new account's six months don't read as months of days off. (They briefly asked for "until the first session" instead, then went back to the join date.) `studyHeatmap` takes an optional `since` (the account's `created_at`) and marks each earlier day `before`, worked out in the account's own timezone; a day that has study on it is never marked, in case time was added from before the account began. The grid draws those squares like the days still to come (the empty-day colour, faded) but a little darker: 35% opacity against the future days' 45%. A first try in solid black at 24% was "too dark". They read "before joining" on hover and can't be selected. Only the profile passes `since`; the Analytics and recap grids are unchanged.

## "I'm a dev": throwaway accounts, fresh or Jerry, 2026-10-21 (user request)

The owner asked for a quick way for them and the agents to see and test changes on the hosted app: an "I'm a dev" link on the sign-in page, paste the dev password, and get an account that isn't a real one, has no admin powers and isn't connected to the rest of the app. Little security needed; it's a debug account. Then: two choices before signing in, a fresh account or Jerry, a long-time user with friends and stats, both on the app's defaults; a way to sign out; and the link small and greyed out.

- **The link.** Small grey "I'm a dev" text at the foot of the sign-in card (server mode, shown when `GET /api/auth/dev` says it's on). It opens "Dev password" with two buttons, **Fresh account** and **Jerry**. `POST /api/auth/dev` takes `{ password, kind }` and answers a token like any sign-in.
- **Fresh account:** a new account starting exactly as a new person's does, default settings and all.
- **Jerry:** sixteen weeks of study across STATS203, ECO220 and CSC148 (tags Midterms, Econ, CS), finished tasks behind the open ones, a six-day streak and a seventeen-day best, XP, a level and the badges they bring, sessions on the calendar and a few planned blocks ahead. Five friends: Noah, Priya and Leo accepted, Sofia asking him, Ethan asked by him. Posts with kudos and comments, the "Study group" with Noah, Priya and Leo, a running jam, a friend's jam to join and a finished one, a nudge from Noah this morning, and Noah and Priya studying right now. Built in `services/dev-world.ts` straight into the database in batches (about a second), with fixed randomness so Jerry always looks the same apart from the dates. Everyone's streak is judged while building it, and the resets found in old history are dropped, so Jerry isn't greeted with "Your streak ended".
- **A world of their own.** Each dev sign-in makes a world (`users.dev_world`): a fresh account alone, or Jerry and his friends. Real people (no world) and dev worlds never see each other: the feed, a post's files, kudos and comments, people search, friend requests, profiles, both leaderboards and their averages, and joining a jam or group by code all check it (`inWorldOf`, `ownerInWorldOf`, `sameWorld` in `services/dev-accounts.ts`). Everything else in Social (friends, groups, live, nudges, Compare) follows friendships, so it stays inside too. Two Jerrys made a minute apart don't see each other either.
- **Not real accounts.** Addresses like `dev-1a2b3c@dev.komodon.invalid` (`.invalid` can never receive mail), no password, never an admin, left out of the admin list, and turned away from university email checks, account email and password changes, and admin (403 "Dev accounts can't use this."). An invite list (`ALLOWED_EMAILS`) doesn't stop them. Each world has `users.dev_expires_at` a day after it was made (Jerry's `created_at` is months back, so it can't be used for this); expired dev accounts are deleted with everything in them whenever a new one is made, and a token for a deleted one is refused ("That dev account has expired. Sign in again.").
- **The password is only ever a hash in the code** (`DEV_PASSWORD_HASH`, scrypt like `password_accounts`): the repository is public. Ten wrong tries in 15 minutes from one address get a wait; thirty new dev accounts an hour per address. `DEV_LOGIN=off` on the API turns it off. It needs `AUTH_SECRET` to sign its tokens, so try it in a sandbox run with `AUTH_SECRET` set and the portal's `VITE_DEV_AUTH_SECRET` empty.
- **Signing out.** A dev account has Sign out in the top bar and the sidebar, and so does anyone with Social off (no profile, where Sign out lives). For a dev account the question says it can't be signed back into: the next dev sign-in makes a new one.
- **Signed out with a reason.** A 401 on `/api/me` (an expired dev account, any ended session) now signs out and says so on the sign-in page instead of "Could not reach the Komodon API". The reason travels in session storage (`komogon.signin.notice`), because the redirect after signing out dropped the router state; that also fixes the suspended-account message, which was lost the same way.
- **Migration** `0025_dev_accounts` (`dev_account`, `dev_world`, `dev_expires_at` on users).

## The sidebar is the default, 2026-10-21 (user request)

The owner asked for the sidebar as the default. `DEFAULT_SETTINGS.nav.style` is now `'sidebar'`, so new accounts, and anyone who never picked one in Settings, get the sidebar on a computer. Phones keep the bottom bar. This replaces "Top bar stays the default" from earlier; Settings still offers both.

## Prettier "Good to know" cards on Analytics, 2026-10-21 (user request)

The owner asked for the Analytics "Good to know" cards to look nicer.

- **Each card has an icon** in a small accent-tinted tile, picked by the insight behind it (`INSIGHT_ICONS` in `RecapView.tsx`): a target for the forecast, an hourglass for progress through a task, a list of ticks for tasks done, a brain for a focused run, and so on. Lucide icons, no emoji: the forecast sentence ends in a target emoji, which the card drops since its icon says the same.
- **Two cards get a progress bar** on the card's floor: "You're 88% through Unit 1" (the highlight's own progress) and the forecast (all-time hours against the hours it names). The other cards stay text only.
- Lines wrap with `text-wrap: pretty` so a headline doesn't leave one word on its last line. On a phone the cards are one a row with the icon beside the words, so each stays short.
- **Same surface as every other card on the page.** The owner found them off in colour and opacity. They had their own near-solid fill (`--glass-solid` at 78%, from when they were "text over the photo") and were Glass cards with its top sheen; they are now Panels with no override, like the chart tiles, so they match the tiles and trophies in every panel style.

## Every card is the same card, 2026-10-21 (user request)

- **The ask:** "proper consistency with every card with exceptions (nav bar, side bar, setting
  bar etc). Same rounded edges and allat". An audit of every card on every page found the
  corners, border, shadow and blur already matched; the padding and two fills did not.
- **20px padding on every card** (`--card-pad`), the roomy ones included: the dashboard hero
  (was 28-32px), start panel, timer card, note, "Days focused", the Analytics hero (40-48px),
  streaks, tiles, equivalents (14px) and trophies, the Achievements hero and reward cards,
  the profile header and tiles, "Got a lot due?", the plan cards and plan page, and the
  empty and error states (24-32px).
- **The hint banner is a card too:** the 22px corner (was 14px) and 20px padding, and its
  lightbulb is centred on the row ("tip icon is too high make it centred"); the tip card's
  lightbulb and close button are centred the same way.
- **Locked badges are on the same surface** as earned ones; they had a lighter fill and no
  shadow. The lock icon and the muted name still say locked.
- **Kept as they are:** the Tasks table and the calendar grid run edge to edge (their text
  stays 20px in); the nav bar, sidebar and settings bar, toasts, menus, dialogs, the focus
  screen and the sign-in card are not cards.
- **The glass blur stays at 28px.** It was lowered to 16px when the owner found the cards
  "too frosted", and put back when they preferred the colour from before.
- **Tried and undone the same night: making every card frost without exception.** The
  Achievements badges (under the fold's mask) and cards inside fading wrappers (a page
  arriving, Analytics loading or rising in, "See all", dialogs) show the background unblurred,
  because a mask or opacity on an ancestor turns the blur off. Moving the masks and fades onto
  the cards fixed that, but the owner didn't like the look and asked for it reverted. Leave
  those as they are unless the owner asks again.

## Coming up and the task cards, trimmed, 2026-10-21 (user request)

The owner found the dashboard's task cards and Coming up "too much text" and asked what "Estimate met" means: you have studied as long as you estimated, but haven't ticked the task off (ticked ones already leave Coming up).

- **Task cards lose "Planned X of Y needed".** The card ends at the due line and "Need N per day". `NodeCard` no longer takes `plannedMinutes`.
- **"Estimate met" stays, in blue** (`info` tone) instead of green, so it no longer looks like "On track". The Tasks table's dot for it is blue too.
- **Coming up says what was studied.** A row with its estimate met reads "Studied 1 h 35 min" where the others read "35 min left".
- **Coming up is laid out as columns**: when, title, time, status, every column left-aligned (the owner tried the times and then the tags right-aligned, and settled on everything left). The tags have 40px of room before them, which pulls the times a little closer to the titles. When the card is narrow (phones, or beside Routines) each row takes two lines: title and status, then when and the time under the status.

## The profile: feed-sized posts, top badges, the study clock, streak tiles, 2026-10-21 (user request)

The owner: the posts on a profile were "too big" (they ran the page's full width, about 1060px, with a video as tall as the screen) and should be "the same size as the posts in social"; on the side, the person's "top 4 badges in terms of xp gain" and the "When you study" ring from Analytics. Then: make the daily and weekly streaks on Totals "more apparent", "add an icon", "maybe add back that fire animation", "dont make it too monotonous", and an XP bar next to the level.

- **Posts at exactly the feed's width.** Under Totals the profile is two columns: the posts, and a side column as wide as the feed's two side columns and the gap between them (464px), narrowing to 240px under 880px of page width as the feed's do, so a post is the same width as on Social at any page width (measured equal from a phone to the full 1120px page). Under 660px the side cards go above the posts. With no posts to show, the side cards share the full width; someone who keeps their study time to themselves now gets that line in the side column, beside their posts.
- **Top badges** (`badges` on `GET /api/profiles/:id`, `topBadges` in `routes/profiles.ts`): the four unlocked badges that paid the most XP, ties to the newer one, as tiles two to a row (a line each in a narrow column or on a phone). The XP amounts are not shown or sent: they stay on Achievements, as the standing rule says. Your own profile links to "All badges".
- **The study clock** (`clock`, `timeOfDayClock` over all their sessions in their own timezone) is the Analytics ring, now one component (`components/recap/StudyClock.tsx`) used by both. On someone else's profile its note is "Night owl" rather than "You're a night owl". Shown only when there is time on it. On every profile it is titled "Peak study hours" (owner, 2026-10-21: no pronoun; it was "When you study" / "When Noah studies"); Analytics keeps "When you study".
- Both follow the study-totals setting: null for others when it is off, like the grid and totals.
- **Streak tiles.** The streaks left the row of figures for tiles of their own: the daily one on a warm tint with the animated fire (`Flame`, StreakFlame.tsx, unused since the Analytics streaks card moved to the line icon; it grows with the run and is still under reduced motion), the weekly one on an accent tint with a calendar badge and this week's seven days as dots. A streak that has gone out shows its best, unlit. The two first sat stacked beside the figures; the owner found Totals "too tall" and asked for one row, with the daily streak "maybe" in the head card. The daily tile went into the head card between the name and the buttons; the owner wasn't "feeling the positioning", so four places were mocked up (a badge on the picture, a pill in the chip row, the tile under the buttons, a strip along the bottom of the card), A and D were built behind a temporary switch, and the owner picked A. **A running daily streak is now a badge on the picture's corner**: the animated flame and the day count on a warm pill, the best in its tooltip and the whole of it read out to screen readers; a streak that has gone out shows nothing there. Totals is one row: the weekly tile, then the figures (they wrap beside it, then under it on a phone). Totals went from about 300px to 177px tall.
- **The name on a phone.** Beside the gear and Sign out (or Friends and Social) the name had about 40px and broke mid-word ("Jer / ry"). When the head card is under 520px the buttons take their own line under the name, then the streak, then the bio; the Friends card opens to the right there, since its chip sits at the card's left edge. On your own profile the owner then asked for the gear and sign out "on top of pfp", smaller, with sign out as an icon only: in a card under 520px they sit in a row above the picture at 32px, and Sign out shows only its icon (the words stay for screen readers, in `.signout-label`). Someone else's profile keeps Friends and Social on their line under the name.
- **The level bar** beside "Level N" is the share of the way to the next level (`levelRatio`), with no XP figures, for the same reason as the badges.

## Settings, regrouped, 2026-10-22 (user request)

The owner asked to move four settings. Each keeps what it does, its labels and how it saves; only where it sits changed.

- **Motion** (System, Reduce, Full) is in Appearance, after Navigation. It was the last row of "After each session".
- **After each session** (Review, Phrases, Confetti, Badge toasts) is a group at the end of Timer, under its own heading.
- **Rest days** (weekly rest days and vacations) is a group at the end of Pace and streaks.
- **Social** (who sees your posts, study totals, leaderboards, friend requests, showing friends when you're studying) is a group in Account, above Data and privacy. The owner typed "more social"; they meant "move".

The three sections left empty are gone from the settings bar, and their search words joined the section that holds them now ("confetti" moved from Appearance to Timer with its switch). Old links still land: `/settings#social`, `#review` and `#rest-days` open the section that holds them and scroll to the group's heading (`MOVED_SECTIONS` and `GroupHead` in `Settings.tsx`), so the feed's "What you share" link, Today's rest-day button and the rest-day tip needed no change.

## Posting the timelapse on Instagram, TikTok and X, 2026-10-22 (user request)

The owner asked for a way to take the timelapse and post it on Instagram, TikTok and X.

- **Where:** the "Your timelapse" card, once the video is made. Under its buttons, a "Post it on" row with Instagram, TikTok and X, each with the site's own mark in one colour (paths from Simple Icons, CC0, in `PlatformMark.tsx`; lucide has no brand icons).
- **No accounts are connected, on purpose.** Posting for someone through the sites' own APIs needs a developer app registered with each site and approved by it (Instagram's posts only for business and creator accounts; TikTok keeps an unapproved app's posts private), plus a sign-in to each site for every person. Without that, a web page can't hand a file to another site, so the buttons hand the video over instead:
  - **On a phone** (the same rule as "Save the video": the recording was made on a phone and the browser can share files), each button opens the share sheet with the video, where Instagram, TikTok and X sit when they're installed. A page can't open the sheet at one app, so all three open the same sheet, and the line under them says to pick the app there.
  - **On a computer** (and on a phone that can't share files), the video downloads and the site opens in a new tab: Instagram's home page (its Create dialog has no address of its own), TikTok Studio's upload page (`tiktok.com/tiktokstudio/upload`), and X's documented web intent (`x.com/intent/tweet`, its composer). A toast gives the next step there for 8 seconds, and the line under the buttons says what will happen before the click.
- **Checks, said under the buttons, never blocking:** a WebM (what a browser that can't make an MP4 makes) can't go on Instagram or X, and X takes up to 2 min 20 s without Premium (X's help centre), so a longer video says so. Instagram's and TikTok's length limits run to many minutes, vary by account and are published differently by different sources, so they aren't checked. The length is the one the player reads from the file, or the planned one until it has.
- No caption field: each site's own composer takes the caption, and nothing is copied to the clipboard.
- A post counts as saving the video, like "Save the video" (the focus screen stops asking before it closes).
- The sites, their links and the checks are in `packages/core/src/post-elsewhere.ts` (tests beside it); the buttons are `postTo` in `TimelapseExport`.

## The focus screen's controls: Timelapse first, both sections fold, 2026-10-22 (user request)

- The controls sheet (the gear on the focus screen) now has Timelapse first and the visualizer last of the two; "Exit focus" and the key hints stay at the bottom.
- Both sections fold from their heading (a chevron, `SheetFold` in `Focus.tsx`, using `Reveal`). Both start open. What is folded is kept in this browser (`komogon.focus.folded`), so the sheet opens the way it was left. A folded Timelapse hides its "Your timelapse" card too; the end-of-session screen still shows it on its own.

## The timelapse: a preview before posting, words at the end, looks, and "Change layout?", 2026-10-22 (user request)

The owner asked for four things in one message: a preview before a post goes out, on Social or elsewhere ("sharing hours, description or anything"); a setting for their own words at the end of the video that disappears when left empty; ready-made looks to choose from; and a way to change the look and layout after a session and have the video just made redrawn ("change layout?", into the settings with a frame of that video as the preview camera, then back).

- **Preview before posting** (`components/focus/PostPreview.tsx`). "Share to Social" and the Instagram, TikTok and X buttons no longer act at once; each opens the post first. Nothing is sent until its last button.
  - **Social:** the post drawn the way the feed shows it (your picture and name, who sees it from Settings › Account › Social, "Just now", the hours, what you wrote, the video), with a "Say something" box (the post's line, 500 characters) and a "Show how long I studied" switch. Compressing a video over the limit is offered inside the dialog now.
  - **Showing the hours is a choice** (new): the switch sends `showTime: false` to `POST /api/social/posts`, which then stores no minutes and no task, so the post shows the words and the video only. It is still tied to its session, and a post without a session is still refused. No database change.
  - **Elsewhere:** the video with its caption under it, a "Caption" box and the same switch, which adds "1 h 30 min of focus on Calculus" (`postCaption` / `sessionLine` in `post-elsewhere.ts`). This reverses the line above that there is no caption field: X's intent takes the words (`?text=`), so X opens with them written in (and warns past 280 characters); for Instagram and TikTok, and in a phone's share menu (which gets them as `text` too, though apps often drop it), the caption is copied to the clipboard and the toast says to paste it.
  - The card's "Change it" button is now "Trim or change the length", beside the new "Change layout?".
- **Words at the end** (`endText` on both presets, `TIMELAPSE_END_TEXT_MAX` 140, saved trimmed to one line). When there are words, the video holds its last frame for 3 seconds (`TIMELAPSE_END_SECONDS`), darkened, with the words in the middle fading in (`drawEndCard` in `timelapse-compose.ts`, extra frames in `renderTimelapse`). Empty, there is no card and no extra length. The field is in each preset in Settings › Timelapse, on the focus screen's controls, and in the "Your timelapse" card (it saves to the preset, like the length fields there); the card's "It comes out N s" counts the card.
- **Looks** (`packages/core/src/timelapse-styles.ts`, tests beside it): Classic (the default layout), Big timer, Headline, Corner and Clean. A look places the clocks, the task name, the progress bar and the mark for the video's shape; the screen keeps its place. A piece a look leaves out waits where Classic would put it, so adding it back lands somewhere sensible. `matchTimelapseStyle` says which look a layout is in (comparing each text piece by its height, top and the side it holds to, since saving stores a piece where it was drawn), or none once it has been arranged by hand. The looks are a row of small pictures drawn with `composeFrame` (`TimelapseStylePicker.tsx`): above the preview in the layout editor (a draft until Save, like any other change there), and on the focus screen's controls, where a pick saves at once (a phone's goes on both its upright and sideways layouts).
- **"Change layout?"** (`RelayoutDialog.tsx`), beside the made video. It opens the layout editor in a dialog rather than the Settings page, because leaving the focus screen drops the stills (the reason the settings links open new tabs) and a frame can't travel to another tab without saving a picture of the person somewhere. Inside: the editor over the middle moment of the video instead of the live camera, with that moment's real time, clock and task name (the editor takes `backdrop` and `sample` props; with a backdrop the camera button goes), only the layout that video uses (a phone's upright or sideways one), the looks, and the words at the end. "Save and remake the video" saves the layout to the same setting as Settings › Timelapse and makes the video again straight away with what was saved (`make(changes)`), without waiting for the settings to come back. With nothing changed the button says "Done".
  - Found while checking it: the card used to stop any video being made whenever its video changed, so clearing the old one cancelled the remake. Making now stops only when the card goes away.
- `targetsFor` (a preset's layouts for the editor) moved from `TimelapsePresets.tsx` into `TimelapseLayoutEditor.tsx` so the dialog can use it without a circular import.
- Checked in the sandbox with a fake camera (a canvas stream): looks in Settings and on the focus screen, the end card in a made video (4.6 s from 1.6 s of stills), the Social preview posting without the hours (201, on the feed without the time), the Instagram preview at computer and phone widths, and "Change layout?" remaking the video in the new look with new words. The share menu, the clipboard on a real phone, and the sites' own pages weren't tried; the owner will have to try those.

## Komodon on a phone, and the bottom bar, 2026-10-22 (user request)

The owner asked for the phone version to feel like an iPhone app rather than the website squeezed down, with a list of specific problems (screenshots from komogon.app on an iPhone). What was wrong underneath, and what changed:

- **The new-session card made the phone zoom in.** The dialog focused its search box on opening, and iOS Safari zooms the page in whenever a text field under 16px gets focus, and stays zoomed; that is what pushed the card past the right edge and made people pinch out. Now every field on a touch screen is at least 16px (`@media (pointer: coarse)` in packages/ui styles.css), and no dialog focuses a text field on a touch screen when it opens (`Modal`: the dialog takes focus itself). On a computer the first field still gets focus, so the search box is still ready to type into.
- **Starting a session on a phone is a screen of its own** (`Modal phone="full"`, `StartSessionDialog`'s phone branch). What to study is one large row at the top ("Choose what to study" until something is chosen); tapping it pushes a list over the screen like the Settings app's, one level at a time (`SubjectPages`): No task, the courses, Routines; a course or unit opens, and its first row ("All of ECO220") studies the whole of it; a task is chosen on tap and goes straight back. Search sits above the list and only takes the keyboard when tapped. Under it: how you work, how long (For a while is a stepper, 5 minutes under an hour and 15 above, no keyboard needed), Show the timer, and Start pinned at the bottom. The computer keeps the card with the picker inside. The picker's search and naming logic is shared (`searchSubjects`, `describeSubject` in SubjectPicker.tsx).
- **Dialogs on a phone.** Short questions stay sheets from the bottom edge. Forms with more than a few fields take the whole screen (`phone="full"`): title and a close button in a bar at the top, the actions pinned at the bottom, sized to what the keyboard leaves (`useVisualViewportFit`). Done for new and edit item, routine, plan and edit plan, template, reward, topic, drill, profile, paste a list, calendar import and add, site blocking, and the admin's account dialog. The end-of-session sheet and the focus prompts stay sheets.
- **The end-of-session sheet sat short of the right edge** on a phone (the owner's fourth screenshot): `.save-sheet` capped its width at the screen less 32px while the phone sheet sits flush left. The same was true of the paste dialog; both caps (and the plan dialog's) now apply only above 560px.
- **The tag menu on a phone** focused its search on opening and closed itself on any scroll or resize, which is what the keyboard coming up causes. On a phone it is a sheet along the bottom over a scrim, above the keyboard, and the keyboard waits for a tap.
- **The bottom bar felt slow** because every navigation is a React transition (React Router wraps them): tapping a tab whose page was still downloading left the old page and the old highlight up until the new one had loaded and rendered, so the tap looked like it hadn't registered. Now the highlight moves on the tap itself (`useNavTarget` in AppShell, which also drives the top bar and sidebar), the nav's pages are downloaded in the background once the app is idle and again the moment a finger touches a tab (`lib/page-loaders.ts`), a page still loading shows a spinner inside the shell after 320ms rather than holding the old one, and pages rise in over 240ms instead of 420ms. The scroll fade under the bars was written to the root element on every scrolled frame, restyling the whole page; it is written on the two bars now.
- **The bar's animation.** The current tab's name slides open (its column goes from 0fr to 1fr) while the other tabs give way in step, the pill fades in, and the icon gives a little under the finger. Nothing waits on the animation. Reduced motion turns it off.
- **Safe areas.** The viewport now has `viewport-fit=cover`, and the page, the top bar, the bottom bar (just clear of the home indicator rather than a whole inset above it), the focus screen, the camera screen and the sheets keep to the safe-area insets, so a phone held sideways keeps everything clear of the notch.
- **The focus screen showed the wrong layout first.** On a phone set to always record, the focus screen appeared, and 1.4 seconds later (a delay meant for the computer's audio question, which phones never ask) turned into the camera. On a phone the decision is now made before the first paint: "always" opens straight onto the camera, "ask" puts the question up at once. The camera's picture fades in once the camera sends its first frame. Also on a phone, opening the focus screen goes there in the same tab (`openFocusTab` answers `'here'`): a second tab on a phone is a second Safari tab, or in the installed app a browser sheet.
- **The camera screen is a grid** (top bar, room, clock, controls, inside the safe area) instead of offsets, so the clock and the controls can't run into each other on a small phone, and the pause button sits dead centre. The eye (hide the clock) moved up beside swap and stop recording.
- **The camera can be made small.** The button left of pause tucks the picture into a small live circle in that same spot, on a plain dark screen; the circle opens it again. Only the picture on screen changes: the camera keeps filming (the stills come from the recorder's own player), and the choice is kept for next time (`komogon.focus.camera`).
- **The screen dims while it records.** Once the focus screen rests (its controls fade after four still seconds), a black layer darkens it by the preset's new `dim` setting (0 to 90%; phones 70%, computers 50%), on the camera screen and the computer's focus screen alike. It is a layer over the page, not the display's brightness, which a web page can't change, and never in the video. The first touch or click on a resting screen only wakes it (`FocusWake`), so a tap on a dark screen can't land on Stop; that guard is there whenever the screen rests, recording or not. A break starting or ending wakes the screen for a moment. When the recording stops, is cancelled or the camera fails, the dim goes with it. The setting is "Dim the screen while recording" in each timelapse preset (Settings and the focus screen's controls), with a small clock beside the slider dimming as it moves.
- **The focus screen's controls** rise as a sheet from the bottom on a phone, over a scrim that closes them, rather than hanging from the gear in the top corner.
- **Smaller fixes.** The focus screen's phase word ("FOCUS · CYCLE 1") sat left of the clock under it: letter spacing trails the last letter too, so its trailing space is taken back. Fields give way in a row (`min-width: 0`), which a 16px field needed: the Tags card's Add button sat past the card's edge. Phones no longer flash grey on every tap or zoom on a quick double tap of a button. After merging the morning's timelapse work: the "Start from a look" previews grew with the screen's pixel density (three times as tall on an iPhone) and ran into the line under them; their row is now the box's height.

## The homepage below the devices, redone, 2026-10-22 (user request)

The owner liked the hero, laptop and phone, but said the rest of `apps/site` looked bad: the
words were right, the layout of text and pictures wasn't, the screenshots were from an older
app, and their own timelapses should be on it. They asked for something like other clean
start-up sites without losing the brand.

- **Words unchanged**, every heading and paragraph as they were.
- **One pattern per section:** the heading on the left and its paragraph on the right (stacked
  on phones), then the pictures on the same 1120 px container. The alternating left-right
  splits and the narrow screenshots are gone.
- **Plain screenshots, cropped tight**, all with the same 24px corner and no shadow or frame
  (the owner rejected photo stages behind sections before). New captures from the current
  app (sidebar, Social, the new profile era), Jerry's seeded sandbox: Analytics' week view;
  the focus screen as a wide band; the feed beside the Leaderboard tab, sized so both are one
  height.
- **The owner's timelapses** (10-18, and both from 10-20) under the focus screen, three across,
  each a whole session in ten seconds. They play only while on screen, and wait on a poster
  with controls under reduced motion. On phones they are a row to swipe. The 10-17 one was
  left out because someone else is in the background for a stretch of it.
- **Closing:** the logo, "Better than last time.", the line and the two buttons straight on
  the page, without the white card.

## Live clip: a moment of the timelapse at real speed, 2026-10-22 (user request)

The owner wanted to be able to be silly in a timelapse now and then and show the camera something: an option that films the camera at full speed and plays that part at 1x. They asked for a 1-2 word name; it's **Live clip**.

- **Where:** while recording, the computer's recording pill in the top bar has a "Live clip" button, and the L key starts and stops one (not while typing or with a dialog up). On a phone it's a pill above the camera screen's controls. While one runs, the pill says "Live clip 0:07 of 0:30" with a "Stop clip" button (red on the phone). It only offers itself while stills are being taken (focus, or breaks when "Record breaks too" is on) with the camera giving pictures; a break, a pause or stopping the recording ends the clip.
- **Limits:** one clip stops on its own after 30 seconds (`LIVE_CLIP_MAX_SECONDS`), and a recording holds 60 seconds of clips in all (`LIVE_CLIP_TOTAL_SECONDS`), because every frame of a clip is kept (about 2 MB a second); after that the button says "Live clips used up" until the stills are thrown away. Settings › Timelapse and the focus screen's controls say it in one line.
- **Recording** (`useTimelapseRecorder`): while a clip runs the paced stills stop, and every frame the camera gives, up to 30 a second (`LIVE_CLIP_FPS`), is kept as a still marked with its clip's number (`Still.clip`) and stamped with the moment it was drawn. Frames are drawn on time and saved alongside one another, up to 45 at once: a JPEG can take about a second to come back in a page the browser thinks nobody is looking at, and waiting for each would have filmed a clip at a frame a second. The paced stills wait until the clip's last frames are saved, so the order holds. Clip frames are never thinned and don't count toward the cap (`thinIfFull(..., isClip)`), so thinning keeps working on the ordinary stills as before. A clip has no screen picture: the camera gets the whole frame for whatever is being shown.
- **The video** (`planTimelapse(..., marks)` in core, tests beside it): the ordinary stills are paced exactly as before, as if the clips weren't there, and each clip goes in where it was filmed with one frame for every 1/fps of it, using the still taken by that moment, so it plays at real speed at any frame rate and adds its own length. A set length is the length of the timelapse part; a speed counts the focus the ordinary stills stand for; when speed would lower the frame rate (few stills), the asked rate is kept so the clip doesn't stutter. A blended frame never reaches across a clip. Clip frames get no smoothing; the deflicker is worked out over the ordinary stills, and a clip takes the light of the still before it. The progress bar holds through a clip; the elapsed clock ticks in real time. The phone's trim spreads its pictures and its bar by time, so a clip's many frames don't take over the strip.
- The "Your timelapse" card says "24 stills and a live clip (5 s) from 1 min of focus".
- Checked in the sandbox with a fake camera (a canvas stream whose colour moves with a frame counter): the L key and the buttons, the 30-second stop, the 60-second total, the phone's camera screen at phone size, and a made video whose clip advanced at the fake camera's own rate (about 80 degrees of colour a second, as live) while the stills around it ran at timelapse speed. A real camera, a real phone and Safari weren't tried.

## The timelapse: your own text on the video, no end card, and the other sites without a preview, 2026-10-22 (user request)

The owner saw the first version (section above) and changed three things.

- **Your text stays on the video, the end card is gone.** "Words at the end" was a misreading: the owner wanted "a persistent text on screen like 'studying for stupid 222 am i cooked' ... kind of like the timer and local time", and asked twice for the end card to go.
  - A seventh layout piece, `note` ("Your text" in the editor), is a text pill like the clocks: placed, resized, lined up and taken out the same way, drawn on every frame by `composeFrame` once there is text, and left out when empty. Each preset keeps the words in `noteText` (`TIMELAPSE_NOTE_MAX` 100, one line, `cleanNoteText`).
  - Where it starts: under the time of day in every shape. Each look places it too (Big timer top left, Headline under the time studied, Corner at the top of its stack, Clean bottom left, so Clean is now "the camera, the mark and your text").
  - The field, "Text on the video" (`NoteField.tsx`), sits under the layout editor in Settings › Timelapse, on the focus screen's controls, on the "Your timelapse" card and in "Change layout?". Until there is text, the editor's preview shows "Your text" so the piece can still be placed.
  - Everything of the end card went: `endText`, `drawEndCard`, the extra frames and the extra seconds in "It comes out N s". Words saved as `endText` during the day it existed carry over as the text on the video (`noteTextOf`), and the API still takes `endText` from an older open portal rather than refusing the save. Layouts saved before `note` existed get its default place from `normalizeTimelapseLayout`.
- **Instagram, TikTok and X go straight there.** "Don't make a preview, just immediately go to Instagram stories or posts, same with TikTok and X; the user can edit their posts natively there." The buttons are back to handing the video over at once (share sheet on a phone, download plus the site in a new tab elsewhere). The caption box, the copying to the clipboard and X's `?text=` went with the preview (`postCaption`, `withCaption`, `captionMax` removed). The WebM and X-length notes stay under the buttons.
- **Typing in the Social preview was slow.** The box now updates on its own: the post beside it reads a deferred copy of the text (`useDeferredValue`) in a memoised card, so a keystroke re-renders only the box; the preview video no longer loops in the background (it waits for a press, like posts on the feed); and the card is `contain: layout paint` so a new line only lays out the card. Measured in the sandbox with real keystrokes: 69 characters, no input event over 16 ms and no long tasks. The pane can't measure painting, so the owner should confirm it feels smooth.

## The visualizer's defaults are the owner's own look (owner request, 2026-10-22)

- The owner asked for the visualizer settings on their account to become the defaults, except for the way audio gets picked up. Read from their screenshots: opacity 0.5 (was 0.85), colour Custom #ffd1e3 (was Accent), Waves off (was on). Cloud mist, the beat drop circle and "Calm when silent" were already at the defaults.
- **Listening keeps its defaults** (Bass heavy and the custom sliders under it), as asked; the owner uses Balanced. "Enable audio visualizer" and "Never ask again" stay off too: they are on/off choices, not the look.
- Accounts that finished onboarding before this keep the full set of settings stored then, so this reaches new accounts, and "Reset the visualizer to its defaults" (which reads `DEFAULT_SETTINGS`).

## Posts say the course with the task: "RSM222 · Assignment", 2026-10-22 (owner request)

The owner saw "1 h on Slides Review" on a post and asked for the course too: "RSM222 · Assignment". "Ignore middle children, just parent and child task that was done directly, so only 2 things at most at all times."

- The label is the task's root course, a dot, and the task the session was on, never the units between; a task with no parent (or a course itself) is just its title; a routine is its title as before. It is the line the focus screen and the timelapse already show, now one helper in core, `focusLabel(focusContext(...))`.
- The API still snapshots it into `posts.subject` when the post is made (`taskLabel` in `routes/social.ts`), so renaming or deleting the task later doesn't change a post. The Social preview before sharing a timelapse shows the same label, and the "I'm a dev" Jerry world's posts are seeded with it.
- Posts made before: migration `0026_post_course_subject` puts the root course in front of the task title they were shared with (a recursive walk up `nodes`; posts on a routine, without the time, or whose task has no parent are left alone). Checked on the seeded sandbox, with a unit between too.

## Glass that frosts on every page, and the glass settings, 2026-10-22 (user request)

- **The black patches.** The owner saw hard-edged dark and unblurred rectangles in the glass cards, in Vivaldi: next to a playing video on Social, after clicking a nudge, after moving the pointer over the sidebar. Tested on their screen with a page of glass cards over black and white stripes: the page fade (`.route-in`) ran with `fill-mode: both`, so the finished animation still held `opacity: 1` on the page, and Chrome kept treating the page as the backdrop of every glass card in it. The cards showed the photo unblurred for good, and only the bits that repainted (a hover, a click, a video) came back frosted, darker and with hard edges. The same fade with `backwards`, or no animation, frosted on that screen. Browser-tool screenshots repaint the whole page, so they never showed it; only a screenshot of the real screen does.
- **Fixed:** `.route-in`, `.summary-reveal`, `.rc-rise` and `.rc-bento > *`, and `.rail-expanded` use `backwards`, so their fades look the same but let go when they end. A fade on the card itself (`.eq-card`, `.badge-card.is-revealing`, `.achievement`) is fine either way.
- **Achievements:** the badge fold no longer masks the whole grid. The second row of badges carries the fade on each badge (`data-fold-edge`, set by BadgeFold; `--fold` runs from 1 folded to 0 open, so the fade slides off as the fold grows), and every badge frosts.
- **Then, the same day: entrances rise without fading.** With the fix live, the owner saw "the blur takes half a second to set in after clicking a new page": while the page faded in, its cards showed the photo unblurred, and the frost snapped in at the end. The page (`route-in`), the Analytics sections and tiles (`rc-rise`, which the equivalents cards share) and "See all" grids and revealed badges (`badge-reveal`) now only rise, with no opacity, so the glass is frosted from the first frame (a transform on an ancestor doesn't turn the blur off; checked in Vivaldi on the test page). Cards that fade themselves in (the quote, hints) keep their fade.
- **Still unblurred while it lasts:** cards while Analytics reloads (`.rc-page.is-stale` dims the page).
- **Frosted, at the owner's pick.** Asked clear or frosted, the owner chose frosted with "the colour of the panel to have more weight", then tuned it on a test page with sliders: today's colour (rgb 22 24 36) at 51%, blur 11px, colour boost 100%. So the glass is now 11px blur (17px for strong glass) with no colour boost (was 28px, 44px and 180%), and the fill stays the theme's (50% in dark).
- **Settings › Appearance › Advanced › Glass** (the owner asked for the test page's sliders there): Colour, Weight (30-95%), Blur (0-40px), Colourful (100-200%), and "Back to the default glass". They are `settings.theme.glassColor` and `glassAlpha` (null keeps the theme's own, so light and dark keep their defaults; a weight is kept as set, even where a photo would have made the theme's glass thicker), `glassBlur` and `glassSaturate`.
  - Blur and colour boost go on the glass tokens for every glass surface (`applyGlassFrost` in theme.ts, from `applyUserTheme`).
  - Colour and weight go through the Backdrop (`chooseGlass` in contrast.ts, `applyChosenGlass`), which knows the photo behind. A chosen colour tints the top bar and sidebar too, because all glass shares one text colour: when a colour wants the other text (light glass in dark mode, say), the text on all glass turns round together, and on a gradient the page's own text is pinned to the theme's.
  - Dragging shows on the page at once; letting go saves. Saved looks keep the glass; looks saved before it keep whatever glass is set. The group hides in Matte, which has no glass.
  - Accounts keep any settings already stored, so everyone without their own glass gets 11px and 100%.

## The task colour setting is gone, 2026-10-22 (owner request)

"Remove the task colour setting, no idea what that is or does." It was a colour picker in the task dialog ("Optional, inherited by children") that only tinted the task's blocks on the calendar and put a dot beside it on Tasks, and the same colour as a default in "Template for items under…".

- Both pickers are removed. The task dialog no longer sends a colour, so saving a task leaves whatever it had; a template saved from now on drops its old colour default, and new items don't take one any more.
- Nothing is deleted: tasks coloured before keep their colour on the calendar and their dot on Tasks (`effectiveColor`, the `nodes.color` column and the API field all stay). Everything else on the calendar uses the accent, as uncoloured tasks always did.

## The timelapse: the text is written after the session, and the computer trims like the phone, 2026-10-22 (owner request)

Two changes from the owner: of "Text on the video", "this should be after the session for the timelapse", and "make the trim feature more like the phone trim feature".

- **Text on the video, after the session.** Asked where it should stay and whether to keep it for next time, the owner chose the "Your timelapse" card once the recording has stopped plus "Change layout?", and text that belongs to that one video.
  - The field is gone from Settings › Timelapse (it sat under the layout editor) and from the focus screen's controls, and the card leaves it out while it is still recording. The layout editor in Settings still has the text piece, shown as "Your text", so it can still be placed; its hint now says the text shows "once you write some, after a session".
  - The words are the card's own (`TimelapseExport` state, not the preset): they go on the video it makes, show in the trim's viewer as they are typed, and are cleared with the stills ("Throw the stills away"). Nothing is saved, so the next video starts empty. "Change layout?" opens with the video's text, saves only the layout, and the remake carries the text back to the card.
  - `noteText` stays on both presets, in the API and in the defaults, unused, so a portal still open from before can save without being refused. Text saved there before today is not put on new videos.
  - The card on the focus screen's controls and the one on the end-of-session screen are separate cards: text typed in the first before the session ends doesn't carry to the second, as the trim and a made video don't.
- **The computer trims like the phone.** `PhoneTrim` is now `TimelapseTrim` (`TimelapseTrim.tsx`, CSS `.tl-trim-*`), used on both; the computer's Start and End sliders and their two stills are gone. Both have the viewer drawn with `composeFrame`, the strip with a handle at each end, the playhead and play. As before, the trim is held in session seconds, an end never moved follows the recording as it grows, "Keep it all" undoes it, and the strip and the progress bar spread a live clip by time.
  - Sized for a computer (`wide`): the strip fits as many stills as it holds at the camera's shape, between 5 and 14 (5 across the end-of-session card's 430 px strip and in the focus screen's controls), where a phone keeps its nine; the viewer draws at 960 px on its long side rather than 640, and it draws the recorded screen in its box too, so it matches the video.
  - The card on the focus screen's controls shows the trim while recording, which the phone never did: the viewer keeps its decoded stills by still rather than by place (thinning moves every still along), playing carries on as the recording grows instead of starting over with each new still, and the strip only loads the stills that are new to it.
  - For a mouse: a hover and a focus ring on the play button, and a pointer over the strip. The handles also move with the arrow keys, as on the phone.
- Checked in a sandbox with a fake camera: a 3 min recording with a 16 s live clip on a computer-sized window (trim, play, Keep it all, the text on the viewer and the made video, "Change layout?" with a new text and the remake, no settings saved), the card in the focus screen's controls while recording, and the phone's trim at the mobile preset.

## A phone held sideways keeps the phone's nav, 2026-10-22 (owner report)

"Fix the phone layout when horizontal, I can't see the full sidebar", and "the cards are all right leaning instead of centered when horizontal". Sideways, a phone is wider than 768px, so the app took it for a computer: it showed the sidebar, whose rows ran off the bottom of a 390px-tall screen, and moved the page right to clear the open sidebar (236px on the left, nothing on the right).

- **A phone is a phone either way up.** `PHONE_QUERY` in `lib/media.ts` (phone-width, or a touch screen under 600px tall) decides the nav: on a phone AppShell leaves the sidebar out whatever Settings says, and shows the top bar and the bottom bar. index.css uses the same query for the phone's top bar, so it keeps clear of the notch sideways.
- Held sideways, the bottom bar is the computer's centred pill (up to 560px), not the full width.
- Upright phones and computers are unchanged; tablets (taller than 600px sideways) still count as computers.

## The phone bar: five places with Start in the middle, 2026-10-22 (owner's choice)

"On the phone there's too much on nav", "4-5 icons maximum". Of three ideas (this one, keeping five pages and folding the rest in, or picking your own five), the owner chose the one modelled on Strava. It replaces the 2026-10-21 phone bar that showed every page as an icon.

- **Home, Tasks, Start, Social, You** (`phoneTabs` in AppShell). Start is a round accent button in the middle, like a running app's Record: it opens the start screen, or goes back to a running session. Two tabs sit each side in equal halves, so Start never moves when the open tab widens to show its name.
- **The other pages live inside Tasks and You** (`PHONE_TASKS`, `PHONE_YOU`), switched by a row of pills at the top of the page (`PhoneSwitcher`, the Social tabs' look): Tasks, Calendar, Routines, Plans; and Profile, Stats, Grades, Settings. A page turned off in Settings › Pages drops out of its row. Someone else's profile belongs to Social.
- **Settings is a pill, not a gear**: your profile card already has its own gear (profile settings), and two gears side by side read as the same thing.
- **Achievements has no pill**, as it has no tab anywhere: the Level pill in the top bar opens it, and the You tab stays lit there.
- **The top bar on a phone** keeps the logo, streak and level (and Admin, feedback and a dev account's Sign out); Settings and the profile picture moved into You.
- Routines were already a card on Home; the page itself is under Tasks.
- Computers are unchanged: the sidebar or top bar still lists every page, and a crowded top bar still turns into the all-pages icon bar.
- Still no "More" menu: every page is two taps away at most, inside the place it belongs to.

## The timelapse comes out compressed, with a resolution slider, 2026-10-22 (owner request)

"Auto compress video after processing then also add option to reduce resolution of video", then: "use percentages to reduce resolution", "a slider but just have the minimum be something reasonable and stop at that depending on their camera", "have a minimum height and length ... dont have anything unreasonable", and "make these rules hidden ... just stop the slider at a minimum and say they reached the minimum compression".

- **Every video is compressed.** It used to be encoded at 8 Mbps, about 1 MB for each second (a 30 s video near 30 MB). It is now encoded at the bitrate its size needs, `timelapseBitrate` in core: 2.5 Mbps at 1280 × 720 and 30 fps, less for a smaller picture (not in step with its pixels, since a small picture needs more bits for each one), a little more at a higher frame rate, never under 300 kbps. Measured in the sandbox: 2.9 Mbps at full size (a third of before), 1.0 Mbps at 640 × 360.
  - It is done in the one encode rather than a second pass after the video is made: the same smaller file without encoding twice, so it is quicker and loses nothing to a second round of compression. The MediaRecorder fallback records at the same rate.
  - The size note in Settings and on the focus screen ("The video ends up around ...") follows: about 13 MB for an auto-length video, from 40.
  - Under the made video, its size in pixels and its weight: "1280 × 720 · 9 MB".
  - The Social preview's "Compress and post" stays for a video that is still over the limit.
- **Resolution, in percent.** A Resolution slider under frames per second, on the "Your timelapse" card and in both presets in Settings › Timelapse, saved on the preset like the length and frame rate (`resolution`, 1-100, 100 by default; the API takes whole percents). Beside it, the percent and the size it makes: "75% · 960 × 540". 100% is today's 1280 px on the long side.
- **The floor, never explained.** The slider stops at the smallest the video may be and says only "That's as small as it goes." The rules, in `minTimelapseResolution`, stay out of the app's words, as asked:
  - Both sides keep a minimum for the video's shape: 360 px on the short side and 640 on the long. For 16:9 and 9:16 that is 50% (640 × 360, 360 × 640); a very wide screen shape may stop higher.
  - When this browser remembers the camera's size (now kept beside its shape, `komogon.timelapse.cameraWidth` / `cameraHeight`, whenever the camera starts) and the camera records smaller than the minimum, the floor drops to the camera's own size, never below it: a 320 × 180 camera can go to 25%. A camera that hasn't been seen leaves the plain minimum.
  - The render clamps the same way, so a percentage saved on another device or for another shape can't make anything smaller.
- Checked in the sandbox with a fake 1280 × 720 camera: the card's slider (100% to 50%, the line at the stop, saved), videos made at 100% (1280 × 720, 1.0 MB for 2.8 s) and 50% (640 × 360, 373 KB), a remembered 320 × 180 camera moving the stop to 25% (320 × 180, 134 KB), and both presets in Settings.

## Upload limits: 250 MB a day each, and nothing past 10 GB in the bucket, 2026-10-22 (owner request)

"to prevent someone from inflating my r2 server put a limit of 250mb of uploads per day", "per account", then "add rule to stop all uploads when my r2 bucket has 10 gb of media".

- **Counted when the upload link is handed out** (`POST /api/social/uploads`), not when the post is made. A link is signed for one exact size, so that is the most it can put in the bucket, and a file uploaded but never posted still sits in `uploads/` for a day. Each link is a row in `media_uploads` (migration 0027_upload_quota), kept two days. The logic is `services/upload-quota.ts`.
- **250 MB a day per account**, over any 24 hours rather than from midnight (no double allowance either side of midnight, and no time zone to pick). A link that would go past it is a 429 with Retry-After: "You can upload 250 MB a day. This one fits again in about 5 hours.", the time being when enough of the oldest uploads turn a day old. That is six 40 MB videos, or about twenty compressed timelapses. A failed upload that is tried again counts each time.
- **10 GB in the bucket stops every upload**, for everyone (R2's free storage; 10 × 1024³ bytes, the same 1024s as the app's MB). Posts without a file still go. The message (503): "Videos and pictures are paused for now. You can still post without one."
  - The bucket is measured from R2 itself (ListObjectsV2, every file's size added up), so files the database has lost track of count too. A measurement is trusted for ten minutes, plus every link handed out since, so nothing slips through between measurements and deleted files free room within ten minutes. Listing costs a request per thousand files, at most every ten minutes and only when someone asks for an upload link.
  - If R2 won't list (the token can't, or R2 is down), the API counts from Postgres instead: every posted file plus every link of the last two days. It logs a warning. `scripts/r2-check.mjs` gained a "measure the whole bucket" step to check the token can list.
- **Found on the way: expired dev accounts left their files in R2 for good.** `sweepDevAccounts` deleted them without the store, so their rows went and their videos stayed with nothing pointing at them. It now gets the store, like every other way an account is deleted.
- Both limits reach people through the toast the composer and "Share to Social" already show for API errors; no portal change.
- Unchanged: 30 links an hour, the 40 MB and 2 MB file limits, and posting without R2 (files in Postgres, 5 MB).

## Our own "Continue with Google" button, 2026-10-22 (owner's request)

"When it goes continue with zachary or whatever it looks ugly, just make your own button", with a screenshot of a light grey pill as the look. Google's ready-made button (Identity Services) can't be restyled, turns into "Continue as <name>" with a picture once Google knows you, and on our dark page sat in a white box.

- **The button is ours** (`GoogleSignInButton`, `.google-button` in index.css): the size and pill of the other buttons, the reference's light grey and Google's "G", with a dark label. That label is the one exception to white labels on buttons, because it is the owner's reference and white wouldn't read on light grey.
- **It opens Google's account popup** (the token flow, `google.accounts.oauth2.initTokenClient`, scope `openid email`), the way Google supports custom buttons. No new keys: the same `GOOGLE_SIGNIN_CLIENT_ID` and its allowed origins. People pick an account and, the first time, agree to share their email.
- **The API checks the access token with Google** (`createGoogleAccessTokenVerifier`): Google's tokeninfo must say it was issued to our client id, or a token another site got for the same person could sign in here. Then the same rules as before (confirmed email, invites, blocked addresses, joining the account with that email).
- `POST /api/auth/google` still takes the old ID token (`credential`), so a sign-in page left open from before the deploy keeps working.
- Closing the popup says nothing; a blocked popup asks to allow pop-ups.
- Checked in a sandbox: the look in both themes and on a phone, the click opening Google's popup, and the API refusing a junk token through Google's real tokeninfo. A real sign-in needs the real client id, so it is tried on komogon.app.

## One download, and the apps on a phone, 2026-10-22 (user request)

The owner asked that the Instagram, TikTok and X buttons never download the video more than once, counting "Save the video" and anything else that downloads it, and that on a phone the buttons go to the apps rather than the websites, through Apple's share sheet.

- **One download a video** (`downloadOnce` in `TimelapseExport`). Whichever of Save the video, Instagram, TikTok and X downloads first, the video downloads that once. After it, Instagram, TikTok and X still open their site (or app) and the toast says "The video is already in your downloads"; Save the video only says "It's already in your downloads." There is no "download again", since the owner said never. The line under the buttons follows it ("The video is in your downloads, and the site opens in a new tab."). A remade video (trim, length, "Change layout?") is a new file and downloads once again. Closing the focus screen's controls sheet drops the made video, as it did before, so that starts over too.
- **The share sheet hands the video over; it isn't a download.** On a phone or tablet each button opens the share sheet with the video (on an iPhone or iPad, Apple's; Instagram, TikTok and X sit in it when installed), every time it is pressed, since the sheet is the only way a page can give a file to an app. A quick second tap while a sheet is still open does nothing (the browser answers `InvalidStateError`) instead of falling back to a download.
- **Tablets count now** (`mobileOs()` in `lib/device.ts`: Android, iPhone, iPad, including an iPad that asks for the computer site). Before, only a phone (`isPhone`) got the share sheet, and an iPad downloaded the video and opened the website. The timelapse preset still goes by `isPhone`, so an iPad keeps the computer's layout.
- **A phone or tablet without the share sheet opens the app, not the site** (`appLink` in `post-elsewhere.ts`). The video downloads (once), then:
  - iPhone and iPad: the app's URL scheme. `instagram://app` is Meta's documented hook; `snssdk1233://` is TikTok's, from its SDK docs, where it is only used to check the app is installed; `twitter://post` opens X's composer and is undocumented but still answered. Without the app, Safari says the address is invalid.
  - Android: Chrome's intent link, pinned to the app's package over the site's address (`intent://www.instagram.com/#Intent;scheme=https;package=com.instagram.android;end`; TikTok `com.zhiliaoapp.musically`, X `com.twitter.android`). Without the app, Chrome opens its Play Store page, which is still the app.
  - The link is followed a moment after the click, once the save has rendered, so the focus screen's "leave this page?" (held while stills are unsaved) is already gone.
  - This path is rare: Safari, Chrome on Android and Samsung Internet share files; Firefox on Android and some in-app browsers don't. On an iPhone it is weaker anyway, since a download lands in Files, which the apps' pickers don't show.
  - The toast gives the app's next step (`appNextStep`): "On Instagram, press + and choose it.", "On TikTok, press + and choose it under Upload.", "Add it to your post on X."
- Checked in the sandbox with a fake camera and a made video: on the computer layout, Instagram, TikTok, X and Save the video in a row made one download and opened the three sites; as an iPhone with a stubbed share sheet, each button shared the MP4 and nothing downloaded; as Android without one, X downloaded once and followed the app link, and TikTok after it didn't download again. A real iPhone's share sheet and the real app links weren't tried; the owner has to try those on a phone.

## Timelapse settings: the notes fold away, 2026-10-22 (owner request)

With a screenshot of the focus screen's Timelapse controls: "theres this massive thing of text, make it collapsable and make it collapsable on default", "if you need to explain things make it very short do not explain things the user does not need to know".

- **A "Tips" fold, closed every time it opens** (`TimelapseTips` in Timelapse.tsx, `.tl-tips-*` in index.css), under the dim slider, in the focus screen's controls and in each preset in Settings › Timelapse. Inside: "Tap the screen to brighten it.", "Live clip (L) films at normal speed, up to 30 s." (no "(L)" on a phone) and, on the focus screen, an "Edit the layout" link (new tab, as before).
- **Cut:** "you are asked whether to record your screen too" (the question asks for itself), the long list of what the layout editor can do, the look's description under the looks on the focus screen (the pictures show it; Settings' editor keeps it), "if there are enough stills" under Set length, the phone's "Breaks always show on the camera screen..." and the two break-clock hints.
- **Shortened:** Auto length is "About 20 to 40 seconds."

## The homepage body, rebuilt around the scroll, 2026-10-22 (owner request)

The owner kept the hero (photo, copy, laptop and phone) and asked for a body that moves with the scroll, after three references: a drum of cards that turns as you scroll (to show how much of the app can be changed), screenshots set like Daybridge and aside.com (a feature list beside a window of the app, a ruled page), and "make people download it". Everything the page already said stays word for word.

- **The devices show at once.** They used to wait 1.3 s (or the first scroll); now they rise with the headline.
- **Ruled page.** Hairlines down the sides of the content and across between sections, like aside.com; pictures sit in pastel fields taken from the Cotton Candy photo's colours.
- **Track** pins: the heading and paragraph on the left with a three-line list (new short lines: "Your week at a glance", "Where the time went", "Plan the week"); a window of the app on the right runs off the screen's edge and swaps Analytics, its charts and the calendar as the list advances. Phones get the list with a screenshot under each line.
- **Make it yours** (new heading and one line under it) pins: sixteen screens in other photos, colours and themes on a drum, small across the middle and large at the sides; they fan out, then slide; the heading's word scrambles through calm, bright, cozy, yours.
- **Focus** pins: the focus screen grows from a card to the whole window while the page goes dark, then runs a Pomodoro: start a session, focus, short break, the controls with the timelapse. The phone's focus screen slides in on the way. The three timelapses follow.
- **Share** is a ruled bento: the feed (a long shot that scrolls inside its field), the leaderboard, and a study group, each with a one-line label.
- **All screenshots retaken** from a fresh sandbox on main (sidebar, the phone bar, timelapse posts in the feed). The capture and convert scripts now live in `apps/site/scripts` and can retake any single shot.
- Reduced motion, or no script: nothing pins, and every scene lays out flat.

**Round two, the same night** (owner's notes: loose, "make my unintelligible words amazing"):

- **Track** is shorter (one Analytics screen, then the Social feed and the leaderboard) and
  pins for less. The drum and the focus screen pin for less too, so Social comes sooner.
- **No pastel fields** ("I don't super like the pink borders"): screenshots sit straight on
  the page.
- **A black interlude** between Track and the drum, after a reference of cards floating
  round centred words on black: seven timelapses float down, clocks behind them run with the
  scroll, the app's Recording pill sits over "Hours of work, in seconds."
- **More timelapses**, from four YouTube videos the owner picked (two study-with-me, a Word
  and an Excel recording): cut, sped up, and drawn with the portal's own composeFrame so they
  look like Komodon's. They aren't the owner's footage; their rights need checking before
  this goes live.
- **The social talk**: posts are in the owner's own words ("can i cram rsm222 in 1 day
  😭😭😭", "daily studyy✨", "technical interview comin up wish me luckk 😛😛", "Will he
  perform when he has money right in front of him?"), and the owner's timelapses are posted
  by a friend called Zachary.
- **The phone shot** is the camera screen, as a phone really records, with the owner's desk
  photo as the camera.
- The drum lost two looks the owner called ugly (a light lilac focus screen and the Opal
  one) for a Milky Way focus screen and custom panels, and its line now reads "80+
  backgrounds and fully customizable panels."

**Round three:** the clocks are gone ("look like shit") and the interlude is no longer pure
black: Cotton Candy under a dusk wash. The owner found the motion "a tad stiff", so the
timelapses no longer ride the scroll one to one: each drifts toward its place a beat behind
and sways and tilts on its own. The calendar got a pinned section after Share ("Plan the
week."): the week with Jerry's classes, Plan my week's suggestions, the week planned, and
the phone's day view. Priya posts "daily studyy✨"; Zachary's timelapse post says "Will he
perform when he has money right in front of him?"

Then: the interlude's straight fade read as a "harsh and linear line", so the way in and out
became three blurred, drifting waves (ink, plum, a rose bloom). The drum turns on its own
instead of only with the scroll, which now just gives it a push.

The Track window no longer fades between screens: they sit on a cylinder that turns like a
revolver's, each rolling up into the frame and settling. "Get the extension" is greyed out
with an "In development!" tag (owner's words). The focus scene's last step was the controls
sheet, a wall of settings; it is now the focus screen recording a timelapse instead.

**Docs page (owner request):** `/docs/` on the site, "very organized so the user would know
exactly where to go": a search across every topic and question, a sidebar grouped Start / Plan
your work / Study / Progress / With friends / Make it yours / More / Help, each topic with a
"Where" path through the app, and a FAQ. Written from a read of the code (labels, defaults and
limits as they are), linked as "Docs" in the homepage nav and footer.

The closing heading is now "The study app." (owner's words), with a hand-drawn underline
under "The" that draws itself in.

## Focus time and time elapsed, start and end times, 2026-10-22 (user request)

The owner asked for an option on Social posts to show the total time elapsed ("the time including breaks not including pauses"), a small start and end time on each post, the same as text pieces on the timelapse, and for the app to say plainly which times are focus and which are elapsed, with basic labels and no explanations ("do not explain this rule or concept just use basic labels", meant for every feature from now on).

- **Words.** Focus is work time only. Elapsed is focus and breaks together; pauses never count. Every time shown is labelled one or the other, and nothing on screen explains the difference.
- **Posts.** Each post shows the session's start and end, small at the right of its session row ("4:29 – 5:29 PM"; on a phone it wraps under). The focus figure says "focus". The time elapsed is an option per post: an "Elapsed" chip in the composer once a session is picked, and a "Time elapsed" switch in the timelapse's Share to Social preview (whose "Show how long I studied" switch is now "Show time", without the line under it). Off by default. New columns `posts.elapsed_minutes`, `started_at`, `ended_at` (migration **0028_post_times**, which also gives every older post that showed its time the start and end of its session). Hiding the time hides the start and end too. The dev world's posts get their times.
- **The timelapse.** Three new text pieces, waiting as chips under the editor: Time elapsed ("Elapsed 51:02"), Start time and End time ("Start 9:10 AM", the session's; until it ends, the end is the last still). The old "Time elapsed" piece was the focus clock all along, so it is now called Focus time and draws "Focus 42:17" (still "Break 3:10" on a break; with the break clock set to keep counting it says "Elapsed"). The looks leave the three new pieces where they are. The API's layout schema takes them, so Render must run this code before a layout with them saves on komogon.app.
- **Elsewhere.** "Studied" times became "focus" (dashboard and profile "Focus, all time", tasks, deadlines, the calendar header, the tracker, admin), the analytics session table's "Work" column is "Focus", and the end-of-session screens and the timer card add "Elapsed" beside the breaks when there were any. "Days studied" stays (it counts days, not time).
- Checked in a sandbox: posts with and without the elapsed time at computer and phone widths, the composer chip, and the three pieces added, drawn and saved in Settings › Timelapse. A real video with them wasn't made (no camera in the preview); the same text code draws the editor and the video.

## A changelog, and docs that aren't a blueprint, 2026-10-22 (owner request)

- **Changelog** at `/changelog/` on the site: one entry per day since the first commit on
  2026-09-20, newest first, written from the commits in plain words for people using the app.
  It only ever calls the app Komodon (no older names). It changes only when the owner asks
  (CLAUDE.md says so).
- **The docs no longer spell out how things work inside**: no XP formula, level thresholds,
  shop prices, pace thresholds, Plan my week's rules or drill schedule. They say what each
  thing does and where it is, "so no one can just copy and paste the contents" and rebuild it.
- **Kept from AI chat assistants and from wholesale copying** (docs and changelog): the text is
  sealed at build time and put together in the browser, robots.txt asks AI crawlers and
  assistants to keep out, the pages and headers say noai, select-all is off, and a copy takes
  400 characters at most. All of this deters rather than prevents: a person can still read and
  retype it, and the seal's key ships with the page. Vercel's firewall can also block AI bots
  outright (a project setting the owner would turn on).
- **The changelog shows the last three days only** (owner, same day): older days stay in the
  file and in the sidebar back to September 20, greyed, and clicking them does nothing. Counted
  from the reader's today, so days drop off on their own; the newest day always shows.

## The bell on Social, and the kudos button without its word, 2026-10-22 (user request)

The owner asked for the "Kudos" text on posts to go, and for notifications on Social: a bell next to the trophy that opens to who gave kudos on which posts, who commented and who nudged, "like BeReal's notifications tab", so it feels familiar.

- **Kudos button:** the thumbs-up and the count only; the word is gone (its label for screen readers stays).
- **Where the bell is:** a third figure on your card beside the feed, after the streak and the level: the bell, how many are new, "new". A dot on the bell while anything is new. Under 880px of page width that card sits under the posts (it always has), so on a phone the bell is far down the feed; not moved, since the owner asked for it beside the trophy.
- **The list** (`components/social/Notifications.tsx`): a dialog on a computer, a whole screen on a phone (`Modal phone="full"`). BeReal's layout: Today, Yesterday, This week, Earlier; each row the person's picture with a small badge for what happened, "**Name** gave you kudos" / "commented: …" / "nudged you", then which post (what it was on, else its words) and when, a dot while new, and the post's picture on the right (its poster, or its focus minutes, labelled "focus", when it has none). A row opens your profile at that post (`/profile#post-<id>`, scrolled to and outlined for a moment; a comment opens its comments too); a nudge opens the person's profile. The list is rendered on the page's body, because inside the figures' row it took on their bold, centred text.
- **What's in it:** kudos and comments on your posts and nudges to you, from the last 30 days, the newest 60 (`GET /api/social/notifications`, `routes/notifications.ts`). It reads the rows Social already keeps; your own kudos and comments on your own posts aren't in it, nor anything from a suspended account. Kudos taken back go away with their row. Friend requests aren't in it (not asked; they have the friends card).
- **New:** anything after `users.notifications_seen_at` (migration **0029_notifications_seen**). Opening the bell sets it (`POST /api/social/notifications/seen`); the count goes to 0 at once and the dots stay until the list next loads. It is separate from a nudge's "Got it" on the dashboard. The list refreshes every minute while the page is open.
- Copy kept to plain labels (the owner's rule from the same evening: don't explain, simple and incomplete is fine): an empty list says "Nothing yet."
- Tests: `notifications.test.ts`. Checked in a sandbox as Jerry: the bell's count, the list on a computer and a phone, a new comment arriving as 1 new, opening clearing it, and a comment row opening the post with its comments.

## Posts: friends only, one post a recent session, and a carousel of a video and three pictures, 2026-10-22 (user request)

The owner asked for three things in one message: an option to post to friends only; a rule, not to be explained anywhere, that only a session less than a week old with no post yet can be posted; and up to one video and three pictures on a post, shown "like Instagram", as a carousel.

- **Friends only** (`posts.friends_only`, migration **0030_post_files**): a "Friends only" chip in the composer once a session is picked (beside "Elapsed"), and a "Friends only" switch in the timelapse's Share to Social preview, whose line explaining who sees the post is gone (the preview's audience chip says Everyone or Friends). Such a post shows only to the author and their friends: the feed, profiles and the file routes all check it. Settings › Social's "friends only" for every post still applies on top; with it on, the chip shows pressed and can't be turned off, and the preview has no switch. A friends-only post says "· Friends" after its time.
- **Which sessions can be posted:** one that ended within the last 7 days and has no post yet (`POST_SESSION_MAX_AGE_MS`). The composer's "Which session?" lists only those (`GET /api/social/postable`); the API refuses the rest ("Too old to post", 409 "Already posted"). Deleting a post frees its session. Nothing on screen explains the rule (owner's words).
- **Files:** a post carries up to 4: one video and three pictures, in the order they were picked. `post_media` has a `position` and its key is now (post, position); posts made before keep their one file at position 0. The API takes `files: [{ media | upload }]` (the old single `media`/`upload` still works), checks each like before, copies each R2 upload, deletes them all with the post, and answers `files` (each with `n`, and the poster on the video) beside the old `media` (the first file), so a portal from before still shows something. `GET /api/posts/:id/media(?n=)` and `/media/url?n=` pick a file. With no R2 the post can carry up to 24 MB (its own body limit).
- **The composer:** "Add photos or a video" picks several at once (then "Add more"); each shows as a chip with a remove button; past one video or three pictures it says "1 video and 3 photos at most." A file too big still gets the compress offer (one at a time). Uploading counts across all the files.
- **The carousel** (`Carousel` in PostCard.tsx): one frame at the first file's shape, kept between 4:5 and 16:9 (Instagram's range is 4:5 to 1.91:1), swiped on a touch screen (scroll snapping), arrows on hover on a computer, "2/4" in the corner and dots under it. Pictures fill the frame; the video sits in it on black, and pauses when swiped away. One file shows as before.
- Tests: `post-files.test.ts` (the session rule, the carousel, friends only), an R2 case in `social-media.test.ts`; older tests now post a session each. Checked in a sandbox: a picture, the video and two pictures in one post at computer and phone widths (arrows, swipe, the video pausing), a friends-only post, and the composer listing only the sessions still free.

## Preset themes, and solid colours that look finished, 2026-10-22 (owner request)

The owner asked for preset themes: the current default named **Dawn Skies**, minimalist
themes in **off white, Discord blue and Claude grey**, things that make solid-colour themes
look better, a tag on each theme (minimalist, nature, cities and so on), and all of it in
Settings › Appearance.

- **Themes** (`packages/core/src/theme-presets.ts`, `components/ThemePicker.tsx`) sit at the
  top of Appearance. A theme sets light or dark, accent, background,
  panels, glass and texture in one click; the one in use is ticked (`matchingThemePreset`,
  which ignores what doesn't show: glass on matte panels, a texture on a photo). Tags:
  Minimalist, Nature, Cities, Night, Abstract, as a filter and in each card's foot. Under
  All, two rows show until "Show all themes", like the background picker.
- **Dawn Skies is the default exactly** (built from `DEFAULT_SETTINGS`), so new accounts
  are on it. Nineteen themes: Dawn Skies, Off White (#f4f1ea, light, ink blue, grain),
  Night Shift (#313338, the owner's Discord dark blue-grey, with a blurple accent; a first
  try on the bright blurple itself was the wrong shade), Warm Charcoal (#262624, the
  owner's Claude grey, with a clay deep enough for white labels), Quiet Stone (Graphite,
  matte, grain), then photo themes (glass, Recommended mode).
  Every background in them is a free one, which the tests check.
- **No other company's name on a theme** (owner): only Dawn Skies and Off White kept the
  names from the request; every other theme has its own name, not its background's.
- **Matte on a solid colour takes its shades from it** (`tonalSurfaces` in contrast.ts,
  applied by `applyUserTheme`, mapped in styles.css under `data-tonal`). Glass over a flat
  colour has nothing to blur and laid the theme's blue-greys over it, which read muddy. Now
  cards, the sidebar or top bar, and dialogs are a shade of the colour (a step lighter on a
  dark one; a step whiter on a light one, like paper; deep enough for
  light text on a bright one), text takes the colour's hue, borders are hairlines and
  shadows short. Every text colour is measured: 7:1 main, 6:1 muted, 4.6:1 quietest, and
  the contrast audit now checks the three minimalist colours and a few hard ones in both
  modes. Only with Matte panels and a solid colour; other panels are as before.
- **Texture** (`settings.theme.texture`: none, grain, dots, grid; API-validated, so Render
  must be on this commit before it saves on komogon.app) shows under Background for a
  solid colour or a Minimal gradient. A faint layer in the Backdrop; photos never get one.
- The light/dark field is now labelled **Mode**, so it isn't read as the Themes above it.
- **Saved looks are the Custom tab** of Themes (owner, same day), beside All and the tags,
  with no heading of their own. The picker opens on Custom when there is at least one saved
  look in this browser, otherwise on All. All lists the preset themes only.
- Saved looks keep the texture too. The extension popup gets the texture and matte shades.

- **Docs off for now** (owner, same night): not built, `/docs` redirects to the homepage, and
  the Docs links are gone from the homepage and the changelog. The page and its text are kept.
- **The Track list lost its icons and connecting line** ("looks too ai"): each line has a thin
  accent bar beside its words, and while the tour runs the lines not on show grey out.

## First-time setup: questions, a look around, the timelapse, then "All done", 2026-10-22 (user request)

The owner asked for an onboarding revamp "like a guided tour similar to apps like Todoist": three sections, each skippable but never the whole thing at once, few words, not monotone or instructive, and every questionnaire answer saved so they can see it, without the account showing any of it.

- **Section 1, About you** (`/onboarding`, `pages/Onboarding.tsx`, before the account counts as set up): Pick a look (Light or Dark, then Dawn skies or Minimalist), Where do you study? (Ontario universities with a search, "You'll verify this in Settings later.", and a "Not in university" button outside the list), What will you use Komodon for? (Study, Read books, Journal, Personal project, Stay on task, Other; no text box), Using another app for this right now? (Todoist, Latent, Notion, Other, plus None, added so "doesn't use one" can be told from a skip), and Bring in your calendar? (Yes walks through Google Calendar, Outlook, iPhone or Canvas/Moodle/Quercus: where to find the .ics link, a field, Add). Every question has Skip; the section has "Skip section". A reload carries on from the first question not yet answered.
- **The looks are the preset themes** (`lib/onboarding-looks.ts`; built on placeholders first, then pointed at the presets once they landed the same night). The owner's picks: Dawn skies is the Dawn Skies theme in light or dark mode; Minimalist is Off White in light and Inkwell in dark. Each pick puts the whole theme on at once, behind the card, and the cards draw it with the theme picker's own preview (`backgroundStyle`, `cardLook`, exported from ThemePicker.tsx).
- **Warm Charcoal is now Inkwell** (owner, same night): first its accent became Peach (`amber`, one of the base accents in Settings) in place of its own clay, then its colour became the owner's screenshot's dark blue-grey, read by eye as `#1c1c21` (the screenshot wasn't a file to sample), and it was renamed. Id `inkwell`; nothing stores preset ids, so nothing carries over.
- **Dawn skies says "Recommended"** (owner, same night): a small accent tag beside its name on Pick a look (`RECOMMENDED_LOOK` in Onboarding.tsx), styled like the timelapse presets' "This device".
- **No full stops on the setup's short lines** (owner, same night): the question lines, the calendar steps, the look-around lines, "All done" and the three ways to add tasks (the "Got a lot due?" card's descriptions too, since it is the same card). The timelapse card's two sentences became two lines. Error messages keep theirs.
- **Komo on the setup card is grey on a light theme** (owner: "never black"): `--fg-subtle` under `data-theme='light'`, the screen's text colour on a dark one.
- **The timelapse part says what a timelapse is** (owner, trying it: "I was even confused here"): a card first, "While you focus, Komodon can film you and speed it up into a short video to keep or share. Set up how it looks here." with Skip section and Set it up; then the bar lists the steps in the page's order (Pick when it records, Start from a look, Drag things around the preview, Save under it). "When it records" comes first because new accounts start on Never, so a layout alone never films anything.
- **The university answer is not the profile's university.** That still needs the emailed code in Settings; the answer is only kept for the owner.
- **Section 2, Look around** (`components/onboarding/Tour.tsx`, mounted in the shell, loaded only while running): Tasks, Analytics, Social (left out when Social is off) and Settings, one stop each. The page opens, its nav link is ringed with the rest dimmed, and a small card says one line (Back, Next, Skip section, "2 of 4"). The link is found where the nav is: the sidebar, the top bar, the phone's bottom bar or its pills at the page top (on a phone Analytics and Settings are pills under You).
- **Section 3, Timelapse:** Settings › Timelapse opens with this device's preset, a small bar at the bottom ("Your timelapse", "Move things around, then save.", Skip section), and a Save under the editor in place of the unsaved-changes bubble (`TimelapseTourSave`). Save, changed or not, ends the section.
- **All done:** "Thanks for setting up and choosing Komodon." with "I'm all good" (home) and "Add your first tasks", which turns into the three options from the "Got a lot due?" card (`GetStartedOptions`): paste from an AI chat, the calendar (greyed out with "Added." when one came in during setup) and add them yourself (Tasks).
- **Where the tour is** is kept in this browser (`komogon.tour`, per account), since the account is already set up by then; a reload carries on.
- **The answers** go to `onboarding_answers` (one row per account, jsonb, migration **0032_onboarding_answers**) as each is given, through `PATCH /api/me/onboarding`; a skipped question is stored as null, so a skip differs from never asked. How each section ended and the last choice are kept too. Admin › Onboarding answers shows totals per question and everyone's rows (dev accounts left out); the account's own export includes them. Nothing in the app shows them to the person.
- Tests: `onboarding-answers.test.ts`. Checked in a sandbox on a computer (sidebar) and a phone: every question, a real calendar added, the tour's four stops, the timelapse save, both endings, and the Admin card.

- **The closing heading is "Try it out!"** (owner, same night): the hand-drawn underline under
  "The" looked ugly, so it and "The study app." are gone.

## Jack mode: a die decides each break, 2026-10-22 (user request)

The owner asked for "Jack mode", named after their friend Jack Chow: after every work session a dice animation plays and rolls a break from -1x (no break) to 3x, with odds that average -0.2x. Off by default, turned on only in Settings › Timer near the Pomodoro settings, with their warning under it. On for Jack Chow once pushed. Anyone with more than 45 minutes of sessions with it on gets the badge "Gambler" and a dice emoji by their name; the profile gets the break won and lost; achievements for how many times they rolled.

- **The setting** (`settings.pomodoro.jackMode`, false by default, API-validated): a toggle in Settings › Timer after "Auto-start work after a break", with the owner's words verbatim as the line under it: "A gambling mode for your timer. Would not recommend turning this on because it is very stupid. Thanks Jack." No popup or confirmation (owner, same message: "it should just say it under the setting"). Settings search finds it by "jack mode", "dice" and "gambling".
- **The die** (`packages/core/src/jack.ts`): six faces, the change to the break in breaks: -1x (46 in 100), -1/2x (20), 0x (12), +1x (12), +2x (6), +3x (4). The weights average exactly -0.2x. -1x means no break; +3x means the break plus three more (four in all). Read "-1x break time (no break time)" as a change to the break, since a break of minus one break can't be had.
- **Where it rolls:** inside the timer's own `advance()`, at each work-to-break boundary (short and long breaks alike). A pomodoro started with Jack mode on carries `timer.jack` (a seed, the rolls, seconds won and lost, the last roll); the face is a hash of the seed and the cycle, so the server, the portal and the extension all land on the same break without asking each other, and advancing twice stays idempotent. The seed is fixed when the session starts: turning the setting on or off changes the next session, not the one running. Continuous sessions have no breaks and never roll. A lost break goes straight on to the next work block (or waits before it when auto-start work is off). Skipping a won break still counts it as won.
- **The animation** (`components/focus/JackDice.tsx`): a die tumbles for 1.5 s and lands on the rolled face, then "Break 5 min → 15 min" / "No break"; it goes away by itself after about 4 s, or on a click or Escape. It plays from the session controller, so on the dashboard's timer card and the focus screen, once per roll per tab; a roll made while the timer was off screen still plays when it comes into view within 3 minutes. Under reduced motion it lands without tumbling. The card rises without fading (it's glass).
- **Gambler:** more than 45 minutes of focus, all time, in sessions that ran with Jack mode on (`isGambler`). That is the "gambler" badge and the dice emoji after the name on the profile (`profile.gambler`). The emoji is the one place the UI uses one: the owner asked for a dice emoji by name, over the no-emoji rule.
- **Profile stats:** "Break won" and "Break lost" in Totals (`stats.jack`, summed from each session's `timer.jack`), each only when above zero, and hidden with the rest of the stats by Settings › Social.
- **Achievements** (badges, since that is what Achievements are): Gambler (75 XP), and rolls: Feeling lucky 1 (25), Ten rolls 10 (50), Regular 25 (75), High roller 50 (100), The house always wins 100 (150). They carry `jack: true` and are listed on Achievements only for someone with Jack mode on or who has earned one, so the badges don't advertise a mode that is off for everyone by default. Not asked either way; easy to show to everyone.
- **Jack Chow:** migration **0031_jack_mode** turns the setting on for any account (not a dev account) whose profile name is "Jack Chow", ignoring case and extra spaces. It runs when Render deploys it; an account named that later doesn't get it.
- Tests: `jack.test.ts` (the odds over 60,000 rolls, the timer), Jack mode cases in `badges.test.ts`, and `jack-mode.test.ts` in the API (the setting, rolls on a session, badges, the profile, the migration).

## Themes: tags on their own line, two themes gone, Off White and Sorbet accents, a white Komo, 2026-10-22 (owner request)

- **The tag under each theme's name, always** (owner: "always on the second line, seperate from the names"): the name and the tick on the first line, the tag (Nature, Minimalist…) on the second. It used to sit beside a short name and drop under a long one.
- **Golden Pond and Neon Streets removed** ("unreadable" for Golden Pond). Their photos (golden-willow, taipei) are still backgrounds; an account using either keeps its look, it just no longer matches a theme.
- **Off White** takes the default accent (sky), not its own navy.
- **Sorbet** takes a muted plum accent (hsl 320 35% 36%) instead of rose. On its light-pink glass every built-in accent measured 1.0 to 1.7 against the sidebar, so Komo vanished; the plum measures about 4.5 to 5.2.
- **Komo goes white when the accent is too dark** (owner: "when komo is too dark along a dark background just resort to making him white"): `logoColor` in ui theme.ts sets `--logo-color` to white on a dark theme when the accent is under 3:1 against the nav (the solid colour's own shades when there is one, else a dark card); otherwise the accent as before. The sidebar's mark now uses it too, and on matte solid colours it takes the same lightened accent as the top bar's (it used the raw accent, which is how Night Shift's indigo Komo got lost on its grey sidebar). Light themes are unchanged.
- A "Recommended" note on Dawn Skies was added and then taken off at the owner's word the same evening.

## Glass cards lose the top sheen, 2026-10-22 (owner request)

- **No sheen on any card in glass mode** (owner: "remove the top sheen efect off of all panels in glass mode"): the white gradient over the top of Glass cards (`.glass::before`, `--glass-highlight`) is gone, and so is the bright 1px line along every glass card's top edge (it was the first part of `--glass-border-inner`, which now keeps only the even inner ring). The Panels setting's glass preview lost its line too.
- **The trophies keep theirs** (owner: "except for those badges that have that nice animated sheen"): the shimmer on new records is untouched, and trophies keep the top edge as `--glass-top-edge`.

## Usernames and display names, 2026-10-21 (user request)

Built on 2026-10-21 but not shipped then; it shipped with the changes in the next section, which replace several of these rules.

The owner asked for a username and a display name, with these rules, in their words: the username "starts with @ and is at least 3 characters", is "only latin alphabet with no accents and . _ -"; the display name has "no punctuation except ._-"; "for both names cannot have 2 symbols next to each other"; "only 1 username can exist at a time and usernames can only change once every 14 days"; and "for everyone that doesnt have a username yet give them a random one and then inform them and bring them to the settings to change it".

- **The display name is the old name** (`settings.profile.name`), relabelled "Display name". It may use letters in any script (accents included), numbers and spaces, and . _ - as its only punctuation; runs of spaces close up. Emoji and other symbols are refused. Names saved before this keep working until they are next edited.
- **The username is a column** (`users.username`, unique; it shipped as migration 0033), stored lower case without the @ and always shown with it. 3 to 30 letters a to z plus . _ -, read literally: no digits. Typing capitals or a leading @ is fine; the field lowers and strips them as you type.
- **Two of . _ - side by side** are refused in both names (`..`, `._`, `-_`); one symbol next to a space is fine in a display name.
- **Once chosen, a username holds for 14 days** (`users.username_changed_at`); the API says the day it can change again, and the field is greyed with that date. Only the username the person chose starts the clock.
- **Everyone gets a random one** the next time they open the app (`ensureUsername` on `GET /api/me`): an adjective and an animal or tree ("golden.finch"), with four random letters after once the short ones keep colliding. It doesn't count as a change, so the first change is free. While it is still the picked one, a one-time dialog says "You have a username" with "Keep it" and "Change it"; Change it opens `/settings#username`, which focuses the field. Read "bring them to the settings" as that button, not an automatic jump, so the dialog can't pull someone off a page mid-task.
- **The username saves on its own Save button, never on blur**, because of the 14-day hold: a half-typed name must not stick by accident.
- **Where it shows:** under the name on profiles, on your card beside the feed, and after names in the feed's people lists. "Find people" also matches usernames, with or without the @.
- The rules live in `packages/core/src/names.ts` (tested), shared by the API and the portal.

## Usernames for everyone, new rules, and a first step in setup, 2026-10-22 (user request)

The owner asked: "add usernames, start with @"; "give all users a username now just 2 random words. notify them and tell them to change it"; "add names and usernames to the onboarding"; then, while it was being built, "force them to add a username but a name is optional", usernames with "no special characters except _-!. no spaces and no 2 special characters right next to eachother", and "for the names, no symbols".

- **Everyone has one now.** Migration 0033 adds the columns and, in the same migration, gives every account two random words ("quiet.otter": an adjective, then an animal, tree or thing outdoors), a pair already taken tried again and a third word after eight tries. The word lists are `USERNAME_WORDS` in core `names.ts`, copied into the migration's SQL. New accounts get one the moment they are made (`ensureUser`), so no account is ever without one; `/api/me` still fills in any row that slipped through. The given one doesn't count as a change, so its first change is free.
- **Usernames:** a to z, numbers and `_ - ! .`; no spaces, no accents, no other symbols, never two of those four side by side; 3 to 30 long; lower case, stored without the @ and always shown with it. Numbers are allowed now (the 10-21 rule read "only latin alphabet" as none); accents stay out because the owner's earlier rule said so and nothing since changed it.
- **Names (the display name) take no symbols at all:** letters in any script, numbers and spaces. Names saved before keep working until they are next edited.
- **Telling people:** someone whose username is still the one they were given sees, once, "Change your username" with what they were given and a box for a new one right there ("Keep it" or "Save"), instead of a trip to Settings. It never shows over the first-time setup's look around. Either button closes it for good (the `username` hint). It is a dialog rather than a row in the Social bell because the bell is only on the feed, and this has to reach everyone.
- **First-time setup starts with "Pick a username"** (`NamesStep` in Onboarding.tsx): a username box that starts empty, so it is the person's own pick, and "Name (optional)". It is the one question with no Skip, and "Skip section" waits until it is done ("force them to add a username"). Saving there counts as choosing, so the 14-day hold starts; it is recorded as `name: true` in the onboarding answers so a reload carries on after it.
- **Where @usernames show:** under the name on profiles, on your card beside the feed, after names in the friends lists, and before the time on each post. "Find people" matches them, with or without the @.
- No explanation of the rules on screen (the plain-labels rule): the field only says what is wrong when something is ("No spaces.", "No two symbols in a row.") and, while held, "Can change again Nov 5".
- **No name, then the username is the name, without its @** (owner, the same night: "if someone has username but no name just make their username BIG and remove the name", then "remove the @ if they only have a username and no name"): `personName` in core gives the name, else the bare username, else "Someone", everywhere the API names a person (profiles, people lists, the leaderboard). So the profile's big title is "komodev" and the small @ line under it goes (`showsUsername`: not when the name is the username). The profile's edit dialog reads your own name from your account, since the title can no longer tell "no name" apart.

## The start card on a computer: a task button, three pills, one Start, 2026-10-22 (owner request)

The owner called the computer's "Start a session" card an eyesore: the picker inside it made
the card taller than the window, so the card scrolled and its list scrolled too. Tried and
turned down along the way: a two-pane rebuild ("looks like ass"), then the original card with
the picker behind a button ("the functionality of the card is much better now, but it is so
ugly"). Asked which apps do this well, the owner said to redo it, keeping the phone as is. This
version borrows Linear's property pills and the running apps' one big Start.

- **What to study is one big button** (`SubjectButton` in SubjectPicker.tsx): the task and where
  it lives, or "Choose what to study". It pops the picker (search, the course pages) out under
  it. No "Studying" label; "No task" stands alone (no "Minutes still count"), and the picker
  lost its "Nothing chosen yet" line.
- **Then a pill each for how it runs:** Pomodoro or Continuous (its pop-out has the lengths under
  Pomodoro and "Change lengths"), how long ("Unlimited", "50 min", "Until 4:30 PM"; its pop-out
  has the three choices and the minus/plus minutes or the time), and "Timer shown" / "Timer
  hidden", which flips on a click. No field labels or hints on the card.
- **One full-width Start**, and an X at the top right in place of Cancel.
- **Pop-outs** are `Popout.tsx`: a popover in the browser's top layer, since anything portalled
  outside a modal dialog is inert. Escape and a click anywhere else close it; choosing closes the
  task and work-style ones.
- The card went from 446px tall to 283px.
- **The phone is unchanged** (owner: "do not change the mobile version"), its "Minutes still
  count" included.

## The dashboard's start card: Most pressing beside the quote, in a small pop-out, 2026-10-22 (owner request)

The owner sent a screenshot of how the "Ready when you are" card should look on a computer:
the title, the day's line and the two buttons on top, one rule, then the quote with "Most
pressing" at its right. And: "make the drop down a separate small card window that just shows
the names and tag of on track or not".

- **One rule, two rows.** The pressing list no longer sits between the buttons and the quote
  under a rule of its own. The quote and a "Most pressing" pill (the count and a chevron) share
  the row under the one rule, the pill at the right, centred on the quote.
- **The pill pops out a small card** (`Popout`, lined up with the pill's right edge; it gained
  an `align` for that): each task's name and its pace tag ("On track", "Behind" and so on, the
  same `StatusChip`). Where the task sits, its due date and its minutes are gone from it.
  Clicking a task still closes the card and goes to that task further down. Escape and a click
  anywhere else close it. It starts shut on every visit; remembering the list open or folded
  (`komogon.pressing-open`) is the phone's alone now.
- **The phone is unchanged** (narrower than 560px, as the start dialog): the list still unfolds
  under Start with where, due and minutes, and the quote keeps its own rule.

## A shorter composer and the post card reworked, 2026-10-22 (user request)

The owner, on Social: the composer was "so tall and gross looking make it shorter and make post fill in that empty space"; then, for posts: "make 1h focus in its own little card thing", "make RSM 222 - slides review kinda like a title of sorts", "remove the trash can, add 3 dots at the bottom left where i can edit the post body or delete it", and "put the time ... on the top right on the same line as the @zachary bit".

- **The composer** (computer only; the phone is untouched): the box is one line and grows as you type (`field-sizing: content`), and Post sits at the right of the attachments' last line instead of a line of its own. 226px tall became 166px.
- **A post's session** is no longer one tinted strip. Settled after two rounds (first the cards beside the title, owner: "should sit on the same line"; then the owner's sketch): the start and end times sit top right with focus (and elapsed, when shown) as small tinted cards under them, and what it was on ("Course · Task") is the post's title, right under the name (owner: "too much space between phy131 and the username"): the head is a grid, so the times and card hang down the right beside both. The timelapse's "Share to Social" preview follows the same layout.
- **What the session earned, beside kudos and comments** (owner's sketch: "content if this session broke records (badges) also add streak"; "for sessions that have badges dont have all of them just have one award symbol, people hover it and they can see which ones"): a flame with the daily streak as it stood when the session ended, then one award icon when the session unlocked badges, naming them in a small card on hover (or a tap). Always in that order (owner: "kudos comment streak badge", the badge "if any"), then the ⋯. Badges come live from `sessions.badges_awarded`; the streak is a new `sessions.streak` (migration **0034_session_streak**), written at the end of every session, so sessions from before it show no flame. Both follow the profile's rule: shown only when the author shares study stats (Settings › Social), and never on a post that hides its time.
- **Every post has the ⋯** (owner: "all posts should have a 3 dots"). Someone else's holds Hide and Report, which only close the menu for now ("don't add functionality yet"). Your own holds Edit and Delete; Delete asks "Are you sure?" first (the trash can deleted at once). Edit turns the words into a box in place, with Cancel and Save. Only the words change: the session, times and files stay as posted. The post's edit isn't marked as edited (not asked for).

## Social on a phone, laid out like the photo-sharing apps, 2026-10-22 (user request)

The owner, with two screenshots of BeReal: "social looks bad on mobile right now make the style similar to bereal". Before, a phone got the computer's cards stacked: a Live now card, a tall composer card, every post a card with its session in a tinted strip, the four tabs running off the screen, and your card and the friends card (with the bell and the requests) under the very last post. Phone width only (560px, `NARROW_QUERY`); the computer's Social is unchanged.

- **The top of Social:** a round friends button on the left (with the count of requests waiting), the title in the middle, the bell on the right; under it the four views as plain words (Feed, Groups, Jams, Leaderboard), the one shown in full colour, Jams keeping its count. The friends button opens the friends card in a sheet (`FriendsButton`, `FriendsCard sheet`); the bell is `NotificationsBell round`. Your card and the friends card are no longer on a phone's feed.
- **Posts sit straight on the page, not in cards** (the one place a phone drops the "every card is the same card" rule, since the reference has no cards): the backdrop's text colours, and the page title's halo on photo backgrounds. The head stays on top as the computer has it (name, the times and focus card at the right, what it was on under the name); the picture or video comes right under it, big (22px corners), then the words and the bottom row (kudos, comments, streak, award, ⋯). It is all CSS (`order`), so a post's markup stays the computer's. The focus card gets a little more tint (18%), since there is no card behind it on a photo. The profile's posts follow.
- **Live now** is a row of round pictures ringed in red (grey on a break or pause) with the clock under each name.
- **The composer** rests as one round field beside your picture and opens up (session, files, Post) when tapped (`is-resting`).
- **Everyone / Friends** are two words instead of a pill switch. **Comments** have no rule above them and a round field. Share to Social's preview puts the video first on a phone too.
- Built first with a big card for the session where the picture would be (on posts without one); dropped the same night once the computer's post got its title and small focus card, so the phone uses the same pieces.

## Glass that blurs once, 2026-10-23 (owner's idea)

The owner found the app's frame rate low and asked whether it was the app or the hosting. It was the app: hosting only decides how fast pages and data arrive, and every glass card blurred the photo behind it again on every frame while the page scrolled, the costliest thing the app draws. The owner then suggested blurring the background once when it changes, saving that as an image, and showing it cropped on the cards that sit straight on the background, keeping the real blur for anything that overlaps other things.

- **How** (`packages/ui/src/glass-image.ts`): the Backdrop blurs the photo once (`makeGlassImage`, on a small canvas, since a blurred photo scaled up looks the same) whenever the photo, the blur or the window's size changes much, and puts it on `<html>` as `--glass-image` with where it lies (`--glass-image-size`, `-x`, `-y`: the photo's own `center / cover`). `watchGlassPanes`, started by AppShell on `#main`, gives each card a `.glass-pane` child: a strip pinned to the window, as wide as the card and as tall as the window, showing the image under the card's own fill, border and inner line (styles.css). The card's own blur goes off. A strip the whole window wide held about three times the memory, hence the strips.
- **The real blur stays** for the nav, dialogs, menus and toasts (they float over other content); for a card while it or anything around it moves (a page rising in, a hover lift, the Achievements fold opening), marked `data-glass-moving`; for a card in a scroller or only partly shown by a clip; for a card holding other glass; for a card the page holds `static` (the pane needs a positioned card: Settings' menu on a phone covered the page title before this was caught); for the "That's enough time to" cards (their entrance holds a transform, and changing it would turn on a hover lift that never worked); and for browsers other than Chrome and those built on it, a colour boost above 100%, PNG uploads (they can be see-through), gradients and solid colours.
- **The one difference:** within about 40px of a card's edge the image blends in a little of the photo just outside the card, where Chrome's own blur stops at the edge. On Cotton Candy that is at most about 4% brightness right at the edge. Otherwise side-by-side screenshots matched to under one colour level on average, in light and dark, at the top of the page and scrolled.
- **Accent buttons on a card:** inside a blurring card an accent button only sees the card's own flat fill, so its blur is one flat colour, a little brighter from its colour boost. Over a pane it would have blurred the photo through the card and come out greyer, so `underColor` works that colour out and it goes under the button's tint instead (`.btn-primary.pane-under`; its tints copy the glass-mode `.btn-primary`, so change both together). Something under the button that isn't flat keeps the card on the real blur.
- **The badges' reveal on Achievements** is `backwards` now, not `both`: the same look, and a held end transform kept their slices from lining up.
- **Measured** on the same build with Chrome's CPU renderer while scrolling, frames a second with the real blur → with panes: Home 13 → 43, Settings 17 → 55, Analytics 12 → 44, Social 16 → 52, Profile 9 → 28, Achievements 40 → 59. Rastered tiles: Analytics about 60 MB more, Social about the same.
- **The owner's laptop** has Intel UHD graphics driving its 165 Hz screen, and an RTX 4050; browsers run on the Intel chip unless Windows is told otherwise (Settings › System › Display › Graphics).

## Sorbet theme removed, 2026-10-23 (owner request)

The owner asked for the Sorbet theme (Abstract, on the Sherbet photo) to go. Only the preset is gone: the Sherbet photo stays in the background picker, and anyone already on that look keeps it (it now reads as their own look rather than a theme).

## The background never picks light or dark, and Social on a phone is one big card, 2026-10-23 (user request)

The owner, looking at Social on a phone: "it should not become an auto light mode just because of the background", "try keeping dark/ light mode and just increasing darkness/lightness on social specifically", then "maybe all of social should be the colour of one big card when you enter", "just use the colour and blur of one big card and blur it in when you enter it", and "remove the global auto light mode/ dark mode".

- **No Recommended mode.** Settings › Appearance › Mode is System, Light or Dark. Recommended took light or dark from the background's colour; accounts that still hold it follow the system (`resolveTheme`), and the Mode switch shows them as System. The photo themes, Dawn Skies and Quiet Stone no longer set a mode, so putting one on keeps the mode already chosen; only the flat colours (Off White, Night Shift, Inkwell) set theirs, since each is made for one (`ThemeLook.mode` is optional; `matchingThemePreset` ignores the mode when a preset has none). The extension follows.
- **Text straight on a photo keeps the mode's colour**: white in dark mode, black in light (`adaptToPhoto`). Before, a light photo turned it black even in dark mode. The photo is washed darker (or lighter, in light mode) under it instead, as far as 4.5:1 needs: at most 30% on the shipped photos. A flat colour keeps whichever text reads on it, since a wash would change the colour chosen.
- **Social on a phone is one big card** (`.social-sheet`, portalled to the body, under the page and over the backdrop): the card's own colour and blur over the whole window, fading in over 360 ms as the page opens, so it looks like the photo blurring in (it holds nothing, so fading it doesn't touch the cards' glass). In glass mode it is the photo blurred once (`--glass-image`) under the glass fill, like a card's pane, or the real blur where there is no blurred copy; other panels give it the panel fill. Its text is a card's (`.social-page` takes the panel or glass text colours). Cards on it (groups, jams, the board) are a step lighter or darker (6% of the text colour, no shadow, no pane) rather than a card on a card; posts, Live now and the composer stay without a surface, and lost the halo they had on the photo.

## Themes: two gone, three new accents, 2026-10-23 (owner request)

- **Morning Tide and Falling Leaves are gone**, with nothing in their place (owner: "dont get a replacement for these"). Their photos (Pier, Autumn) stay in the background picker. Nature keeps Dawn Skies, Cherry Peak and Deep Woods.
- **New accents, sampled from the owner's swatches:** Paper Lanterns a warm grey (#8c857d, `custom:32,6,52`, was Lemon), Old Town a dusty pink (#c99cc2, `custom:309,29,70`, was Peach), Inkwell a peach orange (#ffb36b, `custom:29,100,71`, was Peach). Inkwell is also the Minimalist look's dark side in the first-time setup, so it gets the new orange there too.
- **New theme, Last Light** (Nature), from the owner's own look in a screenshot: the Valley Light photo, matte panels, and the same peach orange as Inkwell (read from the screenshot, which wasn't a file to sample). The name is ours; the photo already has its own. Like the other photo themes it sets no mode, so it keeps the one you're on (the owner was in dark).

## Social's big card blurs in and out, and the bar's name slides open whole, 2026-10-23 (user request)

The owner, on a phone: "add a blur on social for mobile and make it the same blur image from panels, make it fade in and out", and "glitch in mobile for bottom nav where text shows up as ... before the full word".

- **The card moved into the Backdrop** (`sheet` prop, turned on by AppShell for Social at phone width, `.backdrop-sheet` in styles.css). It was a layer the Social page put on the body, which went the moment the page did and leaned on the browser's live blur wherever the photo wasn't blurred once. Now it shows the very image the cards' panes use (`--glass-image`, Chromium); where that isn't made (Safari, or a colour boost), the photo is blurred once in the sheet itself with a CSS filter at the glass's blur, never a live backdrop blur. The cards' colour goes over it. It fades in over 360 ms as Social opens and out as it goes, then hides, so it costs nothing on other pages.
- **The bottom bar's name is cut off, not "…"**: the name's column slides open from nothing, and with `text-overflow: ellipsis` it read "So…" before "Social". With `clip` the word slides out whole.

## The mode picked in setup, never the device's setting by default, 2026-10-23 (user request)

After Recommended went, it followed the device, so the owner's phone, set to light, turned the app light (Dawn Skies in light mode) the next time it opened, without them choosing it: "just dont default to system like ever for both devices". Then, to a forced dark: "no it should start on whatever theme that the person decides during onboarding".

- **A new account starts on what it picks in setup**: the look step saves Light or Dark with the look, as it already did. Until then, and if that step is skipped, it is Dark (`DEFAULT_SETTINGS.theme.mode`, also the first paint before settings load, so the sign-in page is dark), never the device's setting.
- **Accounts still on the old Recommended mode take the light or dark they picked in setup** (migration **0035_theme_mode_from_setup**, from `onboarding_answers.look.dark`), or dark when they never answered it. A row that somehow still holds Recommended shows dark (`resolveTheme`, and the Mode switch shows Dark).
- Only someone who picks System follows their device.

## The background's own blur and brightness, 2026-10-23 (owner request)

The owner asked for the background to be made lighter or darker and blurred, set right under the background in Appearance, and for the blur to be worked out once, when Appearance is saved or left, so it isn't blurred again on every visit or reload.

- **Settings:** `theme.backgroundBlur` (0-40 px) and `theme.backgroundBrightness` (-60..60), API-validated. Two sliders, Blur and Brightness, under the background picker (`BackgroundAdjust.tsx`), only on a photo or an upload: a colour is just picked lighter or darker. Saved looks keep them.
- **Brightness** is black (darker) or white (lighter) over the photo at up to 60%, under the scrim and the page's wash. It is a flat layer, so it costs nothing to draw and isn't baked into anything; the cards' blurred image gets the same layer (`--glass-image-over`), and the text and glass are worked out from the photo's colour under it.
- **Blur:** the Backdrop blurs the photo on a canvas (`blurPhoto` in glass-image.ts, the cards' own blur shared) and keeps it in the browser's Cache Storage (`backdrop-cache.ts`), with the cards' blurred image for each window size beside it. A visit or reload reads both from there instead of blurring again; only a new photo, a new blur or a new window size makes one. A shipped photo's soft placeholder shows for the moment it takes. Signing out empties the cache (an upload's blurred copy is someone's own photo).
- **While dragging** (`backdrop-tuning.ts`) the browser blurs the sharp photo live, and the cards use the real blur over it. Letting go saves; leaving Appearance (another section or another page) is when the photo is blurred for good, once, at the last value.
- Where a canvas can't blur (older Safari) the browser's live blur stays on.

## Trimming a video already posted, 2026-10-23 (owner request)

The owner asked to let people cut videos they've already posted, and to add only that.

- **Where:** "Trim video" in the ⋯ under your own post, only when the post has a video. It opens the timelapse's trim (the same strip, handles, playhead and play, `.tl-trim-*`) over the posted video, in a dialog (a screen of its own on a phone). Save stays off until something is cut. Nothing else about a post can be changed from there: no swapping or removing files.
- **A real cut, not a hidden range:** the browser cuts the file (`lib/video-cut.ts`, mediabunny), so the player, the length and the download are all the cut. A cut that starts on a key frame is copied as it is (instant, no loss); anywhere else it is re-encoded at about the video's own bitrate so it starts exactly where the handle was. Over the post's limit it shrinks like a new post's file.
- **Saving:** the cut goes up the way a new post's file does (R2 upload link, counted in the daily quota, or with the request without R2), then `PUT /api/posts/:id/video` puts it in the old file's place with a new poster, and the old file is deleted from R2. The words, pictures, session and kudos stay.
- **The old copy isn't played again:** a file kept by the API is asked for with its size in the address (`?v=`), because the browser keeps those for an hour under one address.

## School verification and Social, 2026-10-24 (user request)

Updated this checkout to the latest main before extending its existing school email-code
flow. A pinned MIT-licensed Hipo directory adds international university/college names,
countries and domains while preserving Ontario IDs and student email overrides. Matching
uses domain boundaries and rejects ambiguous domains. No email leaves the API for lookup.
Official identifying marks for Toronto and McMaster include provenance; other schools
have a fallback icon. The directory loads only where needed, not in the extension.

Social adds School: verified schoolmates' live subjects and public posts, with activity
sharing off until explicitly enabled. Verifying or unlinking a school resets that consent.
Private posts remain private. Membership comes from confirmed email proof. Leaderboard
adds My school (all-time focused time) and Schools (school totals this week or all time),
with contributor counts and equal ranks for ties. Existing leaderboard opt-outs, suspensions,
test-account exclusion and dev-world isolation apply. The All boards setting now names the
expanded scope. No new onboarding step or schema migration is introduced.

Directory provenance, mark sources, limitations and refresh instructions: docs/SCHOOLS.md.

## The bottom bar snaps to the tapped tab, 2026-10-23 (owner request)

The owner, on a phone: switching tabs is janky, the animation is choppy and doesn't snap straight away.

- **Why it was choppy:** the tapped tab's name slid open by animating its width (a grid column going 0fr to 1fr, and the padding), over 340 ms. A width can only animate on the main thread, and that is exactly when the new page is being built, so the slide got a few frames and stalled in the middle. Measured on a phone-sized Chrome slowed down 4x: the name took 70-224 ms to open, with frames of up to 150 ms stuck in it.
- **Now it snaps:** the highlight, the name and the other tabs giving way all change in one frame on the tap, with no slide (`.tabbar-link` and `.tabbar-label` in index.css have no transitions). The settled bar is unchanged to the pixel. The icon still gives a little under the finger. Same test: the name is fully open one or two frames after the finger lifts.
- This replaces "The bar's animation" from 2026-10-22. The name's `clip` from earlier today stays, so a name that doesn't fit is cut rather than "…".

## A phone asks horizontal or vertical before it records, 2026-10-23 (owner request)

The owner asked: "ask the user on mobile whether they want to record horizontally or vertically before a session", with "another enable thing called remember my decision".

- **When:** on a phone, whenever a recording is about to start (after Record on "Record a timelapse?", with Always record, or from "Record this session" in the controls), a sheet asks "Record horizontally or vertically?" with two big choices, Horizontal and Vertical, and a "Remember my decision" switch. It is asked once a session; stopping and starting the recording again keeps the answer. The clock waits while it is up, like the other questions. Closing it records nothing this time.
- **Remember my decision** saves the answer to the phone's preset (`timelapsePhone.orientation`, 'ask' by default, API-validated: Render must deploy before it saves on komogon.app), and the sheet stops appearing. Settings › Timelapse › Phone (and the focus screen's controls on a phone) has "Horizontal or vertical": Ask, Horizontal, Vertical, to change it or ask again.
- **What it does:** the video takes the shape picked, however the phone is held. Until now the first still decided (the phone upright or sideways when recording began). Stills taken the other way round are cropped to the middle, as a turn mid-recording already was. Held the other way, the camera screen says once "Turn your phone sideways." or "Turn your phone upright.".
- The computer is untouched. The words are the owner's (horizontal, vertical); the layout editor still calls its two layouts Upright and Sideways, and its hint now says which is which.

## Choosing what to study is a page of its own, 2026-10-23 (owner request)

The owner, on the computer's Start a session card: "instead of choose what to study opening a drop down open like a new page of sorts like a flipping animation and after its been chosen go back". A card flip was built first and rejected ("the animation looks bad", "replace the flip animation with something else"); they also asked to "make it more obvious that theyre supposed to go back so add like a button that goes coloured whens omethings selected thats like "im all set" but keep the auto go back thing too".

- **The card turns to a second page**, "What to study", with the same picker as before (search, the courses one level at a time). Back at the top left, Escape and a click outside go back without choosing; the X still closes the whole card.
- **How it moves** (`turnPage` in StartSessionDialog.tsx): the page there slides a little to the side and fades (110 ms), the other one comes in from the side it lives on (the picker from the right, the session from the left) while the card grows or shrinks to fit it (240 ms). The card and its X don't move, so the glass keeps its real blur. With motion off it swaps at once.
- **"I'm all set"**, a normal-sized button at the bottom right (a full-width one like Start was "way too big"), grey until something is chosen and then the accent. Clicking a course or unit chooses it as well as opening it (the owner: "if i click a task that is a parent it does not let me go all set"), so "I'm all set" takes the parent; its first row inside is "All of" it, ticked, except on the last level down, where everything inside is a task with nothing under it (owner: "on the most child task remove the "all of" indicator"). Picking anything inside, a task, No task, a routine, a search result, "All of" or the mark at a row's right still goes straight back.
- The phone is unchanged: it already pushes its own picker page.

## No email code at sign-up, and no password warning, 2026-10-24 (owner request)

The owner: "remove the mandatory email verification when a user makes an account" and "remove the warning about unsafe passwords because now theyre hashed and salted".

- **Sign-up makes the account at once**, like Google sign-in: email, password, Create account, and you're in. The API's `requireEmailVerification` now defaults to off (it was on whenever a mailer was set, and `index.ts` forced it on), so `POST /api/auth/signup` answers a token straight away. The code flow is kept behind the option (the email tests still turn it on), and the portal still shows the code card if a server ever asks for one. Accounts made this way start with no `email_verified_at`, like before the code existed.
- Forgot password, the school email check and Resend are unchanged: they still email codes.
- **The password field's hint** "Don't use a password you use anywhere else." is gone; making an account still says "At least 6 characters.". The line under it saying the owner can see accounts and study data stays (not asked).

## "Don't count this session", 2026-10-25 (owner request)

The owner: "add option at the end to not count a session towards your hours or streaks".

- **Where:** the last line of the end-of-session summary (the dashboard's sheet and the focus screen's), under "Delete time": "Don't count this session". Once used, the XP line says "Not counted", the streak and level figures update in place, badges the session took back go from the list, "Delete time" goes, and the same link reads "Count this session" to undo it. Not offered anywhere else; the session history marks such a session "Not counted" (where its XP was) and doesn't offer Delete time on it.
- **What it doesn't count toward:** every total of focused time (Analytics, the profile, the leaderboard, schools, groups, jams, compare, a task's pace, plans, badges, the greeting, the admin's account list), both streaks, and XP. The XP wasn't in the request, but session XP is paid for the minutes, so a session whose minutes don't count gives it back, with any badge it earned that no longer holds (as Delete time does). Counting it again pays both back. A routine ticked or a task marked done at the end stays so. The session stays in the history, on the app's calendar and in Social (it can still be posted).
- **How:** `sessions.counted` (migration **0036_session_counted**; next is 0037). Everything that adds up time reads only counted sessions (`loadCompletedSessions` and the queries that sum `work_seconds`). `PUT /api/sessions/:id/counted { counted }` (`setSessionCounted`).
- **The streak is wound back, not patched.** Each session now keeps the streak as it stood just before it ended (`sessions.streak_before`). Not counting one (or counting it again) puts the daily streak back to the newest copy that hadn't judged that session's day yet and the weekly streak to the newest that hadn't judged its week, hands back freezes spent on the days since (dropping their events), keeps freezes and break days bought since, and syncs, so those days are judged again with what counts now. For sessions that ended before 0036 there is no copy, and the streak stays as it was.
- Render must deploy (and run 0036) before the link works on komogon.app.

## The page centred beside the sidebar, and the Tasks table on narrow windows, 2026-10-25 (owner request)

The owner, with a ~900px window (the browser on half the screen): "fix main content not being centred", then a screenshot of Tasks with the names gone.

- **Centred beside the slim sidebar.** On a window too narrow to centre the page and clear the sidebar, the page used to leave room for the open sidebar (236px on the left) even while it was slim, so everything sat far right with 24px on the other side. Now it clears the slim sidebar (72px) and its own 28px padding puts the same gap on both sides. Only a pinned sidebar keeps the open one's room (224px). The slim one still opens over the page on hover. Wide windows are unchanged: the page stays in the middle of the window.
- **The Tasks columns fold by the table's width, not the window's.** They folded under 760px of window, so a 780px table beside the sidebar kept the columns and left names a few letters (at 616px, none). Now they fold under 840px of table (`@container tasks`), into the line under each title that phones use. Phones held upright are unchanged; a big phone held sideways now folds too.
- **No ring round the whole page.** "Skip to content" focuses `#main`, and the focus ring drew round all of it (the pink line down the left of the Tasks screenshot). `#main:focus-visible` has no ring now.

## Replies to comments, 2026-10-25 (owner request)

The owner: "Add replies to comments. format: @ the username, and then having that in your comment notifies them. add a button that does that. do not add threads".

- **No threads.** A reply is an ordinary comment at the bottom of the list; what makes it a reply is the @username in it.
- **Reply** sits after the time on every comment but your own. It puts "@username " at the start of the box (left as is if that name is already in it) and puts the cursor after it, so you just type.
- **@username anywhere in a comment tells that person**: the bell lists "<name> mentioned you: <comment>", and it opens the post on its author's profile with the comments open. Usernames are matched without caring about case; a full stop or "!" right after the name ("@quiet.otter.") counts as part of it only when that longer name is someone's.
- Kept when the comment is written (`comment_mentions`, migration **0037_comment_mentions**; next is 0038), so changing a username later doesn't lose it, and deleting the comment takes it away. Only people who can see the post are kept (friends-only posts, Settings › Social, dev worlds), at most 10 a comment, never the writer; the bell checks again when it is opened, so someone who can no longer see the post stops seeing the line. A mention on your own post is already its comment, so it shows once, as the comment.
- In the comment, each @username that names someone is the accent colour and links to their profile.
- Not built: suggestions while typing after @ (not asked).

## A post on its own screen, on a phone, 2026-10-25 (owner request)

The owner: "add a feature on mobile to click to focus on a post so they can see the whole comment section do not add this on pc".

- **On a phone** (the 560px width where Social takes its phone layout), tapping a post, or its comments button, opens it as a screen of its own: "Post" and a close button at the top, the post with every comment under it, and the comment box pinned at the bottom, above the keyboard (`PostSheet` in PostCard.tsx, the full-screen `Modal`). Reply works there as in the feed.
- Taps on what already does something are left alone: names and pictures of people, kudos, the ⋯ menu, the video, a carousel, links in comments.
- A link from the bell to a post's comments opens its screen straight away.
- **The computer is unchanged**: the comments open under the post, and tapping a post does nothing.

## Jack mode: a slot machine instead of the die, 2026-10-25 (owner request)

The owner: "MAKE jack mode feel better, use a slot machine, re rate the x system: 0x means 0, 0.5x means 50% of the original break, its 0-3x", with every step "0.1 0.2 0.3 etc", "Make 1x 30%" and "make the gambler get 0.9x on average". Every result "should explode and be satisfying": the multiplier "turns into the amount of minutes that means and a bunch of numbers pop out and they all go into the break timer and the break timer counts upwards with every number that goes in", "drammatic satisfying ... like actual gambling", with their two sounds: a coin dropping when the result explodes, and a coin collect as the numbers go into the timer.

- **The odds** (`packages/core/src/jack.ts`): the multiplier is now the break itself, not a change to it: 0x is no break, 0.5x half, 1x the usual, 3x three times as long. 31 results, 0.0x to 3.0x in tenths (`JACK_FACES[i]` is i / 10, so a stored roll's `face` is its tenths), weighted in 1000: 0x 84, 0.1x to 0.9x 40 to 44 each (45% under 1x in all), **1x 300 (30%)**, 1.1x to 1.9x falling from 36 to 8, 2.0x 14, 2.1x to 2.9x 3 to 7, 3.0x 15 (1.5%). The average is exactly 0.9x (tested, and over 200,000 spins). The break is `round(base × multiplier)`; break won and lost are what it gives over or under the usual one. Spins are still seeded per session and cycle, so the server and every client land on the same one. A session already running when this deploys keeps the break it already rolled.
- **The machine** (`components/focus/JackSlot.tsx`, replacing `JackDice.tsx`): a card with two reels, whole breaks (0 to 3) and tenths, a "." and "×", and a lever that pulls as it starts. The reels tick as numbers go past (a click made on the spot, `playTick` in sounds.ts), the whole number stops first with a thunk, then the tenths crawl in as the window leans in, run a touch past and settle. It lands with a flash (the accent; red for 0x) and a shake from 2x up, the line under it says the break ("Break 5 min → 11 min 30 s", "No break"), then the result turns into the break's time ("11:30"), swells and shakes, and **bursts into coins** ("+0:30" each, a round amount that divides the break, more coins for bigger results, 8 to about 36) with the **coin drop** sound. The card goes; the coins fly out, drift toward the break clock, then are pulled in one by one. **The break clock waits at 0:00 from the moment the lever pulls** and counts up with every coin that lands, with the **coin collect** sound a little higher each time and a bump on the digits, the last one bigger; the count ends on the real time left, so nothing jumps when the machine hands the clock back. 0x shows the usual break struck through, and its coins drop away in red instead.
- **Where it flies:** to the clock on screen, the focus screen's (`TimerDisplay`) or the dashboard card's, both marked `data-jack-target`. With the clock hidden or off screen, the card stays and its own window counts up instead. The phase label says "Break" while it plays, so the label never gives a 0x away early (`ctl.spinning`).
- **The sounds** are the owner's files, `public/sounds/coin-drop.mp3` and `coin-collect.mp3` (`playEffect`, same evening-out and limiter as the alerts), decoded when a Jack mode session is open, and follow Settings › Sounds (off, volume).
- A click or Escape still puts it away. Reduced motion shows the result at once with one coin sound.
- Badges now say spin ("Spin the slot machine once.", "Ten spins", ...); keys unchanged. Settings search also finds "slot machine".

### Later the same day: the lever is pulled by hand, a voice line, and no blur left behind

The owner: "theres a blur that stays in the middle of the screen after the card disapears remove that", "let the user pull the slot machine instead of automatically going", and with their recording "add this sound if the user doesnt pull the slot machine within 7 seconds".

- **The break waits for the pull.** At the end of a work block in Jack mode the timer pauses (`timer.jack.waiting`, set in `advance()`), holding the spun break (or, after 0x, the next work block) whole; otherwise waiting at the machine would use up the break. The machine opens on "Pull the lever" with the reels resting on 1.0x and the clock at 0:00. When its show ends, the portal sends the new `jack-pull` event (core `applyEvent`, API `timerEventSchema`), and the timer carries on as it would have: the break starts with its full length, unless auto-start says to wait. Resume or Skip break from anywhere (the extension, another tab) also count as the pull; an unpulled machine then goes away. The machine shows on the surface that owns the alerts whenever the timer waits, so a reload brings it back; the old "seen" note in sessionStorage is gone.
- **The lever** is a button: drag the knob down (it follows the pointer, clicks as it passes the point of no return, and springs back if let go early), or click it, or Space or Enter. A click on the dimmed page doesn't close it before the pull; Escape skips the show and starts the break. The card is a dialog, so the focus screen's Space (pause) stays out of it.
- **The voice line**: seven seconds without a pull, the owner's "go back to your focus screen" plays once (`public/sounds/go-back-to-focus.mp3`, their .m4a with the quiet start trimmed), at the sound settings' volume, 3 dB over the other sounds (owner, later: "3 db louder"). It plays from a background tab too, which is the point when the focus screen is in another tab.
- **The blur**: the card shrinking away left a patch of its glass blur over the clock. The card now drops its blur as it shrinks and is taken off the page 300 ms into the burst.

## Two new minimalist themes, Linen and Deep Sea, offered at setup, 2026-10-25 (owner request)

- **Linen** (light): the owner's palette, Neutral #e7e6e3 as the page, Accent #3a3f5f (`custom:232,24,30`) and Text #33322e, no texture. It is the white minimalist theme now and sits first in the list after Dawn Skies.
- **Deep Sea** (dark): the owner's swatches, a navy page #2c3060 with a teal accent (`custom:165,50,45`) and white text, no texture. The swatches were only a picture with no codes, so both colours were read by eye; swap in the real codes if the owner gives them (`theme-presets.ts`, and the key in `SOLID_TEXT`).
- **A flat colour can bring its own text colour** (`SOLID_TEXT` in core theme-presets.ts, keyed by the colour): matte panels on it use that for the main text on cards and on the page wherever it clears 7:1 (`tonalSurfaces`), so Linen put in dark mode, or Deep Sea in light, falls back to the worked-out text. Muted and quiet text are still worked out from the colour. No new setting: the text colour follows the background colour, so the picker previews and the extension get it too.
- **Setup's Minimalist look** is now Linen in light and Deep Sea in dark (`lib/onboarding-looks.ts`). Off White and Inkwell stay in the theme list; nothing was removed.
- **Five more from the owner's palettes** (same day, "just add them off to the side", not in setup), at the end of the theme list, tagged Minimalist, no texture: **Dusk Rose** (dark, #0d1e4c, pink accent #c48cb3, pale pink text #e5c9d7), **Salt Air** (light, #c8d8e4, deep teal accent #2b6777; the palette's teal is too light for main text at 7:1, so its text is worked out), **Wisteria** (light, #f3eef8, accent #6e5a88, text #2a2550), **Tidepool** (dark, #032f30, accent #0c969c) and **Gold Leaf** (dark, #020b13, gold accent #daab2d). The palettes' other colours have no place in a theme (one page colour, one accent, one text). Salt Air isn't called Sea Glass because a background already has that name.

## Calmer Deep Sea, Dusk Rose and Tidepool; setup's Minimalist is Salt Air and Gold Leaf, 2026-10-25 (owner request)

- The owner: "deep sea dusk rose and tide pool are too saturated". Same hues and lightness, about half the saturation on the page colour and the accent (picked from a side by side of now, a middle step and a greyer one; the greyer one lost the colour): **Deep Sea** #323652 with accent `custom:165,34,46` (was #2c3060, `165,50,45`), **Dusk Rose** #1c263f with accent `custom:318,24,66` and text #e4d3db (was #0d1e4c, `318,32,66`, #e5c9d7), **Tidepool** #152c2d with accent `custom:183,44,40` (was #032f30, `183,86,33`). `SOLID_TEXT` moved to the new colours. Anyone who already put the old ones on keeps them until they pick again.
- Then: "make salt air the default light mode minimalist and make gold leaf default dark minimalist on onboarding". Setup's Minimalist look is now Salt Air in light and Gold Leaf in dark (`lib/onboarding-looks.ts`); Linen and Deep Sea stay where they are in the list.

## The palette themes very muted or dark, 2026-10-25 (owner request)

- The owner, on the halved versions: "looks shit, make them all very unsaturated or dark, it hurts to look at them". Every palette theme except Linen (already muted) now has a page colour at 14% saturation or less, dark ones near black, and an accent at 26% or less. The dark themes' accents are dark enough for white labels (lightness about 40) rather than bright pills with dark labels.
- **Deep Sea** #1d1e26, `custom:165,18,40`, white text. **Dusk Rose** #1a1c23, `custom:320,12,46`, text #e3dee0. **Tidepool** #191f1f, `custom:183,18,38`. **Gold Leaf** #0d0f11, `custom:42,26,40`. **Salt Air** #e2e6e9, `custom:195,20,32`. **Wisteria** #f2f1f4, `custom:266,10,42`, text #2f2d39.
- Don't bring the palettes' bright colours back: the owner found them painful.
- Then (same day): "make deep sea default dark mode". Setup's Minimalist look in dark is Deep Sea again (`lib/onboarding-looks.ts`); light stays Salt Air.

## Off to Social after a session, 2026-10-25 (owner request)

The owner: "at the end of session rename post to social", "add automatic go to post social screen", "turn it on by default and it activates when someone ends the session". Asked which Post and when, they picked the Post button in the timelapse's Share to Social preview, and going after the summary rather than instead of it (going earlier would throw away a timelapse not yet saved).

- **The Share to Social preview's button says "Social"** instead of "Post". The composer on the feed still says Post.
- **Closing the summary goes to Social** with that session picked in the post box: Done (or the x, or a click outside) on the dashboard's summary, Close, the x or Escape on the focus screen's. The box opens (on a phone too) and, on a computer, takes the cursor; `?post=<session id>` carries it there and is dropped from the address once read (`Composer.tsx`). It asks for the sessions again first, since the lists in the cache are from before the session ended.
- **Only when there is something to post**: a session of a minute of focus or more (what the post box lists) that `GET /api/social/postable` still offers, so one already shared from the timelapse closes as before. Asked as the summary opens (`useSocialAfterSession` in `lib/after-session.ts`), so closing doesn't wait.
- **The focus screen in its own tab** posts the address to the tab that opened it, which goes to Social while the focus tab closes (`sendOpenerTo` / `useOpenerRequests` in `lib/focus-tab.ts`, listened for in AppShell, Social addresses only). With no such tab (a phone, the extension, a tab opened by hand), the focus screen goes to Social itself.
- **On by default** (`settings.review.openSocial`, true for every account, API-validated): Settings › Timer › After each session › "Go to Social to post it", shown only while Social is on. With Social hidden it never goes.
- "Start another" on the focus screen doesn't go, nor does the summary closing itself after Delete time.

## Your own backgrounds: the first free, then 50 XP each, kept in the browser, 2026-10-25 (owner request)

The owner: "add option to upload custom backgrounds first is free the next is 50 xp", then while it was being built "make sure cutom background storage is local".

- **Where:** Settings › Appearance › Background. The folded picker has an **Upload** button beside "Show all backgrounds" and shows your upload when one is on; the open picker starts with **Yours**: an Upload tile, then your pictures, newest first, each with a delete in its corner. Clicking one puts it on. The old single upload under Advanced is gone (Advanced is now the glass only, so it is hidden with Matte panels).
- **The price:** the first is free; while you keep at least one, each one more is 50 XP (`SHOP.CUSTOM_BACKGROUND_COST`, `customBackgroundCost` in core economy.ts). Counted from what you keep, not from what you ever uploaded: delete them all and the next is free again. Deleting gives no XP back. When the next one costs, "Another background / This one is 50 XP." comes up before the file picker, with "Choose a picture", or "Not enough XP" greyed out. That is the one XP price shown outside Achievements; it is asked right where it is spent so nobody pays without seeing it. Spending XP never lowers the level (like the shop). No ceiling on how many.
- **The pictures are local:** they stay in the browser they were added in (IndexedDB `komogon-backgrounds`, `apps/portal/src/lib/local-backgrounds.ts`: the 2048 px picture and a 400 px tile). The API never receives them. It keeps only a record of each (`custom_backgrounds`, migration **0038_custom_backgrounds**, next is 0039: an id the portal makes, a sha256 fingerprint of the picture, the time) so it can count them and charge. `theme.customBackgroundId` says which one is on (`customBackgroundUrl` stays the 'upload' switch).
  - The same picture again is the same background, put back on for free (matched by fingerprint), never a second charge.
  - The portal names the price it showed when it records one (`cost`); if the real price differs (another tab added one), the API answers 409 with the real price instead of charging.
  - **Another device or browser** has the records but not the pictures: there the tile says "Not on this device" and can only be deleted, and if it is the one on, that device shows the theme's own background. Clearing the browser's site data loses them the same way.
  - **The Chrome extension can't show them** (it can't read the portal's browser storage), so its background picker no longer offers "Uploaded"; one already set to it shows its usual background.
  - **Uploads from before** (one each, kept in the API's `user_assets` as base64) are moved into the browser the first time the app sees them (`POST /api/me/backgrounds/adopt`, free, they were already yours), and the API deletes its copy only once the browser has filed it (`/adopted`). The first device to open the app gets it; others see "Not on this device".
- Saved looks with an uploaded picture put it back through the same record: free when it is still one of yours, otherwise they ask "Add this look's picture back for 50 XP?".

## Rolls on Achievements: 10 XP a pull of the slot machine, 2026-10-25 (owner request)

The owner: "in the acievements tab add an rng system 1/2 1/4 1/8 1/16 kind of a exponential system they can spend 10 xp to roll and get the rarest thing", "at a rarity of 1/256 they get a different name colour (can choose to disable in settings)", "add titles to all of these", "add them on the profile to show how much of a gambler they are", "add a badge for every rarity under 1/256", then "make rolling satisfying reuse the slot machine".

- **The odds** (`packages/core/src/rolls.ts`): 13 rarities, 1/2 up to 1/8192, each half as likely as the one before. The API draws a ticket from 0 to 8191 (`crypto.randomInt`) and the rarity is one more than its trailing zero bits, so 1/n comes up exactly 1 in n times; ticket 0 goes to 1/2. A pull costs 10 XP (`ROLL_COST`), taken in one statement so two quick pulls can't spend the same XP; every pull is a `roll` line in `xp_transactions` (ref = the tier), and `users.roll_best` / `users.roll_count` keep the rarest and the count (migration **0039_roll_best**; next is 0040). `POST /api/rolls` answers the tier, new best or not, and any badge it unlocked.
- **Titles**, commonest first: Coin flipper, Tourist, Beginner's luck, Hot streak, Card counter, Card shark, Big spender, High stakes (1/256), Jackpot, Lightning in a bottle, Four-leaf clover, Once in a blue moon, Beat the house (1/8192).
- **The name colour** from 1/256: each rarity from there has its own colour (gold, rose, blue, green, lavender, red; `--name-tier-8` to `-13` in index.css, lighter on dark and darker on light), on the name wherever Social shows it (posts, comments, Live now, leaderboards, groups, jams, compare, the bell, your card, the profile). The API sends `nameTier` with every person (`nameTierOf`); Settings › Social › "Coloured name from rolls" (`settings.social.rollColour`, on by default) turns it off, and only shows once you have one. Each rarity having its own colour, rather than one colour for all of them, is our reading; one colour is a small change.
- **Badges** for every rarity past 1/256: Jackpot (1/512, 150 XP), Lightning in a bottle (1/1024, 300), Four-leaf clover (1/2048, 600), Once in a blue moon (1/4096, 1,000), Beat the house (1/8192, 2,000). A roll counts for every badge at or under it (a 1/2048 also gives 1/512 and 1/1024), like the streak badges. They are listed on Achievements once you have rolled (`roll: true`, like Jack mode's).
- **The machine** (`components/slot/RollSlot.tsx`) is Jack mode's: the same card, window, lever, ticks, flash and coins, with one long reel of every rarity. The lever's drag, the coins' flight and the shared motion moved out of JackSlot into `components/slot/` (`SlotLever.tsx`, `slot-kit.ts`), so both machines use one copy; Jack mode behaves exactly as before (checked in the sandbox). The reel spins at full speed until the server's answer is in, then slows down onto it: the ladder runs upward, so a common result crawls past 1/4096 and 1/8192 before dropping to 1/2, and a rare one climbs. Rarer results crawl longer and from 1/64 the machine leans in. A rising tick per rarity, a thunk as it lands. From 1/256 the card shakes and throws confetti (the Confetti setting still applies). A new best bursts into coins ("1/2048") that fly into Best at the top of the card, with the coin sounds. The machine stays open for the next pull (lever, Space or Enter); Escape, the X or a click outside closes it. The page behind is only told the result when the reel lands, so it can't give it away.
- **On the page**: a Rolls card after Your rewards: Best (in its colour) and its title, the number of rolls, "Roll for 10 XP", and every rarity with its title and how often it came up; 1/8192 takes the last row to itself.
- **On the profile**: the rarest roll's title as a chip under the name (with a die, in the rarity's colour when the name is coloured), and a Rolls tile beside the posts: rolls, the rarest and every rarity hit. The title is public like the name; the tile follows "Study totals on your profile". No XP figures there, as everywhere outside Achievements.

## RNG Rolls, second pass: titles, gradients, batches, the new-record moment, 2026-10-25 (owner request)

The owner, after the first version went live: "add colours (gradients) for numbers 1/32 and beyond and make it flowy animation", "give the user the option to display on their profile and give the user the option to change their username to the animation and colour", "add badges to their profile", "give achievements related to this gambling", "show the slots in relation to how rare they are it shouldnt just show all of them equally", "clean up the ui in profile, name it RNG Rolls and put it at the bottom below peak study hours", "add these options in small text in the achievements page", "put rng roles below shop", "clean up the ui in profile and achievements to make it prettier", "give titles like sol's rng". Then, with two sounds of theirs: "make it feel special when a user beats their previous best and add shiny effects to the new record", "add effects to certain numbers and let it carry on to the usernames if they choose to do it", "add more numbers up until like 1/32000", "add achievement sound for smaller and less rare wins", "add success sound for rarer wins", "effects and colours should go crazier the more wins", "make it satisfying as possible", and "add ability to roll multiple at once".

- **Fifteen rarities, 1/2 to 1/32768**, one-word titles in the style of the collecting games (our own words, no names taken from one): Common, Uncommon, Good, Natural, Rare (1/32), Crystal, Ember, Sapphire (1/256), Emerald, Starlight, Comet, Eclipse, Celestial (1/8192), Supernova, Genesis (1/32768). These replace the first titles; badges kept their keys and took the new names.
- **Looks that get louder the rarer** (`.roll-fx-*` in index.css, `fxLevel` in lib/rolls.ts): 1/2 to 1/16 a plain colour; from 1/32 a gradient flowing through the letters; from 1/256 a shine sweeping across; from 1/2048 a glow; 1/16384 and 1/32768 the colours cycle as well. Each has a colour for light and for dark. Gradients and glows break the matte rule on purpose here, at the owner's request.
- **Names**: Achievements › RNG Rolls › Name picks what a name wears everywhere on Social: Auto (the rarest roll's look once it is 1/256 or rarer, as before), Plain, or any look from 1/32 up to the rarest roll (`settings.rolls.name`). The Settings › Social switch from the first version is gone; an "off" there reads as Plain.
- **Show on my profile** (`settings.rolls.profile`, on by default) shows the rarest roll's title by the name and the RNG Rolls card; off hides both (the name keeps its look). The card no longer depends on "Study totals on your profile".
- **Both options are small text at the foot of the RNG Rolls card** on Achievements, which now sits below the Shop.
- **Gambling badges** (`rollBadges`, read from `users.roll_stats`, migration **0040_roll_stats** with a backfill of the rarities already landed; next is 0041): Pocket change (10 rolls), First shine (1/32 or rarer), Double take (two of 1/16 or rarer in a row), Hooked (100), Beginner's luck (1/64 or rarer in the first ten), Cold streak (eight 1/2s in a row), Full house (every rarity from 1/2 to 1/64), Regular at the tables (500), All in (1,000), plus the rarity badges up to 1/32768. They stay off Top badges and show on the RNG Rolls card instead.
- **The rarities shown by how rare they are**: on the reel the commonest come round ten times a turn and the rarest once, like a real machine's strip; on Achievements they sit in four bands, small pills for the four commonest and tiles that grow (and wear more of their look) toward Genesis, with the ones not landed yet faint.
- **Many at once**: ×1, ×10 or ×100 a pull (`POST /api/rolls` takes `count`; one ledger line per roll). The reel lands on the rarest of the batch, then the haul is laid out under it, a chip per rarity with how many.
- **Satisfying**: the owner's pop (`public/sounds/roll-pop.mp3`) on the smaller wins and their fanfare (`roll-success.mp3`) from 1/256; the card rings in the colour from 1/256, shakes harder with a glow from 1/2048, and shakes twice with the ring cycling colour at the top; confetti from 1/256 in more waves the rarer; a burst of light behind the card, a turning ring of every colour at the top two. **A new record** gets a "New record" ribbon over the reel, sparks thrown out of the window, the window ringed in the colour, and coins ringed in it that fly into Best, which pops in with its look.
- **On a profile**: RNG Rolls is the last card of the side column, under Peak study hours: the rarest in its look, the count, the five rarest landed with how many, and the RNG Rolls badges.

## Prettier timelapse looks, a style for each piece, Story / Reel on a computer, and posting in fewer steps, 2026-10-25 (owner request)

The owner: "make sending timelapses to social easier", "make the timelapse preset layouts prettier and give more options for customization", then "dont make things global" (an earlier line asked to make things global; asked what that meant, they dropped it) and "add for pc the ability to change the video into a story/reel format". Nothing was made shared between the phone and the computer: each keeps its own preset and layouts.

- **The clocks read better** (`lib/timelapse-compose.ts`): the label and the end of a time are drawn smaller and lighter than the number ("Focus" beside a big "42:17", "2:14" then a small "PM EDT"), every part on one baseline with the capitals centred, and a clock's pill is measured as if every digit were a 0, so it no longer twitches wider and narrower as the time runs. The task name and the person's text stay whole.
- **Each text piece has a pill, a font and a colour**, and the progress bar a colour (`pill`, `font`, `color` on a layout box; absent is the old dark pill, sans, white; API-validated, only what differs is stored). Pills: Dark, Colour (a muted fill of the colour with white text), Outline, None (bare text with a soft shadow). Fonts: Sans (Inter), Geometric (Satoshi, the wordmark's), Mono, Serif. Colours: White, Gold, Mint, Sky, Rose, Lilac, kept muted like the app's accents. They show under the chosen piece's Left / Centre / Right in the layout editor, on a phone too. Set per piece, not for the whole video ("dont make things global"). The mark stays as it is.
- **Eight looks** (`timelapse-styles.ts`): Classic (as before), **Minimal** (bare text), **Big timer** (a big bare focus time, Geometric), Headline (the task in Serif across the top), **Story** (a thin bar along the top like a phone story, the time of day and the mark under it, the task and the time low in the middle), **Mono** (outlined, in mono), Corner and Clean. A look now also says how its texts are drawn, including the time elapsed, start and end it leaves in place. A layout restyled by hand reads as "arranged your own way". Layouts saved in the old Big timer, Headline or Clean read as arranged too, since those looks changed; nothing about them moves.
- **Story / Reel on a computer:** the computer's preset has a second layout, `storyLayout` (always 9:16, starting in the Story look with the screen waiting to be added), and `format` ('normal' or 'story'). The "Your timelapse" card has **Video: Normal / Story / Reel**; switching remakes a made video at once and is remembered for the next one. The trim's viewer, "Change layout?" and the link on the card follow it. Settings › Timelapse › Computer arranges both, picked with the same switch above the editor (no shape to pick for a story). Saying yes to recording the screen puts it in both layouts. The camera is cropped to the middle for the tall video, as a phone's is.
- **Sharing in fewer steps:** "Share to Social" is on the card before the video is made, after a finished session: it makes the video and opens the post's preview. And closing the summary for Social (the 2026-10-25 setting) now takes the made video along: the post box opens with the session picked and the video attached, ready to post. In the same tab the file is handed over in memory (`handTimelapse` / `takeTimelapse` in `lib/after-session.ts`); a focus tab sends it to the tab that opened it with the address (`sendOpenerTo(path, file)`), and the "unsaved timelapse" warning doesn't ask once it has gone. Only a made video goes along; stills with no video yet stay behind as before.
- Not changed: the feed shows a tall video in a wide box (letterboxed when playing), as it already did for phone timelapses.

## Browser notifications for nudges, kudos, comments and mentions, 2026-10-25 (owner request)

The owner: "ask to enable chrome notifications so users can get notified by nudges and likes and add a notifications tab in settings to enable/disable certain notifications or notifications in general".

- **Real Web Push**, so they arrive with Komodon closed (the browser has to be running). The API sends them (`apps/api/src/services/push.ts`) when someone gives kudos, comments on your post, @mentions you on someone else's post, or nudges you: the same four kinds as the bell, with the bell's words ("Sam gave you kudos", "Sam nudged you") and its link as the click. The bell's id is the notification's tag, so taking kudos back and giving them again replaces the pop-up instead of stacking.
- **No package and nothing to set up on Render.** The encryption (RFC 8291, checked against its worked example in `push.test.ts`) and the VAPID signature are written on Node's crypto. The VAPID keys come from the secret the API already has (`AUTH_SECRET`, else the calendar state secret), so every restart has the same keys. A new secret gives new keys; each browser notices on its next visit and subscribes again (`lib/push.ts` compares keys).
- **The ask:** Social shows "Turn on notifications?" / "For nudges and kudos." with Not now and Turn on, a moment after the page opens (`NotificationsAsk.tsx`), only while this browser hasn't been asked by the browser itself (permission "default"). Not now is for good, on every device (`dismissed: 'notifications'`); Turn on is asked again on another browser, since each one has to say yes itself. Never over the first-time setup or the username notice. The browser's own question comes straight from the Turn on click.
- **Settings › Notifications** (after Sounds): "Notifications" switches them on or off **in this browser** (it holds a push subscription or not), and once on, Nudges, Kudos, Comments and Mentions are **for the account** (`settings.notifications`, all on by default, checked by the API before sending). When it can't be on, the line under it says why: blocked in the browser's site settings, not available, or on an iPhone, add Komodon to your Home Screen first (Safari only gets Web Push there). Turning it off also stops the ask.
- **Its own worker:** `public/push-sw.js`, registered at the scope `/push/` where no page lives, so it never caches anything and runs on localhost sandboxes too (the caching `sw.js` is hosted only). While a Komodon window is in front it shows nothing (and the focus screen stays quiet); it tells the open pages instead, and the bell and nudges load again at once (`PushBridge.tsx`). A click focuses an open app window (not the focus screen's tab) and takes it to the link, or opens one.
- **Subscriptions** are `push_subscriptions` (migration **0041_push_subscriptions**; next is 0042), one row per browser keyed by its endpoint: signing in as someone else there moves the row. The API only takes endpoints on the browsers' push services (Google, Mozilla, Apple, Microsoft), or anyone could point the API at any server. Ten browsers an account at most. A browser the push service says is gone (404/410) is deleted.
- **Sign-out** tells the API to forget this browser, so the next person on it gets nothing of yours; the browser keeps the subscription, and signing back in as you turns it on again. Someone else signing in there drops it (`komogon.push.user`).
- The bell still lists everything; the switches decide only what pops up.
