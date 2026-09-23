# Setup: what you need to provide

Everything the build needs from you, grouped by the phase that first needs it. Nothing here is needed for Phases 0, 1, or the credential-free parts of 3, 4, 5, 7, 8, 9.

## Local machine (done)

- Node 22+ (you have 24), pnpm 12 (installed via `npm i -g pnpm`), git.
- No Docker or local Postgres needed. Supabase hosts the database.

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

## Focus screen: Spotify (optional)

The focus screen can show what you are listening to, with play, pause and skip on Premium.

1. Create an app at https://developer.spotify.com/dashboard (any name; Web API).
2. Add `http://localhost:8787/api/spotify/callback` as a redirect URI.
3. Put the client ID and secret into `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` in
   `apps/api/.env`. `TOKEN_ENCRYPTION_KEY` (above) is needed too; the tokens are stored
   encrypted with it.
4. Restart the API. "Connect Spotify" then appears on the focus screen and in
   Settings > Focus screen. Without the credentials the option is simply absent.

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
