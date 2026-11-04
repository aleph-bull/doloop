import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Chip, Input, Spinner, Toggle, useToast } from '@komogon/ui';
import { api, type AccountSecurity } from '../lib/api';
import { useAuth } from '../lib/auth';
import { keys, useSecurity } from '../lib/queries';
import { EmailCodeDialog } from './EmailCodeDialog';
import { SignOutButton } from './SignOutButton';

/**
 * Settings › Security (2026-11-03): the email and whether it is verified, two-step sign-in
 * (off until they turn it on), the password, and signing out.
 */
export function SecuritySettings() {
  const security = useSecurity();
  const auth = useAuth();
  const s = security.data;
  if (!s)
    return security.isPending ? (
      <Spinner />
    ) : (
      <p className="muted text-sm">Couldn't load this. Try again in a moment.</p>
    );
  return (
    <>
      <EmailRow s={s} />
      {/* Two-step guards password sign-ins; Google's own sign-in has its own. */}
      {s.hasPassword && s.canVerify && <TwoStep s={s} />}
      {s.hasPassword && (
        <div className="field">
          <span className="field-label">Password</span>
          <PasswordChange />
        </div>
      )}
      {/* Moved here from Account with the email (2026-11-03). */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="field-hint">Signed in as {s.email || auth.email}.</p>
        <SignOutButton labelled />
      </div>
    </>
  );
}

function EmailRow({ s }: { s: AccountSecurity }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [verifying, setVerifying] = useState(false);
  return (
    <div className="field">
      <span className="field-label">Email</span>
      <div className="security-row">
        <span className="security-email">
          {s.email}
          {s.emailVerified ? (
            <Chip tone="ok">Verified</Chip>
          ) : (
            <Chip tone="neutral">Not verified</Chip>
          )}
        </span>
        {!s.emailVerified && s.canVerify && (
          <Button size="sm" onClick={() => setVerifying(true)}>
            Verify
          </Button>
        )}
      </div>
      <EmailCodeDialog
        open={verifying}
        onClose={() => setVerifying(false)}
        title="Verify your email"
        email={s.email}
        submitLabel="Verify"
        onCode={async (challengeId, code) => {
          await api.verifyAccountCode(challengeId, code);
          qc.setQueryData(keys.security, { ...s, emailVerified: true });
          toast('Email verified.');
          setVerifying(false);
        }}
      />
    </div>
  );
}

function TwoStep({ s }: { s: AccountSecurity }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [asking, setAsking] = useState(false);
  const turningOn = !s.twoStep;
  return (
    <>
      <Toggle
        checked={s.twoStep}
        onChange={() => setAsking(true)}
        label="Two-step sign-in"
        description="A code from your email after your password."
      />
      <EmailCodeDialog
        open={asking}
        onClose={() => setAsking(false)}
        title={turningOn ? 'Turn on two-step sign-in' : 'Turn off two-step sign-in'}
        email={s.email}
        submitLabel={turningOn ? 'Turn on' : 'Turn off'}
        onCode={async (challengeId, code) => {
          const r = await api.setTwoStep(turningOn, challengeId, code);
          qc.setQueryData(keys.security, { ...s, ...r });
          toast(r.twoStep ? 'Two-step sign-in is on.' : 'Two-step sign-in is off.');
          setAsking(false);
        }}
      />
    </>
  );
}

function PasswordChange() {
  const auth = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setOpen(false);
    setCurrent('');
    setNext('');
  };
  const save = async () => {
    setBusy(true);
    try {
      const { token } = await api.changePassword(current, next);
      // Every other device is signed out; this one carries on with the new token.
      auth.adoptToken(token);
      toast('Password changed.');
      reset();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not change the password');
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Change password
        </Button>
      </div>
    );
  return (
    <form
      className="security-password"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        required
      />
      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        minLength={6}
        value={next}
        onChange={(e) => setNext(e.target.value)}
        hint="At least 6 characters. Signs you out on other devices."
        required
      />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy}>
          Save
        </Button>
        <Button variant="ghost" onClick={reset} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
