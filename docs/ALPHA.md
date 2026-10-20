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
app only runs on this computer with dev sign-in. Hosting setup is under "Hosting it" below, and the wider list in [BETA-REVIEW.md](BETA-REVIEW.md) under "Before a private beta".

## Hosting it (closed alpha)

The portal goes on **Vercel**, the API on **Render**, data and sign-in on a new **Supabase**
project. All three have free tiers that cover a handful of testers. The repo already holds
the config: `apps/portal/vercel.json` and `render.yaml`. What is left needs your accounts.

**1. Push the code.** Commit, then push `main` to the GitHub remote (`origin`). Vercel and
Render deploy from it, and every later push redeploys both.

**2. Supabase** (a new project just for the alpha, so your own data stays on this computer;
the IB plan and everything else in `~/.komogon` never leaves it)

- New project, region close to you. Note the project URL and the anon key (Project
  settings › API), the JWT secret (JWT keys), and the **Session pooler** connection string
  (Connect › Session pooler; the direct one is IPv6-only and Render can't reach it).
- Authentication › Sign In / Providers: turn **off "Allow new users to sign up"**. Only
  people you invite can then sign in, by magic link or Google.
- Authentication › URL configuration: Site URL = the Vercel address (step 4); add
  `https://<vercel address>/auth/callback` to Redirect URLs. Fill these in after step 4.
- Authentication › Users › **Invite user** for each tester. They get an email, and the link
  signs them straight in.
- Supabase's built-in email sends only a few messages an hour. That's fine for three
  testers. For more, add your own SMTP (Resend's free tier works) under Authentication ›
  Emails.

**3. Render** (the API)

- New › Blueprint › pick the repo. It reads `render.yaml` and asks for: `SUPABASE_URL`,
  `SUPABASE_JWT_SECRET`, `DATABASE_URL` (the session pooler string), `CORS_ORIGINS` and
  `PORTAL_URL` (both the Vercel address, no trailing slash) and `ALLOWED_EMAILS` (the
  testers' emails, comma separated, as a second lock behind Supabase).
- The first start creates the tables. `https://<api>.onrender.com/api/health` should
  answer `{"ok":true}`.
- The free plan sleeps after 15 idle minutes, and the next visit then waits about a minute.
  To keep it awake, have cron-job.org (free) open the health URL every 10 minutes. One
  always-on service fits inside Render's free monthly hours.

**4. Vercel** (the portal)

- Add New › Project › import the repo. Set **Root Directory to `apps/portal`** and leave
  the build settings alone (`vercel.json` sets them).
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`
  (the Render address), and optionally `VITE_FEEDBACK_URL` and `VITE_SENTRY_DSN` (step 5).
  Never set `VITE_DEV_AUTH_SECRET` here.
- Deploy, then go back and put the Vercel address into Render (`CORS_ORIGINS`,
  `PORTAL_URL`) and Supabase (URL configuration).
- Google sign-in (optional): the new Supabase project has its own callback URI, shown under
  Authentication › Providers › Google. Add it to the OAuth client's redirect URIs in Google
  Cloud, and paste the client ID and secret into that provider.

**5. Feedback and errors** (optional, both off until set)

- Make a short **Tally** form (the questions in section 4 below) and put its link in
  `VITE_FEEDBACK_URL`. A "Send feedback" icon then appears in the top bar.
- Make a **Sentry** project (platform: React) and put its DSN in `VITE_SENTRY_DSN`. Crashes
  and page errors are then reported. Errors only: no session replay, no tracing.

**6. Check it.** Copy the hosted values into `apps/api/.env.alpha` and
`apps/portal/.env.alpha` (git ignores them, and unlike `.env.production` the local build
never reads them), then run `pnpm alpha:check`. Then do the manual pass below on the
Vercel address.

**Installing it.** The portal is an installable web app (manifest and service worker, on the
hosted address only). Tell testers:

- iPhone: open the link in Safari › Share › Add to Home Screen.
- Android: open it in Chrome › menu › Install app.
- Computer: Chrome or Edge › the install icon at the right of the address bar.

It then opens in its own window with the Komogon icon, and it still opens without a
connection, showing the last data it had.

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

- the link, how to install it (above), and a note that it is an early alpha: their data could be reset
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
