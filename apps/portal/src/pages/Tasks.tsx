import type { NodePace, StudyNode } from '@komogon/core';
import { Check, ChevronDown, ChevronRight, Pencil, Play, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Chip, EmptyState, Panel, ProgressBar, Spinner, useToast } from '@komogon/ui';
import { ErrorPanel } from '../components/ErrorState';
import { NodeDialog } from '../components/NodeDialog';
import { StartSessionDialog } from '../components/StartSessionDialog';
import { StatusChip } from '../components/StatusChip';
import { fmtDue, fmtMinutes } from '../lib/format';
import { useNodes, usePace, useUpdateNode } from '../lib/queries';

interface RowProps {
  node: StudyNode;
  depth: number;
  childrenOf: Map<string, StudyNode[]>;
  pace: Record<string, NodePace>;
  onEdit: (n: StudyNode) => void;
  onAdd: (parentId: string) => void;
  onStart: (n: StudyNode) => void;
  onToggleDone: (n: StudyNode) => void;
}

function Row({ node, depth, childrenOf, pace, onEdit, onAdd, onStart, onToggleDone }: RowProps) {
  const [open, setOpen] = useState(true);
  const kids = childrenOf.get(node.id) ?? [];
  const p = pace[node.id];
  const done = !!node.completedAt;
  return (
    <li>
      <div className="tree-row" style={{ paddingLeft: 12 + depth * 20 }}>
        {kids.length > 0 ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            aria-expanded={open}
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
          </button>
        ) : (
          <span style={{ width: 32 }} aria-hidden />
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          aria-pressed={done}
          aria-label={done ? `Mark ${node.title} as not done` : `Mark ${node.title} as done`}
          onClick={() => onToggleDone(node)}
          style={{
            border: '1px solid var(--border-strong)',
            borderRadius: '50%',
            width: 24,
            height: 24,
            background: done ? 'var(--accent)' : 'transparent',
            color: done ? 'var(--accent-fg)' : 'inherit',
          }}
        >
          {done && <Check size={14} aria-hidden />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={done ? 'line-through muted' : 'font-medium'}
              style={
                node.color ? { borderLeft: `3px solid ${node.color}`, paddingLeft: 8 } : undefined
              }
            >
              {node.title}
            </span>
            {node.kind === 'assessment' && <Chip tone="info">Assessment</Chip>}
            {p && node.kind !== 'course' && !done && <StatusChip status={p.status} />}
          </div>
          <div className="text-xs muted flex gap-2 flex-wrap mt-0.5 tabular">
            {node.dueAt && <span>{fmtDue(node.dueAt)}</span>}
            {p?.estimatedMinutes != null ? (
              <span>
                {fmtMinutes(p.loggedWorkMinutes)} / {fmtMinutes(p.estimatedMinutes)}
              </span>
            ) : (
              // No estimate here or under it: hours logged is the only honest number.
              // Gated on the rounded value so a few seconds do not render "0 m studied".
              p != null &&
              Math.round(p.loggedWorkMinutes) > 0 && (
                <span>{fmtMinutes(p.loggedWorkMinutes)} studied</span>
              )
            )}
            {p?.requiredPerDay != null && !done && (
              <span>· need {fmtMinutes(p.requiredPerDay)}/day</span>
            )}
          </div>
          {p?.progress != null && (
            <div className="mt-1" style={{ maxWidth: 240 }}>
              <ProgressBar value={p.progress} label={`${node.title} progress`} />
            </div>
          )}
        </div>
        <div className="row-actions flex gap-1">
          {node.kind !== 'course' && !done && (
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={`Start ${node.title}`}
              onClick={() => onStart(node)}
            >
              <Play size={14} aria-hidden />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={`Add under ${node.title}`}
            onClick={() => onAdd(node.id)}
          >
            <Plus size={14} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={`Edit ${node.title}`}
            onClick={() => onEdit(node)}
          >
            <Pencil size={14} aria-hidden />
          </Button>
        </div>
      </div>
      {open && kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <Row
              key={k.id}
              node={k}
              depth={depth + 1}
              childrenOf={childrenOf}
              pace={pace}
              onEdit={onEdit}
              onAdd={onAdd}
              onStart={onStart}
              onToggleDone={onToggleDone}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The task tree on an opaque panel (spec §8): course -> item -> subtask. */
export function Tasks() {
  const nodes = useNodes();
  const pace = usePace();
  const update = useUpdateNode();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<{
    node?: StudyNode | null;
    parentId?: string | null;
  } | null>(null);
  const [start, setStart] = useState<StudyNode | null>(null);

  const list = useMemo(() => nodes.data?.nodes ?? [], [nodes.data]);
  const childrenOf = useMemo(() => {
    const m = new Map<string, StudyNode[]>();
    for (const n of list) {
      if (!n.parentId) continue;
      const arr = m.get(n.parentId) ?? [];
      arr.push(n);
      m.set(n.parentId, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);
    return m;
  }, [list]);
  const roots = list
    .filter((n) => !n.parentId || !list.some((x) => x.id === n.parentId))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (nodes.isError)
    return (
      <ErrorPanel
        message={nodes.error instanceof Error ? nodes.error.message : 'Could not load tasks.'}
        onRetry={() => nodes.refetch()}
      />
    );
  if (nodes.isLoading || pace.isLoading)
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );

  const toggleDone = async (n: StudyNode) => {
    try {
      await update.mutateAsync({
        id: n.id,
        patch: { completedAt: n.completedAt ? null : new Date().toISOString() },
      });
      if (!n.completedAt) toast(`${n.title} done`, { tone: 'ok' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <h1 className="text-3xl">Tasks</h1>
        <Button variant="primary" onClick={() => setDialog({ parentId: null })}>
          <Plus size={16} aria-hidden /> New course
        </Button>
      </div>

      <Panel className="p-2">
        {roots.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            body="Add a course, then the assignments, quizzes, and readings under it. Estimates and due dates power the pace calculator."
            action={
              <Button variant="primary" onClick={() => setDialog({ parentId: null })}>
                Add a course
              </Button>
            }
          />
        ) : (
          <ul
            aria-label="Task tree"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              const rows = Array.from(
                e.currentTarget.querySelectorAll<HTMLElement>(
                  '.tree-row [tabindex], .tree-row button',
                ),
              ).filter((el) => el.closest('.tree-row'));
              const current = rows.findIndex((el) => el === document.activeElement);
              if (current === -1) return;
              const currentRow = rows[current]!.closest('.tree-row');
              const dir = e.key === 'ArrowDown' ? 1 : -1;
              for (let i = current + dir; i >= 0 && i < rows.length; i += dir) {
                if (rows[i]!.closest('.tree-row') !== currentRow) {
                  rows[i]!.focus();
                  e.preventDefault();
                  return;
                }
              }
            }}
          >
            {roots.map((r) => (
              <Row
                key={r.id}
                node={r}
                depth={0}
                childrenOf={childrenOf}
                pace={pace.data?.pace ?? {}}
                onEdit={(n) => setDialog({ node: n })}
                onAdd={(parentId) => setDialog({ parentId })}
                onStart={setStart}
                onToggleDone={toggleDone}
              />
            ))}
          </ul>
        )}
      </Panel>

      <NodeDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        node={dialog?.node ?? null}
        parentId={dialog?.parentId ?? null}
        nodes={list}
      />
      <StartSessionDialog
        open={start !== null}
        onClose={() => setStart(null)}
        nodes={list}
        node={start}
      />
    </div>
  );
}
