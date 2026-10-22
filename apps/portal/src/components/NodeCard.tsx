import type { NodePace, StudyNode, Tag } from '@komogon/core';
import { Play } from 'lucide-react';
import { Glass, ProgressBar } from '@komogon/ui';
import { fmtDate, fmtDue, fmtMinutes, fmtPerDay, pct } from '../lib/format';
import { StatusChip } from './StatusChip';
import { TagChip } from './Tags';

export interface NodeCardProps {
  node: StudyNode;
  pace?: NodePace;
  courseTitle?: string;
  /** Its tags and the ones it inherits from the course above it. */
  tags?: Tag[];
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

/**
 * Glass node card with pace status (spec §3, heavier-glass decision). Reads top to
 * bottom: where it lives, what it is, how far along, and when it is due, with the play
 * button where the thumb lands.
 */
export function NodeCard({
  node,
  pace,
  courseTitle,
  tags,
  plannedMinutes,
  onStart,
  onOpen,
}: NodeCardProps) {
  const est = pace?.estimatedMinutes ?? node.estimatedMinutes;
  const needLine =
    pace?.requiredPerDay != null && pace.status !== 'done'
      ? `Need ${fmtPerDay(pace.requiredPerDay)} per day`
      : pace?.remainingMinutes != null && pace.status !== 'done'
        ? `${fmtMinutes(pace.remainingMinutes)} left`
        : null;
  const planLine =
    plannedMinutes !== undefined && pace?.remainingMinutes != null && pace.status !== 'done'
      ? `Planned ${fmtMinutes(plannedMinutes)} of ${fmtMinutes(pace.remainingMinutes)} needed`
      : null;

  return (
    <Glass as="article" id={`task-${node.id}`} className="node-card" aria-label={node.title}>
      <div className="node-card-head">
        <div className="min-w-0 flex-1">
          <div className="node-card-where">
            {courseTitle ? `${courseTitle} · ` : ''}
            {KIND_LABEL[node.kind]}
          </div>
          <h3 className="node-card-title">
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
          {tags && tags.length > 0 && (
            <div className="node-card-tags">
              {tags.map((t) => (
                <TagChip key={t.id} tag={t} />
              ))}
            </div>
          )}
        </div>
        {pace && <StatusChip status={pace.status} />}
      </div>

      {est != null && pace ? (
        <div className="node-card-progress">
          <div className="node-card-figures">
            <span className="node-card-logged tabular">{fmtMinutes(pace.loggedWorkMinutes)}</span>
            <span className="node-card-of">of {fmtMinutes(est)}</span>
            <span className="node-card-pct tabular">{pct(pace.progress)}</span>
          </div>
          <ProgressBar value={pace.progress ?? 0} label={`${node.title} progress`} />
        </div>
      ) : (
        // Nothing to measure against, so report the hours instead of an empty bar.
        pace != null &&
        Math.round(pace.loggedWorkMinutes) > 0 && (
          <div className="node-card-figures">
            <span className="node-card-logged tabular">{fmtMinutes(pace.loggedWorkMinutes)}</span>
            <span className="node-card-of">studied</span>
          </div>
        )
      )}

      <div className="node-card-foot">
        <div className="node-card-meta">
          <span className="node-card-due">
            {node.completedAt ? `Done ${fmtDate(node.completedAt)}` : fmtDue(node.dueAt)}
          </span>
          {needLine && <span>{needLine}</span>}
          {planLine && <span>{planLine}</span>}
        </div>
        {onStart && !node.completedAt && (
          <button
            type="button"
            className="node-card-play"
            onClick={() => onStart(node)}
            aria-label={`Start ${node.title}`}
            title="Start a session"
          >
            <Play size={17} aria-hidden fill="currentColor" />
          </button>
        )}
      </div>
    </Glass>
  );
}
