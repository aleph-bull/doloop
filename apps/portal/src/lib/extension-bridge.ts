import { useEffect, useState } from 'react';
import { supabase, authMode } from './auth';

/**
 * Hands the signed-in session to the Chrome extension's content script (same window,
 * same origin). The extension answers with `doloop:connected` when it stored it.
 */

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || window.location.origin;

async function buildPayload(): Promise<Record<string, unknown> | null> {
  if (authMode === 'supabase' && supabase) {
    const { data } = await supabase.auth.getSession();
    const s = data.session;
    if (!s) return null;
    return {
      type: 'doloop:session',
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
  if (authMode === 'dev') {
    let token: string | null = null;
    let email: string | null = null;
    try {
      token = localStorage.getItem('doloop.dev.token');
      email = localStorage.getItem('doloop.dev.email');
    } catch {
      /* ignore */
    }
    if (!token) return null;
    return {
      type: 'doloop:session',
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
      if (t === 'doloop:extension-ready') {
        setState((s) => ({ ...s, installed: true }));
        void pushSessionToExtension();
      }
      if (t === 'doloop:connected')
        setState({
          installed: true,
          connected: true,
          version: (e.data as { version?: string }).version ?? null,
        });
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ type: 'doloop:ping' }, window.location.origin);
    void pushSessionToExtension();
    return () => window.removeEventListener('message', onMsg);
  }, []);
  return state;
}
