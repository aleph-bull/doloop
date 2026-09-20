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
