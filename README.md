# Doloop

A study-planning product: a web portal, a Chrome extension remote, and an API.

- Plan courses, tasks, and assessments with estimates and due dates.
- A pace calculator tells you what to work on today and whether you're on track.
- Timed sessions (pomodoro, unlimited, scheduled) with idle detection and optional site blocking.
- XP, streaks with rest days and freezes, badges, and a positive-only weekly highlights page.
- Google Calendar sync and an .ics feed.

## Getting started

```bash
pnpm install
pnpm dev
```

- Portal: http://localhost:5173
- API: http://localhost:8787/api/health
- Extension: `pnpm --filter @doloop/extension build`, then load `apps/extension/dist` unpacked in Chrome.

`pnpm check` runs lint, typecheck, tests, and builds. See `docs/SETUP.md` for credentials, `docs/ARCHITECTURE.md` for structure, and `DECISIONS.md` for defaults.
