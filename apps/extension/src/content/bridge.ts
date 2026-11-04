/**
 * Runs on the portal origin. The portal posts its session to `window`; we forward it to the
 * background worker, which stores it. We answer so the portal can show "Extension connected".
 */
interface BridgeMessage {
  type: 'komogon:session';
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
    !!data && typeof data === 'object' && (data as { type?: string }).type === 'komogon:session'
  );
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (!isBridgeMessage(event.data)) return;
  const { type: _type, ...connection } = event.data;
  void chrome.runtime.sendMessage({ type: 'connect', connection }).then(() => {
    window.postMessage(
      { type: 'komogon:connected', version: chrome.runtime.getManifest().version },
      window.location.origin,
    );
  });
});

// Their own background's picture and fonts (the portal's `useExtensionLook`): kept only when
// they changed, since the app sends them on every visit.
interface LookMessage {
  type: 'komogon:look';
  background: { id: string; dataUrl: string } | null;
  fonts: Array<{ id: string; data: string }>;
}
window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data as LookMessage | null;
  if (data?.type !== 'komogon:look') return;
  void chrome.storage.local.get(['ownBackground', 'ownFonts']).then((had) => {
    const patch: Record<string, unknown> = {};
    const before = had.ownBackground as { id: string } | null | undefined;
    if ((before?.id ?? null) !== (data.background?.id ?? null))
      patch.ownBackground = data.background;
    const fonts = Object.fromEntries(data.fonts.map((f) => [f.id, f.data]));
    const hadFonts = (had.ownFonts as Record<string, string> | undefined) ?? {};
    if (Object.keys(fonts).sort().join() !== Object.keys(hadFonts).sort().join())
      patch.ownFonts = fonts;
    if (Object.keys(patch).length > 0) void chrome.storage.local.set(patch);
  });
});

// Signing out of the app signs the extension out too.
window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if ((event.data as { type?: string })?.type !== 'komogon:signout') return;
  void chrome.runtime.sendMessage({ type: 'disconnect' });
});

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if ((event.data as { type?: string })?.type !== 'komogon:ping') return;
  window.postMessage(
    { type: 'komogon:connected', version: chrome.runtime.getManifest().version },
    window.location.origin,
  );
});

// Let the portal know we are here as soon as we load.
window.postMessage({ type: 'komogon:extension-ready' }, window.location.origin);
