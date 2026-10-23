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
  gradient page. The real dashboard screenshot sits on a CSS laptop and phone over it, there
  from the first frame. Below the hero the page is ruled (hairlines down the sides of the
  content and across between sections, like aside.com), and six scenes follow the scroll:
  - **Track**: pinned. The heading, paragraph and a three-line list on the left; on the right
    a window of the app running off the screen's edge. The screens (Analytics, the Social
    feed, the leaderboard) sit on the chambers of a cylinder (`tourScene`): scrolling turns
    it like a revolver's, the next one rolling up into the frame from below and settling, and
    the list follows. On phones it stacks.
  - **Timelapses**: a dusk interlude, pinned: Cotton Candy under a dark plum wash. Seven
    timelapses float down on either side of "Hours of work, in seconds." with the app's
    Recording pill. `fallScene` in `main.js` moves them: each drifts toward where the scroll
    puts it a beat behind and sways and tilts a little on its own, so they float rather than
    slide. The way in and out is three blurred waves (ink, plum, a rose bloom) drifting
    sideways in the band's margins (`.fall-edge`), not a straight fade. On phones the words sit high
    and the clips fall out from under them.
  - **Make it yours**: pinned. Sixteen screens in other photos, colours, themes and panels on
    the inside of a drum, small across the middle and large at the sides. They fan out from
    the middle; the drum then turns on its own while it's on screen, and scrolling gives it a
    push that eases off. The heading's last word scrambles through calm, bright, cozy, yours.
  - **Focus**: pinned. The focus screen grows from a card to the whole window while the page
    goes dark around it, then runs a Pomodoro: start a session, focus, short break, and the
    focus screen recording a timelapse (the camera in the corner, no settings sheet). The phone slides in on the way, as the camera screen a
    recording session is on a phone.
  - **Share**: a ruled bento of plain screenshots: the feed (a long picture that scrolls
    inside its frame as the page scrolls), a study group and jams.
  - **Plan**: pinned. The calendar week (classes from a timetable, finished sessions, what's
    due), then Plan my week's suggestions, then the week with them added; the phone's day
    view rises in at the end. It sits after Share so Social comes first.
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
