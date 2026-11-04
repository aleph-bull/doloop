import { uploadedFontId, type UserSettings } from '@komogon/core';
import { useEffect, useState } from 'react';
import { EMAIL_KEY, TOKEN_KEY, supabase, authMode } from './auth';
import { localFontFile } from './local-fonts';

/**
 * Hands the signed-in session to the Chrome extension's content script (same window,
 * same origin). The extension answers with `komogon:connected` when it stored it.
 */

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || window.location.origin;

async function buildPayload(): Promise<Record<string, unknown> | null> {
  if (authMode === 'supabase' && supabase) {
    const { data } = await supabase.auth.getSession();
    const s = data.session;
    if (!s) return null;
    return {
      type: 'komogon:session',
      token: s.access_token,
      refreshToken: s.refresh_token,
      expiresAt: s.expires_at ?? null,
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      apiUrl: API_URL,
      portalUrl: window.location.origin,
      email: s.user.email ?? null,
    };
  }
  // Dev and server mode: the API's own token, from local storage.
  {
    let token: string | null = null;
    let email: string | null = null;
    try {
      token = localStorage.getItem(TOKEN_KEY);
      email = localStorage.getItem(EMAIL_KEY);
    } catch {
      /* ignore */
    }
    if (!token) return null;
    return {
      type: 'komogon:session',
      token,
      apiUrl: API_URL,
      portalUrl: window.location.origin,
      email,
    };
  }
  return null;
}

export async function pushSessionToExtension(): Promise<void> {
  const payload = await buildPayload();
  if (payload) window.postMessage(payload, window.location.origin);
}

/** True once the extension's content script has acknowledged a session. */
export function useExtensionStatus(): {
  installed: boolean;
  connected: boolean;
  version: string | null;
} {
  const [state, setState] = useState({
    installed: false,
    connected: false,
    version: null as string | null,
  });
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const t = (e.data as { type?: string; version?: string })?.type;
      if (t === 'komogon:extension-ready') {
        setState((s) => ({ ...s, installed: true }));
        void pushSessionToExtension();
        postLook();
      }
      if (t === 'komogon:connected')
        setState({
          installed: true,
          connected: true,
          version: (e.data as { version?: string }).version ?? null,
        });
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ type: 'komogon:ping' }, window.location.origin);
    void pushSessionToExtension();
    return () => window.removeEventListener('message', onMsg);
  }, []);
  return state;
}

/**
 * The parts of their look that live only in this browser, for the extension to show too:
 * the picture of their own background and the fonts they uploaded, when in use (owner,
 * 2026-11-04: "the extension and portal should be the exact same in terms of themes and
 * appearance"). The extension keeps them in its own storage and drops them on sign-out.
 * A font over this size stays here (the extension's storage holds about 10 MB in all).
 */
const MAX_FONT_TO_EXTENSION = 3 * 1024 * 1024;

let look: {
  background: { id: string; dataUrl: string } | null;
  fonts: Array<{ id: string; data: string }>;
} | null = null;

function postLook() {
  if (look) window.postMessage({ type: 'komogon:look', ...look }, window.location.origin);
}

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** Hands the look to the extension whenever it changes, and again when the extension loads. */
export function useExtensionLook(
  settings: UserSettings | undefined,
  customImageUrl: string | null,
) {
  const ready = !!settings;
  const backgroundId = settings?.theme.customBackgroundId ?? null;
  const fontKey = settings
    ? [
        ...new Set(
          [settings.theme.fontText, settings.theme.fontHeading, settings.theme.fontTimer]
            .map((f) => (f ? uploadedFontId(f) : null))
            .filter((id): id is string => !!id),
        ),
      ].join(',')
    : '';
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      const fonts: Array<{ id: string; data: string }> = [];
      for (const id of fontKey ? fontKey.split(',') : []) {
        const data = await localFontFile(id);
        if (data && data.byteLength <= MAX_FONT_TO_EXTENSION)
          fonts.push({ id, data: toBase64(data) });
      }
      if (cancelled) return;
      look = {
        background:
          backgroundId && customImageUrl ? { id: backgroundId, dataUrl: customImageUrl } : null,
        fonts,
      };
      postLook();
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, backgroundId, customImageUrl, fontKey]);
}
