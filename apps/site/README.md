# Komogon homepage

The marketing site for Komogon, beside the portal in this repo. Plain HTML and CSS,
served and built with Vite.

```bash
pnpm install
pnpm dev        # http://localhost:5190
pnpm build      # static output in dist/
```

## Page

The design decisions behind the page as it is now, with the owner's reasons and what was turned
down, are in [DESIGN.md](DESIGN.md). Read it before changing how the page looks or moves.

- **2026-11-02 evening, pushed: one sky through a study day.** The
  owner's overhaul brief, built around everything they had chosen. The page is one continuous
  sky: the hero's photo fades into night (`.record`, the timelapses), sunrise into paper
  (`.dawn`, the phones, with the clouds), daylight (`.day`, the app), dusk into an indigo night
  (`.evening`, the looks) and a morning sky (`.morning`, the closing, mist along its foot, the
  footer on the mist). Each part's sky is a gradient sized in `vh` at its top (`--dawn`,
  `--dusk`), so it doesn't stretch with the part's content; `--grain` (an SVG noise tile) lies
  over it. The header reads its tone from `data-tone` on each part and the `.tone-mark`s where a
  part's sky turns (`siteHeader`). The hero shows the laptop (CSS, sized in `cqw` from its own
  width) and the phone from the start; `heroScene` now only tilts the laptop's screen up
  (`--tilt`) and lifts the phone (`--lift`) with the scroll, on every size. The app's tabs are
  a segmented switch (`.app-thumb`, placed by `appTabs`). On a phone the timelapses are two
  rows sliding past each other (`--slide`, `fallScene` in rows mode). **The background is
  one fixed sky** (`.sky`, rebuilt after the owner's "rethink the entire background ... the
  background style should be consistent but not necessarily the same colour"): the Cotton
  Candy photo as it is behind the hero only ("hero can have the cloud image but the rest
  cannot"), and for every other part the same recipe in its own colours: a vertical gradient
  (`--top`, `--mid`, `--foot`) under a wide, slow-fading light on its horizon (`--glow`,
  `--glow-y`), on `.sky-layer[data-sky=…]`, with the grain over all of it. The parts themselves have no background; each names its light (`data-sky`) and
  `skyAndHeader` in `main.js` fades the sky to it as the part's top comes up the window, through
  a third light between a dark part and a light one (`BETWEEN`: sunrise, lilac, blue hour) so
  the fade never goes grey. The header's tone and the page colour behind overscroll follow the
  sky. **No pins** (owner, same evening): on a computer opened at the top the headline sits
  alone in the middle (`hero-waiting`, `--shift`) and the first scroll reveals the devices right
  under it (`heroWait`); `heroScene` only tilts the laptop and lifts the phone; the timelapse
  band scrolls by and `fallScene` drives the clips from its `through`. The rest of
  this list describes the page before it.
- **2026-11-02**: a day of redesigns on this page was set aside (the owner: "the pushed site is
  better than the rebuilt one"; that work is on the unpushed branch `site-overhaul`, commit
  90487cb). Only two things from it were kept, at the owner's word:
  - **The header** (`.site-nav`, now outside `<main>` and fixed): over the hero's photo at the
    top as before, and from the first scroll a compact 60px bar in the portal's glass that
    stays (`siteHeader` in `main.js`), smoked over the hero and the dusk band, frosted white
    with the accent buttons over the light page, smoked from the hero's top through the band and
    half way down its fade (the dusk under the laptop counts as dark: "nav bar incorrectly turns
    white here"). Its Timelapse, On your phone and Planner links are gone ("these are useless").
  - **The hand's foot** (`.phones-rail::after`, computers only): the phones' shadows and the
    cards held low sink into the page through a soft blur and fade instead of stopping on a
    line, with more room under the phones; the fade's colour is the page's there (#e5dcee).
  - Added after, at the owner's word: **the phones higher** on a computer ("phones not visible
    bump them up": less room round the heading and over the phones, so a picked phone fits under
    the header), the settle staying on a part it already rests on, and **the phones as a
    sequence** ("make it more obvious that there is a progression"): under a picked phone's
    words, a pip for each phone (this one long, the ones read tinted) and Next (Start over on the
    last), the arrow keys stepping too (`.hand-step`; phones keep their strip's dots).

- `index.html` and `src/styles.css`: the app's default photograph (Cotton Candy, frostroomhead
  on Pexels) runs edge to edge behind the hero and fades at the bottom into the dusk band's
  own colours, which carry on under the laptop down to the timelapses (`.hero-stage::before`,
  ending in the band's ink, so there is no pale page between; the owner, 2026-11-01: the blend
  "is odd"). One of the owner's timelapses (`clips/morning-exam.mp4`, their 10-23
  morning before an exam, 2x speed, its first 5 s cut at their word) plays on a CSS laptop, and the dashboard (`today-phone`)
  is on a phone hanging in front of it. Nothing floats beside the headline (the stickers there
  were taken off on 2026-11-01). Every phone on the page is the owner's iPhone
  (`.device`: a screenshot or recording under `public/phone-frame.webp`, cut out of their
  mockup by `scripts/cut-phone.mjs`); phone shots are taken at 393 x 852, an iPhone 14 Pro's
  screen, with its safe areas. On a computer the hero opens on a short scene (the owner,
  2026-10-31): it holds the screen for 60% of a screen's scroll (`.hero-stage` is sticky, the
  room is `.hero::after`), the headline starting in the middle of the window and the devices
  out of sight below; scrolling brings the laptop up and the phone just after it, and moves the
  headline up into its place (`heroScene` in `main.js`). Each part eases in and out over its
  own stretch, and the whole scene trails the scroll a beat, so a wheel's steps glide (the
  owner, 2026-11-01: "its janky"). The nav is outside the stage now (2026-11-02, below). Phones keep the
  hero still. Below the hero the page is ruled (hairlines down the sides of
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
    it a beat behind and sways and tilts on its own. The way in is the hero's dusk, already at
    the band's ink. The way out is one long eased gradient from the band into the page
    (`.fall-edge`), with three soft waves (ink, plum, a rose bloom) drifting sideways over it;
    the band's own colour is the dusk photo's tone, so it never dips darker than the band (the
    owner: "make this line more seamless"). On a phone the fade is shorter and less blurred; the
    full blur thinned it where the band ends and drew a line there.
  - **On your phone** (`#phone`): a hand of five phones (`.phones`: Pomodoro, Tasks and
    courses, the feed in the middle, Jams and groups, Streaks and profile), each in another
    theme and each a still of its screen, with clouds drifting behind (`.sky`). `phoneRow` in
    `main.js` moves them on springs: they fan out from a stack as the row comes in, the row
    leans toward the pointer, and the one pointed at rises. Picking one (the owner: "like a
    hand of cards", not a popup) puts `data-picked` on the rail: it moves left, grows and
    plays its screen, its words come out beside it (`.hand-text`), and the rest drop to the
    foot of the rail like cards held low, cut off by it, the one pointed at peeking up.
    Another phone swaps; the X or Escape fans them out again and stills them. On a phone the
    row is a strip to swipe and nothing needs a tap (the owner, 2026-10-31): the phone in the
    middle is the picked one, its words always under the strip (cross-fading in one place, so
    nothing below jumps) and its dot lit (`.hand-dots`); tapping a phone or a dot brings it to
    the middle. There "Pick a phone to take a closer look." is hidden (`.pick-hint`). Only the phones take the pointer:
    an item's own box stays where its phone stood at rest.
  - **The app** (`#app`): Start, Plan, Track, Earn and Social as plain pill tabs over one
    window, the picked one in its part's colour (one even row on a phone). Each part's words
    are on a card in its colour (Elespacio-like, with a paperclip), beside a real recording
    (`focus-start`, `plan-week`, `analytics-scroll`, `xp-buy`, `social-feed`); the
    calendar's phone joins Plan. Each recording plays
    through and the next tab comes up by itself while the window is on screen, the picked tab
    filling along its foot; the tabs and the card's button pick one by hand, and the window's
    pause holds it. Keep Earn's words true to the app if the shop changes.
  - **Make it yours** (`#looks`): a deep night-to-violet card, not pinned (the owner took
    its pin off). Sixteen screens in other photos, colours, themes and panels turn across it
    on the inside of a drum, fanning out as the card comes up and pushed by the scroll; it
    can be dragged round with the mouse and thrown (touch drags sideways, so the page still
    scrolls). It turns on phones too, in a shorter strip (the owner, 2026-10-31), its cards
    spaced further apart round the arc and evenly across, about seven at a time (2026-11-01:
    "spread the drum out"; `span`, `even` and `grow` in `ringScene`). Its CSS hangs on
    `.looks.is-live`, set while `main.js` turns it, not on `has-scrub`. What can be changed sits as chips bobbing around the heading (in a row under it
    below 1024px). The last line names calm, bright and cozy, and marks each in turn like a
    highlighter every few seconds.
  - **The closing**: a card of sky, blue into the page's lilac, with mist along its foot.
- **The clouds** (`public/sky`): made the way the app's audio visualizer makes its cloud
  mist (`packages/ui/src/mist-texture.ts` on core's `cloudNoise`), drawn once by a script
  with the same noise and shading. Behind the phones, single clouds (`cloud-*`, the bank
  gathered into an oval) drift across (`.sky`); along the sky card's foot, two banks tile
  sideways (`.mist`, `mist-*`), the back one wider, fainter and slower, over a faint bank of
  light.
- **Settling on each part** (the owner, 2026-10-30: "make the screen stick to sections and then
  go with enough scroll", then "too aggressive, make it smoother"): on a computer, when a
  scroll comes to rest within about a fifth of a screen of a part (`NEAR` in `main.js`), the
  page waits a moment and eases onto it over 0.7 s; anywhere else it stays where it stopped.
  The timelapses and the phones settle at their top, the app, the looks and the closing in the
  middle of the screen. The hero has none: easing the page along inside its scene felt like a
  tug. Any scroll, key, touch or click stops the ease. No CSS
  scroll snapping (it was too forceful). Phones scroll freely.
- **On a phone the page is flat** (the owner, 2026-10-28): under 641px wide, or under 501px
  tall (a phone held sideways), `main.js` leaves the scenes off and the CSS under the same
  query lays each section out as its words, then its pictures: four clips in a grid on the
  dusk. The drum is the one scene a phone keeps (it pins nothing). A window dragged across
  the line switches as it goes (`apply` in `main.js` stops each scene and clears what it
  wrote).
- **Low Power Mode** on an iPhone plays nothing by itself. Every video shows its poster behind
  it as well (`main.js` sets it as the video's background), because a browser hides the poster
  while it loads a video, and the app's tabs only move a recording back to its start once it
  has loaded.
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
- `src/main.js`: the entrance motion, the scenes (`[data-scrub]`: the hero's
  opening, the pinned timelapses and the drum, told how far each has come up the screen,
  through it and through its pin), the hand of
  phones and the app's tabs; everything moves by transform and opacity. With reduced motion
  (or without the script) nothing pins and the scenes lay out flat: the timelapses and the
  looks as grids, the app's recording on its poster with controls, a picked phone's words
  under the row.
- `public/fonts`: Satoshi for headings and the wordmark. Inter loads from rsms.me like the app.
- `public/shots`: screenshots of the portal from a seeded sandbox account (Jerry): the hero's
  phone, the calendar phone, and `looks/`, the drum's sixteen.
  Replacing a file with the same name is all the page needs; a new crop's shape goes in its
  `width`/`height` in `index.html`.
- `public/clips`: the recordings (below), and ten-second timelapses, 720 px wide, H.264 with
  no sound (about 1 MB each),
  each with a webp poster from 3 s in; `main.js` plays them only while they're on screen.
  `afternoon`, `late-night`, `long-day` and `first-week` are the owner's own. `desk`,
  `essay` and `solo` were made from study-with-me videos and Word and Excel screen
  recordings the owner downloaded from YouTube: cut, sped up, and drawn frame by frame with
  the portal's own `composeFrame` (camera behind, the screen in its box, the clocks, the
  task, the progress bar and the mark), so they look exactly like Komogon's. They are other
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
- `scripts/record-takes.mjs [take ...]`: `plan-week`, `analytics-scroll`, `xp-buy`,
  `social-feed` (computer, 1600 x 1000) and the hand's `phone-pomodoro`, `phone-tasks`, `phone-feed`,
  `phone-together`, `phone-profile` (786 x 1704); every take when none is named. (It also
  still has `phone-groups`, `phone-jams` and `phone-board`, which the page no longer uses.)
  Each sets its own look and puts Jerry's theme back. `xp-buy` buys a real streak freeze, so
  with two held already run it with `REHEARSE=1`, which answers the purchase in the browser.
  `phone-pomodoro` starts and ends real sessions; `phone-tasks` tags a few tasks if Jerry has
  no tags. `social-feed` answers Live now in the browser with the seed's two people mid-session
  (the sandbox drops them from live ten minutes after seeding).

Both need `CAPTURE_DEPS` (as above) and `FFMPEG`, an ffmpeg with `h264_nvenc`. They write
`public/clips/<name>.mp4` and its webp poster (`CLIPS_OUT` for a trial run elsewhere), and
keep the frames in `scripts/out/<name>-frames` for checking.
