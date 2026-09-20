import { useEffect, useState } from 'react';
import { Button, Glass } from '@doloop/ui';
import { getAll, type Stored } from '../lib/storage';

const FALLBACK_PORTAL = import.meta.env.VITE_PORTAL_URL ?? 'http://localhost:5173';

export function Options() {
  const [store, setStore] = useState<Stored | null>(null);
  useEffect(() => {
    void getAll().then(setStore);
  }, []);
  const portal = store?.connection?.portalUrl ?? FALLBACK_PORTAL;
  return (
    <main style={{ padding: 32, maxWidth: 520 }}>
      <Glass
        className="card"
        style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <h1 style={{ fontSize: 'var(--text-xl)' }}>Doloop</h1>
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
