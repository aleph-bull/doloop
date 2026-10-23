import { useState } from 'react';
import { DISPLAY_NAME_MAX, displayNameError } from '@komogon/core';
import { Button, Glass, Input, useToast } from '@komogon/ui';
import { useHints } from '../lib/hints';
import { useMe, useUpdateSettings } from '../lib/queries';

/**
 * Asks once for a name, for people who signed up before the greeting existed. Closing it
 * is permanent — the dismissal is stored on the account, not in this browser — and the
 * field is always available in Settings.
 */
export function NamePrompt() {
  const me = useMe();
  const update = useUpdateSettings();
  const { isDismissed, dismiss } = useHints();
  const { toast } = useToast();
  const [name, setName] = useState('');

  const current = me.data?.user.settings.profile.name;
  if (!me.data || current || isDismissed('name')) return null;
  const problem = displayNameError(name);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || problem) return;
    try {
      await update.mutateAsync({ profile: { name: trimmed } });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save that');
    }
  };

  return (
    <Glass className="p-5 flex flex-col gap-3 fade-in" role="region" aria-label="Your name">
      <div>
        <h2 className="card-title">What should we call you?</h2>
        <p className="muted text-sm">Used to say hello, and shown on the leaderboard.</p>
      </div>
      <form className="flex items-end gap-2 flex-wrap" onSubmit={save}>
        <Input
          label="Display name"
          hint={problem ? <span className="field-error">{problem}</span> : undefined}
          placeholder="e.g. John"
          className="w-48"
          aria-invalid={!!problem}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={DISPLAY_NAME_MAX}
          autoFocus
        />
        <Button type="submit" variant="primary" loading={update.isPending} disabled={!!problem}>
          Save
        </Button>
        <Button variant="ghost" onClick={() => dismiss('name')}>
          Not now
        </Button>
      </form>
    </Glass>
  );
}
