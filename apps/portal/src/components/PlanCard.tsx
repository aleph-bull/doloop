import { pathLabel, type PlanItem, type StudyNode } from '@komogon/core';
import { ChevronDown, ChevronRight, Maximize2, Play } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, Glass, Reveal } from '@komogon/ui';
import { fmtDue, fmtMinutes } from '../lib/format';
import { NARROW_QUERY, useMediaQuery } from '../lib/media';
import { Popout } from './Popout';
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

/** Whether the list is unfolded: open until folded, then kept in this browser as it was left. */
const OPEN_KEY = 'komogon.pressing-open';

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== 'false';
  } catch {
    return true;
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
 * The dashboard's start panel: one big Start, the focus screen beside it, and the most
 * pressing tasks of the day, each a link down to its card. On a computer they pop out of a
 * pill beside the footer, a name and a pace tag each; on a phone they unfold under Start,
 * with where they sit, the due date and the minutes. The plan itself still comes from
 * getDailyPlan (spec §3); the panel just no longer picks for you.
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
  const narrow = useMediaQuery(NARROW_QUERY);
  const pressing = plan.slice(0, PRESSING);
  const [open, setOpen] = useState(readOpen);
  const toggle = () => {
    setOpen(!open);
    writeOpen(!open);
  };
  return (
    <Glass className="start-panel" as="section" aria-label="Start">
      <div className="start-panel-main">
        <div className="min-w-0">
          <h2 className="start-panel-title">Ready when you are</h2>
          <p className="start-panel-sub">
            {todayLine ?? 'Add estimates and due dates to see a plan for today.'}
          </p>
        </div>
        <div className="start-panel-actions">
          <Button size="lg" className="start-panel-focus" onClick={onOpenFocus}>
            <Maximize2 size={16} aria-hidden /> Focus screen
          </Button>
          <Button variant="primary" size="lg" className="start-panel-go" onClick={onStart}>
            <Play size={17} aria-hidden fill="currentColor" /> Start a session
          </Button>
        </div>
      </div>
      {!narrow && (
        <div className="start-panel-foot">
          {footer}
          {pressing.length > 0 && (
            <Popout
              label="Most pressing tasks"
              triggerClassName="start-pill start-pressing-pill"
              className="is-menu"
              width={300}
              room={200}
              align="end"
              trigger={
                <>
                  <span>Most pressing</span>
                  <span className="start-pressing-count tabular">{pressing.length}</span>
                  <ChevronRight size={14} aria-hidden className="start-pill-chevron" />
                </>
              }
            >
              {(close) => (
                <ul className="start-menu">
                  {pressing.map((p) => (
                    <li key={p.nodeId}>
                      <button
                        type="button"
                        className="start-option"
                        onClick={() => {
                          close();
                          onPick(p.nodeId);
                        }}
                        title="Go to this task"
                      >
                        <span className="start-option-text">
                          <span className="start-pressing-title">{p.title}</span>
                        </span>
                        <StatusChip status={p.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Popout>
          )}
        </div>
      )}
      {narrow && pressing.length > 0 && (
        <div className="start-pressing">
          <button
            type="button"
            className="start-pressing-toggle"
            aria-expanded={open}
            aria-controls="most-pressing"
            onClick={toggle}
          >
            <span>Most pressing</span>
            <span className="start-pressing-count tabular">{pressing.length}</span>
            <ChevronDown size={14} aria-hidden className="start-pressing-chevron" />
          </button>
          <Reveal open={open}>
            <ul id="most-pressing" className="start-pressing-list" aria-label="Most pressing tasks">
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
                      <span className="start-pressing-text">
                        <span className="start-pressing-title">{p.title}</span>
                        <span className="start-pressing-where">
                          {parent ?? 'Task'}
                          {node?.dueAt ? ` · ${fmtDue(node.dueAt)}` : ''}
                        </span>
                      </span>
                      <span className="start-pressing-meta">
                        <StatusChip status={p.status} />
                        <span className="start-pressing-mins tabular">
                          {fmtMinutes(p.suggestedMinutes)}
                        </span>
                        <ChevronRight size={16} aria-hidden className="start-pressing-go" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Reveal>
        </div>
      )}
      {narrow && footer}
    </Glass>
  );
}
