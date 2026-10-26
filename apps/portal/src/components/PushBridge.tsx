import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { syncPush } from '../lib/push';
import { keys, useMe } from '../lib/queries';

/**
 * Keeps browser notifications in step on each visit (lib/push.ts), and hears from their
 * worker (public/push-sw.js): something arrived, so the bell and the nudges load again; a
 * notification was clicked, so this window goes where it points.
 */
export function PushBridge() {
  const userId = useMe().data?.user.id;
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (userId) void syncPush(userId).catch(() => undefined);
  }, [userId]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const container = navigator.serviceWorker;
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: unknown; url?: unknown } | null;
      if (data?.type === 'komodon-push') {
        void qc.invalidateQueries({ queryKey: keys.notifications });
        void qc.invalidateQueries({ queryKey: keys.nudges });
      } else if (
        data?.type === 'komodon-push-open' &&
        typeof data.url === 'string' &&
        /^\/(?!\/)/.test(data.url)
      ) {
        navigate(data.url);
      }
    };
    container.addEventListener('message', onMessage);
    // This page isn't the worker's to control, so its messages wait for this.
    container.startMessages();
    return () => container.removeEventListener('message', onMessage);
  }, [qc, navigate]);

  return null;
}
