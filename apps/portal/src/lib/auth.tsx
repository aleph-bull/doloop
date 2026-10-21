import {
  createClient,
  type Session as SupabaseSession,
  type SupabaseClient,
} from '@supabase/supabase-js';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiBaseUrl, setTokenGetter } from './api';

/**
 * Three auth backends:
 *  - Supabase (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY): email and password, magic link,
 *    Google.
 *  - Dev (VITE_DEV_AUTH_SECRET): mints an HS256 token in the browser. Local only.
 *  - Server (neither set): email and password accounts kept by the API itself
 *    (`/api/auth/signin`, `/api/auth/signup`, API env `AUTH_SECRET`).
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DEV_SECRET = import.meta.env.VITE_DEV_AUTH_SECRET as string | undefined;

export const authMode: 'supabase' | 'dev' | 'server' =
  SUPABASE_URL && SUPABASE_ANON_KEY ? 'supabase' : DEV_SECRET ? 'dev' : 'server';

export const supabase: SupabaseClient | null =
  authMode === 'supabase' ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!) : null;

/** Shown when someone not on the closed test's invite list tries to sign in. */
export const NOT_INVITED_MESSAGE =
  "Komodon is in a small private test at the moment, and this email isn't on the list. If you were invited, use the address the invite was sent to.";

/**
 * Sign-in errors in plain words. With sign-ups turned off in Supabase, a magic link or Google
 * sign-in for an unknown email fails with "Signups not allowed…"; that means not invited.
 */
export function friendlyAuthError(message: string): string {
  if (/signups? not allowed|not allowed for otp/i.test(message)) return NOT_INVITED_MESSAGE;
  if (/invalid login credentials/i.test(message)) return "That email and password don't match.";
  if (/email not confirmed/i.test(message))
    return 'Confirm your email first: open the link in the email we sent.';
  if (/user already registered/i.test(message))
    return 'There is already an account with this email. Sign in instead.';
  return message;
}

interface AuthState {
  status: 'loading' | 'signed-out' | 'signed-in';
  email: string | null;
}

interface AuthApi extends AuthState {
  mode: typeof authMode;
  signInWithMagicLink: (email: string) => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  /** Resolves true when the account needs its email confirmed before it can sign in. */
  signUpWithPassword: (email: string, password: string) => Promise<boolean>;
  signInWithGoogle: () => Promise<void>;
  /** Server mode: sign in with the ID token from Google's sign-in button. */
  signInWithGoogleCredential: (credential: string) => Promise<void>;
  signInDev: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

/** Where dev and server mode keep the signed-in token and email (Supabase keeps its own). */
export const TOKEN_KEY = authMode === 'dev' ? 'komogon.dev.token' : 'komogon.token';
export const EMAIL_KEY = authMode === 'dev' ? 'komogon.dev.email' : 'komogon.email';

/** POST to the API's own account routes; answers the token and email, or throws its error. */
async function serverAuth(
  path: 'signin' | 'signup' | 'google',
  body: { email: string; password: string } | { credential: string },
): Promise<{ token: string; email: string }> {
  const res = await fetch(`${apiBaseUrl(true)}/api/auth/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as {
    token?: string;
    email?: string;
    error?: string;
  } | null;
  if (res.status === 404) throw new Error('Password sign-in is not set up on the server.');
  if (res.status === 403 && data?.error === 'invite_only') throw new Error(NOT_INVITED_MESSAGE);
  if (res.status === 400 && data?.error === 'Validation failed')
    throw new Error('Enter a valid email and a password.');
  if (!res.ok || !data?.token) throw new Error(data?.error ?? 'Sign-in failed');
  return { token: data.token, email: data.email ?? ('email' in body ? body.email : '') };
}

/** Server mode: the Google client id when the API offers "Continue with Google", else null. */
export async function serverGoogleClientId(): Promise<string | null> {
  try {
    const res = await fetch(`${apiBaseUrl(true)}/api/auth/google`);
    if (!res.ok) return null;
    const data = (await res.json()) as { clientId?: string | null };
    return data.clientId ?? null;
  } catch {
    return null;
  }
}

// Installed at import, before the first render: queries mounted outside the auth gate
// (the achievement toasts) fetch from child effects, which run before AuthProvider's own
// effect, so a getter set there would let the first /api/me go out without a token, and a
// hidden tab holds the retry until it is shown. Neither getter depends on React state,
// and each returns null while nobody is signed in.
if (supabase) {
  setTokenGetter(async () => (await supabase.auth.getSession()).data.session?.access_token ?? null);
} else {
  setTokenGetter(async () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });
}

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
      return () => sub.subscription.unsubscribe();
    }
    // Dev and server mode: the token is in local storage.
    let token: string | null = null;
    let email: string | null = null;
    try {
      token = localStorage.getItem(TOKEN_KEY);
      email = localStorage.getItem(EMAIL_KEY);
    } catch {
      /* ignore */
    }
    setState({ status: token ? 'signed-in' : 'signed-out', email });
  }, []);

  /** Dev and server mode: keep the token and email, and count as signed in. */
  const keepToken = useCallback((token: string, email: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(EMAIL_KEY, email);
    } catch {
      /* ignore */
    }
    setState({ status: 'signed-in', email });
  }, []);

  const signInWithMagicLink = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw error;
  }, []);

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      if (!supabase) {
        const r = await serverAuth('signin', { email, password });
        keepToken(r.token, r.email);
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    [keepToken],
  );

  const signUpWithPassword = useCallback(
    async (email: string, password: string) => {
      if (!supabase) {
        const r = await serverAuth('signup', { email, password });
        keepToken(r.token, r.email);
        return false;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      // With "Confirm email" on in Supabase there is no session until the link is opened.
      return !data.session;
    },
    [keepToken],
  );

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw error;
  }, []);

  const signInWithGoogleCredential = useCallback(
    async (credential: string) => {
      const r = await serverAuth('google', { credential });
      keepToken(r.token, r.email);
    },
    [keepToken],
  );

  const signInDev = useCallback(
    async (email: string) => {
      keepToken(await mintDevToken(email), email);
    },
    [keepToken],
  );

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EMAIL_KEY);
    } catch {
      /* ignore */
    }
    setState({ status: 'signed-out', email: null });
  }, []);

  const api = useMemo<AuthApi>(
    () => ({
      ...state,
      mode: authMode,
      signInWithMagicLink,
      signInWithPassword,
      signUpWithPassword,
      signInWithGoogle,
      signInWithGoogleCredential,
      signInDev,
      signOut,
    }),
    [
      state,
      signInWithMagicLink,
      signInWithPassword,
      signUpWithPassword,
      signInWithGoogle,
      signInWithGoogleCredential,
      signInDev,
      signOut,
    ],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
