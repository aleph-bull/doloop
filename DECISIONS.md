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
