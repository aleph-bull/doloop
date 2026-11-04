import { Check, ChevronLeft, ChevronRight, CircleDot, Search, Timer, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Snapshot } from '../lib/storage';

type Node = Snapshot['nodes'][number];

/** "No task": a session with just the timer, as in the portal. */
export const NO_TASK = 'none';

/** The task tree, unfinished only, with each node's children in order. */
export function useTree(nodes: Node[]) {
  return useMemo(() => {
    const open = nodes.filter((n) => !n.completedAt);
    const byId = new Map(open.map((n) => [n.id, n] as const));
    const kids = new Map<string | null, Node[]>();
    for (const n of open) {
      const parent = n.parentId && byId.has(n.parentId) ? n.parentId : null;
      kids.set(parent, [...(kids.get(parent) ?? []), n]);
    }
    const pathOf = (id: string): string => {
      const names: string[] = [];
      let at = byId.get(id)?.parentId ?? null;
      while (at && byId.has(at)) {
        names.unshift(byId.get(at)!.title);
        at = byId.get(at)!.parentId;
      }
      return names.join(' › ');
    };
    return { byId, kids, pathOf };
  }, [nodes]);
}

export type Tree = ReturnType<typeof useTree>;

/**
 * What to study, the portal's picker (`SubjectPicker` there) on a page of the popup: search
 * above, then the tree a level at a time, "No task" first and "All of …" to study a course or
 * unit as a whole. Picking goes straight back.
 */
export function SubjectPicker({
  tree,
  value,
  onPick,
  onBack,
}: {
  tree: Tree;
  value: string;
  onPick: (id: string) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState('');
  const [path, setPath] = useState<string[]>(() => {
    // Opens where the chosen one is.
    const out: string[] = [];
    let at = value !== NO_TASK ? (tree.byId.get(value)?.parentId ?? null) : null;
    while (at && tree.byId.has(at)) {
      out.unshift(at);
      at = tree.byId.get(at)!.parentId;
    }
    return out;
  });
  const here = path.length > 0 ? tree.byId.get(path[path.length - 1]!) : null;
  const rows = tree.kids.get(here?.id ?? null) ?? [];
  const q = query.trim().toLowerCase();
  const matches = q
    ? [...tree.byId.values()].filter((n) => n.title.toLowerCase().includes(q)).slice(0, 50)
    : [];

  const row = (n: Node) => {
    const on = value === n.id;
    const inside = tree.kids.get(n.id)?.length ?? 0;
    if (inside > 0)
      return (
        <li key={n.id} className={`picker-folder${on ? ' is-chosen' : ''}`}>
          <button
            type="button"
            className="picker-row picker-open"
            onClick={() => setPath([...path, n.id])}
          >
            <span className="picker-row-text">
              <span className="picker-row-title">{n.title}</span>
            </span>
            <span className="picker-count">
              {inside} {inside === 1 ? 'item' : 'items'}
            </span>
            <ChevronRight size={16} aria-hidden className="picker-chevron" />
          </button>
        </li>
      );
    return (
      <li key={n.id}>
        <button
          type="button"
          className={`picker-row${on ? ' is-chosen' : ''}`}
          onClick={() => onPick(n.id)}
        >
          <span className="picker-row-text">
            <span className="picker-row-title">{n.title}</span>
          </span>
          {on && <Check size={16} aria-hidden className="picker-check" />}
        </button>
      </li>
    );
  };

  return (
    <div className="picker-page">
      <div className="picker-title-row">
        <button type="button" className="picker-back" aria-label="Back" onClick={onBack}>
          <ChevronLeft size={20} aria-hidden />
        </button>
        <h2 className="card-title">What to study</h2>
      </div>
      <div className="picker" role="group" aria-label="What to study">
        <label className="picker-search">
          <Search size={15} aria-hidden className="picker-search-icon" />
          <input
            type="search"
            className="picker-search-input"
            placeholder="Search tasks and courses"
            aria-label="Search tasks and courses"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="picker-search-clear"
              aria-label="Clear"
              onClick={() => setQuery('')}
            >
              <X size={12} aria-hidden />
            </button>
          )}
        </label>
        {q ? (
          <ul className="picker-list" aria-label="Search results">
            {matches.map((n) => {
              const on = value === n.id;
              const where = tree.pathOf(n.id);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`picker-row${on ? ' is-chosen' : ''}`}
                    onClick={() => onPick(n.id)}
                  >
                    <span className="picker-row-text">
                      <span className="picker-row-title">{n.title}</span>
                      {where && <span className="picker-row-sub">{where}</span>}
                    </span>
                    {on && <Check size={16} aria-hidden className="picker-check" />}
                  </button>
                </li>
              );
            })}
            {matches.length === 0 && (
              <li className="picker-empty">Nothing matches &ldquo;{query.trim()}&rdquo;.</li>
            )}
          </ul>
        ) : (
          <>
            {here && (
              <div className="picker-bar">
                <button
                  type="button"
                  className="picker-nav"
                  onClick={() => setPath(path.slice(0, -1))}
                >
                  <ChevronLeft size={14} aria-hidden /> Back
                </button>
                <span className="picker-heading truncate">{here.title}</span>
                <button type="button" className="picker-nav" onClick={() => setPath([])}>
                  All courses
                </button>
              </div>
            )}
            <ul className="picker-list">
              {!here && (
                <li>
                  <button
                    type="button"
                    className={`picker-row${value === NO_TASK ? ' is-chosen' : ''}`}
                    onClick={() => onPick(NO_TASK)}
                  >
                    <Timer size={16} aria-hidden className="picker-row-icon" />
                    <span className="picker-row-text">
                      <span className="picker-row-title">No task</span>
                    </span>
                    {value === NO_TASK && <Check size={16} aria-hidden className="picker-check" />}
                  </button>
                </li>
              )}
              {here && (
                <li>
                  <button
                    type="button"
                    className={`picker-row${value === here.id ? ' is-chosen' : ''}`}
                    onClick={() => onPick(here.id)}
                  >
                    <CircleDot size={16} aria-hidden className="picker-row-icon" />
                    <span className="picker-row-text">
                      <span className="picker-row-title">All of {here.title}</span>
                    </span>
                    {value === here.id && <Check size={16} aria-hidden className="picker-check" />}
                  </button>
                </li>
              )}
              {rows.map(row)}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
