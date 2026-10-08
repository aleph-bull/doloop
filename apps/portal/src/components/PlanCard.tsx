import { pathLabel, type PlanItem, type StudyNode } from '@komogon/core';
import { ChevronDown, Maximize2, Play } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, Glass, Reveal } from '@komogon/ui';
import { fmtDue, fmtMinutes } from '../lib/format';
import { StatusChip } from './StatusChip';

export interface PlanCardProps {
  plan: PlanItem[];
  nodesById: Map<string, StudyNode>;
  /** Open the start dialog, with nothing chosen in advance. */
  onStart: () => void;
  /** Open the focus screen in its own tab. */
  onOpenFocus: () => void;
  /** A pressing task was clicked: take the user to its card further down. */
  onPick: (nodeId: string) => void;
  /** "About 33 min across 1 item today", as a line above the button. */
  todayLine?: string | null;
  /** Rendered at the bottom of the panel, under a rule. */
  footer?: ReactNode;
}

/** How many of the day's plan the panel names. */
const PRESSING = 4;

/** Whether the list is unfolded: folded until opened, then kept in this browser as it was left. */
const OPEN_KEY = 'komogon.pressing-open';

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, String(open));
  } catch {
    /* Storage blocked: it just opens next time. */
  }
}

/**
 * The dashboard's start panel: one big Start, the focus screen a line under it, and the
 * most pressing tasks of the day in small text, each a link down to its card. The plan
 * itself still comes from getDailyPlan (spec §3); the panel just no longer picks for you.
 */
export function PlanCard({
  plan,
  nodesById,
  onStart,
  onOpenFocus,
  onPick,
  todayLine,
  footer,
}: PlanCardProps) {
  const pressing = plan.slice(0, PRESSING);
  const [open, setOpen] = useState(readOpen);
  const toggle = () => {
    setOpen(!open);
    writeOpen(!open);
  };
  return (
    <Glass className="p-5 flex flex-col gap-4 start-panel" as="section" aria-label="Start">
      <div>
        <h2 className="text-xl">Ready when you are</h2>
        <p className="muted text-sm mt-1">
          {todayLine ??
            'Add an estimate and a due date to a task and Komogon will tell you what to do today.'}
        </p>
      </div>
      <div className="start-panel-actions">
        <Button variant="primary" size="lg" onClick={onStart}>
          <Play size={16} aria-hidden /> Start a session
        </Button>
        <button type="button" className="link-button start-panel-focus" onClick={onOpenFocus}>
          <Maximize2 size={13} aria-hidden /> Open the focus screen
        </button>
      </div>
      {pressing.length > 0 && (
        <div className="start-pressing">
          <button
            type="button"
            className="start-pressing-toggle"
            aria-expanded={open}
            aria-controls="most-pressing"
            onClick={toggle}
          >
            <span>Most pressing</span>
            <ChevronDown size={14} aria-hidden className="start-pressing-chevron" />
          </button>
          <Reveal open={open}>
            <ul
              id="most-pressing"
              className="text-sm flex flex-col gap-1 start-pressing-list"
              aria-label="Most pressing tasks"
            >
              {pressing.map((p) => {
                const parent = pathLabel(nodesById, p.nodeId);
                const node = nodesById.get(p.nodeId);
                return (
                  <li key={p.nodeId}>
                    <button
                      type="button"
                      className="start-pressing-item"
                      onClick={() => onPick(p.nodeId)}
                      title="Go to this task"
                    >
                      <span className="truncate">
                        {parent && <span className="subtle">{parent} · </span>}
                        {p.title}
                      </span>
                      <span className="start-pressing-meta">
                        <StatusChip status={p.status} />
                        <span className="muted tabular">
                          {fmtMinutes(p.suggestedMinutes)}
                          {node?.dueAt ? ` · ${fmtDue(node.dueAt)}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Reveal>
        </div>
      )}
      {footer}
    </Glass>
  );
}
