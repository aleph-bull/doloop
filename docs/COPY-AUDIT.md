# Copy audit: what's left

On 2026-10-21 the owner asked for an audit of copy that is abrupt, over-explanatory, wordy,
or that reads as AI-written. Batches 1 to 3 are done and shipped. Everything below is still
open. Pick it up when the owner asks; don't change any of it unasked.

## How the owner works through it

- Present one batch at a time (15 to 20 items), numbered, continuing from the last number
  used (the next new item is **72**). Each item gives the location, the current copy, what's
  wrong, and a suggested direction.
- The owner answers per number: **keep** (leave it), **your rec** (use the suggestion),
  **edit** (they write the words, and you use them verbatim, "!" included; if they haven't
  written it yet, ask), or **remove** (delete the copy).
- Then apply the batch, check it in a sandbox, add a DECISIONS.md entry, and commit and push
  that batch on its own.
- Voice: see the Voice rule in CLAUDE.md. Fragments are fine. A little quirky is fine if it
  sounds like a person. Never corporate or AI-polished, never pushy. When a line is bad,
  offer a human replacement rather than only cutting it. Bucketed lines need enough options
  left: `phrases.test.ts` wants at least 6 per bucket.
- **Line numbers are from 2026-10-21 and drift.** Search for the quoted text. Some files have
  changed since the audit; re-read before presenting.

## Done, don't re-raise

- Batches 1 to 3 (items 1 to 49) cover the dashboard, starting and running a session, and
  after a session. They shipped as 874b09f, 4ee5dc0 and 9ae2113. DECISIONS.md has what
  changed.
- The Calendar items (the "commitment" line under the title, the "Could not suggest" toast)
  went with the calendar rebuild on 2026-10-21; that page's copy is new.
