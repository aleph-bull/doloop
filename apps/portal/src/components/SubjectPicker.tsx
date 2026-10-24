import { buildIndex, type RoutineOccurrence, type StudyNode } from '@komogon/core';
import { ArrowLeft, Check, ChevronRight, CircleDot, Search, Timer, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fmtDate } from '../lib/format';

/** The picker's value: a task, one occurrence of a routine, or nothing at all. */
export const NONE = 'none';
export const nodeKey = (id: string) => `node:${id}`;
export const routineKey = (o: Pick<RoutineOccurrence, 'routineId' | 'date'>) =>
  `routine:${o.routineId}:${o.date}`;

/** The pseudo-folder the routines live in, at the top level. */
export const ROUTINES = 'routines';

export type SubjectIndex = ReturnType<typeof buildIndex>;

/** What can be studied: every course, unit and task not yet done. */
export function useSubjectIndex(nodes: StudyNode[]): SubjectIndex {
  return useMemo(() => buildIndex(nodes.filter((n) => !n.completedAt)), [nodes]);
}

/** The names above a node, course first. */
function chainOf(index: SubjectIndex, n: StudyNode): string[] {
  const chain: string[] = [];
  let cur = n;
  while (cur.parentId && index.byId.has(cur.parentId)) {
    cur = index.byId.get(cur.parentId)!;
    chain.unshift(cur.title);
  }
  return chain;
}

export interface SubjectHit {
  key: string;
  title: string;
  where: string;
}

/**
 * Every task, unit and course whose name or path holds all the words typed, plus the
 * routines due, as one flat list. Each says where it lives, since two units can share a
 * name. Null when nothing is typed.
 */
export function searchSubjects(
  query: string,
  index: SubjectIndex,
  routines: RoutineOccurrence[],
): SubjectHit[] | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const hits: SubjectHit[] = [];
  for (const n of index.byId.values()) {
    const where = chainOf(index, n);
    const hay = [...where, n.title].join(' ').toLowerCase();
    if (words.every((w) => hay.includes(w)))
      hits.push({ key: nodeKey(n.id), title: n.title, where: where.join(' › ') || 'Course' });
  }
  for (const o of routines) {
    if (words.every((w) => `${o.title} routine`.toLowerCase().includes(w)))
      hits.push({ key: routineKey(o), title: o.title, where: 'Routine' });
  }
  // Names that start with what was typed first, then the rest alphabetically.
  const first = words[0]!;
  hits.sort((a, b) => {
    const as = a.title.toLowerCase().startsWith(first) ? 0 : 1;
    const bs = b.title.toLowerCase().startsWith(first) ? 0 : 1;
    return as - bs || a.title.localeCompare(b.title);
  });
  return hits.slice(0, 50);
}

/** The chosen thing and where it lives, for a summary line; null when nothing is chosen. */
export function describeSubject(
  value: string,
  index: SubjectIndex,
  routines: RoutineOccurrence[],
): { title: string; where: string } | null {
  if (value === NONE) return { title: 'No task', where: 'Minutes still count' };
  if (value.startsWith('routine:')) {
    const o = routines.find((r) => routineKey(r) === value);
    return o ? { title: o.title, where: 'Routine' } : null;
  }
  if (value.startsWith('node:')) {
    const n = index.byId.get(value.slice(5));
    if (!n) return null;
    const chain = chainOf(index, n);
    return { title: n.title, where: chain.length ? chain.join(' › ') : 'Course' };
  }
  return null;
}

export interface SubjectPickerProps {
  nodes: StudyNode[];
  routines: RoutineOccurrence[];
  /** Today's date, so an older occurrence can say which day it is from. */
  today?: string;
  value: string;
  /** `opened` when a course or unit was chosen by opening it: the picker shows its insides. */
  onChange: (value: string, opened?: boolean) => void;
}

/**
 * What to study, laid out like the task tree but one page at a time. It always opens on
 * the courses. A row with things inside is chosen on click and turns the page to them, so
 * something inside can still be picked instead; its first row there is "All of" it, unless
 * everything inside is a task with nothing under it (the last level down). A row
 * without is chosen on click, and so is a course or unit through the small mark at its
 * right. Back goes up one level, "See all courses" back to the top.
 * "No task" is the first row at the top, and the routines the last. On a computer it is
 * the Start a session card's second page, turned to from `SubjectButton`.
 */
