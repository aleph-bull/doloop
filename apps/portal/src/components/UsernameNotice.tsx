import { useState } from 'react';
import { normalizeUsername, usernameError } from '@komogon/core';
import { Button, Modal, useToast } from '@komogon/ui';
import { useHints } from '../lib/hints';
import { useMe, useSetUsername } from '../lib/queries';
import { useTour } from '../lib/tour';
import { UsernameInput } from './UsernameInput';

/**
 * Tells someone, once, that the app gave them a username (migration 0033 gave every account
 * two random words) and asks them to change it, right here. Shows only while the username is
 * still the picked one, and never over the first-time setup's look around. "Keep it" closes it
 * for good (the dismissal is stored on the account); Settings can still change it later.
 */
export function UsernameNotice() {
  const me = useMe();
  const tour = useTour();
  const set = useSetUsername();
  const { toast } = useToast();
  const { isDismissed, dismiss } = useHints();
  const [draft, setDraft] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const user = me.data?.user;
  if (!me.data?.onboarded || !user?.username || user.usernameChangedAt) return null;
  if (tour || isDismissed('username')) return null;

  const changed = draft !== '' && normalizeUsername(draft) !== user.username;
  const problem = refused ?? (draft ? usernameError(draft) : null);

  const save = async () => {
    if (!changed || problem) return;
    try {
      await set.mutateAsync(draft);
      dismiss('username');
      toast('Username saved.');
    } catch (err) {
      setRefused(err instanceof Error ? err.message : 'Could not save it');
    }
  };

  return (
    <Modal
      open
      onClose={() => dismiss('username')}
      title="Change your username"
      actions={
        <>
          <Button variant="ghost" onClick={() => dismiss('username')}>
            Keep it
          </Button>
          <Button
            variant="primary"
            loading={set.isPending}
            disabled={!changed || !!problem}
            onClick={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <p>
        We gave you <strong>@{user.username}</strong> for now.
      </p>
      <div className="field username-notice-field">
        <label className="field-label" htmlFor="username-notice">
          New username
        </label>
        <UsernameInput
          id="username-notice"
          aria-invalid={!!problem}
          value={draft}
          onChange={(next) => {
            setDraft(next);
            setRefused(null);
          }}
          onEnter={() => void save()}
        />
        {problem && <span className="field-hint field-error">{problem}</span>}
      </div>
    </Modal>
  );
}
