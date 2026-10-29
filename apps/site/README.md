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
  gradient page. Over its edge hang five phones in a row (`.lineup`), each a part of the app
  in another look: Timelapse (`focus-phone`), Planner (`lineup-plan`), Social (`feed-phone`,
  in the middle), Stats (`lineup-track`) and XP (`lineup-xp`). A phone pops up when pointed at
  and opens the slideshow (`#features`, a `<dialog>`), one slide per phone in the same order.
  Below the hero the page is ruled (hairlines down the sides of the content and across
  between sections, like aside.com). What draws people in comes first, then everything else
  (the owner, 2026-10-28 and 10-29):
  - **Timelapses**: a dusk interlude, pinned: Cotton Candy under a dark plum wash. Seven
    timelapses float down on either side of "See what you got done." with the app's
    Recording pill. `fallScene` in `main.js` moves them: each drifts toward where the scroll
    puts it a beat behind and sways and tilts a little on its own, so they float rather than
    slide. Under them, still on the dusk, `.recap`: the focus screen while it records beside
    the owner's 10-23 timelapse (`clips/morning-exam.mp4`, sped up 2x) playing on a CSS
    laptop. The way in and out is three blurred waves (ink, plum, a rose bloom) drifting
    sideways in the band's margins (`.fall-edge`), not a straight fade.
  - **Social** (`#social`): a ruled bento of plain screenshots: the feed down the left (a
    long picture that scrolls inside its frame as the page scrolls, as tall as the cells
    beside it), then a study group, jams and the leaderboard.
  - **All in one** (`#all`): a centred heading, then Focus, Plan and Track, each with a
    small accent label (`.kicker`) over its heading.
  - **Focus**: pinned. The focus screen grows from a card to the whole window while the page
    goes dark around it, then runs a Pomodoro: start a session, focus, short break, and the
    focus screen recording a timelapse (the camera in the corner, no settings sheet). The
    phone slides in on the way, as the camera screen a recording session is on a phone.
  - **Plan**: pinned. The calendar week (classes from a timetable, finished sessions, what's
    due), then Plan my week's suggestions, then the week with them added; the phone's day
    view rises in at the end.
  - **Track**: pinned. The heading, paragraph and a two-line list on the left; on the right
    a window of the app running off the screen's edge. The screens (Analytics, then Today
    with the streak) sit on the chambers of a cylinder (`tourScene`): scrolling turns it
    like a revolver's, the next one rolling up into the frame from below and settling, and
    the list follows. Under 900px it stacks.
  - **XP and rewards** (`#xp`): Earn XP across the top, then Get rewards and Roll for it side
    by side under it with an arrow down into each, each a real part of Achievements
    (`xp-hero`, `shop`, `rolls-panel`). Its words were checked against the app (2 XP a minute plus a streak
    bonus, the shop's items, 10 XP a roll); keep them true if any of that changes.
  - **Make it yours**: pinned. Sixteen screens in other photos, colours, themes and panels on
    the inside of a drum, small across the middle and large at the sides. They fan out from
    the middle; the drum then turns on its own while it's on screen, and scrolling gives it a
    push that eases off. The last line's word scrambles through calm, bright, cozy.
- **On a phone the page is flat** (the owner, 2026-10-28): under 641px wide, or under 501px
  tall (a phone held sideways), `main.js` leaves the scenes off and the CSS under the same
  query lays each section out as its words, then its pictures: four clips in a grid on the
  dusk, the feed and the other cells in a column, the focus screen and the calendar each with
  its phone in front, six looks in a grid. A window dragged across the line switches as it
  goes (`apply` in `main.js` stops each scene and clears what it wrote).
- `.rail` is `box-sizing: border-box`. Without it every padded rail was its width plus its
  padding, so on any window under about 1330px it ran past the right edge and sat off
  centre, and the side lines didn't meet the bento's.
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
- `src/main.js`: the entrance motion and the scroll scenes. Each `[data-scrub]` element gets
  `--p` (0 to 1 while pinned), `--enter` and `data-step`; everything moves by transform and
  opacity. With reduced motion (or without the script) nothing pins and the scenes lay out
  flat: the list with a screenshot under each line, the looks as a grid, the focus screen
  still.
- `public/fonts`: Satoshi for headings and the wordmark. Inter loads from rsms.me like the app.
- `public/shots`: screenshots of the portal from a seeded sandbox account (Jerry, dark mode,
  Cotton Candy). `looks/` holds the drum's sixteen. Replacing a file with the same name is
  all the page needs; a new crop's shape goes in its `width`/`height` in `index.html`.
- `public/clips`: ten-second timelapses, 720 px wide, H.264 with no sound (about 1 MB each),
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
