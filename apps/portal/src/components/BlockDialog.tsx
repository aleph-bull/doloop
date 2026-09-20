import type { PlannedBlock, StudyNode } from '@doloop/core';
import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, useToast } from '@doloop/ui';
import { isoToLocalDate, isoToLocalTime, localToIso } from '../lib/format';
import { useCreateBlock, useDeleteBlock, useUpdateBlock } from '../lib/queries';

export interface BlockDialogProps {
  open: boolean;
  onClose: () => void;
  nodes: StudyNode[];
  /** Existing block to edit; omit to create. */
  block?: PlannedBlock | null;
  /** Prefill for a new block (from drag or suggestion). */
  draft?: { startAt: string; endAt: string; nodeId?: string | null } | null;
}

export function BlockDialog({ open, onClose, nodes, block, draft }: BlockDialogProps) {
  const create = useCreateBlock();
  const update = useUpdateBlock();
  const remove = useDeleteBlock();
  const { toast } = useToast();
  const [nodeId, setNodeId] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');

  useEffect(() => {
    if (!open) return;
    const src = block ?? draft;
    setNodeId(
      block?.nodeId ??
        draft?.nodeId ??
        nodes.find((n) => n.kind !== 'course' && !n.completedAt)?.id ??
        '',
    );
    setDate(isoToLocalDate(src?.startAt ?? new Date().toISOString()));
    setStart(src ? isoToLocalTime(src.startAt) : '09:00');
    setEnd(src ? isoToLocalTime(src.endAt) : '10:00');
  }, [open, block, draft, nodes]);

  const leaves = nodes.filter((n) => n.kind !== 'course' && !n.completedAt);
  const busy = create.isPending || update.isPending || remove.isPending;

  const submit = async () => {
    const startAt = localToIso(date, start);
    const endAt = localToIso(date, end);
    if (Date.parse(endAt) <= Date.parse(startAt)) return toast('End must be after start');
    try {
      if (block)
        await update.mutateAsync({
          id: block.id,
          patch: { nodeId: nodeId || null, startAt, endAt },
        });
      else await create.mutateAsync({ nodeId: nodeId || null, startAt, endAt });
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        block
          ? block.source === 'google' && !block.nodeId
            ? 'Link this Google event'
            : 'Edit block'
          : 'Plan a block'
      }
      actions={
        <>
          {block && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                remove
                  .mutateAsync(block.id)
                  .then(onClose)
                  .catch((e) => toast(e.message))
              }
            >
              Delete
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Task"
          value={nodeId}
          onChange={(e) => setNodeId(e.target.value)}
          hint={
            block?.source === 'google'
              ? 'Imported from your Study calendar. Pick the task it belongs to.'
              : undefined
          }
        >
          <option value="">No task yet</option>
          {leaves.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-3 gap-3">
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input
            label="From"
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <Input label="To" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
