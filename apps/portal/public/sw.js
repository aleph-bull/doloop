/**
 * Komogon service worker: makes the hosted portal installable and lets it open without a
 * connection. The API is never cached here; data offline comes from the query cache the
 * app already keeps in IndexedDB (lib/persist.ts).
 *
 *  - Pages: network first, so a new deploy shows up on the next open; the last good copy
 *    of the app shell is the fallback when offline.
 *  - /assets/*: Vite's hashed bundles never change under a name, so cache first.
 *  - Icons, fonts, sounds, backgrounds: stale while revalidate.
 *
 * Registered only on a hosted address (see lib/pwa.ts), never on localhost, where the
 * always-on copy and the dev server share a port.
 */
const VERSION = 'v1';
const SHELL = `komogon-shell-${VERSION}`;
const STATIC = `komogon-static-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.add('/'))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('komogon-') && k !== SHELL && k !== STATIC)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(SHELL).then((cache) => cache.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(STATIC).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Range requests (audio seeking) are left to the network: a cached 200 cannot answer them.
  if (req.headers.has('range')) return;
  event.respondWith(
    caches.open(STATIC).then((cache) =>
      cache.match(req).then((hit) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) void cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit ?? Response.error());
        return hit ?? fresh;
      }),
    ),
  );
});
