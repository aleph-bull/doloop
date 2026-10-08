import type { NodePace, StudyNode } from '@komogon/core';
import {
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  LayoutTemplate,
  Pencil,
  Play,
  Plus,
} from 'lucide-react';
import { useMemo, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Button, Chip, EmptyState, Panel, ProgressBar, Spinner, useToast } from '@komogon/ui';
import { ErrorPanel } from '../components/ErrorState';
import { NodeDialog } from '../components/NodeDialog';
import { StartSessionDialog } from '../components/StartSessionDialog';
import { TemplateDialog } from '../components/TemplateDialog';
import { StatusChip } from '../components/StatusChip';
import { fmtDate, fmtDue, fmtMinutes, fmtPerDay } from '../lib/format';
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
  onTemplate: (n: StudyNode) => void;
  /** The drag grip, for a course. */
  grip?: ReactNode;
  /** Drop handling and drag state for a course's whole item, subtree included. */
  itemProps?: HTMLAttributes<HTMLLIElement>;
}

function Row({
  node,
  depth,
  childrenOf,
  pace,
  onEdit,
  onAdd,
  onStart,
  onToggleDone,
  onTemplate,
  grip,
  itemProps,
}: RowProps) {
  const [open, setOpen] = useState(true);
  const kids = childrenOf.get(node.id) ?? [];
  const p = pace[node.id];
  const done = !!node.completedAt;
  // Finished items step out of the way into a folded "Done" group at the bottom.
  const activeKids = kids.filter((k) => !k.completedAt);
  const doneKids = kids.filter((k) => k.completedAt);
  const child = (k: StudyNode) => (
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
      onTemplate={onTemplate}
    />
  );
  return (
    <li
      {...itemProps}
      className={
        [depth === 0 ? 'tree-root' : '', itemProps?.className ?? ''].join(' ').trim() || undefined
      }
    >
      <div className="tree-row" style={{ paddingLeft: 20 + depth * 20 }}>
        {grip}
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
        {/*
          Starting something is the point of the page, so it sits up front beside the tick and
          stays visible rather than waiting for a hover the way the editing actions do - and a
          touch device has no hover to wait for. Rows without one keep the space, so titles
          line up down the tree.
        */}
        {node.kind !== 'course' && !done ? (
          <Button
            variant="ghost"
            size="sm"
            icon
            className="row-start"
            aria-label={`Start a session on ${node.title}`}
            title="Start a session"
            onClick={() => onStart(node)}
          >
            <Play size={14} aria-hidden />
          </Button>
        ) : (
          <span className="row-start-spacer" aria-hidden />
        )}
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
            {node.childDefaults && (
              <Chip tone="neutral" title="Items added under this start from its template">
                Template
              </Chip>
            )}
            {p && node.kind !== 'course' && !done && <StatusChip status={p.status} />}
          </div>
          <div className="row-meta text-xs muted flex gap-2 flex-wrap mt-0.5 tabular">
            {/* Finished is finished: a done item says when, never that it is overdue. */}
            {done && node.completedAt ? (
              <span>Done {fmtDate(node.completedAt)}</span>
            ) : (
              node.dueAt && <span>{fmtDue(node.dueAt)}</span>
            )}
            {p?.estimatedMinutes != null ? (
              <span>
                {fmtMinutes(p.loggedWorkMinutes)} / {fmtMinutes(p.estimatedMinutes)}
              </span>
            ) : (
              // No estimate here or under it: hours logged is the only honest number.
              // Gated on the rounded value so a few seconds do not render "0 min studied".
              p != null &&
              Math.round(p.loggedWorkMinutes) > 0 && (
                <span>{fmtMinutes(p.loggedWorkMinutes)} studied</span>
              )
            )}
            {p?.requiredPerDay != null && !done && (
              <span>· need {fmtPerDay(p.requiredPerDay)}/day</span>
            )}
          </div>
          {p?.progress != null && (
            <div className="mt-1" style={{ maxWidth: 240 }}>
              <ProgressBar value={p.progress} label={`${node.title} progress`} />
            </div>
          )}
        </div>
        <div className="row-actions flex gap-1">
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
            aria-label={`Template for items under ${node.title}`}
            title="Template for items under this"
            onClick={() => onTemplate(node)}
          >
            <LayoutTemplate size={14} aria-hidden />
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
          {activeKids.map(child)}
          {doneKids.length > 0 && (
            <DoneGroup depth={depth + 1} count={doneKids.length}>
              {doneKids.map(child)}
            </DoneGroup>
          )}
        </ul>
      )}
    </li>
  );
}

/**
 * Finished items under one parent, folded away until asked for. Ticking one off moves it
 * here; unticking brings it back.
 */
