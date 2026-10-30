# Komodon homepage

The marketing site for Komodon, beside the portal in this repo. Plain HTML and CSS,
served and built with Vite.

```bash
pnpm install
pnpm dev        # http://localhost:5190
pnpm build      # static output in dist/
```

## Page

- `index.html` and `src/styles.css`: the app's default photograph (Cotton Candy, frostroomhead
  on Pexels) runs edge to edge behind the hero and fades out at the bottom into a light
  gradient page. One of the owner's timelapses (`clips/slides-review.mp4`, their 10-22
  session, 2x speed) plays on a CSS laptop, and the dashboard (`today-phone`) is on a phone
  hanging in front of it. Every phone on the page is the owner's iPhone (`.device`: a
  screenshot or recording under `public/phone-frame.webp`, cut out of their mockup by
  `scripts/cut-phone.mjs`); phone shots are taken at 393 x 852, an iPhone 14 Pro's screen,
  with its safe areas. Below the hero the page is ruled (hairlines down the sides of the
  content and across between sections, like aside.com).
- **A walkthrough** (the owner, 2026-10-29): one session start to finish, then the week.
  "Make the site feel interactive but not intimidating": each step is a heading, a short line
  and one real moving view of the app, and nothing shows twice.
  - **Start** (`#start`): a screen recording (`clips/focus-start.mp4`): Start a session, the
    task, Pomodoro, the focus screen counting down.
  - **Record** (`#timelapse`): a dusk interlude, pinned: Cotton Candy under a dark plum wash.
    Seven timelapses float down on either side of "See what you got done." with the app's
    Recording pill. `fallScene` in `main.js` moves them: each drifts toward where the scroll
    puts it a beat behind and sways and tilts a little on its own, so they float rather than
    slide. The way in and out is three blurred waves (ink, plum, a rose bloom) drifting
    sideways in the band's margins (`.fall-edge`), not a straight fade.
  - **Share** (`#social`): five phones in a row (`.phones`: groups, jams, the feed in the
    middle, the leaderboard, a profile), each in another theme and each playing a recording
    of its screen scrolling. `phoneRow` in `main.js` moves them on springs: they fan out from
    a stack as the row comes in, the row leans toward the pointer, each floats a little, and
    the one pointed at rises while its neighbours lean away. On a phone they're a strip to
    swipe, the one in the middle biggest. Each opens the slideshow (`#features`, a
    `<dialog>` of stills) at its own slide.
  - **Plan** (`#plan`): Plan my week in a window (`clips/plan-week.mp4`), with the phone's
    day view (`cal-phone`) in front of its corner.
  - **Track** (`#track`): Analytics opening and scrolling down to the streaks
    (`clips/analytics-scroll.mp4`).
  - **Earn** (`#xp`): Achievements, buying a streak freeze, then RNG Rolls
    (`clips/xp-buy.mp4`). Keep its words true to the app if the shop changes.
  - **Make it yours** (`#looks`): pinned. Sixteen screens in other photos, colours, themes
    and panels on the inside of a drum, small across the middle and large at the sides. They
    fan out from the middle; the drum then turns on its own while it's on screen, and
    scrolling gives it a push that eases off. The last line's word scrambles through calm,
    bright, cozy.
- Each recording sits in a plain `.window` and plays only while it's on screen. A quiet
  button in its corner (on hover, always on touch screens) pauses it, and a paused one stays
  paused when it scrolls back in.
- **Where you are** (`.progress`): on a computer at least 1100 x 600, the seven steps down
  the left on a line that fills as the page scrolls, the one on screen lit. It shows only
  between the first step and the closing. The names show at 1400px wide and up (below that,
  dots that name themselves when pointed at), and fade over the dusk band so they don't sit
  on the clips drifting past.
- **On a phone the page is flat** (the owner, 2026-10-28): under 641px wide, or under 501px
  tall (a phone held sideways), `main.js` leaves the scenes off and the CSS under the same
  query lays each section out as its words, then its pictures: four clips in a grid on the
  dusk, the phones a strip to swipe, the recordings full width, six looks in a grid. A
  window dragged across the line switches as it goes (`apply` in `main.js` stops each scene
  and clears what it wrote).
- `.rail` is `box-sizing: border-box`. Without it every padded rail was its width plus its
  padding, so on any window under about 1330px it ran past the right edge and sat off
  centre.
- **The docs are off for now** (the owner, 2026-10-22): `docs/index.html` isn't built, `/docs`
  redirects home (`vercel.json`), and nothing links to it. Everything is kept; the comment in
  `vite.config.js` says how to turn it back on.
