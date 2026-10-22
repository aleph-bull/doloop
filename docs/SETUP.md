# Setup: what you need to provide

Everything the build needs from you, grouped by the phase that first needs it. Nothing here is needed for Phases 0, 1, or the credential-free parts of 3, 4, 5, 7, 8, 9.

## Local machine (done)

- Node 22+ (you have 24), pnpm 12 (installed via `npm i -g pnpm`), git.
- No Docker or local Postgres needed. Supabase hosts the database.

### Local test accounts

Run `pnpm sandbox:test:api` and `pnpm sandbox:test:portal` in separate terminals.
Open `http://127.0.0.1:5184/`. Signed-out visitors go to sign in; `/signup` creates an
account and `/signin` signs in.

Expand **Local test accounts** on the sign-in or signup page:

| Account    | Email                     | Password         |
| ---------- | ------------------------- | ---------------- |
| Onboarding | `onboarding@komodon.test` | `Onboarding123!` |
| Admin      | `admin@komodon.test`      | `Admin123!`      |

**Reset and start onboarding** clears only that test account and signs in fresh.
The admin account is already set up and opens `/admin`. Both test accounts are marked
in the database and excluded from the leaderboard. Configured admin accounts are on it
like anyone else. Personal study records still work for testing.

These credentials are intentionally public, local test fixtures. The dedicated API
script binds to loopback and stores data in `apps/api/.pglite-sandbox-testing`, never
the owner's live data. `LOCAL_TEST_ACCOUNTS` defaults to false; enabling it is refused
in production, with a remote database, with a non-loopback host or outside an isolated
`.pglite-sandbox*` directory. Test-account requests also require a loopback connection,
hostname and (when sent) origin. They do not grant access to hosted accounts.

## Verification emails and password reset (Resend)

The API's password signup sends a six-digit email code before creating an account.
Codes expire after ten minutes and allow five guesses. Password reset uses the same
plain-text mailer and signs out existing sessions after a successful reset. Existing
accounts can verify their account email from Social without repeating onboarding.

1. Create a Resend account and add **komogon.app** under Domains. Add the exact SPF
   and DKIM DNS records shown there, then wait until Resend marks the domain verified.
   Keep existing mail records; use Resend's indicated sending subdomain for SPF.
2. Create a sending API key and configure it privately on the **API server**:

   ```dotenv
   RESEND_API_KEY=<private sending key>
   MAIL_FROM=Komodon <noreply@komogon.app>
   ```

   Never put the key in a `VITE_` variable, source control or the portal. The sender
   defaults to this address. Resend's shared trial sender cannot mail arbitrary users.

3. Deploy the API with migration `0016_email_verification_social.sql` (the normal API
   startup applies pending migrations), then test signup and Forgot password with an
   inbox you control. Emails contain only the code, its purpose, expiry and an ignore
   notice. No HTML template, images or tracking links are added.

