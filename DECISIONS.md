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
