import { roundAccuracy, type DrillResult } from '@komogon/core';
import { Check, Minus, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Modal, Textarea } from '@komogon/ui';
import type { DrillInput } from '../../lib/api';
import { pct } from '../../lib/format';

export interface DrillDialogProps {
  open: boolean;
  onClose: () => void;
  topicTitle: string;
  busy: boolean;
  onLog: (input: DrillInput) => Promise<void>;
}

const MARKS: Array<{ result: DrillResult; label: string; key: string; Icon: typeof Check }> = [
  { result: 'ok', label: 'Got it', key: '1', Icon: Check },
  { result: 'shaky', label: 'Shaky', key: '2', Icon: Minus },
  { result: 'miss', label: 'Missed', key: '3', Icon: X },
];

const lines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * A drilling round, tallied as you go: tap (or press 1, 2, 3) after each question you answer
 * out loud. Naming a miss is optional; named ones come back tomorrow in the miss queue.
 */
export function DrillDialog({ open, onClose, topicTitle, busy, onLog }: DrillDialogProps) {
  const [tally, setTally] = useState<DrillResult[]>([]);
  const [misses, setMisses] = useState('');
  const [shakies, setShakies] = useState('');
  const typing = useRef(false);

  useEffect(() => {
    if (!open) return;
    setTally([]);
    setMisses('');
    setShakies('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (typing.current || e.metaKey || e.ctrlKey || e.altKey) return;
      const mark = MARKS.find((m) => m.key === e.key);
      if (mark) {
        e.preventDefault();
        setTally((t) => [...t, mark.result]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const count = (r: DrillResult) => tally.filter((x) => x === r).length;
  const counts = { ok: count('ok'), shaky: count('shaky'), miss: count('miss') };
  const accuracy = roundAccuracy(counts);
  const named = lines(misses).length + lines(shakies).length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onLog({ ...counts, misses: lines(misses), shakies: lines(shakies) });
  };

  const focusGuard = {
    onFocus: () => (typing.current = true),
    onBlur: () => (typing.current = false),
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Drill: ${topicTitle}`}
      className="drill-dialog"
      actions={
        <>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="drill-form"
            variant="primary"
            loading={busy}
            disabled={tally.length === 0 && named === 0}
          >
            Log round
          </Button>
        </>
      }
    >
      <form id="drill-form" className="flex flex-col gap-4" onSubmit={submit}>
        <div className="drill-score" aria-live="polite">
          <span className="drill-score-figure tabular">
            {accuracy === null ? '–' : pct(accuracy)}
          </span>
          <span className="muted text-sm">
            {tally.length === 0
              ? 'Mark each question as you answer it'
              : `${tally.length} question${tally.length === 1 ? '' : 's'} this round`}
          </span>
        </div>
        <div className="drill-marks">
          {MARKS.map(({ result, label, key, Icon }) => (
            <button
              key={result}
              type="button"
              className={`drill-mark is-${result}`}
              onClick={() => setTally((t) => [...t, result])}
              aria-label={`${label}, ${count(result)} so far`}
            >
              <Icon size={20} aria-hidden />
              <span className="drill-mark-count tabular">{count(result)}</span>
              <span className="drill-mark-label">
                {label} <kbd>{key}</kbd>
              </span>
            </button>
          ))}
        </div>
        <div>
          <Button
            size="sm"
            variant="ghost"
            disabled={tally.length === 0}
            onClick={() => setTally((t) => t.slice(0, -1))}
          >
            <Undo2 size={14} aria-hidden /> Undo last
          </Button>
        </div>
        <Textarea
          label="Which ones did you miss? (optional)"
          hint="One per line. They come back tomorrow."
          rows={3}
          placeholder="The question, in a few words"
          value={misses}
          onChange={(e) => setMisses(e.target.value)}
          {...focusGuard}
        />
        <Textarea
          label="Any shaky ones? (optional)"
          rows={2}
          value={shakies}
          onChange={(e) => setShakies(e.target.value)}
          {...focusGuard}
        />
      </form>
    </Modal>
  );
}
