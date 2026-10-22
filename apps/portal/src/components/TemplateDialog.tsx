import type { NodeTemplate, StudyNode } from '@komogon/core';
import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, useToast } from '@komogon/ui';
import { useUpdateNode } from '../lib/queries';
import { KINDS, UNITS } from './NodeDialog';

export interface TemplateDialogProps {
  open: boolean;
  onClose: () => void;
  /** The node whose children the template is for. */
  node: StudyNode | null;
}

/** The empty template: every field unset, so a child gets the ordinary defaults. */
export const EMPTY_TEMPLATE: NodeTemplate = {
  kind: null,
  estimatedMinutes: null,
  dueTime: null,
  countUnit: null,
  countUnitLabel: null,
  color: null,
};

/** True when nothing in the template is set: saving it is the same as clearing it. */
export function isEmptyTemplate(t: NodeTemplate | null | undefined): boolean {
  return !t || Object.values(t).every((v) => v === null || v === '');
}

/**
 * Defaults for everything added under a node. A course sets what its assignments start
 * as; a unit under it can set its own for its tasks, and the nearest one up the tree
 * wins. Only the fields set here are defaults; the rest stay as the dialog would have
 * them anyway. Nothing already saved changes.
 */
export function TemplateDialog({ open, onClose, node }: TemplateDialogProps) {
  const update = useUpdateNode();
  const { toast } = useToast();
  const [kind, setKind] = useState('');
  const [hours, setHours] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [unit, setUnit] = useState('');
  const [unitLabel, setUnitLabel] = useState('');

  useEffect(() => {
    if (!open) return;
    const t = node?.childDefaults;
    setKind(t?.kind ?? '');
    setHours(t?.estimatedMinutes != null ? String(t.estimatedMinutes / 60) : '');
    setDueTime(t?.dueTime ?? '');
    setUnit(t?.countUnit ?? '');
    setUnitLabel(t?.countUnitLabel ?? '');
  }, [open, node]);

  if (!node) return null;

  const save = async (template: NodeTemplate | null) => {
    try {
      await update.mutateAsync({ id: node.id, patch: { childDefaults: template } });
      toast(template ? 'Template saved' : 'Template cleared', { tone: 'ok' });
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save');
    }
  };

  const submit = () => {
    const est = hours.trim() === '' ? null : Math.round(Number(hours) * 60);
    if (est !== null && (Number.isNaN(est) || est < 0)) return toast('Hours must be a number');
    const template: NodeTemplate = {
      kind: (kind || null) as NodeTemplate['kind'],
      estimatedMinutes: est,
      dueTime: dueTime || null,
      countUnit: (unit || null) as NodeTemplate['countUnit'],
      countUnitLabel: unit === 'custom' ? unitLabel.trim() || null : null,
      // Task colours can't be set any more (2026-10-22); saving drops an old default.
      color: null,
    };
    void save(isEmptyTemplate(template) ? null : template);
  };

  return (
    <Modal
      phone="full"
      open={open}
      onClose={onClose}
      title={`Template for items under ${node.title}`}
      actions={
        <>
          {node.childDefaults && (
            <Button variant="ghost" onClick={() => save(null)} disabled={update.isPending}>
              Clear template
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={update.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="field-hint">
          What a new item under {node.title} starts as. Leave a field empty to keep the usual
          default. Items already added are not changed, and each one can still be edited on its own.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">No default</option>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
          <Input
            label="Estimated hours"
            type="number"
            min={0}
            step={0.25}
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="No default"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Due time"
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            hint="Used once a due date is picked"
          />
          <Select
            label="Count activities as"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          >
            <option value="">No default</option>
            {UNITS.filter((u) => u.value !== '').map((u) => (
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
        </div>
        <button type="submit" className="sr-only">
          Save
        </button>
      </form>
    </Modal>
  );
}
