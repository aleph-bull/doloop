import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { Backdrop, Button, Glass, Input, LogoMark, useToast } from '@komogon/ui';
import {
  clearSignInNotice,
  friendlyAuthError,
  readSignInNotice,
  serverDevLogin,
  serverGoogleClientId,
  useAuth,
} from '../lib/auth';
import { LocalTestAccounts } from '../components/LocalTestAccounts';
import { LocalMailInbox } from '../components/LocalMailInbox';
import { GoogleSignInButton } from '../components/GoogleSignInButton';

export function SignIn() {
  const auth = useAuth();
  const { toast } = useToast();
  // Why a sign-in was turned away or ended: from the auth callback, or left by the app
  // when it signed someone out (an expired dev account, a suspension).
  const [notice] = useState(readSignInNotice);
  useEffect(clearSignInNotice, []);
  const turnedAway = (useLocation().state as { error?: string } | null)?.error ?? notice;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(useLocation().pathname === '/signup');
  /** What the email we just sent is for, when one was sent. */
  const [sent, setSent] = useState<'link' | 'confirm' | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');

  /** Server mode: set when the API offers "Continue with Google". */
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  /** Server mode: "I'm a dev" is offered, and whether its password field is open. */
  const [devOffered, setDevOffered] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [devPassword, setDevPassword] = useState('');
  const [devKind, setDevKind] = useState<'fresh' | 'jerry'>('fresh');

  useEffect(() => {
    if (auth.mode !== 'server') return;
    let cancelled = false;
    void serverGoogleClientId().then((id) => !cancelled && setGoogleClientId(id));
    void serverDevLogin().then((on) => !cancelled && setDevOffered(on));
    return () => {
      cancelled = true;
    };
  }, [auth.mode]);

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
            <Link to="/" aria-label="Back to Komodon">
              <LogoMark size={40} className="mb-3" />
            </Link>
            <h1 className="text-2xl">Komodon</h1>
            <p className="muted text-sm mt-1">Plan coursework, track deadlines and study.</p>
          </div>

          {turnedAway && !sent && (
            <p className="text-sm" role="alert">
              {turnedAway}
            </p>
          )}

          {sent === 'confirm' && auth.mode === 'server' && auth.pendingVerification ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await auth.verifyEmailCode(code);
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Could not verify that code.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h2 className="section-title">Check your email</h2>
              <p className="muted text-sm">
                Enter the code sent to {auth.pendingVerification.email}.
              </p>
              <Input
                label="Verification code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
              />
              <Button type="submit" variant="primary" loading={busy}>
                Verify email
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await auth.resendVerification();
                    toast('A new code has been sent.');
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Could not resend.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Resend code
              </Button>
              {/* Back to the signup form, email and password kept, to fix a mistyped address. */}
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setSent(null);
                  setCode('');
                }}
              >
                Go back
              </Button>
              <LocalMailInbox email={auth.pendingVerification.email} />
            </form>
          ) : sent ? (
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
                hint={auth.mode !== 'dev' && creating ? 'At least 6 characters.' : undefined}
              />
              {auth.mode !== 'dev' && (
                <p className="field-hint">
                  This is an early test of Komodon. I can see the accounts and study data saved
                  here.
                </p>
              )}
              {!creating && auth.mode === 'server' && (
                <Link className="link-button text-sm" to="/reset-password">
                  Forgot password?
                </Link>
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
          {auth.mode === 'server' && googleClientId && !sent && (
            <>
              <div className="divider" style={{ margin: 0 }} />
              <GoogleSignInButton
                clientId={googleClientId}
                onAccessToken={(accessToken) =>
                  auth
                    .signInWithGoogleToken(accessToken)
                    .catch((e) => toast(friendlyAuthError(e.message)))
                }
                onError={toast}
              />
            </>
          )}
          {auth.mode === 'dev' && (
            <p className="field-hint">
              Dev mode: any email works, the password is ignored, and data lives in the local API
              only.
            </p>
          )}
          {auth.mode === 'server' &&
            devOffered &&
            !sent &&
            (devOpen ? (
              <form
                className="flex flex-col gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  // Which button sent it; Enter in the field means a fresh account.
                  const submitter = (e.nativeEvent as SubmitEvent).submitter;
                  const kind = submitter?.getAttribute('value') === 'jerry' ? 'jerry' : 'fresh';
                  setDevKind(kind);
                  try {
                    await auth.signInAsDev(devPassword, kind);
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Could not start a dev account.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <div className="divider" style={{ margin: 0 }} />
                <Input
                  label="Dev password"
                  type="password"
                  autoComplete="off"
                  value={devPassword}
                  onChange={(e) => setDevPassword(e.target.value)}
                  required
                  autoFocus
                  hint="Throwaway accounts, deleted after a day. Jerry has months of study and friends."
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="submit"
                    value="fresh"
                    loading={busy && devKind === 'fresh'}
                    disabled={busy}
                  >
                    Fresh account
                  </Button>
                  <Button
                    type="submit"
                    value="jerry"
                    loading={busy && devKind === 'jerry'}
                    disabled={busy}
                  >
                    Jerry
                  </Button>
                </div>
              </form>
            ) : (
              <button type="button" className="dev-link" onClick={() => setDevOpen(true)}>
                I'm a dev
              </button>
            ))}
          <LocalTestAccounts />
        </Glass>
      </main>
    </>
  );
}
