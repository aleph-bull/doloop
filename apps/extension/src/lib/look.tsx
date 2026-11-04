import { CUSTOM_BACKGROUND_UPLOAD, DEFAULT_SETTINGS } from '@komogon/core';
import { useEffect, useState } from 'react';
import { applyUserTheme, Backdrop, resolveTheme } from '@komogon/ui';
import { applyFonts } from './fonts';
import { getAll, onChange, type Stored } from './storage';

/** What the extension keeps, read once and kept up to date. Null until read. */
export function useStored(): Stored | null {
  const [store, setStore] = useState<Stored | null>(null);
  useEffect(() => {
    void getAll().then(setStore);
    return onChange(() => void getAll().then(setStore));
  }, []);
  return store;
}

/** The portal's address: the one the account came from, else the one this build is for. */
export function portalOf(store: Stored | null): string {
  return (
    store?.connection?.portalUrl ??
    (import.meta.env.VITE_PORTAL_URL as string | undefined) ??
    'http://localhost:5173'
  );
}

/**
 * The app's look on an extension page, exactly as the portal draws it (its `useAppearance`):
 * theme, accent, panels, glass, fonts, and the background with its blur, brightness and
 * texture. There is no background of the extension's own (owner, 2026-11-04: "the extension
 * and portal should be the exact same"). Their own background's picture and fonts come from
 * the app through the bridge; one that hasn't arrived shows the theme's background, as the
 * portal does in a browser without the picture. Returns the backdrop to render.
 */
export function useLook(store: Stored | null) {
  // Signed out, the app's own first look; never the last account's.
  const settings = store?.snapshot?.settings ?? DEFAULT_SETTINGS;
  const t = settings.theme;
  const own = store?.ownBackground ?? null;
  const customImageUrl =
    t.customBackgroundUrl === CUSTOM_BACKGROUND_UPLOAD &&
    own &&
    (!t.customBackgroundId || own.id === t.customBackgroundId)
      ? own.dataUrl
      : null;
  // The background on screen: an upload has no colour of its own for matte panels to take.
  const backdropId = customImageUrl ? null : t.backgroundId;
  const ownFonts = store?.ownFonts;

  useEffect(() => {
    applyUserTheme(settings, document.documentElement, backdropId);
  }, [settings, backdropId]);
  useEffect(() => {
    applyFonts(settings.theme, document.documentElement, ownFonts ?? {});
  }, [settings, ownFonts]);
  // Follow the device's light or dark only when they picked System, as the portal does.
  useEffect(() => {
    if (t.mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyUserTheme(settings, document.documentElement, backdropId);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings, t.mode, backdropId]);

  return (
    <Backdrop
      backgroundId={t.backgroundId}
      theme={resolveTheme(t.mode)}
      customImageUrl={customImageUrl}
      assetBase={portalOf(store)}
      glass={{ color: t.glassColor ?? null, alpha: t.glassAlpha ?? null }}
      texture={t.texture ?? 'none'}
      // Held to the same limits as the portal's.
      adjust={{
        blur: Math.min(40, Math.max(0, t.backgroundBlur ?? 0)),
        brightness: Math.min(60, Math.max(-60, t.backgroundBrightness ?? 0)),
      }}
    />
  );
}
