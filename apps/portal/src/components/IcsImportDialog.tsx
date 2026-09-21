import { ROUTINES } from '@doloop/core';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button, Input, Modal } from '@doloop/ui';
import type { ImportIcsResponse } from '../lib/api';

export interface IcsImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (ics: string, defaultEstimate: number) => Promise<ImportIcsResponse>;
}

const MAX_BYTES = 2_000_000;

/**
 * Import repeating events from a calendar export. Only recurring events become routines;
 * the dialog shows exactly what was skipped so nothing disappears quietly.
 */
export function IcsImportDialog({ open, onClose, onImport }: IcsImportDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [estimate, setEstimate] = useState('30');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportIcsResponse | null>(null);

  const pick = async (file: File | undefined) => {
    setError(null);
    setResult(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError('That file is larger than 2 MB.');
      return;
    }
    setFileName(file.name);
    setText(await file.text());
  };

  const run = async () => {
    if (!text) return setError('Choose an .ics file first.');
    setBusy(true);
    setError(null);
    try {
      setResult(await onImport(text, Number(estimate) || 30));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that calendar.');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setResult(null);
    setText(null);
    setFileName(null);
    setError(null);
    onClose();
  };

  if (!open) return null;
  return (
    <Modal
      open
      onClose={close}
      title="Import from a calendar"
      actions={
        result ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!text} onClick={run}>
              Import
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {!result ? (
          <>
            <p className="muted text-sm">
              Pick an .ics export from Google Calendar, Outlook, or your timetable. Repeating events
              become routines; one-off events are left alone. Importing the same calendar again
              updates what it created rather than duplicating it.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <Button onClick={() => fileRef.current?.click()}>
                <Upload size={15} aria-hidden /> Choose file
              </Button>
              <span className="muted text-sm">{fileName ?? 'No file chosen'}</span>
              <input
                ref={fileRef}
                type="file"
                accept=".ics,text/calendar"
                className="sr-only"
                onChange={(e) => void pick(e.target.files?.[0])}
              />
            </div>
            <Input
              label="Default estimate (min)"
              type="number"
              min={ROUTINES.MIN_ESTIMATE_MIN}
              max={ROUTINES.MAX_ESTIMATE_MIN}
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
              hint="Used for all-day events, which carry no duration."
            />
          </>
        ) : (
          <>
            <p>
              {result.created > 0 && (
                <>
                  Added {result.created} routine{result.created === 1 ? '' : 's'}.{' '}
                </>
              )}
              {result.updated > 0 && (
                <>
                  Updated {result.updated} routine{result.updated === 1 ? '' : 's'}.{' '}
                </>
              )}
              {result.created === 0 && result.updated === 0 && 'Nothing to import.'}
            </p>
            {result.routines.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {result.routines.map((r) => (
                  <li key={r.id} className="flex items-baseline gap-2">
                    <span className="flex-1 min-w-0 truncate">{r.title}</span>
                    <span className="muted tabular">{r.estimatedMinutes} min</span>
                  </li>
                ))}
              </ul>
            )}
            {result.skipped.length > 0 && (
              <details>
                <summary className="text-sm" style={{ cursor: 'pointer' }}>
                  Skipped {result.skipped.length} event
                  {result.skipped.length === 1 ? '' : 's'}
                </summary>
                <ul className="flex flex-col gap-1 mt-2 text-sm">
                  {result.skipped.map((s, i) => (
                    <li key={`${s.summary}-${i}`} className="flex items-baseline gap-2">
                      <span className="flex-1 min-w-0 truncate">{s.summary}</span>
                      <span className="muted">{s.reason}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        {error && (
          <p className="text-sm" style={{ color: 'var(--status-bad)' }} role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
