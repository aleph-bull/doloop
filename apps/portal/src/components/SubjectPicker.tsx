import { buildIndex, type RoutineOccurrence, type StudyNode } from '@komogon/core';
import { ArrowLeft, Check, ChevronRight, CircleDot, Timer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fmtDate } from '../lib/format';

/** The picker's value: a task, one occurrence of a routine, or nothing at all. */
export const NONE = 'none';
export const nodeKey = (id: string) => `node:${id}`;
export const routineKey = (o: Pick<RoutineOccurrence, 'routineId' | 'date'>) =>
  `routine:${o.routineId}:${o.date}`;

/** The pseudo-folder the routines live in, at the top level. */
const ROUTINES = 'routines';

export interface SubjectPickerProps {
  nodes: StudyNode[];
  routines: RoutineOccurrence[];
  /** Today's date, so an older occurrence can say which day it is from. */
  today?: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * What to study, laid out like the task tree but one page at a time. It always opens on
 * the courses. A row with things inside opens on click and turns the page to them; a row
 * without is chosen on click. A course or unit can still be studied as a whole through the
 * small mark at its right. Back goes up one level, "See all courses" back to the top.
 * "Just the timer" is the first row at the top, and the routines the last.
 */
export function SubjectPicker({ nodes, routines, today, value, onChange }: SubjectPickerProps) {
  const index = useMemo(() => buildIndex(nodes.filter((n) => !n.completedAt)), [nodes]);
  const [path, setPath] = useState<string[]>([]);

  const here = path[path.length - 1];
  const inRoutines = here === ROUTINES;
  const items = here && !inRoutines ? (index.childrenOf.get(here) ?? []) : index.roots;
  const titleOf = (id: string) =>
    id === ROUTINES ? 'Routines' : (index.byId.get(id)?.title ?? '');
  const heading = here ? titleOf(here) : 'All courses';
  const above = path.slice(0, -1).map(titleOf);

  /** The chosen thing and where it lives, for the summary line. */
  const chosen = (() => {
    if (value === NONE)
      return { title: 'Just the timer', where: 'No task; the minutes still count.' };
    if (value.startsWith('routine:')) {
      const o = routines.find((r) => routineKey(r) === value);
      return o ? { title: o.title, where: 'Routine' } : null;
    }
    if (value.startsWith('node:')) {
      const n = index.byId.get(value.slice(5));
      if (!n) return null;
      const chain: string[] = [];
      let cur = n;
      while (cur.parentId && index.byId.has(cur.parentId)) {
        cur = index.byId.get(cur.parentId)!;
        chain.unshift(cur.title);
      }
      return { title: n.title, where: chain.length ? chain.join(' › ') : 'Course' };
    }
    return null;
  })();

  return (
    <div className="picker" role="group" aria-label="What to study">
      <div className={`picker-chosen${chosen ? '' : ' is-empty'}`} aria-live="polite">
        <span className="picker-chosen-dot" aria-hidden />
        <span className="picker-chosen-title truncate">
          {chosen?.title ?? 'Nothing chosen yet'}
        </span>
        {chosen?.where && <span className="picker-chosen-where truncate">{chosen.where}</span>}
      </div>

      <div className="picker-bar">
        {path.length > 0 ? (
          <button type="button" className="picker-nav" onClick={() => setPath(path.slice(0, -1))}>
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
                <span className="picker-row-title">Just the timer</span>
                <span className="picker-row-sub">No task. The minutes still count.</span>
              </span>
              {value === NONE && <Check size={16} aria-hidden className="picker-check" />}
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
                        <span className="picker-row-sub">from {fmtDate(`${o.date}T12:00:00`)}</span>
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
                    onClick={() => setPath([...path, n.id])}
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
                    aria-label={on ? `${n.title} chosen as a whole` : `Study ${n.title} as a whole`}
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
    </div>
  );
}
