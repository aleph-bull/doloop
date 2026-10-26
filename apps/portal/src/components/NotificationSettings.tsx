import { useEffect, useState } from 'react';
import type { UserSettings } from '@komogon/core';
import { Toggle, useToast } from '@komogon/ui';
import { useHints } from '../lib/hints';
import { pushState, turnOffPush, turnOnPush, type PushState } from '../lib/push';
import { useMe } from '../lib/queries';

type Kinds = UserSettings['notifications'];

const KINDS: Array<{ id: keyof Kinds; label: string }> = [
  { id: 'nudges', label: 'Nudges' },
  { id: 'kudos', label: 'Kudos' },
  { id: 'comments', label: 'Comments' },
  { id: 'mentions', label: 'Mentions' },
];

const WHY_NOT: Partial<Record<PushState, string>> = {
  denied: "Blocked in this browser's site settings.",
  unsupported: 'Not available in this browser.',
  'home-screen': 'Add Komodon to your Home Screen to turn these on.',
};

/**
 * Settings › Notifications: browser notifications on or off in this browser (lib/push.ts),
 * and which kinds the account gets, shown once they are on here.
 */
export function NotificationSettings({
  value,
  onChange,
}: {
  value: Kinds;
  onChange: (patch: { notifications: Partial<Kinds> }) => void;
}) {
  const userId = useMe().data?.user.id;
  const { toast } = useToast();
  const { dismiss } = useHints();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  const toggle = async (on: boolean) => {
    if (!userId) return;
    setBusy(true);
    try {
      if (on) {
        setState(await turnOnPush(userId));
      } else {
        await turnOffPush();
        // Off on purpose: Social doesn't ask again.
        dismiss('notifications');
        setState('off');
      }
    } catch {
      toast(on ? "Couldn't turn on notifications." : "Couldn't turn off notifications.");
      setState(await pushState());
    } finally {
      setBusy(false);
    }
  };

  const blocked = state !== null && state in WHY_NOT;
  return (
    <>
      <Toggle
        checked={state === 'on'}
        disabled={state === null || busy || blocked}
        onChange={(on) => void toggle(on)}
        label="Notifications"
        description={state ? WHY_NOT[state] : undefined}
      />
      {state === 'on' &&
        KINDS.map((k) => (
          <Toggle
            key={k.id}
            checked={value[k.id]}
            onChange={(on) => onChange({ notifications: { [k.id]: on } })}
            label={k.label}
          />
        ))}
    </>
  );
}
