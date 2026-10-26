/**
 * Komodon's notifications worker: shows what the API sends (nudges, kudos, comments and
 * mentions; apps/api/src/services/push.ts) and opens the app when one is clicked.
 *
 * It is a worker of its own, scoped to /push/ where no page lives, so it never caches or
 * serves anything and runs on every address, localhost sandboxes included. The caching one
 * (sw.js) runs only on hosted builds. Registered by lib/push.ts.
 */

const windows = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true });

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('push', (event) => {
  let message = null;
  try {
    message = event.data ? event.data.json() : null;
  } catch {
    message = null;
  }
  if (!message || !message.title) return;
  event.waitUntil(
    (async () => {
      const open = await windows();
      // The bell and the nudges card load again now rather than at their next refresh.
      for (const client of open) client.postMessage({ type: 'komodon-push', kind: message.kind });
      // Someone looking at the app already sees it there, and the focus screen stays quiet.
      if (open.some((client) => client.focused)) return;
      await self.registration.showNotification(message.title, {
        body: message.body || undefined,
        tag: message.tag,
        icon: '/icon-192.png',
        data: { url: message.url },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/social';
  event.waitUntil(
    (async () => {
      const open = await windows();
      // An app window, not the focus screen's own tab.
      const app = open.find((client) => !new URL(client.url).pathname.startsWith('/focus'));
      if (app) {
        await app.focus();
        app.postMessage({ type: 'komodon-push-open', url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
