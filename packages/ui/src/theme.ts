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
