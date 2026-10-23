import { useEffect, useRef, useState } from 'react';

interface TokenClient {
  requestAccessToken(): void;
}

/** The bits of Google Identity Services (accounts.google.com/gsi/client) used here. */
interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient(opts: {
        client_id: string;
        scope: string;
        callback: (r: { access_token?: string }) => void;
        error_callback?: (e: { type: string }) => void;
      }): TokenClient;
    };
  };
}

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';
let scriptPromise: Promise<GoogleIdentity> | null = null;

function loadGoogle(): Promise<GoogleIdentity> {
  const w = window as unknown as { google?: GoogleIdentity };
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google);
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
 * "Continue with Google", drawn by us. Google's own button can't be restyled and turns into
 * "Continue as <name>" with a picture once it knows you, so this opens Google's account popup
 * instead (the token flow Google offers for custom buttons). It hands back an access token,
 * which `onAccessToken` sends to the API to check.
 */
export function GoogleSignInButton({
  clientId,
  onAccessToken,
  onError,
}: {
  clientId: string;
  onAccessToken: (accessToken: string) => void;
  onError: (message: string) => void;
}) {
  const client = useRef<TokenClient | null>(null);
  const [ready, setReady] = useState(false);
  // Latest handlers without making a new token client each time they change.
  const handlers = useRef({ onAccessToken, onError });
  useEffect(() => {
    handlers.current = { onAccessToken, onError };
  });

  useEffect(() => {
    let cancelled = false;
    loadGoogle()
      .then((google) => {
        if (cancelled) return;
        client.current = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'openid email',
          callback: (r) =>
            r.access_token
              ? handlers.current.onAccessToken(r.access_token)
              : handlers.current.onError("Google sign-in didn't go through. Try again."),
          // Closing the popup is changing your mind, not an error.
          error_callback: (e) => {
            if (e.type === 'popup_failed_to_open')
              handlers.current.onError(
                'Your browser blocked the Google window. Allow pop-ups here and try again.',
              );
          },
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
    <button
      type="button"
      className="btn google-button"
      disabled={!ready}
      // The popup has to open inside the click, or the browser blocks it.
      onClick={() => client.current?.requestAccessToken()}
    >
      <GoogleMark />
      Continue with Google
    </button>
  );
}

/** Google's "G", in its own colours. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
