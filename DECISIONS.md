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
