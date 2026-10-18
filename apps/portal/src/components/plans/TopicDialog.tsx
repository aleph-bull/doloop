import type { TopicProgress } from '@komogon/core';
import { useEffect, useState } from 'react';
import { Button, Input, Modal, Toggle } from '@komogon/ui';
import type { TopicPatch } from '../../lib/api';

export interface TopicDialogProps {
  open: boolean;
  onClose: () => void;
  /** The topic being edited, or null to add one. */
  topic: TopicProgress | null;
  busy: boolean;
  onSave: (patch: TopicPatch & { title: string; plannedMinutes: number }) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function TopicDialog({ open, onClose, topic, busy, onSave, onDelete }: TopicDialogProps) {
  const [title, setTitle] = useState('');
  const [hours, setHours] = useState('');
  const [resource, setResource] = useState('');
  const [practice, setPractice] = useState(true);
  const [done, setDone] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = topic?.topic;
    setTitle(t?.title ?? '');
    setHours(t ? String(+(t.plannedMinutes / 60).toFixed(2)) : '');
    setResource(t?.resource ?? '');
    setPractice(t?.practice ?? true);
    setDone(t?.completedAt != null);
    setConfirmDelete(false);
  }, [open, topic]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({
      title: title.trim(),
      plannedMinutes: Math.round((Number(hours) || 0) * 60),
      resource: resource.trim() || null,
      practice,
      ...(topic ? { done } : {}),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={topic ? `Edit ${topic.topic.title}` : 'New topic'}
      actions={
        <>
          {onDelete &&
            (confirmDelete ? (
              <Button variant="danger" loading={busy} onClick={onDelete}>
                Delete with its sessions and drills
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
          <Button type="submit" form="topic-form" variant="primary" loading={busy}>
            {topic ? 'Save' : 'Add topic'}
          </Button>
        </>
      }
    >
      <form id="topic-form" className="flex flex-col gap-4" onSubmit={submit}>
        <Input
          label="Topic"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          autoFocus
        />
        <Input
          label="Planned hours"
          type="number"
          min={0}
          step="0.25"
          inputMode="decimal"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
        <Input
          label="Resource (optional)"
          placeholder="Book, module, link"
          value={resource}
          onChange={(e) => setResource(e.target.value)}
          maxLength={500}
        />
        <Toggle
          checked={practice}
          onChange={setPractice}
          label="Drill it with questions"
          description="Marked right, shaky or missed. It counts as learned once your accuracy holds, not when the hours run out."
        />
        {topic && (
          <Toggle
            checked={done}
            onChange={setDone}
            label="Learned"
            description="Tick it yourself, or let the drills do it."
          />
        )}
      </form>
    </Modal>
  );
}
