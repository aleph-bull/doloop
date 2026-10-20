import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { Spinner } from '@komogon/ui';
import { friendlyAuthError, supabase } from '../lib/auth';

/** Landing page for magic links and OAuth redirects. Supabase parses the URL itself. */
export function AuthCallback() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setDone(true);
      return;
    }
    const url = new URL(window.location.href);
    // A refused sign-in (e.g. Google for an email that isn't invited) comes back with the
    // reason in the query or the hash instead of a code.
    const hash = new URLSearchParams(url.hash.slice(1));
    const refused =
      url.searchParams.get('error_description') ?? hash.get('error_description') ?? null;
    if (refused) {
      setError(friendlyAuthError(refused));
      setDone(true);
      return;
    }
    const code = url.searchParams.get('code');
    const client = supabase;
    const run = async () => {
      try {
        if (code) await client.auth.exchangeCodeForSession(code);
        else await client.auth.getSession();
      } catch (err) {
        setError(err instanceof Error ? friendlyAuthError(err.message) : 'Sign-in failed');
      } finally {
        setDone(true);
      }
    };
    void run();
  }, []);

  if (!done)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  if (error) return <Navigate to="/signin" replace state={{ error }} />;
  return <Navigate to="/" replace />;
}
