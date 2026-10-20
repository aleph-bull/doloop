import { useEffect, useState } from 'react';
import {
  applyUserTheme,
  Backdrop,
  Button,
  DEFAULT_BACKGROUND_ID,
  Glass,
  recommendedTheme,
  resolveExtensionBackdrop,
  resolveTheme,
} from '@komogon/ui';
import { getAll, type Stored } from '../lib/storage';

const FALLBACK_PORTAL = import.meta.env.VITE_PORTAL_URL ?? 'http://localhost:5173';

export function Options() {
  const [store, setStore] = useState<Stored | null>(null);
  useEffect(() => {
    void getAll().then(setStore);
  }, []);
  const settings = store?.snapshot?.settings ?? null;
  const portal = store?.connection?.portalUrl ?? FALLBACK_PORTAL;
  const choice = settings
    ? resolveExtensionBackdrop(settings.theme, store?.customBackground?.dataUrl ?? null)
    : { backgroundId: DEFAULT_BACKGROUND_ID, customImageUrl: null };
  // An upload is not sampled here, so Recommended follows the system on one.
  const recommended = choice.customImageUrl ? null : recommendedTheme(choice.backgroundId);
  useEffect(() => {
    if (settings) applyUserTheme(settings, document.documentElement, recommended);
  }, [settings, recommended]);
  return (
    <main style={{ padding: 32, maxWidth: 520 }}>
      <Backdrop
        backgroundId={choice.backgroundId}
        theme={settings ? resolveTheme(settings.theme.mode, undefined, recommended) : 'dark'}
        customImageUrl={choice.customImageUrl}
        assetBase={portal}
      />
      <Glass
        className="card"
        style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <h1 style={{ fontSize: 'var(--text-xl)' }}>Komogon</h1>
        <p style={{ color: 'var(--fg-muted)' }}>
          {store?.connection
            ? `Connected as ${store.connection.email ?? 'your account'}. All settings live in the portal.`
            : 'Not connected. Sign in to the portal and this extension connects automatically.'}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="primary"
            onClick={() => chrome.tabs.create({ url: `${portal}/settings` })}
          >
            Open portal settings
          </Button>
          {store?.connection && (
            <Button
              variant="ghost"
              onClick={() => {
                void chrome.runtime
                  .sendMessage({ type: 'disconnect' })
                  .then(() => getAll().then(setStore));
              }}
            >
              Disconnect
            </Button>
          )}
        </div>
      </Glass>
    </main>
  );
}
