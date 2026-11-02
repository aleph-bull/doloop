# The homepage's design: what was decided, and why

Read this before changing how `apps/site` looks or moves. It records the deliberate choices
made on 2026-11-02, when the page was rebuilt from the owner's brief and then reworked through
a long run of their notes (shipped as 9fff0a6). The owner's own words are quoted so the reason
travels with the rule. The mechanics are in [README.md](README.md); the step-by-step record is
DECISIONS.md, "The homepage: one sky through a study day".

## How the owner works on this page

- Notes arrive as a screenshot and a short line ("pills not in frame", "is tilted"). Read the
  screenshot for what is actually wrong, fix that, and check it at their size: a computer
  window of about **1536 × 790** CSS pixels, and sometimes a narrow window of about **554**
  wide that gets the phone layout.
- A redesign is judged against the page they already like. The morning's redesign of the same
  day was rejected ("looks noticeably worse") because it swapped distinctive choices for
  generic ones. The evening's stuck because every signature piece stayed (the dusk photo, the
  floating timelapses, the hand of phones, the coloured app card with its paperclip, the drum,
  the compact glass header, every line of copy) and only the composition around them changed.
- The words on the page are the owner's. Keep them verbatim.
- Push only when they say so in the moment ("page looks great push it").

## Principles

1. **One sky, one technique, a colour for each part.** "The background style should be
   consistent but not necessarily the same colour." The whole page has one background that
   never scrolls (`.sky`, fixed). Each part names its light (`data-sky`) and the sky fades
   from one light to the next as the parts pass. No part has a background of its own.
2. **No visible edges or bands, anywhere.** "Not even looking blended and there are edges
   visible." Straight gradient bands, cloud-bank edges, a mist strip and a hairline between
   two parts were all called out. A change of colour happens over time as the page scrolls,
   never as a line across it. A fine grain (`--grain`) lies over the sky so long gradients
   never band.
3. **The photograph is the hero's alone.** "Hero can have the cloud image but the rest
   cannot." Every other part uses the same recipe: a vertical gradient (`--top`, `--mid`,
   `--foot`) under a wide light on its horizon (`--glow`, `--glow-y`). The light sits low on
   dark parts and high on light ones, and fades over most of the window so it has no ring.
4. **Nothing holds the screen.** "Remove the screen pin." No part pins, and the timelapses
   scroll by. The one place the page takes over is the settle (below), and only once the
   scroll has stopped.
5. **The real app is the star; nothing is invented.** Recordings and screenshots only. The
   pills, buttons and glass on the page borrow the portal's own styles and values.
6. **Motion answers the visitor, and rests when they stop.** Things move on arrival, on
   scroll, on hover or on a pick, then stay put. The theme drum turning and the clips drifting
   are content, so they keep moving.
7. **Smooth is part of the design.** "Frames are suffering now please try to make the site
   smooth as possible." See the performance rules below; they are as binding as the colours.
