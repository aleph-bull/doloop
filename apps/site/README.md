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
  gradient page. One of the owner's timelapses (`clips/morning-exam.mp4`, their 10-23
  morning before an exam, 2x speed, its first 5 s cut at their word) plays on a CSS laptop, and the dashboard (`today-phone`)
  is on a phone hanging in front of it. Two real pieces of the app sit tilted at the hero's
  sides like stickers (`sticker-live`, Live now from the feed; `sticker-week`, the week's
  hours from Analytics; nothing about the rolls, at the owner's word), from 1300px wide,
  floating and leaning away from the pointer. Every phone on the page is the owner's iPhone
  (`.device`: a screenshot or recording under `public/phone-frame.webp`, cut out of their
  mockup by `scripts/cut-phone.mjs`); phone shots are taken at 393 x 852, an iPhone 14 Pro's
  screen, with its safe areas. Below the hero the page is ruled (hairlines down the sides of
  the content and across between sections, like aside.com). The words are the owner's own
  (2026-10-30).
- **Short and calm** (the owner, 2026-10-30: the long scroll made the app look like more than
  it is; "make the site feel fluid beautiful and professional"; earlier, 10-29: "make the
  site feel interactive but not intimidating"). About seven screens on a computer, one of
  them the pinned timelapses; nothing shows twice.
  - **Record** (`#timelapse`): a dusk band: Cotton Candy under a dark plum wash, pinned for a
    screen of scrolling. Seven timelapses fall past "See what you got done." with the app's
    Recording pill, fading in and out at the stage's top and bottom rather than being cut off
    by its edge. `fallScene` in `main.js` moves them: each drifts toward where the scroll puts
    it a beat behind and sways and tilts on its own. The way in and out is three blurred waves
    (ink, plum, a rose bloom) drifting sideways in the band's margins (`.fall-edge`).
  - **On your phone** (`#phone`): a hand of five phones (`.phones`: Pomodoro, Tasks and
    courses, the feed in the middle, Jams and groups, Streaks and profile), each in another
    theme and each a still of its screen, with clouds drifting behind (`.sky`). `phoneRow` in
    `main.js` moves them on springs: they fan out from a stack as the row comes in, the row
    leans toward the pointer, and the one pointed at rises. Picking one (the owner: "like a
    hand of cards", not a popup) puts `data-picked` on the rail: it moves left, grows and
    plays its screen, its words come out beside it (`.hand-text`), and the rest drop to the
    foot of the rail like cards held low, cut off by it, the one pointed at peeking up.
    Another phone swaps; the X or Escape fans them out again and stills them. On a phone the
    row is a strip to swipe and the words show under it. Only the phones take the pointer:
    an item's own box stays where its phone stood at rest.
  - **The app** (`#app`): Start, Plan, Track and Earn as plain pill tabs over one window, the
    picked one in its part's colour. Each part's words are on a card in its colour
    (Elespacio-like, with a paperclip), beside a real recording (`focus-start`, `plan-week`,
    `analytics-scroll`, `xp-buy`); the calendar's phone joins Plan. Each recording plays
    through and the next tab comes up by itself while the window is on screen, the picked tab
    filling along its foot; the tabs and the card's button pick one by hand, and the window's
    pause holds it. Keep Earn's words true to the app if the shop changes.
  - **Make it yours** (`#looks`): a deep night-to-violet card, not pinned (the owner took
    its pin off). Sixteen screens in other photos, colours, themes and panels turn across it
    on the inside of a drum, fanning out as the card comes up and pushed by the scroll; it
    can be dragged round with the mouse and thrown (touch drags sideways, so the page still
    scrolls). What can be changed sits as chips bobbing around the heading (in a row under it
    below 1024px). The last line names calm, bright and cozy, and marks each in turn like a
    highlighter every few seconds.
  - **The closing**: a card of sky, blue into the page's lilac, with mist along its foot.
- **The clouds** (`public/sky`): made the way the app's audio visualizer makes its cloud
  mist (`packages/ui/src/mist-texture.ts` on core's `cloudNoise`), drawn once by a script
  with the same noise and shading. Behind the phones, single clouds (`cloud-*`, the bank
  gathered into an oval) drift across (`.sky`); along the sky card's foot, two banks tile
  sideways (`.mist`, `mist-*`), the back one wider, fainter and slower, over a faint bank of
  light.
- **On a phone the page is flat** (the owner, 2026-10-28): under 641px wide, or under 501px
  tall (a phone held sideways), `main.js` leaves the scenes off and the CSS under the same
  query lays each section out as its words, then its pictures: four clips in a grid on the
  dusk, six looks in a grid on the card. A window dragged across the line switches as it
  goes (`apply` in `main.js` stops each scene and clears what it wrote).
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
- `src/main.js`: the entrance motion, the stickers, the two pinned scenes (`[data-scrub]`,
  told how far each has come up the screen, through it and through its pin), the hand of
  phones and the app's tabs; everything moves by transform and opacity. With reduced motion
  (or without the script) nothing pins and the scenes lay out flat: the timelapses and the
  looks as grids, the app's recording on its poster with controls, a picked phone's words
  under the row.
- `public/fonts`: Satoshi for headings and the wordmark. Inter loads from rsms.me like the app.
- `public/shots`: screenshots of the portal from a seeded sandbox account (Jerry): the hero's
  phone and stickers, the calendar phone, and `looks/`, the drum's sixteen.
  Replacing a file with the same name is all the page needs; a new crop's shape goes in its
  `width`/`height` in `index.html`.
- `public/clips`: the recordings (below), and ten-second timelapses, 720 px wide, H.264 with
  no sound (about 1 MB each),
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
  1600 x 1000) and the hand's `phone-pomodoro`, `phone-tasks`, `phone-feed`,
  `phone-together`, `phone-profile` (786 x 1704); every take when none is named. (It also
  still has `phone-groups`, `phone-jams` and `phone-board`, which the page no longer uses.)
  Each sets its own look and puts Jerry's theme back. `xp-buy` buys a real streak freeze, so
  with two held already run it with `REHEARSE=1`, which answers the purchase in the browser.
  `phone-pomodoro` starts and ends real sessions; `phone-tasks` tags a few tasks if Jerry has
  no tags.

Both need `CAPTURE_DEPS` (as above) and `FFMPEG`, an ffmpeg with `h264_nvenc`. They write
`public/clips/<name>.mp4` and its webp poster (`CLIPS_OUT` for a trial run elsewhere), and
keep the frames in `scripts/out/<name>-frames` for checking.