Resend's free plan currently allows 3,000 emails per month, up to 100 per day. The API
caps code requests at 95 sends per rolling day across purposes, plus recipient/IP
limits, to leave a little room under the daily allowance. Other senders using the same
Resend account consume that allowance too. Monitor provider usage before increasing
the limit. See [Resend pricing](https://resend.com/pricing) and
[domain verification](https://resend.com/docs/dashboard/domains/introduction).

Without a mailer configured, hosted signup and code requests return an unavailable
message. Existing users can still sign in. Supabase sign-in, when enabled, continues
to use Supabase's own account confirmation and recovery settings.

For local testing, run `pnpm sandbox:test:api` and `pnpm sandbox:test:portal`, then open
`http://127.0.0.1:5184`. The isolated localhost test mode captures messages in memory;
**Local test email** on the signup, reset and Social forms shows the latest code.
Use any throwaway email for signup, and a school/work-style email for organization
verification. No real email is sent. Codes and messages disappear from the local inbox
when the API restarts. The two seeded test accounts can still sign in directly.

## Social profiles

Social is available from the main navigation. A profile has a name, school/organization
label and a separate verified school/work email. This address does not change the
sign-in email, password recovery address, or Google/Outlook calendar connections.
Common personal email providers are rejected for organization verification.

The badge confirms access to an email domain, not an official school name or role.
Profiles are private by default. People can explicitly share their name and organization
with others who verified the exact same domain. Directory responses omit email addresses
and study data. Removing or replacing the organization verification hides the profile
until sharing is enabled again. Test accounts are excluded from the directory and
leaderboard. No invitations or messages are sent to other people.

## Phase 2: Supabase project

1. Create a project at https://supabase.com/dashboard (free tier is fine). Region close to you.
2. From **Project settings > API** copy into `apps/api/.env` and `apps/portal/.env`:
   - `SUPABASE_URL` / `VITE_SUPABASE_URL`
   - `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (API only, never in the portal)
   - `SUPABASE_JWT_SECRET` (API only) from **Project settings > API > JWT settings**
3. From **Project settings > Database > Connection string** copy the **Transaction pooler** URI into `DATABASE_URL` (API only).
4. In **Authentication > Providers**, Email is on by default. Magic link needs no extra setup. Turn **Confirm email** off if you want the first sign-in to be one click.
5. In **Authentication > URL configuration** set Site URL to `http://localhost:5173` and add `http://localhost:5173/auth/callback` to Redirect URLs.

## Phase 2: Google sign-in (optional until you want it)

1. In https://console.cloud.google.com create a project, then **APIs & Services > OAuth consent screen** (External, add yourself as a test user).
2. **Credentials > Create credentials > OAuth client ID > Web application**. Add these redirect URIs:
   - `https://<your-project-ref>.supabase.co/auth/v1/callback` (for sign-in)
   - `http://localhost:8787/api/calendar/google/callback` (for calendar consent, Phase 6)
3. Paste the client ID and secret into Supabase **Authentication > Providers > Google**, and into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `apps/api/.env`.

## Phase 6: Google Calendar

1. Same Google Cloud project: **APIs & Services > Library > Google Calendar API > Enable**.
2. On the consent screen add scopes `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar.readonly`.
3. Generate `TOKEN_ENCRYPTION_KEY` (32 random bytes as hex) for `apps/api/.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Automatic course and deadline imports (Google and Outlook)

In Settings > Calendar, connect either or both providers. Imports run immediately on
connection, on Sync now, and about every 15 minutes while the API is running. The portal
refreshes imported data within a minute of a completed background sync. A sleeping or
offline API catches up when it starts again.

Google reads all accessible calendars except Komodon's dedicated Study calendar. It
keeps the existing two-way Study calendar sync. Existing connections already have the
calendar.readonly permission; no additional scope is needed.

For Outlook:

1. Register an application in Microsoft Entra > App registrations. To support both school
   and personal accounts, choose accounts in any organizational directory and personal
   Microsoft accounts.
2. Add a **Web** redirect URI: `http://localhost:8787/api/calendar/outlook/callback`
   locally, or `https://<your-api-host>/api/calendar/outlook/callback` when hosted.
3. Add Microsoft Graph delegated `Calendars.Read` permission and create a client secret.
   Some school organizations require their administrator to approve calendar consent.
4. Set `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_REDIRECT_URI` and
   `TOKEN_ENCRYPTION_KEY` on the API. `OUTLOOK_TENANT` defaults to `common`; use a tenant
   ID to restrict it to one organization. Never put client secrets or the encryption key
   in Vite variables. Outlook imports are read-only and require offline access for refresh.

Both providers expand recurring events and follow all result pages over a rolling window
of 30 days back and 180 days ahead. Existing course names, course codes such as CSC108H1
or MATH 101, and titles such as `Calculus: lecture` identify courses. Midterm, exam, final,
quiz and test identify assessments. Due, deadline, assignment, homework, problem set,
submission, essay, project and paper identify tasks. Unrecognized course names need a
matching course in Tasks first; an ambiguous event stays ungrouped. Ordinary appointments
remain commitments and never count as study time. A timed assessment or deadline uses
the event's start; a date-only deadline uses the end of that day in the account timezone.
Date-only academic items appear in the calendar's due row and do not reserve a full day
as a study block or commitment.

Repeated imports retain provider/calendar/event identity. Matching course and task names
are reused, including mirrored tasks across providers. Calendar changes update untouched
titles and deadlines; manual edits, completed work and deleted tasks are preserved.
An event removed from a successfully fetched window cancels its commitment and archives
its untouched imported task. Disconnecting keeps imported data and stops future imports.
Refresh tokens are encrypted at rest and excluded from exports.

Provider references: [Google event listing](https://developers.google.com/workspace/calendar/api/v3/reference/events/list),
[Microsoft calendar views](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0)
and [Microsoft OAuth authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

## Phase 4: Chrome extension

- Chrome (or any Chromium browser). Load `apps/extension/dist` via `chrome://extensions` > Developer mode > Load unpacked. Nothing else to provide.

## Optional

- A GitHub remote if you want CI to run. The workflow in `.github/workflows/ci.yml` runs `pnpm check` on push.
- Deployment targets are out of scope until you pick them (portal: any static host; API: any Node host such as Fly, Railway, or Render).

## Running without any credentials (dev mode)

Set these in `apps/api/.env` and the whole stack runs locally with an in-memory database and locally minted tokens:

```
DEV_AUTH_SECRET=any-long-random-string
```

Leave `SUPABASE_URL` and `DATABASE_URL` empty. Data is lost when the API restarts. The portal's dev sign-in page mints a token for you when `VITE_DEV_AUTH_SECRET` matches.
