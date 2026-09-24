import {
  createClient,
  type Session as SupabaseSession,
  type SupabaseClient,
} from '@supabase/supabase-js';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setTokenGetter } from './api';

/**
 * Two auth backends:
 *  - Supabase (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY): magic link + Google.
 *  - Dev (VITE_DEV_AUTH_SECRET): mints an HS256 token in the browser. Local only.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DEV_SECRET = import.meta.env.VITE_DEV_AUTH_SECRET as string | undefined;

export const authMode: 'supabase' | 'dev' | 'none' =
  SUPABASE_URL && SUPABASE_ANON_KEY ? 'supabase' : DEV_SECRET ? 'dev' : 'none';

export const supabase: SupabaseClient | null =
  authMode === 'supabase' ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!) : null;

interface AuthState {
  status: 'loading' | 'signed-out' | 'signed-in';
  email: string | null;
}

interface AuthApi extends AuthState {
  mode: typeof authMode;
  signInWithMagicLink: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInDev: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

const DEV_KEY = 'komogon.dev.token';
const DEV_EMAIL_KEY = 'komogon.dev.email';

async function mintDevToken(email: string): Promise<string> {
  const { SignJWT } = await import('jose');
  // Stable per-email id so data persists across reloads while the API is up.
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(email.toLowerCase()),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  const key = new TextEncoder().encode(DEV_SECRET);
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(id)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(key);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', email: null });

  useEffect(() => {
    if (authMode === 'supabase' && supabase) {
      const apply = (session: SupabaseSession | null) =>
        setState({
          status: session ? 'signed-in' : 'signed-out',
          email: session?.user.email ?? null,
        });
      supabase.auth.getSession().then(({ data }) => apply(data.session));
      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => apply(session));
      setTokenGetter(
        async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
      );
      return () => sub.subscription.unsubscribe();
    }
    if (authMode === 'dev') {
      let token: string | null = null;
      try {
        token = localStorage.getItem(DEV_KEY);
      } catch {
        /* ignore */
      }
      setTokenGetter(async () => {
        try {
          return localStorage.getItem(DEV_KEY);
        } catch {
          return null;
        }
      });
      let email: string | null = null;
      try {
        email = localStorage.getItem(DEV_EMAIL_KEY);
      } catch {
        /* ignore */
      }
      setState({ status: token ? 'signed-in' : 'signed-out', email });
      return;
    }
    setState({ status: 'signed-out', email: null });
  }, []);

  const signInWithMagicLink = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw error;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw error;
  }, []);

  const signInDev = useCallback(async (email: string) => {
    const token = await mintDevToken(email);
    try {
      localStorage.setItem(DEV_KEY, token);
      localStorage.setItem(DEV_EMAIL_KEY, email);
    } catch {
      /* ignore */
    }
    setState({ status: 'signed-in', email });
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    try {
      localStorage.removeItem(DEV_KEY);
      localStorage.removeItem(DEV_EMAIL_KEY);
    } catch {
      /* ignore */
    }
    setState({ status: 'signed-out', email: null });
  }, []);

  const api = useMemo<AuthApi>(
    () => ({ ...state, mode: authMode, signInWithMagicLink, signInWithGoogle, signInDev, signOut }),
    [state, signInWithMagicLink, signInWithGoogle, signInDev, signOut],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
