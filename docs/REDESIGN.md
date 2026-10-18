# Visual and UX overhaul (2026-10-08)

A visual and UX pass only. No new features, settings or personalization options.
Direction: Liquid Glass for the shell (nav, toolbars, sheets, controls), solid-feeling
surfaces for dense content, and running-app presentation (big numbers, rewarding recaps) for
progress. Screens were captured in the sandbox with six weeks of seeded history, plus an empty
account, before any change.

## Pass 1: visual critique

1. **Everything is the same card.** Dashboard is ten stacked panels with the same radius,
   border, blur and padding. Nothing leads; the eye has nowhere to land.
2. **Glass is decoration, not hierarchy.** Nav, cards, tables, hints and tooltips all share
   one translucent recipe. Dense content (task tree, grade tables) sits on the busiest
   surface; floating chrome (nav) looks no different from content.
3. **The numbers are not the heroes.** "65.1 h" is the only large figure on the dashboard.
   This week (the number you can still move) is a 17px line beside a 72px ring.
4. **Type.** The stack asks for Inter, which is never loaded, so every OS falls back to
   something different. Hierarchy is carried by grey, not size: piles of 12px muted text.
5. **Accent used as text fails contrast.** Amber, mint and sky links on light backgrounds
   are around 2:1 ("All tasks", "Manage", "Change goal"). White text on a light custom accent
   is unreadable.
6. **Chip soup.** Done / On track / Assessment / Task chips on every row and card. "Done" on
   a task you have not ticked (it means the estimate is used up) reads as a contradiction.
7. **Template tells.** Underlined "Open the focus screen" link next to a pill button, emoji
   inside an icon tile, `·`-joined meta lines that wrap mid-thought, dashed empty boxes.
8. **Charts.** The Session lengths chart scales its SVG to the tile width, so its 11px labels
   render at 30px+ and collide. Heatmaps sit small and left-aligned in wide cards.
9. **Completion moment.** The end-of-session sheet leads with "0 XP"; the focused time, the
   thing you actually did, is a small stat underneath.
10. **Mobile nav** is a horizontally scrolling text strip with arrows; most tabs are hidden.

## Pass 2: UX critique

1. **Primary action buried in prose.** Start is inside a card titled "Ready when you are",
   between a sub-line and a quote; the useful "Most pressing" list starts folded.
2. **Dashboard order** puts tips (three dismissible cards) above trackers, so the bottom
   third of the page is admin.
3. **Navigation on phones** needs a sideways scroll to reach Analytics or Achievements.
4. **Status language** ("Done" vs ticked off) is ambiguous on Today, Coming up and Tasks.
5. **Achievements** shows locked and unlocked badges at nearly the same weight, so the
   unlocked ones do not feel earned.
6. **Grades** tables look like a form (bordered input on every cell), not a record.

## Plan (in order)

1. Tokens: system font stacks (SF Pro / Segoe UI Variable), display numerals, type scale,
   concentric radii, three materials (chrome glass, sheet glass, content surface), specular
   rim, accessible `--accent-text`, accent foreground chosen by contrast,
   `prefers-reduced-transparency`, spring easing.
2. Shell: floating glass top bar with a streak and level cluster; a floating glass tab bar
   with icons on phones.
3. Dashboard: week-first hero stats, Start as the clear primary action, quieter tips,
   cleaner task cards, unambiguous status labels.
4. Components: buttons, segmented controls, inputs, chips, modals as sheets, toasts.
5. Completion: focused time as the hero of the end-of-session sheet.
6. Analytics: charts sized in real pixels; hero and tiles on the content material.
7. Achievements, Grades, Tasks, Routines, Settings polish.
8. Motion: spring presses, route fade-rise, all under reduced motion.

## What changed

**Tokens and materials** (`packages/ui/tokens.css`, `styles.css`, `theme.ts`, `contrast.ts`,
`Backdrop.tsx`)

- System type: SF Pro on Apple, Segoe UI Variable on Windows (Inter was never loaded).
  Display stack for headings and numbers, `--text-stat` and `--text-hero` sizes.
- Three materials: chrome (nav, tab bar), glass (cards, sheets), content panel (lists,
  tables, charts). Specular top rim on glass, spring easing token, concentric radii.
- One text context: anything on the backdrop or on glass uses the backdrop-adapted set;
  opaque panels use the theme's own. Inputs, segmented controls and secondary buttons tint
  from the text colour, so they read on glass, panels and custom panel colours alike.
- Accent text and the label on accent buttons are measured, not guessed
  (`readableAccent`, `accentForeground`). Custom accents and custom panel colours included.
- Photos: text colour now chosen by measured contrast against the photo as shown (under the
  theme's scrim). Fixes light theme + mid-tone photos (Sherbet) putting white titles on pink.
  A page wash is added only when the page's own titles need it; a soft halo covers patches.
- Glass on photos thickens until even the quietest text (64%) clears 4.5:1.
- `prefers-reduced-transparency` turns every material solid. Reduced motion covers all new
  animation.
- `pnpm audit:contrast` now also checks muted and subtle text, page text on the backdrop,
  every photo in both themes, and the accent presets as text and as button labels (656
  checks, all pass).

**Shell**: chrome capsule with a sliding neutral lens, streak pill and level ring; on phones a
floating seven-tab bar with icons replaces the sideways-scrolling strip. Pages rise in.

**Dashboard**: Start leads (primary button, focus screen as a real secondary button, plan
list open by default). Stat hero: this week in hero type, goal bar, seven day columns, all-time
and streak underneath. Coming up and Routines side by side. Task cards lead with time logged
and a round play button. Tips moved to the bottom, quieter. A new account sees "add your
first course" before any numbers. Days focused shows its totals as figures.

**Completion**: the end-of-session sheet leads with focused time (counts up), XP as a reward
pill, bonuses as small tallies, streak and level as tiles, earned badges glowing.

**Elsewhere**: live session card with a breathing status dot; Analytics charts draw at real
pixel width (labels no longer balloon), chart tiles on the content material; Tasks tree with a
proper tick control, colour dot, phone indentation, and chips only for statuses that need a
look; Routines week grid wraps titles, four-week adherence as a figure; Achievements level hero
and earned vs locked badges; Calendar "planned vs needed" as a list with bars instead of a
wall of chips; settings nav and hovers use the neutral lens; sheets rise from the bottom on
phones.

**Copy**: "Done" for a used-up estimate now reads "Estimate met", so it no longer contradicts
the tick.

## Recommended next

1. Analytics hero shows a giant "0" on an empty week; swap it for the line under it.
2. Mobile Tasks still spends ~110px on the left controls; consider moving play into the row's
   trailing edge on phones.
3. The three back-to-back prompts on a first session (focus tab, visualizer, timelapse) are
   one too many; consider asking the timelapse question at the first start instead of the end.
4. The Chrome extension shares these tokens and builds cleanly, but was not visually reviewed.
