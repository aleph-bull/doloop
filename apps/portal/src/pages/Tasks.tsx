import { tagsOf, type NodePace, type StudyNode, type Tag } from '@komogon/core';
import {
  Check,
  ChevronRight,
  ClipboardPaste,
  GripVertical,
  LayoutTemplate,
  Pencil,
  Play,
  Plus,
  Tag as TagIcon,
} from 'lucide-react';
import {
  useCallback,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { Button, EmptyState, Panel, Reveal, Spinner, useToast } from '@komogon/ui';
import { ErrorPanel } from '../components/ErrorState';
import { NodeDialog } from '../components/NodeDialog';
import { PasteListDialog } from '../components/PasteListDialog';
import { StartSessionDialog } from '../components/StartSessionDialog';
import { TagChip, TagManager, TagPicker } from '../components/Tags';
import { TemplateDialog } from '../components/TemplateDialog';
import { fmtDate, fmtDue, fmtMinutes, fmtPerDay } from '../lib/format';
import { useNodes, usePace, useTags, useUpdateNode } from '../lib/queries';

interface RowProps {
  node: StudyNode;
  depth: number;
  childrenOf: Map<string, StudyNode[]>;
  pace: Record<string, NodePace>;
  tagsById: Map<string, Tag>;
  onEdit: (n: StudyNode) => void;
  onAdd: (parentId: string) => void;
  onStart: (n: StudyNode) => void;
  onToggleDone: (n: StudyNode) => void;
  onTemplate: (n: StudyNode) => void;
  /** Open the tag menu for `n`, beside `anchor`. */
  onTag: (n: StudyNode, anchor: HTMLElement) => void;
  /** The drag grip, for a course. */
  grip?: ReactNode;
  /** Drop handling and drag state for a course's whole item, subtree included. */
  itemProps?: HTMLAttributes<HTMLLIElement>;
}

/** Status words for the table's Status column: a dot and a word, no pill. */
const STATUS_WORD: Record<NodePace['status'], string> = {
  done: 'Estimate met',
  'on-track': 'On track',
  behind: 'Behind',
  critical: 'Critical',
  overdue: 'Overdue',
  'no-estimate': 'No estimate',
};

/**
 * One line of the task table, Notion-style: the toggle, tick and play at the left, the title,
 * then Tags, Due, Time and Status as columns, with the editing actions showing on hover.
 * Every row starts folded, so the page opens as a list of courses.
 */
function Row({
  node,
  depth,
  childrenOf,
  pace,
  tagsById,
  onEdit,
  onAdd,
  onStart,
  onToggleDone,
  onTemplate,
  onTag,
  grip,
  itemProps,
}: RowProps) {
  const [open, setOpen] = useState(false);
  const kids = childrenOf.get(node.id) ?? [];
  const p = pace[node.id];
  const done = !!node.completedAt;
  const tags = tagsOf(node.tagIds, tagsById);
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
      tagsById={tagsById}
      onEdit={onEdit}
      onAdd={onAdd}
      onStart={onStart}
      onToggleDone={onToggleDone}
      onTemplate={onTemplate}
      onTag={onTag}
    />
  );
  const tagLabel = tags.length
    ? `Tags on ${node.title}: ${tags.map((t) => t.name).join(', ')}. Change them`
    : `Add a tag to ${node.title}`;
  // Finished is finished: a done item says when, never that it is overdue.
  // Like a table cell, an empty due date is just empty.
  const due =
    done && node.completedAt
      ? `Done ${fmtDate(node.completedAt)}`
      : node.dueAt
        ? fmtDue(node.dueAt)
        : '';
  const time =
    p?.estimatedMinutes != null
      ? `${fmtMinutes(p.loggedWorkMinutes)} / ${fmtMinutes(p.estimatedMinutes)}`
      : // No estimate here or under it: hours logged is the only honest number. Gated on the
        // rounded value so a few seconds do not render "0 min studied".
        p != null && Math.round(p.loggedWorkMinutes) > 0
        ? `${fmtMinutes(p.loggedWorkMinutes)} studied`
        : '';
  const perDay =
    p?.requiredPerDay != null && !done ? `Need ${fmtPerDay(p.requiredPerDay)}/day` : null;
  const status = p && node.kind !== 'course' && !done ? p.status : null;

  return (
    <li
      {...itemProps}
      className={
        [depth === 0 ? 'tree-root' : '', itemProps?.className ?? ''].join(' ').trim() || undefined
      }
    >
      <div
        className={`tree-row${depth === 0 ? ' is-root' : ''}${done ? ' is-done' : ''}`}
        style={{ '--depth': depth } as CSSProperties}
      >
        <div className="tt-name">
          {grip}
          {kids.length > 0 ? (
            <button
              type="button"
              className="tt-toggle"
              aria-expanded={open}
              aria-label={open ? `Collapse ${node.title}` : `Expand ${node.title}`}
              onClick={() => setOpen(!open)}
            >
              <ChevronRight size={15} aria-hidden />
            </button>
          ) : (
            <span className="tt-toggle-spacer" aria-hidden />
          )}
          <button
            type="button"
            className="tree-tick"
            aria-pressed={done}
            aria-label={done ? `Mark ${node.title} as not done` : `Mark ${node.title} as done`}
            onClick={() => onToggleDone(node)}
          >
            <Check size={12} strokeWidth={3} aria-hidden />
          </button>
          {/*
            Starting something is the point of the page, so play sits beside the tick and stays
            visible rather than waiting for a hover the way the editing actions do. A course
            has one too: a session on it counts toward the whole course. Finished rows keep
            the space, so titles line up down the table, and a folded one shows how many
            items it holds there, in one left-aligned column.
          */}
          {!done ? (
            <button
              type="button"
              className="row-start"
              aria-label={`Start a session on ${node.title}`}
              title="Start a session"
              onClick={() => onStart(node)}
            >
              <Play size={13} aria-hidden />
            </button>
          ) : kids.length > 0 && !open ? (
            <span
              className="row-start-spacer tt-count-slot tabular"
              title={`${kids.length} inside`}
            >
              {kids.length}
            </span>
          ) : (
            <span className="row-start-spacer" aria-hidden />
          )}
          <span className="tt-title-wrap">
            <span className={`tree-title${depth === 0 ? ' is-root' : ''}${done ? ' is-done' : ''}`}>
              {node.color && (
                <span className="tree-color" style={{ background: node.color }} aria-hidden />
              )}
              {node.title}
            </span>
            {node.kind === 'assessment' && <span className="tt-kind">Assessment</span>}
            {node.childDefaults && (
              <span className="tt-kind" title="Items added under this start from its template">
                Template
              </span>
            )}
            {/* Rows with a play button keep their count after the title. */}
            {kids.length > 0 && !open && !done && (
              <span className="tt-count tabular">{kids.length}</span>
            )}
          </span>
          {/* Where the Tags column doesn't fit, the tags take a line under the title. */}
          {tags.length > 0 && (
            <button
              type="button"
              className="tt-tags-inline"
              aria-label={tagLabel}
              onClick={(e) => onTag(node, e.currentTarget)}
            >
              {tags.map((t) => (
                <TagChip key={t.id} tag={t} />
              ))}
            </button>
          )}
          {/* On a phone the columns fold into one quiet line under the title. */}
          <span className="tt-meta tabular">
            {[due, time, perDay, status && status !== 'on-track' ? STATUS_WORD[status] : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <div className="tt-cell tt-tags">
          <button
            type="button"
            className="tt-tags-button"
            aria-label={tagLabel}
            onClick={(e) => onTag(node, e.currentTarget)}
          >
            {tags.length ? (
              tags.map((t) => <TagChip key={t.id} tag={t} />)
            ) : (
              <TagIcon size={13} aria-hidden className="tt-tags-empty" />
            )}
          </button>
        </div>
        <div className="tt-cell tt-due tabular">{due}</div>
        <div className="tt-cell tt-time tabular" title={perDay ?? undefined}>
          {/* Every row keeps the bar's slot, so the times start at one edge down the column. */}
          {p?.progress != null ? (
            <span className="tt-bar" aria-hidden>
              <span style={{ width: `${Math.min(100, Math.round(p.progress * 100))}%` }} />
            </span>
          ) : (
            <span className="tt-bar is-empty" aria-hidden />
          )}
          <span>{time}</span>
        </div>
        <div className="tt-cell tt-status">
          {status && (
            <span className={`tt-status-word is-${status}`} title={perDay ?? undefined}>
              <span className="tt-dot" aria-hidden />
              {STATUS_WORD[status]}
            </span>
          )}
        </div>
        <div className="row-actions">
          {/* Only where the Tags column is folded away (narrow tables, phones). */}
          <button
            type="button"
            className="tt-action tt-tag-action"
            aria-label={tagLabel}
            title="Tags"
            onClick={(e) => onTag(node, e.currentTarget)}
          >
            <TagIcon size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="tt-action"
            aria-label={`Add under ${node.title}`}
            title="Add inside"
            onClick={() => onAdd(node.id)}
          >
            <Plus size={15} aria-hidden />
          </button>
          <button
            type="button"
            className="tt-action"
            aria-label={`Template for items under ${node.title}`}
            title="Template for items under this"
            onClick={() => onTemplate(node)}
          >
            <LayoutTemplate size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="tt-action"
            aria-label={`Edit ${node.title}`}
            title="Edit"
            onClick={() => onEdit(node)}
          >
            <Pencil size={14} aria-hidden />
          </button>
        </div>
      </div>
      {kids.length > 0 && (
        <Reveal open={open}>
          <ul>
            {activeKids.map(child)}
            {doneKids.length > 0 && (
              <DoneGroup depth={depth + 1} count={doneKids.length}>
                {doneKids.map(child)}
              </DoneGroup>
            )}
          </ul>
        </Reveal>
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
        style={{ '--depth': depth } as CSSProperties}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight size={14} aria-hidden className="tt-done-chevron" />
        Done · {count}
      </button>
      <Reveal open={open}>
        <ul>{children}</ul>
      </Reveal>
    </li>
  );
}

/** The task table (spec §8): course -> item -> subtask, folded until opened. */
export function Tasks() {
  const nodes = useNodes();
  const pace = usePace();
  const tags = useTags();
  const update = useUpdateNode();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<{
    node?: StudyNode | null;
    parentId?: string | null;
  } | null>(null);
  const [start, setStart] = useState<StudyNode | null>(null);
  const [template, setTemplate] = useState<StudyNode | null>(null);
  const [tagging, setTagging] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const closeTagging = useCallback(() => setTagging(null), []);
  const tagsById = useMemo(
    () => new Map((tags.data?.tags ?? []).map((t) => [t.id, t])),
    [tags.data],
  );
  const [paste, setPaste] = useState(false);
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
  const taggingNode = tagging ? list.find((n) => n.id === tagging.id) : undefined;

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
        <h1 className="page-title">Tasks</h1>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" onClick={() => setPaste(true)}>
            <ClipboardPaste size={16} aria-hidden /> Paste a list
          </Button>
          <Button variant="primary" onClick={() => setDialog({ parentId: null })}>
            <Plus size={16} aria-hidden /> New course
          </Button>
        </div>
      </div>

      <Panel className="task-table">
        {roots.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            body="Add a course, then its assignments, quizzes and readings. Estimates and due dates let Komodon plan your day."
            action={
              <div className="flex gap-2 flex-wrap justify-center">
                <Button variant="primary" onClick={() => setDialog({ parentId: null })}>
                  Add a course
                </Button>
                <Button variant="secondary" onClick={() => setPaste(true)}>
                  Paste a whole list
                </Button>
              </div>
            }
          />
        ) : (
          <>
            <div className="tt-head" aria-hidden>
              <span>Name</span>
              <span className="tt-tags">Tags</span>
              <span>Due</span>
              <span>Time</span>
              <span>Status</span>
              <span />
            </div>
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
                  tagsById={tagsById}
                  onEdit={(n) => setDialog({ node: n })}
                  onAdd={(parentId) => setDialog({ parentId })}
                  onStart={setStart}
                  onToggleDone={toggleDone}
                  onTemplate={setTemplate}
                  onTag={(n, anchor) =>
                    setTagging((t) => (t?.anchor === anchor ? null : { id: n.id, anchor }))
                  }
                />
              ))}
            </ul>
          </>
        )}
      </Panel>

      {roots.length > 0 && <TagManager nodes={list} />}

      {tagging && taggingNode && (
        <TagPicker
          anchor={tagging.anchor}
          nodeId={taggingNode.id}
          title={taggingNode.title}
          selected={taggingNode.tagIds ?? []}
          onClose={closeTagging}
        />
      )}

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
      <PasteListDialog open={paste} onClose={() => setPaste(false)} />
      <TemplateDialog
        open={template !== null}
        onClose={() => setTemplate(null)}
        // The row's node from the fresh list, so a saved template shows at once.
        node={template ? (list.find((n) => n.id === template.id) ?? template) : null}
      />
    </div>
  );
}
