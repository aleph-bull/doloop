import { contrastRatio, hslToRgb, relativeLuminance, type RGB } from './contrast';

export type ResolvedTheme = 'light' | 'dark';

/**
 * Resolve the theme to apply. Kickoff decision: when the mode is 'system' and the
 * system preference cannot be read, default to dark.
 */
export function resolveTheme(
  mode: 'system' | 'light' | 'dark',
  matchMedia: ((q: string) => { matches: boolean }) | undefined = typeof window !== 'undefined'
    ? window.matchMedia?.bind(window)
    : undefined,
): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') return mode;
  if (!matchMedia) return 'dark';
  try {
    if (matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    return 'dark';
  } catch {
    return 'dark';
  }
}

export interface ApplyThemeOptions {
  mode: 'system' | 'light' | 'dark';
  accent: string;
  reducedMotion: 'system' | 'on' | 'off';
}

/** Write theme/accent/motion attributes onto <html>. Safe to call repeatedly. */
export function applyTheme(opts: ApplyThemeOptions, root: HTMLElement = document.documentElement) {
  root.dataset.theme = resolveTheme(opts.mode);
  root.dataset.accent = opts.accent;
  // data-motion: 'on' forces animations even if the OS prefers reduced; 'off' disables them.
  if (opts.reducedMotion === 'system') delete root.dataset.motion;
  else root.dataset.motion = opts.reducedMotion === 'on' ? 'off' : 'on';
}

export interface PanelStyleOptions {
  panel: 'opaque' | 'glass' | 'custom' | 'matte';
  /** Hex colour for 'custom'. */
  color: string;
  /** 0..1 for 'custom'. */
  alpha: number;
  theme: ResolvedTheme;
}