8. **A phone gets its own composition**, not the computer's shrunk: what is visible at once,
   what is a strip to swipe, and what drops away (a picked phone's Next, the app card) is
   decided for the phone.

## Part by part

**Header.** Fixed. Clear over the hero, then a compact 60px bar in the portal's glass from the
first scroll ("shrink a taller hero header into a compact bar once scrolling starts"). Its tone
(smoked or frosted white) follows the sky's light, not the part under it (`skyAndHeader`). No
nav links ("these are useless").

**Hero.** On a computer at the very top of the page (`scrollY <= 4`) the headline sits in the
middle of the window and the laptop and phone are hidden ("hide the computer and centre the
text until scroll", "I should not see the computer and phone when I am on the very top").
Scrolling away glides the words up and the devices rise in right under the buttons, and
returning to the top hides them again (`heroWait`, `html.hero-waiting`, `--shift`). There is
no big gap: the laptop sits right under the words ("there shouldn't be a big gap between the
text and the computer, it should appear instead of just being there ... so the section can
continue to be short"). The laptop's lid opens as it comes up ("make the laptop do an opening
animation"): shut over the base, then lifting on its hinge, then the screen wakes. While off,
the screen is pure black and its cover runs a pixel past the picture ("fix the weird line on
the pc screen, make it pure black when it's off"). As the page scrolls, the screen leans back
and comes up to face you, and the phone climbs a touch faster than the page. On a phone
everything is shown at once: the whole laptop inside the margins with a smaller phone in front
of its lower left corner ("HERO looks bad on phone": it had run off the edge under a big
phone).

**Timelapses.** A screen tall on the night light, scrolling by ("remove the screen pin but
keep the reactive falling"). The clips sink through it slower than the page, driven by how
far the band has passed through the window (`fallScene`, `through`). On a phone, two rows
slide past each other with the scroll (`--slide`).

**On your phone, too.** Sits in a soft lavender morning. The owner dislikes peach: "don't like
the peachy colour".

- **Placement:** the phones pass in front of the heading and their words, and are never
  clipped ("cut off glitches, send text to behind the phones", "the phones should be above
  every other element"). On a computer the rail reaches 120px up over the heading, and
  `.phones` sits above everything in it. On a phone it doesn't, because the strip's padding
  would cover its dots.
- **Fit:** the row is capped by the window's height, so whole phones show ("bump up the phones
  at the bottom not visible").
- **Resting fan:** stays even. The pointer slides it but never turns it ("is tilted").
- **Picked phone, the others:** they are held low but in view under the words (`lowFloor`,
  `lowView`).
- **Picked phone, the step row:** the dots and Next never move between phones, because all five
  phones' words share one grid cell ("should never bounce around and it should only remain in
  1 area").
- **Picked phone, the line under the heading:** it fades out while a phone is picked, on
  computers ("when you click a phone the [line] should fade out").
- **The foot:** the fade and blur at the foot start below every standing or picked phone, so
  only the phones held low sink into it.
- **The phone itself:** each phone has a dark inside under its frame (`.device::before`). The
  frame's inner rim is soft-edged, and the light page showed through as a thin white line
  ("the phones have white edges").

**The app.** A segmented switch whose thumb slides to the picked part in its colour and fills
as the recording plays. On a computer, the coloured card with the paperclip sits beside the
window. On a phone (matching the owner's screenshot): the switch, then the recording edge to
edge on a band in the part's colour, then the words plainly under it, centred, with no card,
paperclip or Next.

**Make it feel like yours.** Indigo evening. Six pills around the heading: "80+ backgrounds"
and "Glass panels" were removed ("remove 2 pills, the top 2"). The pills are the portal's dark
glass panel, copied from the design tokens: fill `rgb(22 24 36 / .5)`, a 1px white `.12` rim,
the inner line and glass shadow, an 11px blur, text `#f4f5f9`, and the small-tile 14px corner
("make the pills look like the panels on the actual app portal"). They hang within the
heading's height so they never sit under the header ("pills not in frame"). The drum ignores
the scroll. The first time it comes up the window its cards burst out from the middle, once,
in under a second ("make scrolling not affect the drum, only on entry should it do that fast
explosion thing"). It still turns on its own and can be dragged.

**Closing and footer.** A clear morning blue, no mist, no photo. The footer sits on the same
sky; on a phone its links are in two columns.

**Settling.** On a computer, a scroll that comes to rest between two parts always eases onto
the nearer one ("it goes to one or the other, screen should never stand in the middle").

- **Where it lands:** a part settles to its top, or to the middle of the space the 60px header
  leaves, not the middle of the whole window.
- **Edges of the page:** above the first part (the hero) and past the last, it only pulls when
  very close. At the very bottom it stays on the footer.
- **Timing:** it waits for the scroll to stop and eases (480 to 950ms by distance). Any input
  cancels it, because a hard CSS snap was "too aggressive" before.

## The sky's colours

| light    | used for                    | top / middle / foot                             | horizon light                      |
| -------- | --------------------------- | ----------------------------------------------- | ---------------------------------- |
| dusk     | hero                        | the Cotton Candy photo under the dark-mode wash | none                               |
| night    | timelapses                  | `#150e1b` / `#201627` / `#2b1e34`               | plum `rgb(104 66 118 / .6)`, low   |
| dawn     | phones                      | `#f6f4fa` / `#eeeaf5` / `#e4deef`               | white, high                        |
| day      | the app                     | `#f5f6fa` / `#eceff5` / `#e2e7f0`               | white, high                        |
| evening  | looks                       | `#110d2c` / `#1a1442` / `#261d5a`               | violet `rgb(92 70 178 / .55)`, low |
| morning  | closing, footer             | `#a2baef` / `#bfd0f6` / `#dee7fb`               | white, low                         |
| sunrise  | between night and dawn      | `#2c2140` / `#5b4a7d` / `#9a8bbd`               | lavender                           |
| lilac    | between day and evening     | `#d7cce8` / `#a493c8` / `#7362a3`               | lilac                              |
| bluehour | between evening and morning | `#1b2156` / `#2f4494` / `#587ac9`               | pale blue                          |

A fade from a dark part to a light one passes through its third light (`BETWEEN` in main.js).
A straight fade between them went a muddy grey half way. The fade runs while the next part's
top climbs from 90% to 25% of the window.

## Type, colour and buttons

- **Type:** Satoshi 600 for headings, Inter for everything else. Three heading sizes: the hero
  `clamp(42px, 6.3vw, 94px)`, a part's heading `clamp(36px, 4.5vw, 64px)`, and the words
  inside a part. Tight tracking at display sizes.
- **Accent:** one, the app's `#5b55eb`, matte. The main button has a plain shadow, never a
  coloured glow. The app's five part colours are unchanged.
- **Copy:** unchanged throughout. Only the pills were removed, at the owner's word.

## Performance rules (keep them)

- **No layout reads on a scroll frame.** The sky, the scroll scenes, the hero and the hand of
  phones all work from page positions measured on load, on resize and when `main` changes size
  (a `ResizeObserver`), plus the scroll position. Reading a rectangle after the last frame's
  writes makes the browser lay the page out again.
- **Write only what changed.** The sky's layer opacities, the page colour and the header's
  state.
- **Layers only where needed.** Only the sky lights currently showing get `will-change`.
- **Loops rest when still.** The hand of phones stops its loop once its springs settle, and
  wakes on scroll, pointer, focus or a pick. It no longer bobs while idle.
- **No filters over playing video.** The phones' shadow is a box shadow drawn once
  (`.device::before`), not `filter: drop-shadow` on the whole phone, which was worked out
  again for every frame of a playing screen.

## Tried today and turned down (don't bring back unasked)

- Cloud banks made like the audio visualizer's mist, rising at each change of colour: "this
  looks bad".
- The same cloud photo graded for every part: "hero can have the cloud image but the rest
  cannot".
- Peach and rose tones in the morning: "don't like the peachy colour".
- The oval cloud images drifting through the sunrise: "the clouds look bad".
- A headline owning a whole screen with the devices a screen below it: the "big gap".
- The pinned hero scene and the pinned timelapse band: "remove the screen pin".
- The drum pushed and folded by the scroll.
- Frosted white pills, then light glass pills. The portal's dark glass panel replaced both.
- The laptop running off the edge on a phone, under a big phone.

## Checking changes

- **Animations stall in the preview.** The preview pane runs animations and
  `requestAnimationFrame` only when a screenshot is taken. Take a screenshot (or two) before
  reading state, and expect a fade or an entrance to be caught half way.
- **Sizes to check:** emulate 1536 × 790 for the owner's computer, 390 × 844 and 554 wide for
  phones. Measure positions with JavaScript rather than trusting a scaled screenshot.
- **Old console errors:** errors about `heroScene` reading `null` in the preview's console are
  left over from mid-edit hot reloads. A clean load logs nothing.
- **Ask before stress tests.** Ask before running GPU or frame-rate tests on the owner's
  machine (see the memory note on safe performance testing).
