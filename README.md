# Komogon

A study-planning product: a web portal, a Chrome extension remote, and an API. Frosted-glass UI, light and dark.

## What it does

- **Plan**: courses, tasks, assessments, and subtasks with estimates and due dates. Rest days and vacations that never break a streak.
- **Pace**: a calculator tells you what to work on today, how many minutes per day you need, and whether each task is on track, behind, critical, or overdue.
- **Study**: pomodoro, unlimited, or until-a-time sessions with idle detection, optional site blocking (extension), and a skippable end-of-session review. Starting one opens a focus screen in its own tab: a large clock, the task under it, an optional audio-reactive visualizer, and what Spotify is playing.
- **Motivate**: XP, levels, streaks with freezes and break days, badges, context-aware phrases, a daily quote or research tip, and a positive-only "This week" page.
- **Analyse**: an Advanced page with everything (per task, per course, estimate accuracy), a weekly review, and post-assessment follow-ups.
- **Schedule**: a week view with drag-to-create blocks, free-slot suggestions, two-way Google Calendar sync into a dedicated "Study" calendar, and an .ics feed.

## Getting started

```bash
pnpm install
pnpm dev
```

- Portal: http://localhost:5173
- API: http://localhost:8787/api/health
- Extension: `pnpm --filter @komogon/extension build`, then load `apps/extension/dist` unpacked in Chrome.

With no credentials configured the API runs on an in-process Postgres (PGlite, persisted to `apps/api/.pglite`) and the portal signs in with a locally minted dev token. Set `DEV_AUTH_SECRET` in `apps/api/.env` and the same value as `VITE_DEV_AUTH_SECRET` in `apps/portal/.env`.

`pnpm check` runs lint, typecheck, tests, the background contrast audit, and builds.

## Always on, on this PC

`pnpm local:update` builds, freezes a copy of the build, and starts it hidden: the portal on http://localhost:5173 and the API on 127.0.0.1:8787, reachable from this PC only. A `Komogon` shortcut in the Windows Startup folder runs `pnpm local:start` at sign-in.

- It runs the frozen copy, so rebuilding while you develop does not change it. Run `pnpm local:update` again when you want the latest.
- Its data lives in `%LOCALAPPDATA%\Komogon\pglite`, copied once from `apps/api/.pglite` on first start. Dev servers keep `apps/api/.pglite` for testing. Logs are in `%LOCALAPPDATA%\Komogon\logs`.
- It uses the dev ports, so `pnpm local:stop` before `pnpm dev`, and `pnpm local:start` after.
- To stop it starting at sign-in, delete `Komogon.lnk` from `shell:startup`.

To try things without touching real data or those ports, run the sandbox: `node scripts/local/sandbox-api.mjs` (API on 8797, throwaway data in `apps/api/.pglite-sandbox`) and `pnpm --filter @komogon/portal exec vite --config vite.sandbox.config.ts` (portal on http://localhost:5183).

## Layout

```
apps/portal      React + Vite + React Router + Tailwind (layout only); visual style from packages/ui tokens
apps/extension   Chrome MV3 popup, background worker, content-script bridge
apps/api         Fastify + Drizzle; Supabase Postgres in production, PGlite in dev/tests
packages/core    Pure TypeScript domain logic (pace, XP, streaks, timer, highlights, badges), 220+ tests
packages/ui      tokens.css, glass/panel surfaces, components, backgrounds, charts
```

See `docs/SETUP.md` for Supabase and Google credentials, `docs/ARCHITECTURE.md` for structure and data flow, and `DECISIONS.md` for every default chosen along the way.
