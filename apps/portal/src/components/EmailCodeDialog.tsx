import { useEffect, useId, useRef, useState } from 'react';
import { Button, Input, Modal, useToast } from '@komogon/ui';
import { api } from '../lib/api';
import { LocalMailInbox } from './LocalMailInbox';

/**
 * Sends a code to the account's own email and takes it back: verifying the address, and
 * turning two-step sign-in on or off. `onCode` does what the code is for; it throws the API's
 * message when the code is wrong.
 */
export function EmailCodeDialog({
  open,
  onClose,
  title,
  email,
  submitLabel,
  onCode,
  sendNow = false,
  dismissLabel = 'Cancel',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  email: string;
  submitLabel: string;
  onCode: (challengeId: string, code: string) => Promise<void>;
  /** Send the first code as it opens, without waiting for a tap. */
  sendNow?: boolean;
  /** The button that closes it: "Later" where it asks, "Cancel" where they opened it. */
  dismissLabel?: string;
}) {
  const { toast } = useToast();
  const formId = useId();
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'check' | null>(null);

  const send = async () => {
    setBusy('send');
    try {
      setChallengeId((await api.requestAccountCode()).challengeId);
      setCode('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send a code');
    } finally {
      setBusy(null);
    }
  };

  // Each opening starts afresh.
  const close = () => {
    setChallengeId(null);
    setCode('');
    onClose();
  };
  // `sendNow` sends the first code as it opens, once.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  const sentOnOpen = useRef(false);
  useEffect(() => {
    if (!open) sentOnOpen.current = false;
    else if (sendNow && !sentOnOpen.current) {
      sentOnOpen.current = true;
      void sendRef.current();
    }
  }, [open, sendNow]);

  const check = async () => {
    if (!challengeId) return;
    setBusy('check');
    try {
      await onCode(challengeId, code.trim());
      // Done: the next opening starts afresh.
      setChallengeId(null);
      setCode('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That code did not work');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      initialFocus="dialog"
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            {dismissLabel}
          </Button>
          {challengeId ? (
            <Button
              type="submit"
              form={formId}
              variant="primary"
              loading={busy === 'check'}
              disabled={!/^\d{6}$/.test(code.trim())}
            >
              {submitLabel}
            </Button>
          ) : (
            <Button variant="primary" loading={busy === 'send'} onClick={() => void send()}>
              Send code
            </Button>
          )}
        </>
      }
    >
      <form
        id={formId}
        className="email-code"
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
        <p className="muted">{challengeId ? `Code sent to ${email}.` : email}</p>
        {challengeId && (
          <Input
            label="Code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            required
          />
        )}
        {challengeId && (
          <button
            type="button"
            className="link-button email-code-again"
            disabled={busy === 'send'}
            onClick={() => void send()}
          >
            Send again
          </button>
        )}
        <LocalMailInbox email={email} />
      </form>
    </Modal>
  );
}