function DoneGroup({
  depth,
  count,
  children,
}: {
  depth: number;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        className="tree-done-toggle"
        // In line with the tick buttons of the rows it holds.
        style={{ paddingLeft: 20 + depth * 20 + 42 }}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        Done · {count}
      </button>
      {open && <ul>{children}</ul>}
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
  const [template, setTemplate] = useState<StudyNode | null>(null);
  // Dragging courses: which is being dragged, where it would land, and the new order shown
  // until the server's copy catches up. The optimistic order is tied to the data it was
  // made from, so fresh data replaces it without an effect.
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; before: boolean } | null>(null);
  const [optimistic, setOptimistic] = useState<{ ids: string[]; basis: unknown } | null>(null);

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
  const sortedRoots = list
    .filter((n) => !n.parentId || !list.some((x) => x.id === n.parentId))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const roots =
    optimistic && optimistic.basis === nodes.data
      ? [
          ...optimistic.ids
            .map((id) => sortedRoots.find((r) => r.id === id))
            .filter((r): r is StudyNode => !!r),
          ...sortedRoots.filter((r) => !optimistic.ids.includes(r.id)),
        ]
      : sortedRoots;

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

  /**
   * Put course `id` at `to` in the list of courses. Its sort order becomes the midpoint of
   * its new neighbours, so only the moved course is written, and Ctrl+Z moves it back.
   */
  const moveCourse = async (id: string, to: number) => {
    const from = roots.findIndex((r) => r.id === id);
    if (from < 0) return;
    const target = Math.max(0, Math.min(roots.length - 1, to));
    if (target === from) return;
    const next = roots.filter((r) => r.id !== id);
    next.splice(target, 0, roots[from]!);
    const before = next[target - 1];
    const after = next[target + 1];
    const sortOrder =
      before && after
        ? (before.sortOrder + after.sortOrder) / 2
        : before
          ? before.sortOrder + 1
          : after
            ? after.sortOrder - 1
            : 0;
    setOptimistic({ ids: next.map((r) => r.id), basis: nodes.data });
    try {
      await update.mutateAsync({ id, patch: { sortOrder } });
    } catch (err) {
      setOptimistic(null);
      toast(err instanceof Error ? err.message : 'Could not move that course');
    }
  };

  const dropOn = (targetId: string, before: boolean) => {
    if (!dragId || dragId === targetId) return;
    const from = roots.findIndex((r) => r.id === dragId);
    let to = roots.findIndex((r) => r.id === targetId) + (before ? 0 : 1);
    if (from < to) to -= 1;
    void moveCourse(dragId, to);
  };

  const courseGrip = (r: StudyNode, index: number) => (
    <button
      type="button"
      className="tree-grip"
      draggable
      aria-label={`Move ${r.title}. Drag, or press Alt with the up or down arrow.`}
      title="Drag to reorder"
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', r.id);
        const item = e.currentTarget.closest('li');
        if (item) e.dataTransfer.setDragImage(item, 24, 20);
        setDragId(r.id);
      }}
      onDragEnd={() => {
        setDragId(null);
        setDrop(null);
      }}
      onKeyDown={(e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        e.stopPropagation();
        const target = e.currentTarget;
        void moveCourse(r.id, index + (e.key === 'ArrowUp' ? -1 : 1)).then(() =>
          // Keep focus on the grip that moved, so the keys can keep moving it.
          window.requestAnimationFrame(() => target.focus()),
        );
      }}
    >
      <GripVertical size={14} aria-hidden />
    </button>
  );

  const courseItemProps = (r: StudyNode): HTMLAttributes<HTMLLIElement> => ({
    className: [
      dragId === r.id ? 'is-dragging' : '',
      drop?.id === r.id ? (drop.before ? 'is-drop-before' : 'is-drop-after') : '',
    ]
      .join(' ')
      .trim(),
    onDragOver: (e) => {
      if (!dragId || dragId === r.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const box = e.currentTarget.getBoundingClientRect();
      const before = e.clientY < box.top + box.height / 2;
      if (drop?.id !== r.id || drop.before !== before) setDrop({ id: r.id, before });
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
    },
    onDrop: (e) => {
      e.preventDefault();
      const box = e.currentTarget.getBoundingClientRect();
      dropOn(r.id, e.clientY < box.top + box.height / 2);
      setDrop(null);
      setDragId(null);
    },
  });

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
            body="Add a course, then its assignments, quizzes and readings. Estimates and due dates let Komogon plan your day."
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
            {roots.map((r, i) => (
              <Row
                key={r.id}
                node={r}
                depth={0}
                grip={roots.length > 1 ? courseGrip(r, i) : undefined}
                itemProps={courseItemProps(r)}
                childrenOf={childrenOf}
                pace={pace.data?.pace ?? {}}
                onEdit={(n) => setDialog({ node: n })}
                onAdd={(parentId) => setDialog({ parentId })}
                onStart={setStart}
                onToggleDone={toggleDone}
                onTemplate={setTemplate}
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
        lockSubject
      />
      <TemplateDialog
        open={template !== null}
        onClose={() => setTemplate(null)}
        // The row's node from the fresh list, so a saved template shows at once.
        node={template ? (list.find((n) => n.id === template.id) ?? template) : null}
      />
    </div>
  );
}
