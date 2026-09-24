import { pathLabel, type PlanItem, type StudyNode } from '@komogon/core';
import { Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Glass } from '@komogon/ui';
import { fmtDue, fmtMinutes } from '../lib/format';
import { StatusChip } from './StatusChip';

export interface PlanCardProps {
  plan: PlanItem[];
  nodesById: Map<string, StudyNode>;
  onStart: (node: StudyNode, suggestedMinutes: number) => void;
  /** "About 33 m across 1 item today", as a line above the suggestion. */
  todayLine?: string | null;
  /** Rendered at the bottom of the panel, under a rule. */
  footer?: ReactNode;
}

/** "Suggested next session" driven by getDailyPlan (spec §3). */
export function PlanCard({ plan, nodesById, onStart, todayLine, footer }: PlanCardProps) {
  const top = plan[0];
  if (!top) {
    return (
      <Glass className="p-5" as="section" aria-label="Suggested next session">
        <h2 className="text-lg">Nothing urgent</h2>
        <p className="muted text-sm mt-1">
          Add an estimate and a due date to a task and Komogon will tell you what to do today.
        </p>
        {footer}
      </Glass>
    );
  }
  const node = nodesById.get(top.nodeId);
  const rest = plan.slice(1, 4);
  const topPath = pathLabel(nodesById, top.nodeId);
  return (
    <Glass className="p-5 flex flex-col gap-4" as="section" aria-label="Suggested next session">
      <div>
        {todayLine && <div className="subtle text-sm">{todayLine}</div>}
        {topPath && (
          <div className="muted text-sm mt-1 truncate" aria-label="In">
            {topPath}
          </div>
        )}
        <div className="flex items-start gap-2 mt-1">
          <h2 className="text-xl flex-1">{top.title}</h2>
          <StatusChip status={top.status} />
        </div>
        <p className="muted text-sm mt-1">
          {fmtMinutes(top.suggestedMinutes)} suggested · {fmtMinutes(top.remainingMinutes)} left ·{' '}
          {fmtDue(node?.dueAt ?? null)}
        </p>
      </div>
      <div>
        <Button
          variant="primary"
          size="lg"
          onClick={() => node && onStart(node, top.suggestedMinutes)}
        >
          <Play size={16} aria-hidden /> Start {fmtMinutes(top.suggestedMinutes)}
        </Button>
      </div>
      {rest.length > 0 && (
        <ul className="text-sm muted flex flex-col gap-1" aria-label="Also today">
          {rest.map((p) => {
            const parent = pathLabel(nodesById, p.nodeId);
            return (
              <li key={p.nodeId} className="flex justify-between gap-2">
                <span className="truncate">
                  {parent && <span className="subtle">{parent} · </span>}
                  {p.title}
                </span>
                <span className="tabular shrink-0">{fmtMinutes(p.suggestedMinutes)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {footer}
    </Glass>
  );
}
