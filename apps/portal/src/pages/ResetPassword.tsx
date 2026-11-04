import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Backdrop, Button, Glass, Input } from '@komogon/ui';
import { api } from '../lib/api';
import { LocalMailInbox } from '../components/LocalMailInbox';

export function ResetPassword() {
  // From sign-in, for an email that signs in with Google: its first password.
  const from = useLocation().state as { email?: string; first?: boolean } | null;
  const first = from?.first === true;
  const [email, setEmail] = useState(from?.email ?? ''),
    [code, setCode] = useState(''),
    [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null),
    [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  return (
    <>
      <Backdrop backgroundId="aurora" theme="dark" />
      <main className="min-h-screen flex items-center justify-center p-4 on-backdrop">
        <Glass className="p-8 w-full max-w-sm flex flex-col gap-5" strong>
          <h1 className="text-2xl">{first ? 'Set a password' : 'Reset your password'}</h1>
          {done ? (
            <>
              <p>
                {first
                  ? 'Your password is set. Sign in with it, or with Google as before.'
                  : 'Your password has been updated. Sign in with your new password.'}
              </p>
              <Link to="/signin" className="btn btn-primary">
                Sign in
              </Link>
            </>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                try {
                  if (challenge) {
                    await api.resetPassword(challenge, code, password);
                    setDone(true);
                  } else setChallenge((await api.requestPasswordReset(email)).challengeId);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not reset your password.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {!challenge ? (
                <Input
                  label="Account email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              ) : (
                <>
                  <p className="muted text-sm">
                    If an account uses {email}, a code has been sent. Enter it below.
                  </p>
                  <Input
                    label="Reset code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    required
                  />
                  <Input
                    label="New password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    minLength={6}
                    maxLength={200}
                    required
                  />
                </>
              )}
              {error && (
                <p role="alert" className="text-sm">
                  {error}
                </p>
              )}
              <Button type="submit" variant="primary" loading={busy}>
                {challenge
                  ? first
                    ? 'Set password'
                    : 'Set new password'
                  : first
                    ? 'Send code'
                    : 'Send reset code'}
              </Button>
              {challenge && (
                <>
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        setChallenge((await api.requestPasswordReset(email)).challengeId);
                      } catch (err) {
                        setError(
                          err instanceof Error ? err.message : 'Could not send another code.',
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Resend code
                  </Button>
                  <LocalMailInbox email={email} />
                </>
              )}
              <Link to="/signin" className="link-button text-sm">
                Back to sign in
              </Link>
            </form>
          )}
        </Glass>
      </main>
    </>
  );
}
