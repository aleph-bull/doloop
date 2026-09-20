/**
 * Runs on the portal origin. The portal posts its session to `window`; we forward it to the
 * background worker, which stores it. We answer so the portal can show "Extension connected".
 */
interface BridgeMessage {
  type: 'doloop:session';
  token: string;
  apiUrl: string;
  portalUrl: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  supabaseUrl?: string | null;
  anonKey?: string | null;
  email?: string | null;
}

function isBridgeMessage(data: unknown): data is BridgeMessage {
  return (
    !!data && typeof data === 'object' && (data as { type?: string }).type === 'doloop:session'
  );
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (!isBridgeMessage(event.data)) return;
  const { type: _type, ...connection } = event.data;
  void chrome.runtime.sendMessage({ type: 'connect', connection }).then(() => {
    window.postMessage(
      { type: 'doloop:connected', version: chrome.runtime.getManifest().version },
      window.location.origin,
    );
  });
});

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if ((event.data as { type?: string })?.type !== 'doloop:ping') return;
  window.postMessage(
    { type: 'doloop:connected', version: chrome.runtime.getManifest().version },
    window.location.origin,
  );
});

// Let the portal know we are here as soon as we load.
window.postMessage({ type: 'doloop:extension-ready' }, window.location.origin);
