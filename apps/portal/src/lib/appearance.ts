import {
  CUSTOM_BACKGROUND_UPLOAD,
  DEFAULT_SETTINGS,
  type BackgroundTexture,
  type UserSettings,
} from '@komogon/core';
import { applyUserTheme, resolveTheme, type GlassChoice, type ResolvedTheme } from '@komogon/ui';
import { useEffect } from 'react';
import { applyFonts } from './fonts';
import { useCustomBackground } from './queries';

export interface Appearance {
  theme: ResolvedTheme;
  backgroundId: string;
  customImageUrl: string | null;
  /** Their own glass colour and weight (Appearance › Advanced), for the Backdrop. */
  glass: GlassChoice;
  /** The pattern over a plain background, for the Backdrop. */
  texture: BackgroundTexture;
  /** The glass's blur and colour boost, so the Backdrop can blur the photo once for cards. */
  frost: { blur: number; saturate: number };
  /** The photo's own blur and brightness (Appearance, under the background). */
  adjust: { blur: number; brightness: number };
}

type Resolved = Omit<Appearance, 'glass' | 'texture' | 'frost' | 'adjust'> & {
  /** An upload is on and its picture is (or may yet be) in this browser. */
  uploadOn: boolean;
};

/** The theme and backdrop the settings come to, without touching <html>. */
export function useResolvedAppearance(settings: UserSettings | undefined): Resolved {
  const wantsUpload = settings?.theme.customBackgroundUrl === CUSTOM_BACKGROUND_UPLOAD;
  const uploaded = useCustomBackground(wantsUpload, settings?.theme.customBackgroundId ?? null);
  const customImageUrl = wantsUpload ? (uploaded.data ?? null) : null;
  // An upload whose picture isn't in this browser shows the theme's own background instead.
  const missing = wantsUpload && uploaded.isSuccess && !uploaded.data;
  const backgroundId = settings?.theme.backgroundId ?? 'aurora';
  return {
    theme: resolveTheme(settings?.theme.mode ?? DEFAULT_SETTINGS.theme.mode),
    backgroundId,
    customImageUrl,
    uploadOn: wantsUpload && !missing,
  };
}

/** The resolved light or dark theme alone, for previews that draw in it. */
export function useResolvedTheme(settings: UserSettings | undefined): ResolvedTheme {
  return useResolvedAppearance(settings).theme;
}

/**
 * Applies the user's theme to <html> and says which backdrop to draw. Shared by the app
 * shell and the focus screen, so a tab of either always looks like the same product.
 */
export function useAppearance(settings: UserSettings | undefined): Appearance {
  const resolved = useResolvedAppearance(settings);
  // The background on screen: an upload has no colour of its own for matte panels to take.
  const backdropId = resolved.uploadOn ? null : resolved.backgroundId;

  useEffect(() => {
    if (settings) applyUserTheme(settings, document.documentElement, backdropId);
  }, [settings, backdropId]);

  // The timer, heading and text fonts, each once it has loaded.
  const fontText = settings?.theme.fontText;
  const fontHeading = settings?.theme.fontHeading;
  const fontTimer = settings?.theme.fontTimer;
  useEffect(() => {
    if (!settings) return;
    applyFonts(
      {
        fontText: fontText ?? DEFAULT_SETTINGS.theme.fontText,
        fontHeading: fontHeading ?? DEFAULT_SETTINGS.theme.fontHeading,
        fontTimer: fontTimer ?? DEFAULT_SETTINGS.theme.fontTimer,
      },
      document.documentElement,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!settings, fontText, fontHeading, fontTimer]);

  // Follow OS theme changes while the system decides: only when someone picked System.
  const followsSystem = settings?.theme.mode === 'system';
  useEffect(() => {
    if (!settings || !followsSystem) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    // All of it, not just light or dark: matte panels on a solid colour shade for the theme.
    const onChange = () => applyUserTheme(settings, document.documentElement, backdropId);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings, followsSystem, backdropId]);

  return {
    theme: resolved.theme,
    backgroundId: resolved.backgroundId,
    customImageUrl: resolved.customImageUrl,
    glass: {
      color: settings?.theme.glassColor ?? null,
      alpha: settings?.theme.glassAlpha ?? null,
    },
    texture: settings?.theme.texture ?? 'none',
    // Held to the same limits applyGlassFrost puts on the CSS.
    frost: {
      blur: Math.min(
        40,
        Math.max(0, settings?.theme.glassBlur ?? DEFAULT_SETTINGS.theme.glassBlur),
      ),
      saturate: Math.min(
        200,
        Math.max(100, settings?.theme.glassSaturate ?? DEFAULT_SETTINGS.theme.glassSaturate),
      ),
    },
    adjust: {
      blur: Math.min(40, Math.max(0, settings?.theme.backgroundBlur ?? 0)),
      brightness: Math.min(60, Math.max(-60, settings?.theme.backgroundBrightness ?? 0)),
    },
  };
}
