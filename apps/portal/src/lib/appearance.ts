import { CUSTOM_BACKGROUND_UPLOAD, type UserSettings } from '@komodoit/core';
import { applyTheme, applyUserTheme, resolveTheme, type ResolvedTheme } from '@komodoit/ui';
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
