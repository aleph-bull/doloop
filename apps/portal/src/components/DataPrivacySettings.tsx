import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, useToast } from '@komogon/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { exportToCsvFiles, zipFiles } from '../lib/csv-export';
import { clearQueryCache } from '../lib/persist';

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** What this browser holds besides the query cache: saved looks and small preferences. */
function clearThisDevice() {
  try {
    indexedDB.deleteDatabase('komogon-presets');
  } catch {
    // Private windows can refuse IndexedDB; there is nothing stored there to clear.
  }
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('komogon')) localStorage.removeItem(k);
  } catch {
    // Storage blocked: likewise nothing to clear.
  }
}

/**
 * What happens to your data, said plainly, and the two things you can always do with it:
 * take a copy, or delete all of it.
 */
export function DataPrivacySettings() {
  const auth = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<'csv' | 'json' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);

  const exportAs = async (kind: 'csv' | 'json') => {
    setBusy(kind);
    try {
      const data = (await api.exportData()) as Record<string, unknown>;
      if (kind === 'json')
        download(
          new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
          `komogon-export-${stamp()}.json`,
        );
      else download(zipFiles(exportToCsvFiles(data)), `komogon-export-${stamp()}.zip`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not export your data');
    } finally {
      setBusy(null);
    }
  };

  const deleteEverything = async () => {
    setDeleting(true);
    try {
      await api.deleteAccount();
      await clearQueryCache();
      qc.clear();
      clearThisDevice();
      await auth.signOut();
      navigate('/signin');
    } catch (err) {
      setDeleting(false);
      toast(err instanceof Error ? err.message : 'Could not delete your data');
    }
  };

  const closeConfirm = () => {
    if (deleting) return;
    setConfirming(false);
    setTyped('');
  };

  return (
    <>
      <div className="privacy-promise">
        <p className="privacy-lead">Your data is yours.</p>
        <ul className="privacy-points">
          <li>Komogon never sells your data, to advertisers or to anyone else.</li>
          <li>
            It is only used to run Komogon for you: your tasks, sessions and stats. Nothing else
            is done with it unless you agree to it first.
          </li>
          <li>There are no ads and no tracking.</li>
          <li>Google Calendar is only used if you connect it, and you can disconnect it at any time.</li>
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Download a copy</h3>
        <p className="field-hint">
          Everything you have added, at any time. The CSV download is a .zip with one spreadsheet
          per kind of record, which opens in Excel, Numbers or Google Sheets.
        </p>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => exportAs('csv')} loading={busy === 'csv'}>
            Export as CSV
          </Button>
          <Button variant="secondary" onClick={() => exportAs('json')} loading={busy === 'json'}>
            Export as JSON
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">On this device</h3>
        <p className="field-hint">
          Komogon keeps a copy of your data in this browser so it opens quickly and works offline.
          It stays on this device and is cleared when you sign out.
        </p>
        <div>
          <Button
            variant="secondary"
            onClick={async () => {
              await clearQueryCache();
              qc.clear();
              toast('Offline copy cleared', { tone: 'ok' });
            }}
          >
            Clear offline copy
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Delete everything</h3>
        <p className="field-hint">
          Deletes your account and all of your data for good. You may want to export a copy first.
        </p>
        <div>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete all my data
          </Button>
        </div>
      </div>

      <Modal
        open={confirming}
        onClose={closeConfirm}
        title="Delete all your data?"
        actions={
          <>
            <Button variant="secondary" onClick={closeConfirm} disabled={deleting}>
              Keep my data
            </Button>
            <Button
              variant="danger"
              onClick={deleteEverything}
              disabled={typed.trim().toLowerCase() !== 'delete'}
              loading={deleting}
            >
              Delete everything
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p>
            This deletes your account and everything in it: tasks, sessions, routines, plans,
            grades, rewards, trackers and settings. It also clears the copy saved on this device.
            It cannot be undone.
          </p>
          <Input
            label='Type "delete" to confirm'
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        </div>
      </Modal>
    </>
  );
}
