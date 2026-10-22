import {
  diffDays,
  standsInForChildren,
  toLocalDate,
  type NodePace,
  type StudyNode,
} from '@komogon/core';
import { Link } from 'react-router';
import { Panel } from '@komogon/ui';
import { StatusChip } from './StatusChip';
import { fmtDue, fmtMinutes } from '../lib/format';

export interface UpcomingDueProps {
  nodes: StudyNode[];
  pace: Record<string, NodePace>;
  /** How far ahead to look. */
  days?: number;
  max?: number;
}

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * What is coming up, soonest first.
 *
 * Only things you would actually sit down and do: a parent that stands in for its children
 * is not a deadline you work on, it is a heading. Anything already overdue leads the list,
 * because a passed deadline is more urgent than tomorrow's.
 */
export function UpcomingDue({ nodes, pace, days = 14, max = 5 }: UpcomingDueProps) {
  const zone = tz();
  const today = toLocalDate(new Date(), zone);

  const items = nodes
    .filter((n) => {
      if (!n.dueAt || n.completedAt || n.archived || n.kind === 'course') return false;
      const p = pace[n.id];
      if (p && standsInForChildren(p)) return false;
      return diffDays(today, toLocalDate(n.dueAt, zone)) <= days;
    })
    .sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : 1))
    .slice(0, max);

  if (items.length === 0) return null;

  return (
    <Panel as="section" className="dash-card" aria-labelledby="upcoming-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="upcoming-h" className="card-title">
          Coming up
        </h2>
        <Link to="/tasks" className="section-link">
          All tasks
        </Link>
      </div>
      <ul className="due-list">
        {items.map((n) => {
          const p = pace[n.id];
          const overdue = diffDays(today, toLocalDate(n.dueAt!, zone)) < 0;
          return (
            <li key={n.id} className="due-row">
              <span className="due-when tabular" data-overdue={overdue || undefined}>
                {fmtDue(n.dueAt)}
              </span>
              <span className="due-title">{n.title}</span>
              {/* Always there, empty or not, so the times line up as a column. */}
              <span className="due-time muted text-xs tabular">
                {p?.status === 'done'
                  ? `Studied ${fmtMinutes(p.loggedWorkMinutes)}`
                  : p?.remainingMinutes != null
                    ? `${fmtMinutes(p.remainingMinutes)} left`
                    : null}
              </span>
              <span className="due-status">{p && <StatusChip status={p.status} />}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
