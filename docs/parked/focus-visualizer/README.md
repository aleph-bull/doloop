# Focus screen and audio visualizer (parked)

Built 2026-09-21, removed the same day: it looked bad on screen. The code is kept here
rather than only in git history so it can be picked up again without digging.

Nothing in this folder is built, linted or formatted — `eslint.config.js` and
`.prettierignore` both skip `docs/parked`. The files are exactly as they were when they
worked, so restoring is a matter of moving them back and re-wiring.

## What it was

A full-screen view at `/focus` for the running session: a large countdown with the block
type above it, and around it the live clock and date, the subject, its sub-item, hours this
session and hours remaining. Non-essential text faded after four seconds of stillness.

Behind it, an ambient glow along the bottom half of both screen edges, mirrored, driven by
**system audio** (not the microphone) and drawn as one smooth blurred shape rather than
bars.

## Why it was dropped

The look, not the mechanism. Worth knowing before trying again:

- The glow is very subtle at the default 55% opacity over a dark background — it reads more
  as a smudge than as light. It probably needs either much higher contrast against a plain
  backdrop, or a different treatment entirely.
- A blur of 5.5% of viewport width over a shape that only reaches ~5% in is most of the
  reason it looks vague. Either the reach or the blur wants to change, not both.
- It competes with the photographic backgrounds rather than sitting on them.

The maths underneath is sound and tested; it is the visual design that did not land.

## Files

| Parked here                 | Belongs at                                       |
| --------------------------- | ------------------------------------------------ |
| `core/glow.ts`              | `packages/core/src/glow.ts`                      |
| `core/glow.test.ts`         | `packages/core/src/glow.test.ts`                 |
| `ui/audio-levels.ts`        | `packages/ui/src/audio-levels.ts`                |
| `ui/AudioGlow.tsx`          | `packages/ui/src/components/AudioGlow.tsx`       |
| `portal/use-system-audio.ts`| `apps/portal/src/lib/use-system-audio.ts`        |
| `portal/Focus.tsx`          | `apps/portal/src/pages/Focus.tsx`                |

`core/glow.ts` is pure and carries 17 passing tests — attack/decay, the breathing wave, the
silence threshold, per-band independence, the reduced-motion path, and that the glow never
reaches the middle of the screen. It is deliberately out of the component because an
animation frame only fires when the page is painting, which makes the motion impossible to
verify from a canvas.

## To restore

1. Move the six files back to the paths above.
2. `packages/core/src/index.ts` — add `export * from './glow';`
3. `packages/core/src/types.ts` — add to `UserSettings`:
   ```ts
   visualizer: { enabled: boolean; intensity: number; opacity: number; color: string };
   ```
4. `packages/core/src/defaults.ts` — add to `DEFAULT_SETTINGS`:
   ```ts
   visualizer: { enabled: true, intensity: 0.6, opacity: 0.55, color: '#6366f1' },
   ```
5. `apps/api/src/validation.ts` — add to `settingsSchema`:
   ```ts
   visualizer: z
     .object({
       enabled: z.boolean(),
       intensity: z.number().min(0).max(1),
       opacity: z.number().min(0).max(1),
       color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
     })
     .partial(),
   ```
6. `packages/ui/src/index.ts` — re-export `AudioGlow` and the `audio-levels` helpers.
7. `apps/portal/src/App.tsx` — lazy-import `Focus` and add the `/focus` route **outside**
   `AppShell`, so the screen has no nav or page chrome.
8. `apps/portal/src/components/AppShell.tsx` — add `{ to: '/focus', label: 'Focus' }` to
   `links`. Without this the screen is unreachable unless a session is already running.
9. `apps/portal/src/index.css` — restore the `focus-screen` block (see the commit below).
10. Optionally re-add the expand icon on the timer card.

Everything is in git: `6c5bca9` added it, `9a028ff` made it reachable, and the commit that
parked it removed the wiring. `git show 6c5bca9 -- apps/portal/src/index.css` has the CSS.

## Notes for a second attempt

- System audio only comes through `getDisplayMedia({ video: true, audio: true })` — a
  screen-share prompt needing a user gesture. The video track is stopped immediately and the
  audio is never connected to the destination, so nothing echoes. Four ordinary failures
  (unsupported, dismissed, shared without ticking "share audio", stopped from the browser's
  banner) are all handled as reported states rather than errors.
- Firefox does not reliably expose system audio this way; this was only ever checked against
  Chromium.
- The prompt is per-visit: browsers will not remember it, so the screen has to work while
  idling, which is what the breathing state is for.
