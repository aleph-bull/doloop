import { useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Backdrop, Button, Glass, Input, LogoMark, useToast } from '@komogon/ui';
import { friendlyAuthError, useAuth } from '../lib/auth';

export function SignIn() {
  const auth = useAuth();
  const { toast } = useToast();
  // Set by the auth callback or the invite check when a sign-in was turned away.
  const turnedAway = (useLocation().state as { error?: string } | null)?.error ?? null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  /** What the email we just sent is for, when one was sent. */
  const [sent, setSent] = useState<'link' | 'confirm' | null>(null);
  const [busy, setBusy] = useState(false);

  if (auth.status === 'signed-in') return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      if (auth.mode === 'dev') await auth.signInDev(email.trim());
      else if (creating) {
        if (await auth.signUpWithPassword(email.trim(), password)) setSent('confirm');
      } else await auth.signInWithPassword(email.trim(), password);
    } catch (err) {
      toast(err instanceof Error ? friendlyAuthError(err.message) : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const emailLink = async () => {
    if (!email.trim()) {
      toast('Enter your email first.');
      return;
    }
    setBusy(true);
    try {
      await auth.signInWithMagicLink(email.trim());
      setSent('link');
    } catch (err) {
      toast(err instanceof Error ? friendlyAuthError(err.message) : 'Sign-in failed');
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
            <LogoMark size={40} className="mb-3" />
            <h1 className="text-2xl">Komogon</h1>
            <p className="muted text-sm mt-1">Plan the work. Keep the pace.</p>
          </div>

          {turnedAway && !sent && (
            <p className="text-sm" role="alert">
              {turnedAway}
            </p>
          )}

          {sent ? (
            <p className="text-sm">
              {sent === 'link'
                ? 'Check your email for a sign-in link.'
                : 'Check your email and open the link to confirm your account.'}
            </p>
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
              <Input
                label="Password"
                type="password"
                autoComplete={creating ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={auth.mode !== 'dev'}
                minLength={auth.mode !== 'dev' ? 6 : undefined}
                hint={
                  auth.mode === 'dev'
                    ? undefined
                    : `${creating ? 'At least 6 characters. ' : ''}Don't use a password you use anywhere else.`
                }
              />
              {auth.mode !== 'dev' && (
                <p className="field-hint">
                  This is an early test of Komogon. I can see the accounts and study data saved
                  here.
                </p>
              )}
              <Button type="submit" variant="primary" loading={busy} disabled={busy}>
                {auth.mode === 'dev' ? 'Continue (dev)' : creating ? 'Create account' : 'Sign in'}
              </Button>
              {auth.mode !== 'dev' && (
                <div className="flex justify-between gap-2 text-sm">
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setCreating((c) => !c)}
                  >
                    {creating ? 'I already have an account' : 'Create an account'}
                  </button>
                  {!creating && auth.mode === 'supabase' && (
                    <button type="button" className="link-button" onClick={() => void emailLink()}>
                      Email me a link instead
                    </button>
                  )}
                </div>
              )}
            </form>
          )}

          {auth.mode === 'supabase' && (
            <>
              <div className="divider" style={{ margin: 0 }} />
              <Button
                onClick={() =>
                  auth.signInWithGoogle().catch((e) => toast(friendlyAuthError(e.message)))
                }
              >
                Continue with Google
              </Button>
            </>
          )}
          {auth.mode === 'dev' && (
            <p className="field-hint">
              Dev mode: any email works, the password is ignored, and data lives in the local API
              only.
            </p>
          )}
        </Glass>
      </main>
    </>
  );
}
