import { Chip, Glass, Panel } from '@komodoit/ui';
import { useExtensionStatus } from '../lib/extension-bridge';

export function Extension() {
  const status = useExtensionStatus();
  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <h1 className="text-3xl">Chrome extension</h1>
      <Glass className="p-5 flex items-center gap-3">
        <span className="flex-1">
          {status.connected
            ? 'Extension connected. Your sessions sync automatically.'
            : status.installed
              ? 'Extension detected. Connecting…'
              : 'Extension not detected in this browser.'}
        </span>
        <Chip tone={status.connected ? 'ok' : status.installed ? 'warn' : 'neutral'} dot>
          {status.connected
            ? `Connected${status.version ? ` · v${status.version}` : ''}`
            : status.installed
              ? 'Connecting'
              : 'Not installed'}
        </Chip>
      </Glass>
      <Panel className="p-5 flex flex-col gap-3 text-sm">
        <h2 className="text-lg">What it does</h2>
        <ul className="list-disc pl-5 muted flex flex-col gap-1">
          <li>Start and stop sessions from the toolbar; the badge shows minutes left.</li>
          <li>
            Pauses the work clock when your computer goes idle and asks if you are still studying.
          </li>
          <li>Blocks the sites you list in Settings during work intervals, if you turn that on.</li>
        </ul>
        <h2 className="text-lg mt-2">Install (developer build)</h2>
        <ol className="list-decimal pl-5 muted flex flex-col gap-1">
          <li>
            Build it: <code>pnpm --filter @komodoit/extension build</code>
          </li>
          <li>
            Open <code>chrome://extensions</code>, turn on Developer mode, click Load unpacked,
            choose <code>apps/extension/dist</code>.
          </li>
          <li>Reload this page. The extension picks up your sign-in automatically.</li>
        </ol>
      </Panel>
    </div>
  );
}
