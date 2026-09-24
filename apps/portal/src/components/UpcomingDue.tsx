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
    <Panel as="section" className="p-5 flex flex-col gap-3" aria-labelledby="upcoming-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="upcoming-h" className="text-lg">
          Coming up
        </h2>
        <Link to="/tasks" className="text-sm">
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
              <span className="flex-1 min-w-0 truncate">{n.title}</span>
              {p?.remainingMinutes != null && p.status !== 'done' && (
                <span className="muted text-xs tabular">{fmtMinutes(p.remainingMinutes)} left</span>
              )}
              {p && <StatusChip status={p.status} />}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
