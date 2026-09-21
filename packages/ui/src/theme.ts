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
  panel: 'opaque' | 'glass' | 'custom';
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
) {
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
    return;
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
}

export interface UserThemeLike {
  theme: {
    mode: 'system' | 'light' | 'dark';
    accent: string;
    panel: 'opaque' | 'glass' | 'custom';
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
  const resolved = resolveTheme(settings.theme.mode);
  applyPanelStyle(
    {
      panel: settings.theme.panel,
      color: settings.theme.panelColor,
      alpha: settings.theme.panelAlpha,
      theme: resolved,
    },
    root,
  );
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
  const custom =
    theme.customBackgroundUrl === 'upload' ? uploadedDataUrl : theme.customBackgroundUrl;
  return { backgroundId: theme.backgroundId, customImageUrl: custom ?? null };
}
