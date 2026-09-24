import type { NodePace, StudyNode } from '@komogon/core';
import { Play } from 'lucide-react';
import { Button, Chip, Glass, ProgressBar } from '@komogon/ui';
import { fmtDue, fmtMinutes, pct } from '../lib/format';
import { StatusChip } from './StatusChip';

export interface NodeCardProps {
  node: StudyNode;
  pace?: NodePace;
  courseTitle?: string;
  /** Future planned minutes for this node (from /api/pace). */
  plannedMinutes?: number;
  onStart?: (node: StudyNode) => void;
  onOpen?: (node: StudyNode) => void;
}

const KIND_LABEL: Record<StudyNode['kind'], string> = {
  course: 'Course',
  assessment: 'Assessment',
  task: 'Task',
  other: 'Other',
};

/** Glass node card with pace status (spec §3, heavier-glass decision). */
export function NodeCard({
  node,
  pace,
  courseTitle,
  plannedMinutes,
  onStart,
  onOpen,
}: NodeCardProps) {
  const est = pace?.estimatedMinutes ?? node.estimatedMinutes;
  const needLine =
    pace?.requiredPerDay != null && pace.status !== 'done'
      ? `Need ${fmtMinutes(pace.requiredPerDay)} per day`
      : pace?.remainingMinutes != null && pace.status !== 'done'
        ? `${fmtMinutes(pace.remainingMinutes)} left`
        : null;

  return (
    <Glass as="article" className="p-4 flex flex-col gap-3" aria-label={node.title}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {courseTitle && <div className="subtle text-xs truncate">{courseTitle}</div>}
          <h3 className="text-base font-semibold truncate">
            {onOpen ? (
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => onOpen(node)}
              >
                {node.title}
              </button>
            ) : (
              node.title
            )}
          </h3>
        </div>
        {pace && <StatusChip status={pace.status} />}
      </div>

      {est != null && pace ? (
        <div>
          <ProgressBar value={pace.progress ?? 0} label={`${node.title} progress`} />
          <div className="flex justify-between text-xs muted mt-1 tabular">
            <span>
              {fmtMinutes(pace.loggedWorkMinutes)} of {fmtMinutes(est)}
            </span>
            <span>{pct(pace.progress)}</span>
          </div>
        </div>
      ) : (
        // Nothing to measure against, so report the hours instead of an empty bar.
        pace != null &&
        Math.round(pace.loggedWorkMinutes) > 0 && (
          <div className="text-xs muted tabular">{fmtMinutes(pace.loggedWorkMinutes)} studied</div>
        )
      )}

      <div className="flex items-center gap-2 flex-wrap text-xs muted">
        <Chip tone="neutral">{KIND_LABEL[node.kind]}</Chip>
        <span>{fmtDue(node.dueAt)}</span>
        {needLine && <span>· {needLine}</span>}
        {plannedMinutes !== undefined &&
          pace?.remainingMinutes != null &&
          pace.status !== 'done' && (
            <span>
              · planned {fmtMinutes(plannedMinutes)} / need {fmtMinutes(pace.remainingMinutes)}
            </span>
          )}
      </div>

      {onStart && !node.completedAt && (
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={() => onStart(node)}>
            <Play size={14} aria-hidden /> Start
          </Button>
        </div>
      )}
    </Glass>
  );
}
