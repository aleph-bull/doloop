# @komogon/ui

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

| Group      | Tokens                                                                                                                                                                            | Notes                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Typography | `--font-sans`, `--font-mono`, `--text-*`, `--tracking-*`, `--leading-*`                                                                                                           | Inter Variable, bundled, with system fallback; Satoshi for the wordmark only. See Typography below.        |
| Radius     | `--radius-sm/md/lg/xl/pill`                                                                                                                                                       | Glass surfaces use `lg` or `xl`.                                                                           |
| Motion     | `--dur-fast/base/slow` (150/200/250 ms), `--ease-out`, `--ease-in-out`                                                                                                            | Every non-essential animation must read a `--dur-*` so it can be zeroed.                                   |
| Spacing    | `--space-1..12`                                                                                                                                                                   | 4 px base.                                                                                                 |
| Accent     | `--accent`, `--accent-strong`, `--accent-soft`, `--accent-fg`, `--accent-h/s/l`                                                                                                   | Six presets on `data-accent`; custom accent sets the HSL parts. `--accent-fg` flips to dark text on amber. |
| Status     | `--status-ok/warn/bad/info`                                                                                                                                                       | Pace status colors. Never used as scolding red on analytics.                                               |
| Surfaces   | `--bg-base`, `--bg-elevated`, `--bg-sunken`                                                                                                                                       | Flat backgrounds.                                                                                          |
| Text       | `--fg`, `--fg-muted`, `--fg-subtle`, `--fg-on-glass`                                                                                                                              | `--fg-on-glass` is swapped by the custom-background luminance sampler.                                     |
| Borders    | `--border`, `--border-strong`                                                                                                                                                     |                                                                                                            |
| Glass      | `--glass-fill`, `--glass-fill-strong`, `--glass-border`, `--glass-border-inner`, `--glass-shadow`, `--glass-top-edge`, `--glass-blur`, `--glass-blur-strong`, `--glass-saturate`  | The `.glass` recipe: low-alpha fill, 1 px inner light border, blur + saturate backdrop. No top sheen.      |
| Panel      | `--panel-fill`, `--panel-border`                                                                                                                                                  | Near-opaque surfaces for dense content (task tree, tables, charts).                                        |
| Overlay    | `--overlay-scrim`                                                                                                                                                                 | Behind modals and the reward overlay.                                                                      |
| Focus      | `--ring`                                                                                                                                                                          | Two-tone focus ring, applied by `:focus-visible`.                                                          |

## Typography

The type rules, as set on 2026-10-17. New UI follows these; change them here first.

| Use                                                  | Font                                                 | Weight  | Tracking                                               | Where it lives                                                     |
| ---------------------------------------------------- | ---------------------------------------------------- | ------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| Everything: body, labels, buttons, card titles       | **Inter Variable** (`--font-sans`)                   | 400–600 | normal                                                 | `tokens.css`, bundled from `@fontsource-variable/inter` (opsz cut) |
| Page titles (`.page-title`) and other headings       | **Inter Variable** (`--font-display`)                | 600     | `--tracking-display`: **0**                            | `apps/portal/src/index.css`                                        |
| Big numbers (hero figures, timer, stats, `.tabular`) | **Inter Variable**, tabular figures                  | 600–700 | `--tracking-numeric` and the hero figures: **-0.01em** | `tokens.css`, `index.css`, `plans.css`                             |
| The "Komodon" wordmark in the nav (`.brand`) only    | **Satoshi Variable** (`--font-brand`)                | **600** | `--tracking-tight`                                     | `apps/portal/public/fonts/`, `@font-face` in `index.css`           |
| Canvas drawings (share card, timelapse clock)        | `'Inter Variable'` named in the canvas `font` string | 600–700 | —                                                      | `share-card.ts`, `lib/timelapse.ts`                                |

- **Inter** uses the optical-size axis (`opsz.css`), so large text automatically gets Inter's tighter display cut. Do not add negative tracking on top: it was tuned for SF Pro / Segoe and makes Inter crowd. Keep page titles at 0 and big numbers at no tighter than -0.01em.
- **Satoshi** is for the wordmark and nothing else. Stylistic sets on: `ss01` (alternate G, a and ®) and `ss03` (alternate t), via `font-feature-settings: 'ss01', 'ss03'`. Off: `ss02` (alternate g) and the alternate Q. The `.woff2` ships unmodified with its ITF Free Font License (`Satoshi-LICENSE.txt`); do not subset or convert it.
- Both fonts are self-hosted, so the app looks the same offline. The system stack (SF Pro, Segoe UI Variable) is only the fallback while they load.
- Text on the photo backdrop (page titles, the line under them, section heads) gets a soft halo: `text-shadow` at 25% / 35% of `--glass-solid` (`styles.css`). Keep it faint.
- Charts with labels inside a ring or bar need room for Inter's wider letters: the Focus quality ring is 136 px, and the day chart's labels are 14 px (`.rc-tick.is-lg`).

## Panel surface setting

`data-panel="opaque|glass|custom"` on `<html>` (set by `applyPanelStyle()`). Glass makes `.panel` translucent with the strong-glass recipe; custom sets `--panel-fill` to the user's colour and overrides `--panel-fg`, `--panel-fg-muted`, `--panel-fg-subtle`, and `--panel-border` inline, chosen by luminance so text stays readable.

## Where glass is allowed

Glass: top nav, timer card, modals, reward overlay, node cards, daily quote card, analytics highlight cards (heavier-than-spec by kickoff decision).

Opaque `.panel`: task tree, tables, charts, settings forms. Anything dense enough that a busy background would hurt legibility.

## Contrast rule

Every shipped background is checked in both themes so that `--fg` on `.panel` and `--fg-on-glass` on `.glass` reach 4.5:1. Custom uploaded backgrounds sample average luminance and raise `--glass-fill` alpha until the ratio passes.
