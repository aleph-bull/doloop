# Ideas backlog

Parked ideas. Each section says when it was built, if it has been.

See also [BETA-REVIEW.md](BETA-REVIEW.md) for the 2026-10-05 review: bugs, UI and QoL fixes, feature ideas, and the private-beta checklist.

## Timelapse recorder (logged 2026-10-05, built 2026-10-06)

Built as a local-only first version on the focus screen; see DECISIONS.md. Sharing comes with the social layer.

- Records from the camera during a study session and turns it into a timelapse of the user.
- Optional on-screen timer showing hours studied, which can be turned on or off.
- Settings:
  - Target timelapse length (how long the finished video should be).
  - Playback fps. The max is whatever the captured frames can support.
- Camera permission: ask the user to turn it on. As with other prompts, include an option to stop asking permanently.
- Length mode (added 2026-10-05): rather than only a fixed end length, let the user pick a speed multiplier (e.g. 60x, 300x, 1000x). Output length = session length ÷ speed. Keep "fixed length" as the other option.
- Quality bar: should look as good as Apple's iPhone Time-lapse. What makes that one look good (to research further before building):
  - Adaptive capture interval: it captures frames more slowly the longer it runs, so the result always lands around 20–40s and playback stays smooth at 30fps. That would make a good default "Auto" mode alongside fixed length and x speed.
  - Steady exposure and white balance, so there's no flicker or color pumping between frames. Lock or smooth the webcam's auto-exposure.
  - Smooth playback fps (30) with evenly spaced frames.
  - Optional frame blending, which averages neighbouring frames for a soft, motion-blur look instead of a jittery one. Try it with and without and keep whichever looks better.
  - Stabilisation matters less here because a webcam on a desk doesn't move.

## Starting a timer from the Tasks screen (logged 2026-10-05, built 2026-10-06)

- If a session is started with a task's play button, the panel drops its task selection options. The session can only run on that task.
- Play button placement: on the left of the row, right after the tick (complete) button, with plenty of padding between them.

## Social layer, Strava-style (logged 2026-10-05)

- Friends can see each other's study times and timelapses so they keep each other accountable. Think kudos on a run, but for a study session.
- Decided by user (2026-10-05):
  - Friends-only by default.
  - No leaderboards.
  - Users choose what to share (timelapses, study times, whatever they want). Nothing is shared automatically.
- Things to work out before building:
  - Even friends-only, camera footage of students (many likely under 18) needs basic safety: friend requests that need approval, blocking, reporting, and an easy way to delete anything you've posted.
  - Cold start: a feed is empty until your friends join. Exporting timelapses to TikTok/Instagram/Reels with a small Komogon watermark could bring in users before the in-app network exists.
  - Keep it consistent with "compare against your own past" and the no-guilt tone: kudos and showing up.
  - Existing players to study: YPT (Yeolpumta) study groups, Forest, StudyStream / Study Together, Focusmate, and the "study with me" genre on YouTube and TikTok.

## Study plans: after the first version (logged 2026-10-09)

- **Describe it (generation).** User says what, resources, deadline, hours a week; the API asks a model for a draft in the same `createPlanSchema` shape (topics with hours, resource, drilled or not, method, optional top-up), shown in the same editable rows before anything is saved. Ask only what changes the plan: goal and test format, current level per area, resources, deadline, hours a week, how they practise.
- **Log a drill from the end-of-session sheet** when the session was on a drilled topic (the round keeps the session id; the column already exists).
- **Onboarding that starts with a plan** instead of requiring a course and an assignment.
- **Plan on the dashboard**: up next plus due-back count in the start panel.
- **Milestones as achievements**: first topic learned, plan finished, 25/100 misses cleared.
- **Rebalance across topics**, not only the budget: shrink or drop topics when the target is fixed.
- **Reorder topics** by drag; today they keep the order they were made in (edit the sort order through the API).

## One session at a time (logged 2026-10-17, built 2026-10-17)

- Starting a session while another is still running asks first instead of starting a second one or silently replacing it: "<Session> is still running. Cancel to start <new session>?"
- Cancel ends the running session (saved as usual) and starts the new one; dismissing keeps the running session going.

## Focus end screen can't scroll (logged 2026-10-17, fixed 2026-10-17)

- The end-of-session screen on the focus page sometimes gets taller than the window, and there's no way to scroll to the rest. Fix later: let it scroll (or keep the actions reachable) when the content runs long.

## Clear missed routines (logged 2026-10-17, built 2026-10-17)

- Missed occurrences pile up in "Due now" (the same two routines repeated ten times over), which buries what's actually due today.
- Add a way to bin all missed routines at once, e.g. a "Clear missed" action on the Due now card. Binning drops the missed occurrences only; the routines themselves and today's due ones stay.
- Not built yet, worth considering: show each routine once with a missed count instead of one row per missed day.