export function SubjectPicker({ nodes, routines, today, value, onChange }: SubjectPickerProps) {
  const index = useSubjectIndex(nodes);
  const [path, setPath] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  const results = useMemo(() => searchSubjects(query, index, routines), [query, index, routines]);

  const here = path[path.length - 1];
  const inRoutines = here === ROUTINES;
  const items = here && !inRoutines ? (index.childrenOf.get(here) ?? []) : index.roots;
  /** The last level down: nothing here has anything under it. */
  const lastLevel = items.every((n) => !index.childrenOf.get(n.id)?.length);
  const titleOf = (id: string) =>
    id === ROUTINES ? 'Routines' : (index.byId.get(id)?.title ?? '');
  const heading = here ? titleOf(here) : 'All courses';
  const above = path.slice(0, -1).map(titleOf);

  return (
    <div className="picker" role="group" aria-label="What to study">
      <label className="picker-search">
        <Search size={15} aria-hidden className="picker-search-icon" />
        <input
          type="search"
          className="picker-search-input"
          placeholder="Search tasks, courses and routines"
          aria-label="Search for something to study"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              // Clear the search rather than closing the dialog.
              e.preventDefault();
              e.stopPropagation();
              setQuery('');
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="picker-search-clear"
            aria-label="Clear the search"
            onClick={() => setQuery('')}
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </label>

      {results ? (
        <ul className="picker-list" aria-label="Search results">
          {results.map((r) => {
            const on = value === r.key;
            return (
              <li key={r.key}>
                <button
                  type="button"
                  className={`picker-row${on ? ' is-chosen' : ''}`}
                  aria-pressed={on}
                  onClick={() => onChange(r.key)}
                >
                  <span className="picker-row-text">
                    <span className="picker-row-title">{r.title}</span>
                    <span className="picker-row-sub">{r.where}</span>
                  </span>
                  {on && <Check size={16} aria-hidden className="picker-check" />}
                </button>
              </li>
            );
          })}
          {results.length === 0 && (
            <li className="picker-empty">Nothing matches &ldquo;{query.trim()}&rdquo;.</li>
          )}
        </ul>
      ) : (
        <>
          <div className="picker-bar">
            {path.length > 0 ? (
              <button
                type="button"
                className="picker-nav"
                onClick={() => setPath(path.slice(0, -1))}
              >
                <ArrowLeft size={14} aria-hidden /> Back
              </button>
            ) : (
              <span />
            )}
            <span className="picker-heading truncate">
              {above.length > 0 && <span className="picker-above">{above.join(' › ')} › </span>}
              {heading}
            </span>
            {path.length > 0 ? (
              <button type="button" className="picker-nav" onClick={() => setPath([])}>
                See all courses
              </button>
            ) : (
              <span />
            )}
          </div>

          <ul className="picker-list">
            {path.length === 0 && (
              <li>
                <button
                  type="button"
                  className={`picker-row${value === NONE ? ' is-chosen' : ''}`}
                  aria-pressed={value === NONE}
                  onClick={() => onChange(NONE)}
                >
                  <Timer size={16} aria-hidden className="picker-row-icon" />
                  <span className="picker-row-text">
                    <span className="picker-row-title">No task</span>
                  </span>
                  {value === NONE && <Check size={16} aria-hidden className="picker-check" />}
                </button>
              </li>
            )}

            {/* Inside a course or unit, the first row is all of it, except on the last level. */}
            {here && !inRoutines && !lastLevel && (
              <li>
                <button
                  type="button"
                  className={`picker-row${value === nodeKey(here) ? ' is-chosen' : ''}`}
                  aria-pressed={value === nodeKey(here)}
                  onClick={() => onChange(nodeKey(here))}
                >
                  <CircleDot size={16} aria-hidden className="picker-row-icon" />
                  <span className="picker-row-text">
                    <span className="picker-row-title">All of {titleOf(here)}</span>
                  </span>
                  {value === nodeKey(here) && (
                    <Check size={16} aria-hidden className="picker-check" />
                  )}
                </button>
              </li>
            )}

            {inRoutines
              ? routines.map((o) => {
                  const key = routineKey(o);
                  const on = value === key;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className={`picker-row${on ? ' is-chosen' : ''}`}
                        aria-pressed={on}
                        onClick={() => onChange(key)}
                      >
                        <span className="picker-row-text">
                          <span className="picker-row-title">{o.title}</span>
                          {today && o.date !== today && (
                            <span className="picker-row-sub">
                              from {fmtDate(`${o.date}T12:00:00`)}
                            </span>
                          )}
                        </span>
                        {on && <Check size={16} aria-hidden className="picker-check" />}
                      </button>
                    </li>
                  );
                })
              : items.map((n) => {
                  const key = nodeKey(n.id);
                  const on = value === key;
                  const kids = index.childrenOf.get(n.id)?.length ?? 0;
                  if (kids === 0) {
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          className={`picker-row${on ? ' is-chosen' : ''}`}
                          aria-pressed={on}
                          onClick={() => onChange(key)}
                        >
                          <span className="picker-row-text">
                            <span className="picker-row-title">{n.title}</span>
                          </span>
                          {on && <Check size={16} aria-hidden className="picker-check" />}
                        </button>
                      </li>
                    );
                  }
                  return (
                    <li key={n.id} className={`picker-folder${on ? ' is-chosen' : ''}`}>
                      <button
                        type="button"
                        className="picker-row picker-open"
                        onClick={() => {
                          setPath([...path, n.id]);
                          onChange(key, true);
                        }}
                        aria-label={`Open ${n.title}, ${kids} inside`}
                      >
                        <span className="picker-row-text">
                          <span className="picker-row-title">{n.title}</span>
                        </span>
                        <span className="picker-count">
                          {kids} {kids === 1 ? 'item' : 'items'}
                        </span>
                        <ChevronRight size={16} aria-hidden className="picker-chevron" />
                      </button>
                      <button
                        type="button"
                        className="picker-whole"
                        aria-pressed={on}
                        aria-label={
                          on ? `${n.title} chosen as a whole` : `Study ${n.title} as a whole`
                        }
                        title={on ? 'Chosen as a whole' : 'Study this as a whole'}
                        onClick={() => onChange(key)}
                      >
                        {on ? <Check size={16} aria-hidden /> : <CircleDot size={16} aria-hidden />}
                      </button>
                    </li>
                  );
                })}

            {path.length === 0 && routines.length > 0 && (
              <li>
                <button
                  type="button"
                  className="picker-row picker-open"
                  onClick={() => setPath([ROUTINES])}
                  aria-label={`Open routines, ${routines.length} due`}
                >
                  <span className="picker-row-text">
                    <span className="picker-row-title">Routines</span>
                  </span>
                  <span className="picker-count">{routines.length} due</span>
                  <ChevronRight size={16} aria-hidden className="picker-chevron" />
                </button>
              </li>
            )}

            {items.length === 0 && !inRoutines && path.length > 0 && (
              <li className="picker-empty">Nothing under here yet.</li>
            )}
            {inRoutines && routines.length === 0 && <li className="picker-empty">Nothing due.</li>}
          </ul>
        </>
      )}
    </div>
  );
}

export interface SubjectButtonProps {
  nodes: StudyNode[];
  routines: RoutineOccurrence[];
  value: string;
  /** Turns the card over to the picker. */
  onOpen: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * What to study, on a computer: a big button showing what is chosen. It turns the card to
 * the picker, a page of its own, and choosing something (or "I'm all set") turns it back.
 */
export function SubjectButton({ nodes, routines, value, onOpen, ref }: SubjectButtonProps) {
  const index = useSubjectIndex(nodes);
  const chosen = describeSubject(value, index, routines);
  // "No task" stands alone here; the phone's row still says more under it.
  const where = value === NONE ? '' : chosen?.where;

  return (
    <button
      ref={ref}
      type="button"
      className={`start-subject${chosen ? '' : ' is-empty'}`}
      onClick={onOpen}
    >
      <span className="start-subject-text">
        <span className="start-subject-title truncate">
          {chosen?.title ?? 'Choose what to study'}
        </span>
        {where && <span className="start-subject-where truncate">{where}</span>}
      </span>
      <ChevronRight size={18} aria-hidden className="start-subject-chevron" />
    </button>
  );
}
