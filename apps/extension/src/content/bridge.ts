/**
 * Runs on the portal origin. The portal posts its session to `window`; we forward it to the
 * background worker, which stores it. We answer so the portal can show "Extension connected".
 */
interface BridgeMessage {
  type: 'komodoit:session';
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
    !!data && typeof data === 'object' && (data as { type?: string }).type === 'komodoit:session'
  );
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (!isBridgeMessage(event.data)) return;
  const { type: _type, ...connection } = event.data;
  void chrome.runtime.sendMessage({ type: 'connect', connection }).then(() => {
    window.postMessage(
      { type: 'komodoit:connected', version: chrome.runtime.getManifest().version },
      window.location.origin,
    );
  });
});

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if ((event.data as { type?: string })?.type !== 'komodoit:ping') return;
  window.postMessage(
    { type: 'komodoit:connected', version: chrome.runtime.getManifest().version },
    window.location.origin,
  );
});

// Let the portal know we are here as soon as we load.
window.postMessage({ type: 'komodoit:extension-ready' }, window.location.origin);
