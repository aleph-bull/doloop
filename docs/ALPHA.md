# Small alpha release

A first release to a couple of people, to learn what confuses them, what breaks, and what they
actually use. This is the test to pass before sending it, and the kit to send with it.

## 1. Automated test

```
pnpm alpha:check
```

Runs everything in order and stops at the first failure:

1. **Lint, types, unit and API tests, contrast audit, build** (`pnpm check`). The tests include
   the **alpha journey** (`apps/api/src/test/alpha-journey.test.ts`): a new tester's first
   sitting, end to end through the real API. It covers signing in, onboarding, a course, task
   and test, a 50-minute session paying XP, streak and badges, a reward unlocked by the test,
   a grade, settings within their limits, the week in Analytics, data export, and account
   deletion.
2. **Preflight** (`scripts/alpha-preflight.mjs`, also `pnpm alpha:preflight` on its own):
   checks how the build is configured and whether the code is safe, and exits non-zero on any
   blocker. It reads `apps/api` and `apps/portal` `.env.production` (or `.env`) and reports by
   key name, never printing a value. Blockers:
   - dev sign-in still on (`DEV_AUTH_SECRET` / `VITE_DEV_AUTH_SECRET`): anyone could sign in as
     anyone
   - no real sign-in (Supabase keys)
   - no hosted database (`DATABASE_URL`)
   - the portal pointing at this computer (`VITE_API_URL`), or the API refusing the hosted
     portal (`CORS_ORIGINS`)
   - no git remote

As of 2026-10-18 the checks pass and the preflight reports 7 blockers, all about hosting: the
app only runs on this computer with dev sign-in. Hosting setup is in [SETUP.md](SETUP.md)
(Phase 2) and the wider list in [BETA-REVIEW.md](BETA-REVIEW.md) under "Before a private beta".

## 2. Manual pass (about 30 minutes, on the hosted build)

Do this on the build testers will get, signed in as a brand-new account, in Chrome and once
on a phone. Tick each line; anything that fails goes on the known-issues list or gets fixed.

**First run**

- [ ] Sign in with the real sign-in (magic link or Google), not dev sign-in.
- [ ] Onboarding: name, a course, the first thing due. Lands on the dashboard.
- [ ] Reload the page: still signed in, nothing lost.

**Studying**

- [ ] Start a session from the dashboard, from Tasks (play button) and from a routine.
- [ ] The search in Start a session finds a task by name.
- [ ] A Pomodoro runs into its break and back; the sound plays at a sensible volume.
- [ ] Hide and show the clock on the focus screen (smooth, nothing jumps).
- [ ] End with the review; the summary shows XP, streak and any badge, with the badge's XP.
- [ ] Close the tab mid-session and come back: the session is still running.

**Timelapse** (needs a camera)

- [ ] Record a short session with "Record breaks too" on; the video has the clock, the break
      label and the Komogon watermark, and is the length it says.
- [ ] The camera picture is not dark.

**Planning and progress**

- [ ] Tasks: add, tick, reorder; counts and times line up.
- [ ] Grades: enter a mark; the target and average pills update.
- [ ] Analytics: the week shows the session; "Show as a table" swaps in place.
- [ ] Achievements: rewards first, badges folded at the bottom; a locked background in
      Settings leads here and lights up.

**Settings**

- [ ] Theme, accent (built-in and your own), solid colour, uploaded image.
- [ ] Save a look, change things, apply the look: it all comes back, image included.
- [ ] Streak day start can be changed once, then says when it can change again.
- [ ] Export my data downloads a file; Delete account signs out and removes everything.

**Phone** (narrow screen)

- [ ] Sign in, start and end a session, read the dashboard. Nothing cut off or unusable.

## 3. Sending it

Who: two or three people who study and will say what they think: ideally one who uses a
Pomodoro app already and one who doesn't.

Send them:

- the link, and a note that it is an early alpha: their data could be reset
- what to try in the first week: plan one course in Tasks, do at least three sessions, look
  at Analytics at the end of the week
- the Chrome extension, if it's ready for the hosted address (unlisted Web Store item or a
  zip with install steps)
- how to reach you, and the questions below

Keep a short known-issues list and send it with the link, so testers don't spend their time
reporting what you already know.

## 4. Feedback to ask for

After a few days, and again after a week:

1. What did you use it for, and what did you stop using?
2. Where did you get stuck or confused? (the first ten minutes especially)
3. Did anything break, look wrong, or lose your data?
4. Which part made you want to open it again? Which part felt like a chore?
5. Was anything missing that would make you use it every day?
6. On a scale of 1–10, how likely are you to keep using it? What would move that up by one?

Log each answer in [IDEAS.md](IDEAS.md) or as a bug, with who said it and when.
