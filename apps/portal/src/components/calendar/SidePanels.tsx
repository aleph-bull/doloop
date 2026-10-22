import { addDays, diffDays, startOfWeekMonday } from '@komogon/core';
import { Check, Flag } from 'lucide-react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router';
import { Panel } from '@komogon/ui';
import type { Deadline, TrayItem } from '../../lib/calendar';
import { periodLabel } from '../../lib/calendar';
import { fmtMinutes } from '../../lib/format';

function dueWord(day: string | null, today: string): string | null {
  if (!day) return null;
  const days = diffDays(today, day);
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  const date = new Date(`${day}T12:00:00`);
  if (days > 1 && days < 7)
    return `Due ${new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date)}`;
  return `Due ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)}`;
}

export interface PlanTrayProps {
  items: TrayItem[];
  today: string;
  /** False when the week is already over: nothing can be planned into it. */
  open: boolean;
  /** No calendar connected yet, so the page can say what connecting would add. */
  showConnect: boolean;
  /** Pointer down on an item: the page takes over and drags it onto the grid. */
  onGrab: (item: TrayItem, e: ReactPointerEvent<HTMLButtonElement>) => void;
  onPick: (item: TrayItem) => void;
}

/** What still wants time this week, to drag onto the grid or click to find a time for. */
export function PlanTray({ items, today, open, showConnect, onGrab, onPick }: PlanTrayProps) {
  const tasks = items.filter((i) => i.kind === 'task');
  const plans = items.filter((i) => i.kind === 'plan');
  const row = (it: TrayItem) => {
    const covered = it.need === 0;
    const meta = [it.sub, it.kind === 'task' ? dueWord(it.dueDay, today) : null]
      .filter(Boolean)
      .join(' · ');
    const share = it.planned + it.need > 0 ? it.planned / (it.planned + it.need) : 1;
    return (
      <li key={it.key}>
        <button
          type="button"
          className={`cal-tray-item${covered ? ' is-covered' : ''}`}
          style={it.color ? ({ '--ev': it.color } as CSSProperties) : undefined}
          onPointerDown={(e) => onGrab(it, e)}
          onClick={() => onPick(it)}
          aria-label={`${it.title}: ${covered ? 'time set aside' : `${fmtMinutes(it.need)} to plan`}. Click to find a time.`}
        >
          <span className="cal-tray-main">
            <span className="cal-tray-title">{it.title}</span>
            {meta && <span className="cal-tray-meta">{meta}</span>}
          </span>
          <span className="cal-tray-fig tabular">
            {covered ? (
              <>
                <Check size={13} aria-hidden /> Set aside
              </>
            ) : (
              fmtMinutes(it.need)
            )}
          </span>
          <span className="cal-tray-bar" aria-hidden>
            <span style={{ width: `${Math.round(share * 100)}%` }} />
          </span>
        </button>
      </li>
    );
  };
  return (
    <Panel as="aside" className="cal-side" aria-label="To plan">
      <div className="cal-side-head">
        <h2 className="card-title">To plan</h2>
      </div>
      {!open ? (
        <p className="cal-side-empty">This week is over. Its blocks stay here as a record.</p>
      ) : items.length === 0 ? (
        <p className="cal-side-empty">Nothing needs more time this week.</p>
      ) : (
        <>
          {tasks.length > 0 && <ul className="cal-tray">{tasks.map(row)}</ul>}
          {plans.length > 0 && (
            <>
              <h3 className="cal-side-sub">Study plans</h3>
              <ul className="cal-tray">{plans.map(row)}</ul>
            </>
          )}
          <p className="cal-side-tip">Drag one onto the week, or click it to find a time.</p>
        </>
      )}
      {showConnect && (
        <Link to="/settings#calendar" className="cal-side-link">
          Connect Google or Outlook to plan around your classes
        </Link>
      )}
    </Panel>
  );
}

export interface DueListProps {
  deadlines: Deadline[];
  today: string;
  onOpen: (d: Deadline) => void;
}

/** Everything due in the month, a week at a time, so a crunch shows up before it arrives. */
export function DueList({ deadlines, today, onOpen }: DueListProps) {
  const thisWeek = startOfWeekMonday(today);
  const groups = new Map<string, Deadline[]>();
  for (const d of deadlines) {
    const w = startOfWeekMonday(d.day);
    if (!groups.has(w)) groups.set(w, []);
    groups.get(w)!.push(d);
  }
  const weekName = (w: string) =>
    w === thisWeek
      ? 'This week'
      : w === addDays(thisWeek, 7)
        ? 'Next week'
        : w === addDays(thisWeek, -7)
          ? 'Last week'
          : periodLabel('week', w, addDays(w, 6));
  return (
    <Panel as="aside" className="cal-side" aria-label="Due this month">
      <div className="cal-side-head">
        <h2 className="card-title">Due this month</h2>
      </div>
      {deadlines.length === 0 ? (
        <p className="cal-side-empty">Nothing has a due date this month.</p>
      ) : (
        [...groups.entries()].map(([w, list]) => (
          <section key={w} className="cal-due-group">
            <h3 className="cal-side-sub">{weekName(w)}</h3>
            <ul className="cal-due-list">
              {list.map((d) => (
                <li key={d.node.id}>
                  <button
                    type="button"
                    className={`cal-due-row${d.done ? ' is-done' : ''}`}
                    style={d.color ? ({ '--ev': d.color } as CSSProperties) : undefined}
                    onClick={() => onOpen(d)}
                  >
                    {d.assessment ? (
                      <Flag size={12} aria-hidden className="cal-due-icon" />
                    ) : (
                      <span className="cal-due-dot" aria-hidden />
                    )}
                    <span className="cal-due-row-main">
                      <span className="cal-due-row-title">{d.node.title}</span>
                      {d.course && <span className="cal-due-row-meta">{d.course}</span>}
                    </span>
                    <span className="cal-due-row-date tabular">
                      {d.day === today
                        ? 'Today'
                        : new Intl.DateTimeFormat(undefined, {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          }).format(new Date(`${d.day}T12:00:00`))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </Panel>
  );
}
