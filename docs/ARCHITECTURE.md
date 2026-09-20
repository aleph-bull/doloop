# Architecture

Doloop is a pnpm monorepo with three deployables and two shared packages.

```
apps/portal      React + Vite + React Router. The full product UI.
apps/extension   Chrome MV3 (React + Vite + CRXJS). Thin remote: start/stop, timer, blocking.
apps/api         Fastify + Drizzle on Supabase Postgres. Single source of truth.
packages/core    Pure TypeScript domain logic. No React, no I/O. Fully unit-tested.
packages/ui      Design tokens (tokens.css) + shared React components + theme helpers.
```

## Dependency direction

```
portal ─┐
        ├─▶ ui ─▶ core
extension┘
api ─────────▶ core
```

`core` depends on nothing. `ui` depends on `core` for types only. Apps depend on both. The API depends on `core` for every calculation (pace, XP, streaks, highlights) so that both clients and the server agree on numbers.

## Data flow

1. Clients authenticate with Supabase Auth (magic link or Google). They hold a Supabase JWT.
2. Every API request carries `Authorization: Bearer <jwt>`. The API verifies it and resolves the `User` row.
3. Clients never talk to Postgres. The API owns the schema (Drizzle migrations) and all writes.
4. Derived values (logged minutes, remaining, progress, pace status, XP, level, streak state) are computed in `core` from raw rows on read. Only `xp`, `level` (cached), and `streak` are persisted, and streak is re-evaluated lazily on any read.
5. Google Calendar sync runs inside the API. The refresh token is stored encrypted. The `.ics` feed is served by the API with a per-user secret token.

## Timekeeping

- Wire format is ISO-8601 UTC.
- Calendar-day logic (streaks, rest days, "due today") is computed in the user's IANA timezone using `core`'s date helpers, never with the server's local clock.
- Sessions record `workSeconds`, `breakSeconds`, `idleSeconds` separately. Only `workSeconds` counts toward progress.

## Theming

`packages/ui/tokens.css` defines every token. `applyTheme()` writes `data-theme`, `data-accent`, `data-motion` on `<html>`. Glass surfaces use the `.glass` recipe; dense content uses `.panel`. See `packages/ui/README.md`.

## Phase status

| Phase                    | Status  |
| ------------------------ | ------- |
| 0 Scaffold               | done    |
| 1 Core logic             | pending |
| 2 API + auth             | pending |
| 3 Portal MVP             | pending |
| 4 Extension              | pending |
| 5 Analytics              | pending |
| 6 Calendar               | pending |
| 7 Economy + achievements | pending |
| 8 Quotes                 | pending |
| 9 Polish                 | pending |
