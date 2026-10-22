import type { RoutineOccurrence, StudyNode } from '@komogon/core';
import { Check, ChevronLeft, ChevronRight, CircleDot, Search, Timer, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDate } from '../lib/format';
import {
  NONE,
  ROUTINES,
  nodeKey,
  routineKey,
  searchSubjects,
  type SubjectIndex,
} from './SubjectPicker';

export interface SubjectPagesProps {
  index: SubjectIndex;
  routines: RoutineOccurrence[];
  /** Today's date, so an older occurrence can say which day it is from. */
  today?: string;
  value: string;
  /** Something was chosen: the screen goes back to the session with it. */
  onPick: (value: string) => void;
  /** Back from the top level, choosing nothing. */
  onBack: () => void;
  /** On screen now: focus goes to its back button as it slides in. */
  active: boolean;
}

/**
 * What to study, on a phone: a list like the Settings app's, one level at a time. A course
 * or unit opens on tap and its first row studies the whole of it; a task is chosen on tap,
 * which goes straight back to the session. Search sits at the top level and only takes the
 * keyboard when it is tapped.
 */
export function SubjectPages({
  index,
  routines,
  today,
  value,
  onPick,
  onBack,
  active,
}: SubjectPagesProps) {
  const [path, setPath] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  // Which way the last move went, so the next level slides in from the side it lives on.
  const [dir, setDir] = useState<'in' | 'out'>('in');
  const searchRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) backRef.current?.focus({ preventScroll: true });
  }, [active]);

  const results = useMemo(
    () => (path.length === 0 ? searchSubjects(query, index, routines) : null),
    [path.length, query, index, routines],
  );

  const here = path[path.length - 1];
  const inRoutines = here === ROUTINES;
  const titleOf = (id: string) =>
    id === ROUTINES ? 'Routines' : (index.byId.get(id)?.title ?? '');
  const heading = here ? titleOf(here) : 'What to study';
  // Back names the page it goes to, as on iOS; from the top it goes back to the session.
  const backLabel =
    path.length > 1 ? titleOf(path[path.length - 2]!) : path.length ? 'What to study' : 'Back';
  const items: StudyNode[] = here && !inRoutines ? (index.childrenOf.get(here) ?? []) : index.roots;

  const open = (id: string) => {
    setDir('in');
    setPath([...path, id]);
  };
  const up = () => {
    if (path.length === 0) return onBack();
    setDir('out');
    setPath(path.slice(0, -1));
  };

  const row = (key: string, title: string, sub?: string, icon?: React.ReactNode) => {
    const on = value === key;
    return (
      <li key={key}>
        <button
          type="button"
          className={`ss-row${on ? ' is-chosen' : ''}`}
          aria-pressed={on}
          onClick={() => onPick(key)}
        >
          {icon && (
            <span className="ss-row-icon" aria-hidden>
              {icon}
            </span>
          )}
          <span className="ss-row-text">
            <span className="ss-row-title">{title}</span>
            {sub && <span className="ss-row-sub">{sub}</span>}
          </span>
          {on && <Check size={18} aria-hidden className="ss-row-check" />}
        </button>
      </li>
    );
  };

  const folder = (id: string, title: string, count: string, label: string) => (
    <li key={id}>
      <button type="button" className="ss-row" onClick={() => open(id)} aria-label={label}>
        <span className="ss-row-text">
          <span className="ss-row-title">{title}</span>
        </span>
        <span className="ss-row-count">{count}</span>
        <ChevronRight size={18} aria-hidden className="ss-row-chevron" />
      </button>
    </li>
  );

  return (
    <div className="ss-page" role="group" aria-label="What to study">
      <div className="ss-page-head">
        <button ref={backRef} type="button" className="ss-back" onClick={up}>
          <ChevronLeft size={22} aria-hidden />
          <span className="truncate">{backLabel}</span>
        </button>
        <h3 className="ss-page-title truncate">{heading}</h3>
        <span aria-hidden />
      </div>

      <div className="ss-page-scroll">
        {path.length === 0 && (
          <label className="ss-search">
            <Search size={17} aria-hidden className="ss-search-icon" />
            <input
              ref={searchRef}
              type="search"
              enterKeyHint="search"
              className="ss-search-input"
              placeholder="Search"
              aria-label="Search tasks, courses and routines"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  // Clear the search rather than closing the screen.
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery('');
                }
              }}
            />
            {query && (
              <button
                type="button"
                className="ss-search-clear"
                aria-label="Clear the search"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
              >
                <X size={14} aria-hidden />
              </button>
            )}
          </label>
        )}

        <div
          key={results ? 'results' : path.join('/') || 'top'}
          className="ss-level"
          data-dir={dir}
        >
          {results ? (
            <ul className="ss-list" aria-label="Search results">
              {results.map((r) => row(r.key, r.title, r.where))}
              {results.length === 0 && (
                <li className="ss-empty">Nothing matches &ldquo;{query.trim()}&rdquo;.</li>
              )}
            </ul>
          ) : (
            <ul className="ss-list">
              {path.length === 0 &&
                row(NONE, 'No task', 'Minutes still count', <Timer size={18} />)}

              {/* Inside a course or unit, the first row studies all of it. */}
              {here &&
                !inRoutines &&
                row(nodeKey(here), `All of ${titleOf(here)}`, undefined, <CircleDot size={18} />)}

              {inRoutines
                ? routines.map((o) =>
                    row(
                      routineKey(o),
                      o.title,
                      today && o.date !== today
                        ? `from ${fmtDate(`${o.date}T12:00:00`)}`
                        : undefined,
                    ),
                  )
                : items.map((n) => {
                    const kids = index.childrenOf.get(n.id)?.length ?? 0;
                    if (kids === 0) return row(nodeKey(n.id), n.title);
                    return folder(
                      n.id,
                      n.title,
                      `${kids} ${kids === 1 ? 'item' : 'items'}`,
                      `Open ${n.title}, ${kids} inside`,
                    );
                  })}

              {path.length === 0 &&
                routines.length > 0 &&
                folder(
                  ROUTINES,
                  'Routines',
                  `${routines.length} due`,
                  `Open routines, ${routines.length} due`,
                )}

              {path.length === 0 && items.length === 0 && routines.length === 0 && (
                <li className="ss-empty">No courses yet. &ldquo;No task&rdquo; still counts.</li>
              )}
              {items.length === 0 && !inRoutines && path.length > 0 && (
                <li className="ss-empty">Nothing under here yet.</li>
              )}
              {inRoutines && routines.length === 0 && <li className="ss-empty">Nothing due.</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
