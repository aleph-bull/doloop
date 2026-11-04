import { Maximize2 } from 'lucide-react';
import { Button, Glass } from '@komogon/ui';
import { portalOf, useLook, useStored } from '../lib/look';

const params = new URLSearchParams(window.location.search);
const until = params.get('until');
const site = params.get('site');

function untilTime(): string | null {
  if (!until) return null;
  const t = new Date(until);
  if (Number.isNaN(t.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(t);
}

/** Where a blocked site goes during focus, when the extension may send it here. */
export function Blocked() {
  const store = useStored();
  const backdrop = useLook(store);
  const time = untilTime();
  return (
    <main className="blocked">
      {backdrop}
      <Glass className="card stack">
        <h1>{time ? `Focus until ${time}` : 'Focus'}</h1>
        {site && <p className="muted">{site} is blocked during focus.</p>}
        <div className="row">
          <Button onClick={() => void chrome.tabs.create({ url: `${portalOf(store)}/focus` })}>
            <Maximize2 size={14} aria-hidden /> Open the focus screen
          </Button>
        </div>
      </Glass>
    </main>
  );
}