## Grades: what you need on the rest (logged 2026-10-17, built 2026-10-17)

- In a by-weight course card, under the "X% of the Y% of this course that has been marked…" line, add: "You need Z% on average from the rest of your grades to get an average of (target)."
- Show it if and only if the course has a target grade set. No target, no line.
- Z = (target − current% × marked weight) ÷ remaining weight. Example: RSM222 is 91.7% on 10% marked; with a 90% target the rest needs (90 − 9.17) ÷ 0.9 ≈ 89.8%.
- Edge cases to word calmly: the target is already locked in (needed ≤ 0%), it's out of reach (needed > 100%), or nothing is left to mark.

## Dashboard: text too bold (logged 2026-10-17, fixed 2026-10-17)

- The "Ready when you are" heading on the dashboard start card is too heavy. Lighten its weight so it sits closer to the rest of the card (in line with the first-version weights).
- Same for the "Coming up" card: its heading (and the matching "Routines" card heading) and the bold task names like "Midterm" are too heavy. Lighten them to match.
- Tasks carousel cards: the big time figure (e.g. "53 min" on Unit 1) is too bold. Lighten it, keeping the tight number/unit spacing.

## More trophies and achievements (logged 2026-10-17, built 2026-10-17)

- The trophy shelf has 7 personal bests today (biggest day, biggest week, longest session, longest streak, most tasks in a week, earliest start, latest finish). Add more, and more achievements alongside them.
- Trophy ideas (personal bests, "beat last time"):
  - Biggest month.
  - Most sessions in a day.
  - Longest unbroken focus (no pauses).
  - Most courses touched in a week.
  - Most routines kept in a week; longest routine streak.
  - Best on-track week (tasks finished within their estimate).
  - Biggest grade jump on a course.
- Achievement ideas (one-off milestones; check against the 29 existing badges first, "First session" already exists): first 10/50/100 hours, first full week with a session every day, first task finished under its estimate, first routine kept 4 weeks running, first .ics import, plus the study-plan milestones already noted above.
- Layout: 7 cards leaves one orphan on the second row. Pick a count (or a grid) that fills rows evenly.
- Built: 5 new trophies (12 in all, the grid balances its rows) and 11 new badges (40 in all); see DECISIONS.md.
- Still open, needing data the app does not keep yet: longest focus without a pause, longest routine streak, best on-track week, biggest grade jump, first .ics import badge, study-plan milestone badges.

## Remove the saturated magenta accent everywhere (logged 2026-10-17, fixed 2026-10-17)

- The bright magenta/pink accent (seen on unlocked badge icons and the "Unlocked <date>" text on the Badges section) is too saturated. Remove it entirely, from every place it's used, not just badges.
- Replace it with the calmer muted accent the rest of the app uses (e.g. the dusty pink of "Start a session" and "All tasks"), or a neutral. Matte and flat, no glow.
- When building: search the theme tokens and any hard-coded hex values for this colour so no instance is left behind.

## Reward unlocked by a grade (logged 2026-10-17)

- Task rewards (built 2026-10-17) open when the linked task or test is marked done. A further step: open only once that test's grade reaches a set mark ("pass the midterm", "70% or more"), read from the course's grade components.

## Focus screen wordmark font (logged 2026-10-18, built 2026-10-18)

- The "Komogon" wordmark in the focus screen's top-left corner is still in the old font. Change it to match the portal nav: Satoshi Variable, weight 600, stylistic sets ss01 + ss03 (see packages/ui/README.md, Typography).

## Unrestricted accent and visualizer colours (logged 2026-10-18, built 2026-10-18)

Built for the user's own colours: saved exactly as picked, fills in the true colour with a white or dark label by contrast. The built-in presets keep their muted fills. The visualizer's custom colour already had no limits.

