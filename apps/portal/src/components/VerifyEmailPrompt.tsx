import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@komogon/ui';
import { api } from '../lib/api';
import { keys, useSecurity } from '../lib/queries';
import { askedThisVisit, clearNewAccount, isNewAccount, markAsked } from '../lib/verify-email';
import { EmailCodeDialog } from './EmailCodeDialog';

/**
 * Asks someone to verify their email: as the account is made, then once each visit until
 * they do. Never required; Later closes it until the next visit. Hidden while `hold` (another
 * question or the look around is on screen), and when no code can be sent.
 */
export function VerifyEmailPrompt({ hold = false }: { hold?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  // Read once: whether this visit already asked, and whether the account was just made.
  const [asked, setAsked] = useState(askedThisVisit);
  const [fresh] = useState(() => !asked && isNewAccount());
  useEffect(clearNewAccount, []);
  const security = useSecurity(!asked, true);
  const s = security.data;
  // Only on a fresh answer: the saved copy may be from before they verified elsewhere.
  const due = !asked && security.isFetchedAfterMount && !!s && s.canVerify && !s.emailVerified;
  if (!due || !s) return null;

  const close = () => {
    markAsked();
    setAsked(true);
  };

  return (
    <EmailCodeDialog
      open={!hold}
      onClose={close}
      title="Verify your email"
      email={s.email}
      submitLabel="Verify"
      sendNow={fresh}
      dismissLabel="Later"
      onCode={async (challengeId, code) => {
        await api.verifyAccountCode(challengeId, code);
        qc.setQueryData(keys.security, { ...s, emailVerified: true });
        toast('Email verified.');
        close();
      }}
    />
  );
}
