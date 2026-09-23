import { CUSTOM_BACKGROUND_UPLOAD, type UserSettings } from '@doloop/core';
import { applyTheme, applyUserTheme, resolveTheme, type ResolvedTheme } from '@doloop/ui';
import { useEffect } from 'react';
import { useCustomBackground } from './queries';

export interface Appearance {
  theme: ResolvedTheme;
  backgroundId: string;
  customImageUrl: string | null;
}

/**
 * Applies the user's theme to <html> and says which backdrop to draw. Shared by the app
 * shell and the focus screen, so a tab of either always looks like the same product.
 */
export function useAppearance(settings: UserSettings | undefined): Appearance {
  useEffect(() => {
    if (settings) applyUserTheme(settings);
  }, [settings]);

  // Follow OS theme changes while in system mode.
  useEffect(() => {
    if (!settings || settings.theme.mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () =>
      applyTheme({
        mode: 'system',
        accent: settings.theme.accent.startsWith('custom:') ? 'custom' : settings.theme.accent,
        reducedMotion: settings.effects.reducedMotion,
      });
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings]);

  const wantsUpload = settings?.theme.customBackgroundUrl === CUSTOM_BACKGROUND_UPLOAD;
  const uploaded = useCustomBackground(wantsUpload);
  return {
    theme: resolveTheme(settings?.theme.mode ?? 'system'),
    backgroundId: settings?.theme.backgroundId ?? 'aurora',
    customImageUrl: wantsUpload ? (uploaded.data?.dataUrl ?? null) : null,
  };
}

/** The accent as hex, read back from the theme so a custom accent is honoured too. */
export function accentHex(): string {
  if (typeof window === 'undefined') return '#6366f1';
  const probe = document.createElement('span');
  probe.style.color = 'var(--accent)';
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const m = rgb.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return '#6366f1';
  return `#${[m[1], m[2], m[3]].map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;
}
