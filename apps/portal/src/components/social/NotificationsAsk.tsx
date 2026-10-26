import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Modal, useToast } from '@komogon/ui';
import { useHints } from '../../lib/hints';
import { pushState, turnOnPush, type PushState } from '../../lib/push';
import { useMe } from '../../lib/queries';
import { useTour } from '../../lib/tour';

/**
 * Asks, on Social, whether to turn on browser notifications, before the browser's own
 * question (which comes only from a click). Once in each browser that hasn't been asked
 * yet; "Not now" is for good, on every device (Settings › Notifications still has it). Never
 * over the first-time setup or the username notice.
 */
export function NotificationsAsk() {
  const me = useMe();
  const tour = useTour();
  const { toast } = useToast();
  const { isDismissed, dismiss } = useHints();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // A moment after the page, not on top of its arrival.
    const timer = window.setTimeout(() => {
      void pushState().then(setState);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  const user = me.data?.user;
  if (!me.data?.onboarded || !user || tour) return null;
  if (user.username && !user.usernameChangedAt && !isDismissed('username')) return null;
  if (state !== 'off' || Notification.permission !== 'default') return null;
  if (isDismissed('notifications')) return null;

  const turnOn = async () => {
    setBusy(true);
    try {
      const next = await turnOnPush(user.id);
      setState(next);
      if (next === 'on') toast('Notifications on.');
    } catch {
      toast("Couldn't turn on notifications.");
    } finally {
      setBusy(false);
    }
  };

  // On the body: on a phone, Social's sheet would lend it its own text styles.
  return createPortal(
    <Modal
      open
      onClose={() => dismiss('notifications')}
      title="Turn on notifications?"
      actions={
        <>
          <Button variant="ghost" onClick={() => dismiss('notifications')}>
            Not now
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void turnOn()}>
            Turn on
          </Button>
        </>
      }
    >
      <p>For nudges and kudos.</p>
    </Modal>,
    document.body,
  );
}
