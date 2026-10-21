import { useEffect, useRef, useState } from 'react';

/** The bits of Google Identity Services (accounts.google.com/gsi/client) used here. */
interface GoogleIdentity {
  accounts: {
    id: {
      initialize(opts: {
        client_id: string;
        callback: (r: { credential?: string }) => void;
        ux_mode?: 'popup';
      }): void;
      renderButton(el: HTMLElement, opts: Record<string, string | number>): void;
    };
  };
}

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';
let scriptPromise: Promise<GoogleIdentity> | null = null;

function loadGoogle(): Promise<GoogleIdentity> {
  const w = window as unknown as { google?: GoogleIdentity };
  if (w.google?.accounts?.id) return Promise.resolve(w.google);
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => (w.google ? resolve(w.google) : reject(new Error('Google did not load')));
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('Google did not load'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Google's own "Continue with Google" button (Google requires its look). It hands back an ID
 * token, which `onCredential` sends to the API to check. Shows nothing until it has loaded.
 */
export function GoogleSignInButton({
  clientId,
  onCredential,
  onError,
}: {
  clientId: string;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // Latest handlers without re-rendering Google's button each time they change.
  const handlers = useRef({ onCredential, onError });
  useEffect(() => {
    handlers.current = { onCredential, onError };
  });

  useEffect(() => {
    let cancelled = false;
    loadGoogle()
      .then((google) => {
        const el = ref.current;
        if (cancelled || !el) return;
        google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          callback: (r) =>
            r.credential
              ? handlers.current.onCredential(r.credential)
              : handlers.current.onError("Google sign-in didn't go through. Try again."),
        });
        google.accounts.id.renderButton(el, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'center',
          // Google allows 200 to 400. The card can still be laying out here, so fall back
          // to the sign-in card's form width.
          width: Math.min(400, Math.max(200, el.offsetWidth || 318)),
        });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) handlers.current.onError("Google sign-in couldn't load just now.");
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return (
    <div
      ref={ref}
      className="google-signin"
      style={{ minHeight: ready ? undefined : 40, display: 'flex', justifyContent: 'center' }}
    />
  );
}
