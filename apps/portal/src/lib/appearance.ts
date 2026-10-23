import {
  CUSTOM_BACKGROUND_UPLOAD,
  DEFAULT_SETTINGS,
  type BackgroundTexture,
  type UserSettings,
} from '@komogon/core';
import {
  applyUserTheme,
  recommendedTheme,
  resolveTheme,
  sampleImage,
  type GlassChoice,
  type ResolvedTheme,
  type RGB,
} from '@komogon/ui';
import { useEffect, useState } from 'react';
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
}

interface Resolved extends Omit<Appearance, 'glass' | 'texture' | 'frost'> {
  /** The background's own pick, which the Recommended mode follows; null on a gradient. */
  recommended: ResolvedTheme | null;
}

/**
 * The theme and backdrop the settings come to, without touching <html>. A Recommended
 * theme is read off the background: a photo's or colour's own, an upload's sampled.
 */
export function useResolvedAppearance(settings: UserSettings | undefined): Resolved {
  const wantsUpload = settings?.theme.customBackgroundUrl === CUSTOM_BACKGROUND_UPLOAD;
  const uploaded = useCustomBackground(wantsUpload);
  const customImageUrl = wantsUpload ? (uploaded.data?.dataUrl ?? null) : null;
  const backgroundId = settings?.theme.backgroundId ?? 'aurora';

  // Only Recommended needs an upload's colour, so only then is it measured.
  const [uploadAvg, setUploadAvg] = useState<RGB | null>(null);
  const measure = settings?.theme.mode === 'recommended' ? customImageUrl : null;
  useEffect(() => {
    if (!measure) return setUploadAvg(null);
    let cancelled = false;
    sampleImage(measure)
      .then((avg) => !cancelled && setUploadAvg(avg))
      .catch(() => !cancelled && setUploadAvg(null));
    return () => {
      cancelled = true;
    };
  }, [measure]);

  const recommended = customImageUrl
    ? uploadAvg && recommendedTheme(backgroundId, uploadAvg)
    : recommendedTheme(backgroundId);
  return {
    theme: resolveTheme(settings?.theme.mode ?? 'system', undefined, recommended),
    backgroundId,
    customImageUrl,
    recommended,
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
  const { recommended } = resolved;
  // The background on screen: an upload has no colour of its own for matte panels to take.
  const backdropId = settings?.theme.customBackgroundUrl ? null : resolved.backgroundId;

  useEffect(() => {
    if (settings) applyUserTheme(settings, document.documentElement, recommended, backdropId);
  }, [settings, recommended, backdropId]);

  // Follow OS theme changes while the system decides: in system mode, or Recommended on a
  // background that has no pick of its own.
  const followsSystem =
    settings?.theme.mode === 'system' || (settings?.theme.mode === 'recommended' && !recommended);
  useEffect(() => {
    if (!settings || !followsSystem) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    // All of it, not just light or dark: matte panels on a solid colour shade for the theme.
    const onChange = () =>
      applyUserTheme(settings, document.documentElement, recommended, backdropId);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings, followsSystem, recommended, backdropId]);

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
  };
}