function hexToRgbLocal(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lum([r, g, b]: [number, number, number]): number {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

/**
 * Surface for dense panels. 'glass' reuses the glass recipe; 'custom' sets the panel fill to
 * the user's colour and picks light or dark panel text from the composited luminance.
 */
export function applyPanelStyle(
  opts: PanelStyleOptions,
  root: HTMLElement = document.documentElement,
): RGB | null {
  root.dataset.panel = opts.panel;
  const clear = [
    '--panel-fill',
    '--panel-fg',
    '--panel-fg-muted',
    '--panel-fg-subtle',
    '--panel-border',
  ];
  if (opts.panel !== 'custom') {
    for (const v of clear) root.style.removeProperty(v);
    root.style.removeProperty('--panel-accent-text');
    return null;
  }
  const rgb = hexToRgbLocal(/^#[0-9a-f]{6}$/i.test(opts.color) ? opts.color : '#151827');
  const alpha = Math.min(1, Math.max(0.2, opts.alpha));
  const base: [number, number, number] = opts.theme === 'dark' ? [11, 13, 20] : [238, 240, 245];
  const composite = rgb.map((c, i) => Math.round(c * alpha + base[i]! * (1 - alpha))) as [
    number,
    number,
    number,
  ];
  const lightText = lum(composite) < 0.4;
  root.style.setProperty('--panel-fill', `rgb(${rgb.join(' ')} / ${alpha.toFixed(2)})`);
  root.style.setProperty('--panel-fg', lightText ? '#f2f3f8' : '#0f1220');
  root.style.setProperty(
    '--panel-fg-muted',
    lightText ? 'rgb(242 243 248 / 0.78)' : 'rgb(15 18 32 / 0.72)',
  );
  root.style.setProperty(
    '--panel-fg-subtle',
    lightText ? 'rgb(242 243 248 / 0.6)' : 'rgb(15 18 32 / 0.55)',
  );
  root.style.setProperty(
    '--panel-border',
    lightText ? 'rgb(255 255 255 / 0.14)' : 'rgb(15 18 32 / 0.12)',
  );
  return composite;
}

/** The preset hues, mirroring tokens.css, so an accent can be named as a colour without the DOM. */
const ACCENT_PRESET_HSL: Record<string, [number, number, number]> = {
  indigo: [240, 84, 62],
  sky: [199, 89, 48],
  mint: [160, 64, 42],
  amber: [38, 92, 50],
  rose: [346, 77, 56],
  violet: [271, 81, 60],
};

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lig - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const hex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * The accent setting ('indigo', or 'custom:<h>,<s>,<l>') as a hex colour. Computed from
 * the setting rather than read back from <html>, which may not have been themed yet.
 */
export function accentHexFor(accent: string): string {
  if (accent.startsWith('custom:')) {
    const [h, s, l] = accent.slice(7).split(',').map(Number);
    return hslToHex((((h ?? 240) % 360) + 360) % 360, s ?? 84, l ?? 62);
  }
  const preset = ACCENT_PRESET_HSL[accent] ?? ACCENT_PRESET_HSL.indigo!;
  return hslToHex(preset[0], preset[1], preset[2]);
}

/** The accent setting as HSL numbers (h 0-360, s/l 0-100). */
function accentHsl(accent: string): [number, number, number] {
  if (accent.startsWith('custom:')) {
    const [h, s, l] = accent.slice(7).split(',').map(Number);
    return [(((h ?? 240) % 360) + 360) % 360, s ?? 84, l ?? 62];
  }
  return ACCENT_PRESET_HSL[accent] ?? ACCENT_PRESET_HSL.indigo!;
}

/** Surfaces the accent text is measured against: a light card and a dark one. */
const LIGHT_SURFACE: RGB = [244, 245, 248];
const DARK_SURFACE: RGB = [30, 32, 44];

/**
 * The accent, moved in lightness only as far as it takes to reach `ratio` against `bg`.
 * Keeps hue and saturation, so a link still reads as the user's colour.
 */
export function readableAccent([h, s, l]: [number, number, number], bg: RGB, ratio = 4.6): string {
  const darker = relativeLuminance(bg) > 0.4;
  let lig = l;
  for (let i = 0; i < 100; i++) {
    if (contrastRatio(hslToRgb(h, s, lig), bg) >= ratio) break;
    lig += darker ? -1 : 1;
    if (lig <= 0 || lig >= 100) break;
  }
  return `hsl(${h} ${s}% ${Math.max(0, Math.min(100, lig))}%)`;
}

/**
 * Solid accent fills never go past this saturation. A full-strength accent as a solid
 * block (a badge medal, a primary button, a "New" pill) read as a hot, saturated colour;
 * the user asked for it gone everywhere (2026-10-17). Text and tints keep the accent as is.
 */
export const FILL_MAX_SATURATION = 45;

/**
 * The fill behind white labels: the accent's hue, muted to at most FILL_MAX_SATURATION, and
 * taken just dark enough for white to read on it. Labels stay white on every accent; nothing
 * goes black. Only the lightness moves after that: raising saturation as it darkened
 * (2026-10-08) is what turned a dusty pink into a magenta.
 */
export function accentFill([h, s, l]: [number, number, number]): string {
  const sat = Math.min(s, FILL_MAX_SATURATION);
  let lig = l;
  while (lig > 0 && contrastRatio(hslToRgb(h, sat, lig), [255, 255, 255]) < 4.5) lig -= 1;
  return `hsl(${h} ${Math.round(sat)}% ${lig}%)`;
}

/**
 * A colour the user picked themselves is used exactly as picked, fills included; the label
 * on it is whichever of white or near-black reads better, rather than the colour being
 * changed to suit a white label.
 */
export function ownAccentFill([h, s, l]: [number, number, number]): { fill: string; fg: string } {
  const rgb = hslToRgb(h, s, l);
  const dark: RGB = [17, 19, 24];
  const fg =
    contrastRatio(rgb, [255, 255, 255]) >= contrastRatio(rgb, dark) ? '#ffffff' : '#111318';
  return { fill: `hsl(${h} ${s}% ${l}%)`, fg };
}

export interface UserThemeLike {
  theme: {
    mode: 'system' | 'light' | 'dark';
    accent: string;
    panel: 'opaque' | 'glass' | 'custom' | 'matte';
    panelColor: string;
    panelAlpha: number;
  };
  effects: { reducedMotion: 'system' | 'on' | 'off' };
}

/**
 * Apply everything from user settings that lives on <html>: theme, accent (preset or
 * "custom:<h>,<s>,<l>"), motion, and panel surface. Used by the portal and the extension.
 */
export function applyUserTheme(
  settings: UserThemeLike,
  root: HTMLElement = document.documentElement,
): ResolvedTheme {
  const custom = settings.theme.accent.startsWith('custom:');
  applyTheme(
    {
      mode: settings.theme.mode,
      accent: custom ? 'custom' : settings.theme.accent,
      reducedMotion: settings.effects.reducedMotion,
    },
    root,
  );
  if (custom) {
    const [h, s, l] = settings.theme.accent.slice(7).split(',').map(Number);
    root.style.setProperty('--accent-h', String(h ?? 240));
    root.style.setProperty('--accent-s', `${s ?? 84}%`);
    root.style.setProperty('--accent-l', `${l ?? 62}%`);
  } else {
    root.style.removeProperty('--accent-h');
    root.style.removeProperty('--accent-s');
    root.style.removeProperty('--accent-l');
  }
  // Measured, not guessed: accent text that clears AA on light and dark surfaces, and the
  // fill a white button label reads on.
  const hsl = accentHsl(settings.theme.accent);
  root.style.setProperty('--accent-text-on-light', readableAccent(hsl, LIGHT_SURFACE));
  root.style.setProperty('--accent-text-on-dark', readableAccent(hsl, DARK_SURFACE));
  if (custom) {
    const own = ownAccentFill(hsl);
    root.style.setProperty('--accent-fill', own.fill);
    root.style.setProperty('--accent-fg', own.fg);
  } else {
    root.style.setProperty('--accent-fill', accentFill(hsl));
    root.style.removeProperty('--accent-fg');
  }
  const resolved = resolveTheme(settings.theme.mode);
  const panelBehind = applyPanelStyle(
    {
      panel: settings.theme.panel,
      color: settings.theme.panelColor,
      alpha: settings.theme.panelAlpha,
      theme: resolved,
    },
    root,
  );
  // A custom panel colour gets its own accent text, measured against that colour.
  if (panelBehind) root.style.setProperty('--panel-accent-text', readableAccent(hsl, panelBehind));
  return resolved;
}

export interface ExtensionBackdropChoice {
  backgroundId: string;
  customImageUrl: string | null;
}

/**
 * Which background the extension shows: the portal's (preset or custom image), the uploaded
 * image, or a preset of its own. `uploadedDataUrl` is the cached upload, if any.
 */
export function resolveExtensionBackdrop(
  theme: { backgroundId: string; customBackgroundUrl: string | null; extensionBackground: string },
  uploadedDataUrl: string | null,
): ExtensionBackdropChoice {
  const choice = theme.extensionBackground || 'same';
  if (choice === 'upload')
    return { backgroundId: theme.backgroundId, customImageUrl: uploadedDataUrl };
  if (choice !== 'same') return { backgroundId: choice, customImageUrl: null };
  const custom = theme.customBackgroundUrl === 'upload' ? uploadedDataUrl : null;
  return { backgroundId: theme.backgroundId, customImageUrl: custom };
}
