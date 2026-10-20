/**
 * Registers the service worker (public/sw.js) that makes the hosted portal installable
 * ("Add to Home Screen", "Install app") and able to open offline.
 *
 * Only on a hosted production build: on localhost the always-on copy and the dev server
 * share port 5173, and a worker installed by one would serve the other.
 */
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$|\.test$/;

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  if (LOCAL_HOSTS.test(window.location.hostname)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* installability is a nicety; the app works without it */
    });
  });
}