- **Docs** at `/docs/` and the **changelog** at `/changelog/`, each its own page in the Vite
  build (`docs/index.html`, `changelog/index.html`) sharing `src/docs.css` and
  `src/docs.js`. Their text lives in `src/content/docs.html` and `src/content/changelog.html`
  and is sealed at build time (the `?sealed` import in `vite.config.js`, opened by
  `src/sealed.js`), so the pages and scripts never hold it as readable text for bots that only
  fetch. `public/robots.txt` asks AI crawlers and chat assistants to keep out of both,
  `vercel.json` adds `X-Robots-Tag: noai`, select-all is off and a copy takes 400
  characters at most. The search filters topics as you type (`/` focuses it, `?q=` links to
  a search). The docs say what things do and where they are, not the formulas or thresholds
  behind them (the owner didn't want them to be a blueprint). The changelog is one entry per
  day, written from the commits, and only changes when the owner asks. It shows only the last
  three days (counted from the reader's today; `maxAgeDays` in `src/changelog-page.js`):
  older days stay in the content file and in the sidebar, greyed, and their links do nothing.
- `src/main.js`: the entrance motion, the two scroll scenes, the phone row, the clips and the
  rail. Each `[data-scrub]` element gets `--p` (0 to 1 while pinned) and `--enter`;
  everything moves by transform and opacity. With reduced motion (or without the script)
  nothing pins and the scenes lay out flat: the timelapses and the looks as grids, the
  recordings on their posters with controls.
- `public/fonts`: Satoshi for headings and the wordmark. Inter loads from rsms.me like the app.
- `public/shots`: screenshots of the portal from a seeded sandbox account (Jerry): the hero's
  phone, the calendar phone, the slideshow's five phones, and `looks/`, the drum's sixteen.
  Replacing a file with the same name is all the page needs; a new crop's shape goes in its
  `width`/`height` in `index.html`.
- `public/clips`: the recordings (below), and ten-second timelapses, 720 px wide, H.264 with no sound (about 1 MB each),
  each with a webp poster from 3 s in; `main.js` plays them only while they're on screen.
  `afternoon`, `late-night`, `long-day` and `first-week` are the owner's own. `desk`,
  `essay` and `solo` were made from study-with-me videos and Word and Excel screen
  recordings the owner downloaded from YouTube: cut, sped up, and drawn frame by frame with
  the portal's own `composeFrame` (camera behind, the screen in its box, the clocks, the
  task, the progress bar and the mark), so they look exactly like Komodon's. They are other
  people's footage: check the rights before the site goes live, or swap them for the owner's.

## Retaking the screenshots

1. Seed a sandbox with Jerry and six friends (Zachary posts the timelapses): in `../api`,
   with that sandbox's API stopped,
   `SEED_DATA=.pglite-sandbox-<name> SEED_MEDIA_DIR=<folder> npx tsx seed-site-layout.tmp.ts`
   (an untracked seed; `<folder>` holds `v1.mp4`..`v3.mp4` and `v*-poster.jpg`, which can be
   copies of `public/clips`, so the feed has timelapse posts). It also adds Jerry's class
   timetable as a calendar link, which Plan my week plans around.
2. Start the sandbox API and portal for that data folder. `scripts/capture-lib.mjs` expects
   the portal on 5302 and the API on 8902; change `PORTAL`, `API` and `APP` there to match.
3. Install `playwright-core` and `jose` in a scratch folder, then run
   `CAPTURE_DEPS=<that folder> node scripts/capture.mjs` (names as arguments retake just
   those, e.g. `feed focus-break`). It drives the
   installed Chrome headless, signs in with a dev token, turns off tips and the focus screen's
   prompts, and writes PNGs to `scripts/out` (or `SHOTS_OUT`). `CAMERA_PHOTO` (a photo of a
   desk) feeds a fake camera for the phone's camera screen. The calendar shots click Plan my
   week (and Add all for `cal-added`, whose blocks are deleted again afterwards). The looks change Jerry's theme
   and put it back; the focus shots start real sessions, and the break waits out a
   one-minute Pomodoro, so a full run takes about four minutes.
4. `scripts/convert.mjs` turns the PNGs into the webp files in `public/shots`, with the crops
   for the social cards. It needs `sharp` (a root devDependency).

## Retaking the recordings

The recordings are frame-stepped, not screen-captured: the page's clock is replaced and its
animations stopped, and each frame is one screenshot exactly 1/30 s after the last, so a
slow software-drawn Chrome still makes a smooth video (`scripts/record-lib.mjs`). They run
against the same seeded sandbox as the screenshots.

- `scripts/record-focus.mjs`: `focus-start`. It starts and ends one real Pomodoro.
- `scripts/record-takes.mjs [take ...]`: `plan-week`, `analytics-scroll`, `xp-buy` (computer,
  1600 x 1000) and `phone-feed`, `phone-groups`, `phone-jams`, `phone-board`,
  `phone-profile` (786 x 1704); every take when none is named. Each sets its own look and
  puts Jerry's theme back. `xp-buy` buys a real streak freeze, so with two held already run
  it with `REHEARSE=1`, which answers the purchase in the browser.

Both need `CAPTURE_DEPS` (as above) and `FFMPEG`, an ffmpeg with `h264_nvenc`. They write
`public/clips/<name>.mp4` and its webp poster (`CLIPS_OUT` for a trial run elsewhere), and
keep the frames in `scripts/out/<name>-frames` for checking.