- The owner **kept these on purpose**:
  - the start panel's "About 33 min across 1 item today"
  - the quirky greetings ("The timer missed you.", "Long time no see!", "Locked in.", "You
    got this.", "Moon out, brain on.")
  - "A weekend session. Nice."
  - "A little space for what you want to do."
  - the streak-milestone and late-night session lines
  - "Nothing was shared, so the visualizer is idling."
  - "Needs more time than planned?"

## Batch 4, presented but not decided (Analytics and recap)

50. RecapView `note` (~546) and Profile "Days studied" note: "The last six months. 131
    active days, a longest run of 12." Profile already says "131 active days in the last
    six months, with a longest streak of 12." When empty: "The last six months. Each day
    with a session lights up a square."
    - Problem: a stiff fragment and an awkward stat, and the two pages say it differently.
    - Direction: one wording for both, "131 days in the last six months, 12 in a row at
      best."; when empty, "Last six months".
51. RecapView ~625 and Profile ~186: "Tuesday carries the most."
    - Direction: "Tuesdays are your big day."
52. RecapView ~424: "Tuesday led with 3.2 h." (month view: "Tuesday Oct 14 led with 3.2 h.")
    - Direction: "Tuesday was the big one: 3 h 10 min."
53. RecapView ~428: "The faint bars are the same days from last time."
    - Direction: "Faint bars: last week" (or month).
54. RecapView ~456: "12 h to 50 hours."
    - Direction: "12 h to go until 50 h."
55. RecapView ~500: "Your hours of the day fill in as you study."
    - Direction: "Fills in as you study."
56. RecapView `clockLabel` (~71): "You're a night owl 🦉" / "Early bird 🐦" / "Morning mind ☕"
    / "Afternoon focus 🌤️" / "Evening engine 🌆".
    - Problem: a sentence mixed with labels, alliteration that reads generated, and emoji
      (against the rules).
    - Direction: "Night owl", "Early bird", "Morning person", "Afternoon person", "Evening
      person", with a lucide icon.
57. RecapView ~114 chip: "Level with last week"
    - Direction: "Same as last week".
58. RecapView ~224: "Your first session starts the record."
    - Direction: "Nothing here yet."
59. RecapView ~364: "2 streak freezes on hand: a missed day uses one instead of resetting the
    count."
    - Direction: "2 streak freezes saved up. Each covers a missed day."
60. RecapView ~661, the grades tile: "Hours studied on each course, all time, beside its
    current mark. Many things shape a grade; this is just the two side by side."
    - Direction: drop it, or "All-time hours next to your current mark."
61. TrophyShelf ~101: "Your personal bests land here: biggest day, longest session, longest
    streak, and a few more. One session puts the first on the shelf."
    - Direction: "Your personal bests show up here after your first session."
62. Analytics ~53: "Where the time actually went. Each bar is one course split by its parts,
    so a course that looks busy but is all one topic shows up as a single wide band."
    - Direction: drop it.
63. Analytics ~100: "Each bar is logged time divided by what you estimated… 1× means you
    called it exactly; above 1× means it took longer than you thought. Only finished tasks
    with an estimate appear here."
    - Direction: "Time taken ÷ your estimate. Over 1× means it ran long."
64. Analytics ~94: "Complete a few estimated tasks to see how your estimates compare with
    reality."
    - Direction: "Finish a few tasks with estimates to see how close you got."
65. Analytics ~181: "How prepared you said you felt at the end of each session on this task, 1
    to 5. It is your own read, not a score."
    - Direction: drop it, or "Your 1–5 rating after each session."
66. Analytics ~162 and ~175: the pill "Distracted in 40% of sessions", then the sentence "You
    reported a distraction in 40% of the sessions you answered for."
    - Direction: keep the pill only.
67. Analytics `plannedVsNeeded` (~22): "No estimate, so there is nothing to be behind on." /
    "You have scheduled enough time to finish this." / "You are 1 h 20 min short of the
    time you would need."
    - Direction: "No estimate set." / "Enough time scheduled." / "1 h 20 min more to
      schedule."
68. Analytics ~166: "Went 4/5"
    - Direction: "Rated 4/5".
69. Analytics, the estimate table: "Logged / estimated" shows "%" while the bars show "×", and
    the Kind column shows raw "task" / "assessment".
    - Direction: use × in both; show "Task" / "Assessment".
70. Analytics ~128: the card heading "Per task" sits on a tab called "By task".
    - Direction: use one name.
71. packages/ui Recap.tsx ~399 and ~959: the tooltip "…: nothing yet" shows even for past
    days, and the climb tooltip "10 hours on Oct 3" reads as 10 hours studied that day.
    - Direction: "nothing" for past days; "Hit 10 hours on Oct 3".

## Not presented yet

### A. Generated analytics copy (packages/core, packages/ui)

- recap.ts `recapSummary`: every summary that names a best day ends ", and Tuesday did the
  heavy lifting".
  - Problem: the same flourish every week.
  - Also: "Up on last week" (clipped), "Right in step with last week" (polished), "Nothing
    on the board yet this week. The next session changes that.", "Your first week is on the
    board. Here's where you started." ("on the board" is used four times).
  - The " You hit your goal!" / " Almost there!" / " Good work!" endings are the owner's own
    words; leave them.
- recap.ts forecast: "At this pace you'll hit 100 hours by March 3 🎯". The emoji breaks the
  rules.
- recap.ts personality reasons:
  - "45% of your minutes start after 9 pm." Minutes don't start; say study time.
  - "Short bursts, 2.3 a day on the days you study." A decimal count of sessions.
  - "Your typical session runs 1.2 hours." Decimal hours; use "1 h 10 min".
- recap.ts records:
  - The label "Focused in a row" is ungrammatical; use "Focused sessions in a row".
  - Values use decimal hours ("4.3 hours"); use h/min.
  - Session-length takeaway: "Most of your sessions are 40 min to 1 h."
- highlights.ts ("Good to know"):
  - throughput: "1.4 problems per 10 min, up from 1.1, on Problem set 4" / "Compared with
    your previous session on it". Put the title first; shorten the detail.
  - mood: "You felt better after this session than the last one" / "On Midterm: 2 to 4".
    "this session" doesn't fit a weekly card, and the numbers have no scale.
  - preparedness: "Preparedness for Midterm went 2 to 4" / "Your own rating after each
    session". Use the Not yet…Ready words and drop the detail.
  - focus streak detail: "No distraction reported in any of them". Redundant.
  - goal progress: "You're 62% through Midterm" / "Of the time you estimated for it".
  - on pace: "Midterm is back on track" / "You pulled it back this week". Coach-ish.
  - all tasks done: "3 items"; say tasks.
  - estimate beat: "Finished Lab 2 in 1.5 hours, estimated 2 hours" / "Under your own
    estimate". Decimal hours, and the detail is redundant.
  - early finish: "Lab 2 done two days early" / "Ahead of its due date". The detail is
    redundant; "two" is spelled out but "3" isn't.
- equivalents.ts ("That's enough time to…"):
  - The world-rate cards read "That's enough time to see ~350 million Google searches made".
    You can't "see" those; reframe them as "In that time…" or drop the weakest.
  - Forced: "ride ~108,000 km around the Sun with Earth", "watch the fastest bamboo grow ~3
    cm".
  - Padded tails: "make ~3 pizzas from scratch, dough and all", "bake ~2 loaves of bread,
    rises included", "~2.1 average novels", "sleep ~1.5 full nights", "walk ~62 km at a
    stroll, about the Comrades ultramarathon…".
  - Decimal albums: "~3.2 albums front to back". "the entire season 1 of Breaking Bad ~2.3
    times" is clunky. "fly … ~2 times" but climbs say "twice".
- analytics.ts:
  - "You typically underestimate homework by ~30%" has no full stop.
  - "Your estimates are close to actual time. Keep estimating the same way." The second
    sentence is coaching.
  - "Accounting (direct)" reads like dev copy.
- badges.ts:
  - "Looking back" asks for four weekly reviews, but the weekly review page was removed, so
    the badge can't be earned.
  - Odd names: "Honest start", "Unassisted 30", "Hundred days", "Hundred sessions", "Paid in
    full".
  - "before 8:00" / "after 22:00" use 24-hour times; the app says "9 pm".
  - Descriptions end with a tacked-on "…, all time."
- rewards.ts: "120 XP short — Hoodie costs 300 XP." (an em dash and odd order) and "On
  cooldown until 2026-10-24." (a raw ISO date).
- Heatmap.tsx and Charts.tsx show decimal hours in tooltips and labels.

### B. Tasks, Plans, Calendar, Routines, Grades

- Today/Tasks tooltips: "Template for items under this", "Add inside" (its aria-label says
  "Add under X"), "4 inside", "Items added under this start from its template".
- Tasks empty state: "…Estimates and due dates let Komodon plan your day."
- Plan.tsx:
  - "At 5 h a week, it lands Fri, Dec 12." ("lands" is vague)
  - "Every topic is learned. Drills still welcome." and "Every topic learned. Nicely done."
  - "Daily top-up: X, 10 min. It sits with your routines."
  - the toast "Derivatives: learned."
  - the hint "Over the last two drill rounds, with every named miss redone. Shaky counts
    half." (dense)
  - "Name a miss when you log a drill and it comes back here the next day."
  - the tooltip "Drop it"
- Plans.tsx:
  - "…Topics, hours and drills, tracked like training." (a tagline)
  - "…Sessions on a topic count toward it, and drills tell you when it is actually learned."
- Routines:
  - the empty state "…Give each one an estimate, then tick it off — or start it as a timed
    session and tick it off at the end."
  - "Nothing outstanding. Everything due is ticked off." (says it twice)
  - "Cleared 3 missed. Ctrl+Z brings them back."
  - "Occurrences load for two weeks either side of today; navigate back to this week to tick
    anything off."
  - "…They still count in the four-week figure."
  - "missed" chip is lowercase; "25m" vs "25 min"; RoutinesDueCard shows "20m".
- Grades:
  - "84.5% of the 40% of this course that has been marked."
  - the target lines "An average of 85% is out of reach: you would need 112%…" / "…is already
    locked in." / "You need 92% on average from the rest of your grades to get an average of
    85%."
  - the weight notes: "Each item needs a weight - the share…", "…so 40% of the course is
    still unaccounted for.", "…which is 20% more than the whole course."
  - "Your own scale, set in settings."
  - "That has to be a number"
- NodeDialog:
  - "Filled in from the template on X. Change anything you like."
  - the label "Count activities as" with the hint "Used in the full review" (the same label
    is in TemplateDialog)
  - "Optional, inherited by children"
- TemplateDialog:
  - "What a new item under X starts as. Leave a field empty to keep the usual default. Items
    already added are not changed, and each one can still be edited on its own."
  - the colour hint "Set" / "None set. Items under this use the colour above it."
- IcsImportDialog:
  - three stacked sentences, with a semicolon
  - "Used for all-day events, which carry no duration."
- RoutineDialog: "Also how long a session for it runs by default".
- TrackerDialog: the "Unit" hint repeats the field label.
- TopicDialog: "Marked right, shaky or missed. It counts as learned once your accuracy holds,
  not when the hours run out."
- PlanDialog:
  - the toast "A weekly budget needs a number of hours."
  - "…Hours and resources are picked up when they are there."
  - "Copy a prompt for your AI" + "Paste it into ChatGPT or Claude, fill in your resources,
    then paste the table back here."
  - The placeholder "IB technicals" is the owner's own plan.

### C. Achievements, rewards, Profile, Leaderboard

- Achievements:
  - "Pick any of these backgrounds in Appearance to use them." This is misleading: the grid
    shows locked ones.
  - "Price rises each purchase this month (2 so far)."
  - "At least 24 h ahead. Never retroactive."
  - the toast "Break day set for 2026-10-25" (an ISO date)
  - "Level 4" shown twice
  - "Could not load the shop."
- RewardDialog:
  - the placeholder "An hour of doomscrolling" (RewardShelf spells it "doom scrolling")
  - "Mark it done in Tasks and the reward opens. It can be redeemed once."
  - "Optional — the grey one, size M"
  - "The price must be a whole number from 150 XP up."
- RewardRedeemed: the button "Go enjoy it" plus the body "You earned this one. Go and take
  it." (says it twice)
- RewardShelf:
  - "150 XP takes about an hour of focus. The current minimum is X XP. You can change this in
    Settings."
  - the empty state "…an hour of doom scrolling, that hoodie you always wanted, a night out,
    etc."
  - "taken 3×" vs "redeemed 3 times"
- Leaderboard: "The ten people with the most focused time so far. Names are the ones each
  person chose, and open their profile." / "No finished sessions yet. Yours could be the
  first."
- Profile:
  - "Your first session will start the count."
  - "Studied, all time" (also in DashboardStats)
  - the dev-facing error "The API this app is talking to is older than the app…"
  - "Your profile is not ready yet."
- DashboardStats: the day tooltip "Tuesday: nothing".

### D. Settings (Settings.tsx and its panels)

- Pomodoro labels: "Work (min)" / "Short break" / "Long break" / "Cycles before long". The
  units are inconsistent, and "Cycles before long" is clipped.
- "Changed recently. You can change it again Wed at 3:00 PM."
- The download is named `komogon.ics`; it should be komodon.
- "Your profile page, with the days you studied and your totals, and other people's. It sits
  at the end of the nav."
- "Now and then a short tip about Komodon shows under the start panel, with a link to try
  it."
- "…On the plain gradients it follows your system."
- "Where the pages sit on a computer. Phones keep the bar along the bottom."
- The toggle "Advanced" with "Upload your own image."
- "A session gives you XP when you complete at least 10 minutes of work, or when you mark a
  task done."
- Review: "The assessment after a session. Gives more data for analytics and planning."
- "Badge toasts" ("toast" is jargon).
- The sound hints repeat their labels ("A work block has ended.").
- "Comfortable minutes per day".
- Rest days: "Rest days never break a streak. Weekly changes take effect next Monday.
  Vacations need 48 hours notice and can be removed anytime. 2 changes left this week."
  Also "Pending: Sat, Sun from 2026-10-27." (an ISO date, and "none from" reads badly).
- "Site blocking (extension)" doesn't match the nav; "…during work intervals"; "Only the
  Chrome extension enforces this. Off by default."
- "Download .ics once".
- Google and Outlook calendar:
  - "Google Calendar is not configured on this server." / "Not configured, so this does not
    work yet."
  - a "Connected" chip next to "Connected. Last sync…"
  - the "Reconnect" chip used as a status
  - "Access was revoked. Reconnect to resume syncing."
  - "Read busy times from my primary calendar" ("my" vs "your")
  - "Could not start"
- DataPrivacy:
  - "Your data is yours."
  - "The export is a .zip containing CSV files of your activity."
  - "…It stays on this device and is cleared when you sign out."
  - three names for delete
- GradeScale: "Each row is the lowest percentage that earns that grade. Rows are sorted
  highest first when you save."; "band" vs "grade".
- AppearancePresets:
  - "Your current appearance settings saved as a preset."
  - "look" vs "preset"
  - "This browser would not save the preset. Is storage turned off?"
  - "Image not here"
  - "Glossy"/"Matte" tags don't match the panel options
- AccentPicker: "2 of 8 of your own".
- ExtensionBackgroundPicker: "Same as portal" / "The Chrome extension popup can share this
  page's background or use its own."
- PanelSettings:
  - "Every card and panel uses this. Glass shows the background through them; Matte turns
    off glass everywhere… Text colour adapts automatically so it stays readable."
  - "Background set (412 KB)"
  - "Resized to 2048 px and stored with your account."
  - "Canvas unavailable"
- ProfileFields:
  - "A JPEG, PNG or WebP. It is cropped to a square."
  - the university hint "…We send a code there to confirm it, and the profile shows only the
    university, never the address."
- NamePrompt: "Not now" is a permanent dismissal.
- SignOutButton: "You can sign back in any time. Your data stays in your account; only the
  copy kept in this browser is cleared."
- VisualizerSettings:
  - "Enable audio visualizer"
  - "Never ask again" / "Stop the focus screen offering to share audio on its own. You can
    still share from its controls."
  - "Follows your accent colour." / "One colour of your choosing."
  - the listening presets "Kicks and drops. Quick to react, quick to settle, hard to fool."
    and the two like it
  - two controls both called "Spikes"
  - "Bass in the middle" hint
  - "A glowing spectrum along the bottom of the screen."
  - "glowing" four times
  - "Reset the visualizer to its defaults"
- SettingsNav search keywords point at the wrong sections (confetti, motion, freeze).
- app-tips.ts: the rest-days tip and the calendar tip were reworded in batch 1; check the
  others still read well.

### E. Chrome extension (apps/extension)

- "portal" is used throughout the popup and options ("Open portal", "Sign in to the portal
  once and this remote connects automatically.").
- Popup:
  - "Session saved. Details are in the portal."
  - "The full review is in the app. It is fine to skip."
  - The chip shows the raw `timer.mode` ("unlimited").
  - "{1 h 30 min} of session."
  - The routine tick note joins raw badge keys and says "badge unlocked".
  - "Nothing outstanding. Every routine due is ticked off."
  - "… redeemed for N XP. Go enjoy it."
  - "Loading your shelf…"
  - "No rewards yet. Set one up in the portal and spend XP on it."
  - "· 40 to go"
  - "No reply"
- Raw errors ("Failed to fetch", "Validation failed") reach the popup.
- The blocked page:
  - "focus block" / "work intervals" / "work block" are three terms for one thing.
  - "You chose this in Komodon settings. It lifts automatically on your break." This is
    wrong for continuous sessions.
- The manifest description is a list of three.

### F. Marketing site (apps/site/index.html)

- The title and H1 "Productive, every time." are a hollow tagline that never says it's for
  studying. "Better than last time." would make a better headline.
- The meta description and hero lede are two lists of three. The runner line ("Study the way
  runners train…") is the best idea on the page and is buried.
- The section headings follow one template: "Track your focus sessions." / "Stay accountable
  and focused." / "Share your wins with friends."
- "Hours you can be proud of, and the information to plan ahead and get ahead."; "module by
  module" (the app says courses and tasks).
- "Komodon is built for getting work done. The Pomodoro timer is yours to shape, a timelapse
  records you…, and a site blocker is there if you want it."
- "Grow stronger and better together." This overclaims: there's no competition you can set
  up.

### G. Error messages that reach people (apps/api, packages/core)

- server.ts: "Validation failed", "Internal error".
- sessions.ts:
  - "Cannot study an archived node"
  - "Scheduled sessions need plannedEndAt"
  - "plannedEndAt must be in the future"
  - "That is before the session had started"
- nodes.ts: "Node not found", "A node cannot be its own parent", "That would create a cycle".
- planned-blocks.ts: "Imported events are commitments, not study time. Plan a block instead."
- me.ts:
  - "When your day starts can change once a day. Try again later."
  - "The reward minimum can change once a day."
  - "That background is locked or not yet purchased"
- calendar.ts / calendar-sync.ts: "…not configured on this server", "Google did not return a
  refresh token; retry with consent."
- "Missing bearer token".
- "There have been too many tries. Please wait a few minutes and try again."
- university.ts:
  - "That address is not from an Ontario university we know…"
  - "That code is not right." / "…and it has now expired." (it actually ran out of tries)
  - In the verification email, the code is buried mid-sentence.
- Validation messages that mention "integers" and "0 (Sunday)", and "Repeat every 1 to 52
  periods."

### H. Consistency, app-wide

- Raw ISO dates in sentences: the streak, break day, rest-day pending and cooldown messages.
- Durations: "25m" vs "25 min"; decimal hours ("1.5 h", "4.3 hours") vs "1 h 30 min".
- One thing, several names:
  - focus block / work block / work interval
  - the app / the portal / Komodon
  - look / preset
  - band / grade
  - "Achievement unlocked" / "badge unlocked"
- Text that just repeats its label: tooltips and hints across Settings, and the Shuffle
  tooltip.

### I. Never audited (new or rewritten after the audit snapshot)

The Landing page (`pages/Landing.tsx`), the rewritten Onboarding, SignIn's new copy,
ResetPassword, OutlookCalendarSettings, the dev-only LocalMailInbox and LocalTestAccounts, and
the rest of the FocusDashboard "Time to focus" screen.
