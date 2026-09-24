import type { Tracker } from '@komogon/core';
import { useEffect, useState } from 'react';
import { Button, Input, Modal, useToast } from '@komogon/ui';
import { useCreateTracker, useDeleteTracker, useUpdateTracker } from '../lib/queries';

export interface TrackerDialogProps {
  open: boolean;
  onClose: () => void;
  /** The tracker being edited, or null to create one. */
  tracker: Tracker | null;
}

const EXAMPLES = [
  { title: 'Pages read', unitLabel: 'pages', dailyGoal: '20' },
  { title: 'Problems solved', unitLabel: 'problems', dailyGoal: '10' },
  { title: 'Flashcards reviewed', unitLabel: 'cards', dailyGoal: '50' },
  { title: 'Words written', unitLabel: 'words', dailyGoal: '500' },
];

/** Create or edit a custom tracker: what it is called, what one unit is, and a daily goal. */
export function TrackerDialog({ open, onClose, tracker }: TrackerDialogProps) {
  const create = useCreateTracker();
  const update = useUpdateTracker();
  const remove = useDeleteTracker();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [unitLabel, setUnitLabel] = useState('');
  const [dailyGoal, setDailyGoal] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(tracker?.title ?? '');
    setUnitLabel(tracker?.unitLabel ?? '');
    setDailyGoal(tracker?.dailyGoal != null ? String(tracker.dailyGoal) : '');
    setConfirmDelete(false);
  }, [open, tracker]);

  const busy = create.isPending || update.isPending || remove.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const goalNum = dailyGoal.trim() === '' ? null : Number(dailyGoal);
    if (goalNum !== null && (!Number.isFinite(goalNum) || goalNum <= 0)) {
      toast('A daily goal has to be a positive number');
      return;
    }
    const input = {
      title: title.trim(),
      unitLabel: unitLabel.trim(),
      dailyGoal: goalNum,
    };
    try {
      if (tracker) await update.mutateAsync({ id: tracker.id, patch: input });
      else await create.mutateAsync(input);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save that');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tracker ? `Edit ${tracker.title}` : 'New tracker'}
      actions={
        <>
          {tracker &&
            (confirmDelete ? (
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={async () => {
                  try {
                    await remove.mutateAsync(tracker.id);
                    onClose();
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Could not delete that');
                  }
                }}
              >
                Delete and lose its history
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ))}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="tracker-form" variant="primary" loading={busy}>
            {tracker ? 'Save' : 'Add tracker'}
          </Button>
        </>
      }
    >
      <form id="tracker-form" className="flex flex-col gap-4" onSubmit={submit}>
        <Input
          label="What are you counting?"
          placeholder="e.g. Pages read"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={60}
          autoFocus
        />
        <Input
          label="Unit"
          hint="The plural word for one of them. It appears on the widget and its tooltips."
          placeholder="e.g. pages"
          value={unitLabel}
          onChange={(e) => setUnitLabel(e.target.value)}
          required
          maxLength={24}
        />
        <Input
          label="Daily goal (optional)"
          hint="With a goal, the colours are fixed fractions of it, so a good day always looks the same. Without one, they follow your own best and worst days."
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          placeholder="e.g. 20"
          value={dailyGoal}
          onChange={(e) => setDailyGoal(e.target.value)}
        />
        {!tracker && (
          <div className="flex flex-col gap-2">
            <span className="field-label">Or start from one of these</span>
            <div className="flex gap-2 flex-wrap">
              {EXAMPLES.map((ex) => (
                <Button
                  key={ex.title}
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setTitle(ex.title);
                    setUnitLabel(ex.unitLabel);
                    setDailyGoal(ex.dailyGoal);
                  }}
                >
                  {ex.title}
                </Button>
              ))}
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
