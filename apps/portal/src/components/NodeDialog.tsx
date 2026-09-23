import type { StudyNode } from '@komodoit/core';
import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, useToast } from '@komodoit/ui';
import { isoToLocalDate, isoToLocalTime, localToIso } from '../lib/format';
import { useArchiveNode, useCreateNode, useUpdateNode } from '../lib/queries';

export interface NodeDialogProps {
  open: boolean;
  onClose: () => void;
  /** Existing node to edit; omit to create. */
  node?: StudyNode | null;
  /** Default parent when creating. */
  parentId?: string | null;
  /** All non-archived nodes, for the parent picker. */
  nodes: StudyNode[];
}

const KINDS: Array<{ value: StudyNode['kind']; label: string }> = [
  { value: 'course', label: 'Course' },
  { value: 'assessment', label: 'Assessment (quiz, exam)' },
  { value: 'task', label: 'Task (homework, reading)' },
  { value: 'other', label: 'Other' },
];

const UNITS: Array<{ value: NonNullable<StudyNode['countUnit']> | ''; label: string }> = [
  { value: '', label: 'Not counted' },
  { value: 'problems', label: 'Problems' },
  { value: 'pages', label: 'Pages' },
  { value: 'cards', label: 'Cards' },
  { value: 'custom', label: 'Custom label' },
];

export function NodeDialog({ open, onClose, node, parentId, nodes }: NodeDialogProps) {
  const create = useCreateNode();
  const update = useUpdateNode();
  const archive = useArchiveNode();
  const { toast } = useToast();

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<StudyNode['kind']>('task');
  const [parent, setParent] = useState<string>('');
  const [hours, setHours] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('23:59');
  const [unit, setUnit] = useState<string>('');
  const [unitLabel, setUnitLabel] = useState('');
  const [color, setColor] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle(node?.title ?? '');
    setKind(node?.kind ?? (parentId ? 'task' : 'course'));
    setParent(node?.parentId ?? parentId ?? '');
    setHours(node?.estimatedMinutes != null ? String(node.estimatedMinutes / 60) : '');
    setDueDate(isoToLocalDate(node?.dueAt ?? null));
    setDueTime(node?.dueAt ? isoToLocalTime(node.dueAt) : '23:59');
    setUnit(node?.countUnit ?? '');
    setUnitLabel(node?.countUnitLabel ?? '');
    setColor(node?.color ?? '');
  }, [open, node, parentId]);

  const candidates = nodes.filter((n) => n.id !== node?.id);
  const busy = create.isPending || update.isPending;

  const submit = async () => {
    const est = hours.trim() === '' ? null : Math.round(Number(hours) * 60);
    if (est !== null && (Number.isNaN(est) || est < 0)) return toast('Hours must be a number');
    const payload = {
      title: title.trim(),
      kind,
      parentId: parent || null,
      estimatedMinutes: est,
      dueAt: dueDate ? localToIso(dueDate, dueTime || '23:59') : null,
      countUnit: (unit || null) as StudyNode['countUnit'],
      countUnitLabel: unit === 'custom' ? unitLabel.trim() || null : null,
      color: color || null,
    };
    if (!payload.title) return toast('Give it a title');
    try {
      if (node) await update.mutateAsync({ id: node.id, patch: payload });
      else await create.mutateAsync(payload);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={node ? 'Edit' : 'New item'}
      actions={
        <>
          {node && (
            <Button
              variant="danger"
              onClick={async () => {
                await archive.mutateAsync(node.id);
                toast('Archived');
                onClose();
              }}
              disabled={busy}
            >
              Archive
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {node ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          required
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Type"
            value={kind}
            onChange={(e) => setKind(e.target.value as StudyNode['kind'])}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
          <Select label="Under" value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">Top level</option>
            {candidates.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input
            label="Estimated hours"
            type="number"
            min={0}
            step={0.25}
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="e.g. 4"
            hint="Leave empty if unknown"
          />
          <Input
            label="Due date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <Input
            label="Due time"
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            disabled={!dueDate}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Select
            label="Count activities as"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            hint="Used in the full review"
          >
            {UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </Select>
          {unit === 'custom' && (
            <Input
              label="Label"
              value={unitLabel}
              onChange={(e) => setUnitLabel(e.target.value)}
              placeholder="e.g. essays"
            />
          )}
          <Input
            label="Colour"
            type="color"
            value={color || '#6366f1'}
            onChange={(e) => setColor(e.target.value)}
            hint="Optional, inherited by children"
          />
        </div>
        <button type="submit" className="sr-only">
          Save
        </button>
      </form>
    </Modal>
  );
}
