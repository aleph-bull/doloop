# App review, 2026-10-05

> **Update 2026-10-06:** bugs 1–3 and 5–7, the UI fixes for units, the first-run dashboard and per-day rounding, the start dialog remembering your last choice, and focus-screen shortcuts are built (see DECISIONS.md). Bug 4 (extension and portal logging each other out) waits on Supabase being set up.

A read-through of the code plus a look at the sandbox at desktop and phone width. No code was changed. Lint, typecheck and all tests pass (core 496, API 139).

Labels: **confirmed** means seen in the app or certain from the code. **Likely** means the code allows it but it hasn't been reproduced.

## Bugs

1. **Possible double XP when a timed session ends on its own (likely).** When an "until a time" or "for a while" session runs out, the next `GET /api/sessions/active` finishes it (`getActive` in `apps/api/src/services/sessions.ts`). The portal polls that every 20 s and the extension every minute. If two requests arrive together, both can finish it, which pays XP twice and updates the streak twice. Double-clicking End, or ending from the portal and the extension at once, has the same risk in `endSession`. The cause is that the session-ending code has no database transaction and no "only if not already ended" guard. Fix: run it in a transaction, or claim the session with `UPDATE ... WHERE ended_at IS NULL RETURNING` and skip the rest if no row comes back.
2. **XP totals can lose updates (likely).** XP is written as `user.xp + delta` from a value read at the start of the request. Two XP-earning actions at the same moment (a routine tick plus a session end, or two tabs) can overwrite each other. Use `xp = xp + delta` in SQL.
3. **Double-clicking Start gives "Internal error" (likely).** The database correctly allows only one active session, but a second start racing the first hits that unique index, and the API returns a 500 instead of the friendly "A session is already running". Map Postgres error 23505 to 409.
4. **The extension and portal will log each other out once Supabase is on (likely, beta blocker).** The extension refreshes its own token using the refresh token the portal handed it. Supabase rotates refresh tokens and treats reuse as theft, so whichever side refreshes second can get the whole session revoked. Fix: let the portal push fresh tokens to the extension through the bridge, or have the extension use its own sign-in.
5. **The Tasks screen is cramped at phone width (confirmed).** On a 375 px screen the row of actions (play, add, template, edit) squeezes the task title to a word or two per line, and "0 m / 3 h" and "need 26 m/day" wrap mid-value. This should be solved together with the planned play-button move (see IDEAS.md).
6. **Start dialog resets while open (minor, likely).** Its form resets whenever `nodes`, `settings` or `routine` change, so a background refetch can wipe what the user picked.
7. **"Until a time" can silently mean tomorrow (minor).** If the chosen time has already passed, even by seconds, the session runs until that time tomorrow. The hint does say "23 h 59 min from now", but a clearer warning would help.

## UI fixes

- Units are inconsistent: "0 min" in the stat strip, "30 m" in the plan, "m/day" on tasks. Pick one style, probably "30 min" and "1 h 30 min".
- New-user dashboard: the stat strip shows 0 min, 0%, 0 days and the heatmap says "0 h across 0 days." That goes against the "never show a discouraging zero" rule used on Analytics. Show a friendly first-run message there instead.
- The plan says "About 30 m … today" while the same task says "need 26 m/day". The rounding differs and looks like two different answers.
- On desktop, task actions only appear on hover, which hides that you can start a session from a task. The planned always-visible play button fixes that.
- The stat strip text is low contrast while its entrance animation runs over vivid backgrounds. It's worth checking once the animation settles on the brightest backgrounds.

## Quality of life

- Keyboard shortcuts: Space to pause or resume on the focus screen, N for a new task, S to start.
- Quick "start again" on the last task from the dashboard (running app: "repeat this run").
- Browser notification when a break ends, if the focus tab isn't in front.
- Remember the last session style and length in the start dialog instead of resetting to Pomodoro and Unlimited each time.
- Drag to reorder tasks and courses.
- Undo toast after deleting a task, not just Ctrl+Z.

## Feature ideas (running-app inspired)

- **Personal bests:** longest focus, best week, longest streak, shown as "new PB" in the session summary.
- **Splits:** a session summary showing each pomodoro block, like run splits.
- **Compare to last time:** "12 min more than your last session on ECO220".
- **Weekly and monthly goals with a ring,** which already exists in part. Add a monthly distance-style goal.
- **Training-plan style schedule** before an exam: "8 sessions over 2 weeks" generated from the estimate and due date.
- Timelapse recorder and friends (see IDEAS.md).

## Before a private beta

Must have:
- **Commit and back up the code.** There are 107 uncommitted files on top of `eefcc28`, and the repo has no remote. A disk failure would lose weeks of work. Push to a private GitHub repo.
- **Real auth and hosting.** Supabase project (magic link plus Google), a hosted Postgres, the API deployed somewhere (Fly, Render, Railway), and the portal on a real domain with HTTPS. Dev sign-in mints tokens in the browser and must be off in any shared build.
- **Fix bugs 1–4 above.** Double XP and auto-logout are the kind of thing beta testers notice right away.
- **Extension built for the real domain.** The portal and API URLs are baked in at build time. Publish it as an unlisted Chrome Web Store item, or hand out a zip with install steps.
- **Privacy policy and terms.** Even a short page. Needed for Google sign-in, Google Calendar verification (sensitive scopes need Google's app review, or testers must be added as test users), and the Chrome Web Store.
- **Account deletion should also delete the Supabase sign-in.** `DELETE /api/me` removes the app data only. The data export already exists.
- **Error reporting** (Sentry or similar) for the portal, API and extension, so you hear about crashes you didn't see.
- **A feedback button** in the app (a form or mailto) so testers can report issues where they happen.
- **Database backups** on the hosted Postgres (Supabase has daily backups on paid plans; check what the free tier gives).

Should have:
- Rate limiting on the API (`@fastify/rate-limit`), especially on uploads (8 MB body limit) and the ICS import.
- Check that the JWT `aud` claim is "authenticated" in the Supabase verifier.
- A short onboarding check on a phone, since many students will open it there first.
- Basic usage analytics (privacy-friendly, e.g. Plausible or PostHog with no personal data) to see which features testers actually use.
- A known-issues list to share with testers.
