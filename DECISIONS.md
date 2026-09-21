# Decisions

Running log of defaults chosen without a spec answer, and kickoff decisions from the user. Newest at the bottom.

## Kickoff (2026-09-20, decided by user)

- **Backend: Supabase** for Postgres + Auth (magic link and Google sign-in). The Fastify API stays the only boundary; clients never talk to Supabase's DB directly. Clients do use Supabase Auth JS for the sign-in handshake, then send the JWT to the API.
- **Glass level: heavier than §8.** Glass also on node cards, the daily quote card, and analytics highlight cards. Task tree, tables, charts, and settings forms stay on opaque panels.
- **Default theme: dark** when the system preference cannot be read. `mode: 'system'` still follows the OS; manual override in settings.
- **Workflow:** run every phase that needs no credentials, commit each phase on `main`, stop only when blocked on Supabase or Google credentials.

## Phase 0

- **Workspace packages export TypeScript source** (`exports` point at `src/index.ts`). Vite and `tsx` consume TS directly, so no build step is needed to develop. The API bundles `@doloop/core` with tsup for production.
- **Tailwind v4** via `@tailwindcss/vite` for layout only. All visual values come from `packages/ui/tokens.css` custom properties.
- **Inter** loaded from rsms.me in the portal. The extension popup uses the system font stack to avoid a network fetch in a popup.
- **API port 8787**, portal 5173, extension dev 5174. Portal proxies `/api` to the API in dev.
- **ESLint** enforces purity in `packages/core`: no DOM globals, no Node built-ins, no React imports.
- **Coverage thresholds** for core: 90% lines/functions/statements, 85% branches (branches are noisier; the spec's 90% is for lines).
- **Extension icons** are generated PNGs checked into `apps/extension/public/icons` so the manifest builds without an asset pipeline.

## Phase 1

- **A session is credited to the local calendar day it started**, even if it runs past midnight. This is what a late-night studier expects ("today's" session).
- **Streak evaluation advances `lastCountedDate` through every judged day** (counted, rest, frozen, reset), which is what makes lazy re-evaluation idempotent. A freeze is never spent when `current` is already 0. A quiet "today" is left unjudged until it is over.
- **Parent aggregation:** when any child carries an estimate, the parent's numbers are rolled up from those children and the parent's own estimate is ignored. A parent whose children have no estimates behaves as a leaf using its own estimate and all descendant sessions. A completed parent is `done` regardless of children.
- **A node with no estimate** is `no-estimate`, except `done` when completed and `overdue` when past due and not completed.
- **Due today with nothing studied recently** yields `behind` (the §3 formula: required exceeds 1.25 x 0 and study days remaining is 0 <= 3). `critical` still wins if required exceeds the comfortable maximum.
- **Rest-day edit limit** counts weekly-pattern changes and vacation additions. Vacation removals and purchased break-day applications do not count (removal is "anytime" per spec; break days already cost XP). A weekly pattern must leave at least one study day. Unchanged submissions are no-ops and are not logged.
- **Break-day monthly pricing** needs a count of purchases in the calendar month, so the API keeps an `xp_transactions` ledger (also useful for analytics and data export).
- **Cosmetic catalogue** (accent presets with level gates, 10 backgrounds with two purchasable) lives in core as metadata; the visuals live in `packages/ui`.
- **Quotes are placeholders** (4 verified attributions from Wikiquote-sourced material) until the Phase 8 sourcing task replaces `packages/core/data/quotes.json`. Research tips are likewise a 5-entry placeholder until Phase 8 writes 30+.
- **Phrase bucket priority** when several apply: node completed > streak milestone > distracted a lot > late night > assessment buckets > behind > first session > default.

## Phase 2

- **The API owns the timer.** A session row stores a `TimerState` (from `@doloop/core/timer`) and the server materializes pomodoro/scheduled transitions lazily on every read (`advance(state, now)`). Clients only send events (pause, resume, skip-break, idle-start, idle-answer, extend, end) and render `viewTimer()` against their own clock. This keeps the portal and extension in agreement without a cron or websockets.
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
- **The extension follows the portal's appearance.** `applyUserTheme()` in `@doloop/ui` is the single place that applies theme mode, accent (preset or custom), motion, and panel surface; the portal shell and the extension popup/options both call it. The popup renders the same `Backdrop`. The background worker caches an uploaded background in `chrome.storage` and re-downloads it only when `/api/me` reports a new `backgroundUpdatedAt`.

## XP rework and early cancellation (user request, 2026-09-20)

- **XP is proportional to focused time.** Base is 2 XP per focused minute; every bonus is a percentage of the base (review +10%, focus +20%/+5%, planned block +10%, on pace +10%, estimate beat +20%). Under a minute of focus earns nothing. This replaces the spec's flat bonuses, which read as arbitrary next to the time term.
- **The streak bonus is fixed**: +1 XP per streak day, capped at 30, added once per session that earned a base. The multiplier is gone.
- **Ending early earns no XP.** A pomodoro cancelled before its first work interval completes, or a scheduled session stopped before its planned end, logs the minutes (they still count toward progress and streaks) but awards zero XP and no confetti. The portal asks "End early?" first. Unlimited sessions are never early.
- **Pomodoro durations are locked** to 25/5/15 with a long break every 4, shown read-only in Settings, so short intervals cannot be used to collect the interval-completion threshold quickly. Auto-start and timer-visibility toggles remain editable. The API still accepts the fields; the constant lives in `DEFAULT_SETTINGS`.
- **Level divisor raised to 100** so levelling pace stays close to before despite higher per-session XP. Shop prices are unchanged.
- **Extension background** is a theme setting: same as the portal (default), the uploaded image, or its own preset. Resolved by `resolveExtensionBackdrop()` in `@doloop/ui`; the background worker caches the upload whenever either surface needs it.

## Parent path on task surfaces (user request, 2026-09-21)

- **Why**: two tasks can share a title ("Test 1"), so the Up Next card was ambiguous.
- **What**: `ancestorTitles`/`pathLabel` in core build "Course › Topic" from any id map. Shown above the title on the Up Next card, prefixed in the "Also today" list, under the running task in the timer card, and in the extension popup's task picker and active view.
- **Extension snapshot** now carries every non-archived node with `parentId` (parents included) so the popup can resolve paths; the picker filters to startable leaves itself.
