import { useState } from 'react';
import { Navigate } from 'react-router';
import { Backdrop, Button, Glass, Input, LogoMark, useToast } from '@komogon/ui';
import { useAuth } from '../lib/auth';

export function SignIn() {
  const auth = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (auth.status === 'signed-in') return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      if (auth.mode === 'dev') await auth.signInDev(email.trim());
      else {
        await auth.signInWithMagicLink(email.trim());
        setSent(true);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Backdrop backgroundId="aurora" theme="dark" />
      <main className="min-h-screen flex items-center justify-center p-4 on-backdrop">
        <Glass className="p-8 w-full max-w-sm flex flex-col gap-5" strong>
          <div>
            <div className="brand-mark mb-3" aria-hidden>
              <LogoMark size={14} />
            </div>
            <h1 className="text-2xl">Komogon</h1>
            <p className="muted text-sm mt-1">Plan the work. Keep the pace.</p>
          </div>

          {auth.mode === 'none' && (
            <p className="text-sm" style={{ color: 'var(--status-warn)' }}>
              No auth configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or
              VITE_DEV_AUTH_SECRET for local development.
            </p>
          )}

          {sent ? (
            <p className="text-sm">Check your email for a sign-in link.</p>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
              <Button
                type="submit"
                variant="primary"
                loading={busy}
                disabled={auth.mode === 'none'}
              >
                {auth.mode === 'dev' ? 'Continue (dev)' : 'Email me a link'}
              </Button>
            </form>
          )}

          {auth.mode === 'supabase' && (
            <>
              <div className="divider" style={{ margin: 0 }} />
              <Button onClick={() => auth.signInWithGoogle().catch((e) => toast(e.message))}>
                Continue with Google
              </Button>
            </>
          )}
          {auth.mode === 'dev' && (
            <p className="field-hint">
              Dev mode: any email works and data lives in the local API only.
            </p>
          )}
        </Glass>
      </main>
    </>
  );
}
