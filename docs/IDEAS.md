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
