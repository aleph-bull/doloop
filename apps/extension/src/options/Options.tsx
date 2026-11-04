import { Button, Glass, LogoMark } from '@komogon/ui';
import { portalOf, useLook, useStored } from '../lib/look';

export function Options() {
  const store = useStored();
  const backdrop = useLook(store);
  const portal = portalOf(store);
  return (
    <main className="options">
      {backdrop}
      <Glass className="card stack">
        <div className="brand">
          <LogoMark size={28} />
          <h1 className="card-title">Komogon</h1>
        </div>
        <p className="muted text-sm">
          {store?.connection
            ? `Connected as ${store.connection.email ?? 'your account'}.`
            : store
              ? 'Sign in to Komogon in this browser.'
              : ''}
        </p>
        <div className="row">
          <Button
            variant="primary"
            onClick={() =>
              chrome.tabs.create({ url: store?.connection ? `${portal}/settings` : `${portal}/` })
            }
          >
            {store?.connection ? 'Open settings' : 'Open Komogon'}
          </Button>
          {store?.connection && (
            <Button
              variant="ghost"
              onClick={() => void chrome.runtime.sendMessage({ type: 'disconnect' })}
            >
              Disconnect
            </Button>
          )}
        </div>
      </Glass>
    </main>
  );
}
