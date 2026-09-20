# @doloop/ui

Shared design tokens and React components for the portal and the extension popup.

## Files

- `tokens.css` — every color, radius, type size, motion duration, and glass value. Nothing else in the codebase hard-codes a color.
- `src/styles.css` — base element styles plus the `.glass`, `.glass-strong`, `.panel`, and `.tabular` utility classes.
- `src/theme.ts` — `resolveTheme()` and `applyTheme()` which set `data-theme`, `data-accent`, and `data-motion` on `<html>`.
- `src/components/*` — React components.

## Theme switching

`<html data-theme="light|dark" data-accent="indigo|sky|mint|amber|rose|violet" data-motion="on|off">`

- `data-theme` absent: follows `prefers-color-scheme`. The app always sets it on boot. When the OS preference cannot be read, the resolver returns **dark** (kickoff decision).
- `data-accent` absent: indigo. A custom accent sets `--accent-h/s/l` inline on `<html>` instead.
- `data-motion="off"`: all `--dur-*` durations become 0. Absent: follows `prefers-reduced-motion`. `on`: forces animation even when the OS prefers reduced motion (user override).

## Token groups

| Group      | Tokens                                                                                                                                                                            | Notes                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Typography | `--font-sans`, `--font-mono`, `--text-*`, `--tracking-*`, `--leading-*`                                                                                                           | One variable sans (Inter) with system fallback. `.tabular` gives tabular figures + tight tracking for timers and hours. |
| Radius     | `--radius-sm/md/lg/xl/pill`                                                                                                                                                       | Glass surfaces use `lg` or `xl`.                                                                                        |
| Motion     | `--dur-fast/base/slow` (150/200/250 ms), `--ease-out`, `--ease-in-out`                                                                                                            | Every non-essential animation must read a `--dur-*` so it can be zeroed.                                                |
| Spacing    | `--space-1..12`                                                                                                                                                                   | 4 px base.                                                                                                              |
| Accent     | `--accent`, `--accent-strong`, `--accent-soft`, `--accent-fg`, `--accent-h/s/l`                                                                                                   | Six presets on `data-accent`; custom accent sets the HSL parts. `--accent-fg` flips to dark text on amber.              |
| Status     | `--status-ok/warn/bad/info`                                                                                                                                                       | Pace status colors. Never used as scolding red on analytics.                                                            |
| Surfaces   | `--bg-base`, `--bg-elevated`, `--bg-sunken`                                                                                                                                       | Flat backgrounds.                                                                                                       |
| Text       | `--fg`, `--fg-muted`, `--fg-subtle`, `--fg-on-glass`                                                                                                                              | `--fg-on-glass` is swapped by the custom-background luminance sampler.                                                  |
| Borders    | `--border`, `--border-strong`                                                                                                                                                     |                                                                                                                         |
| Glass      | `--glass-fill`, `--glass-fill-strong`, `--glass-border`, `--glass-border-inner`, `--glass-shadow`, `--glass-highlight`, `--glass-blur`, `--glass-blur-strong`, `--glass-saturate` | The `.glass` recipe: low-alpha fill, 1 px inner light border, blur + saturate backdrop, top highlight.                  |
| Panel      | `--panel-fill`, `--panel-border`                                                                                                                                                  | Near-opaque surfaces for dense content (task tree, tables, charts).                                                     |
| Overlay    | `--overlay-scrim`                                                                                                                                                                 | Behind modals and the reward overlay.                                                                                   |
| Focus      | `--ring`                                                                                                                                                                          | Two-tone focus ring, applied by `:focus-visible`.                                                                       |

## Where glass is allowed

Glass: top nav, timer card, modals, reward overlay, node cards, daily quote card, analytics highlight cards (heavier-than-spec by kickoff decision).

Opaque `.panel`: task tree, tables, charts, settings forms. Anything dense enough that a busy background would hurt legibility.

## Contrast rule

Every shipped background is checked in both themes so that `--fg` on `.panel` and `--fg-on-glass` on `.glass` reach 4.5:1. Custom uploaded backgrounds sample average luminance and raise `--glass-fill` alpha until the ratio passes.