- Let the user pick any accent colour and any visualizer colour, without the current limits.
- Today a custom accent is clamped when saved (saturation at least 30, lightness 35-70, in AccentPicker's `toAccent`), and the filled accent is capped at 45% saturation (`accentFill`). Check the visualizer's custom colour for similar limits.
- When building: keep text on accent fills readable some other way (for example, choosing light or dark text by contrast) rather than by limiting the colour itself, and rerun the contrast audit.

## Appearance presets (logged 2026-10-18, built 2026-10-18)

Built as "Saved looks" in Settings → Appearance: list in localStorage, an uploaded image in IndexedDB. Applying a look with an image re-uploads it as the background, through the normal upload.

- Save the current appearance as a named preset: background (preset, solid colour or uploaded image), accent colour, and panel style (glossy/glass or matte). The user names it when saving.
- A list of saved presets in Settings → Appearance. Each shows a preview of what it looks like: its background, its accent, and whether it is glossy or matte. Picking one applies all of it at once.
- Must work with custom backgrounds: an uploaded image appears in the preview and is restored when the preset is picked.
- Stored locally only, never on the server: keep presets in this browser (for example, localStorage for the settings, IndexedDB for an uploaded image's file), not in the user's settings or the API.
- When building: decide what happens if a preset's uploaded image is no longer there (another browser, cleared site data), and allow renaming and deleting presets.

## Locked backgrounds lead to the shop (logged 2026-10-18, built 2026-10-18)

- In Settings → Appearance, clicking a background that isn't unlocked yet asks whether to go and see it in the shop, instead of doing nothing.
- Yes takes the user to Achievements, scrolls to that background in the Backgrounds section, and highlights it, so they can buy it there (or see the level that unlocks it).
- When building: today locked tiles are disabled buttons, so they would need to stay clickable while still reading as locked; the link could carry the background's id (for example `/achievements#bg-kirkjufell`).

## Fewer saved custom accents (logged 2026-10-18, built 2026-10-18)

- Lower the limit on the user's own saved accent colours from 10 to 8 (14 in all with the six built-in ones).
- When building: it is one constant, `MAX_SAVED_ACCENTS` in packages/core/src/economy.ts, which the API check, the picker and its counter all read. Anyone who already saved 9 or 10 keeps them; the server should only refuse adding more, not fail on a list that is already longer.

## Komogon watermark on timelapse videos (logged 2026-10-18, built 2026-10-18)

- Draw a Komogon watermark into every timelapse video: the logo mark and the "Komogon" wordmark, as they appear in the portal nav (Satoshi 600 with ss01 + ss03).
- At 30% opacity (70% transparent).
- Black or white, whichever reads better, chosen once from the 30th frame of the video. If the video has fewer than 30 frames, use the last one.
- When building: it is drawn in `frameDrawer` in apps/portal/src/lib/timelapse.ts, alongside the time-studied clock. Pick black or white from the chosen frame's brightness under where the mark sits (the stills already carry an average brightness, `luma`). Keep it clear of the clock in the bottom-left corner, and load Satoshi before drawing so the canvas doesn't fall back to another font.

## Animate hiding and showing the focus timer (logged 2026-10-18, built 2026-10-18)

- On the focus screen, the eye button hides and shows the timer (the big clock, the task, and the totals). Today it snaps; give it a smooth animation both ways, for example the clock fading and gently shrinking away, then fading and settling back in.
- When building: the layout around it shouldn't jump as it goes, and the phase word ("Short break") stays. Respect the motion setting, so it is instant when motion is off.

## Timelapse: record breaks too (logged 2026-10-18, built 2026-10-18)

- A timelapse option to keep taking stills during breaks, not only during focus (today it pauses on a break).
- With breaks recorded, an option for what the clock in the video shows during them:
  - a break timer (the break's own time, counting up or down, so it reads clearly as a break), or
  - the studied-time clock carrying on counting up through the break.
- When building: the recorder's `capturing` flag in Focus.tsx is what stops it on a break, and each still stamps `workSeconds`, which stands still during a break, so the clock would need a second time (break time or total time) per still. Mark break stills somehow (for example a small "Break" label) so the video shows when the user was resting.

## "Just the timer" becomes "No task" (logged 2026-10-19)

- In Start a session, rename the "Just the timer" row to **No task**, with the subtitle **Minutes still count** (no full stop)
- When building: the text is in apps/portal/src/components/SubjectPicker.tsx: the row (title and subtitle) and the chosen summary at the top, which today reads "Just the timer" / "No task; the minutes still count." and should match the new wording.

## "Needs more time" when there's no estimate, or it's already passed (logged 2026-10-19)

- At the end of a session, the review asks "Needs more time than planned?" (+30 min, +1 h, +2 h). Today the answer is added to the task's estimate.
- When the task has no estimate, or the time studied has already gone past it, add the answer to the time studied so far instead. Example: estimated 1 h, studied 1 h 40 min, picks "+1 h" → the new estimate is 2 h 40 min, not 2 h (which would still be behind).
- When the task has an estimate that hasn't been reached yet, keep adding to the estimate as now.
- When building: the change is where the review's `extraMinutesAdded` is applied to the node's estimate at session end (apps/api/src/services/sessions.ts, the end pipeline), and the review dialog's wording may need to say which it is ("1 h more from where you are").

## "Custom time" in "Needs more time than planned?" (logged 2026-10-19)

- Add a **Custom** option after No / +30 min / +1 h / +2 h in the end-of-session review. Picking it shows a small field for any amount (minutes or hours, e.g. "45 min" or "3 h").
- It is applied the same way as the fixed options, including the rule above for a task with no estimate or one already passed.
- When building: the choices are in apps/portal/src/components/ReviewDialog.tsx; the API already takes any `extraMinutesAdded`, so check its upper limit in the review validation.
