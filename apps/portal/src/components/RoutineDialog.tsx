import type { Routine, StudyNode } from '@doloop/core';
import { describeRecurrence, ROUTINES } from '@doloop/core';
import { useState } from 'react';
import { Button, Input, Modal, Segmented, Select, Textarea } from '@doloop/ui';
import type { RoutineInput } from '../lib/api';

export interface RoutineDialogProps {
  open: boolean;
  /** The routine being edited, or null to create a new one. */
  routine: Routine | null;
  nodes: StudyNode[];
  today: string;
  onClose: () => void;
  onSave: (input: RoutineInput) => Promise<unknown>;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function RoutineDialog({
  open,
  routine,
  nodes,
  today,
  onClose,
  onSave,
}: RoutineDialogProps) {
  const [title, setTitle] = useState(routine?.title ?? '');
  const [note, setNote] = useState(routine?.note ?? '');
  const [minutes, setMinutes] = useState(String(routine?.estimatedMinutes ?? 20));
  const [freq, setFreq] = useState<Routine['freq']>(routine?.freq ?? 'daily');
  const [interval, setInterval] = useState(String(routine?.interval ?? 1));
  const [weekdays, setWeekdays] = useState<number[]>(routine?.byWeekday ?? []);
  const [monthdays, setMonthdays] = useState<number[]>(routine?.byMonthday ?? []);
  const [startDate, setStartDate] = useState(routine?.startDate ?? today);
  const [endDate, setEndDate] = useState(routine?.endDate ?? '');
  const [nodeId, setNodeId] = useState(routine?.nodeId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (list: number[], set: (v: number[]) => void, value: number) =>
    set(
      list.includes(value)
        ? list.filter((d) => d !== value)
        : [...list, value].sort((a, b) => a - b),
    );

  const preview = describeRecurrence({
    freq,
    interval: Number(interval) || 1,
    byWeekday: freq === 'weekly' ? weekdays : [],
    byMonthday: freq === 'monthly' ? monthdays : [],
    startDate: startDate || today,
    endDate: endDate || null,
  });

  const save = async () => {
    if (!title.trim()) return setError('Give the routine a name.');
    const est = Number(minutes);
    if (
      !Number.isInteger(est) ||
      est < ROUTINES.MIN_ESTIMATE_MIN ||
      est > ROUTINES.MAX_ESTIMATE_MIN
    )
      return setError(
        `Estimate between ${ROUTINES.MIN_ESTIMATE_MIN} and ${ROUTINES.MAX_ESTIMATE_MIN} minutes.`,
      );
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        note: note.trim() || null,
        nodeId: nodeId || null,
        estimatedMinutes: est,
        freq,
        interval: Number(interval) || 1,
        byWeekday: freq === 'weekly' ? weekdays : [],
        byMonthday: freq === 'monthly' ? monthdays : [],
        startDate: startDate || today,
        endDate: endDate || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the routine.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={routine ? 'Edit routine' : 'New routine'}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {routine ? 'Save' : 'Add routine'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="What repeats?"
          placeholder="Read 10 pages"
          value={title}
          autoFocus
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="How long does it take?"
            type="number"
            min={ROUTINES.MIN_ESTIMATE_MIN}
            max={ROUTINES.MAX_ESTIMATE_MIN}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            hint="Also how long a session for it runs by default"
          />
          <Select
            label="Part of"
            value={nodeId}
            onChange={(e) => setNodeId(e.target.value)}
            hint="Optional"
          >
            <option value="">Nothing in particular</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </Select>
        </div>

        <div className="field">
          <span className="field-label">Repeats</span>
          <Segmented
            ariaLabel="How often"
            value={freq}
            onChange={(v) => setFreq(v as Routine['freq'])}
            options={[
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
            ]}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Every"
            type="number"
            min={1}
            max={ROUTINES.MAX_INTERVAL}
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            hint={freq === 'daily' ? 'days' : freq === 'weekly' ? 'weeks' : 'months'}
          />
        </div>

        {freq === 'weekly' && (
          <div className="field">
            <span className="field-label">On</span>
            <div className="pill-row">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  className="day-pick"
                  aria-pressed={weekdays.includes(i)}
                  onClick={() => toggle(weekdays, setWeekdays, i)}
                >
                  {d}
                </button>
              ))}
            </div>
            <span className="field-hint">Pick none to use the start date&rsquo;s weekday.</span>
          </div>
        )}

        {freq === 'monthly' && (
          <div className="field">
            <span className="field-label">On day</span>
            <div className="monthday-grid">
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <button
                  key={d}
                  type="button"
                  className="day-pick"
                  aria-pressed={monthdays.includes(d)}
                  onClick={() => toggle(monthdays, setMonthdays, d)}
                >
                  {d}
                </button>
              ))}
            </div>
            <span className="field-hint">
              Months without that day are skipped. Pick none to use the start date.
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Starts"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <Input
            label="Ends"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            hint="Optional"
          />
        </div>

        <Textarea
          label="Note"
          value={note}
          rows={2}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />

        <p className="muted text-sm">{preview}</p>
        {error && (
          <p className="text-sm" style={{ color: 'var(--status-bad)' }} role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
