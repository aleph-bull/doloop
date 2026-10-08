import { formatClock, type StudyNode, type UserSettings } from '@komogon/core';
import { Eye, EyeOff, Maximize2, Pause, Play, SkipForward, Square } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Chip, Glass, useToast } from '@komogon/ui';
import type { ActiveSession, EndSummary } from '../lib/api';
import { openFocusTab, useFocusTabPresent } from '../lib/focus-tab';
import { fmtTime } from '../lib/format';
import { PHASE_LABEL, useSessionController } from '../lib/session-controller';

export interface TimerCardProps {
  active: ActiveSession;
  settings: UserSettings;
  nodes: StudyNode[];
  /** Called with the summary once the session has been finalized. */
  onEnded: (summary: EndSummary) => void;
  /** Rendered at the bottom of the card, under a rule. */
  footer?: ReactNode;
}

/**
 * The active session card (spec §4): all three modes, the end flow. The logic
 * is `useSessionController`, shared with the focus screen; this is the dashboard's view.
 */
export function TimerCard({ active, settings, nodes, onEnded, footer }: TimerCardProps) {
  const { toast } = useToast();
  // While the focus tab is open it plays the alerts, so the dashboard stays quiet.
  const focusOpen = useFocusTabPresent();
  const ctl = useSessionController({ active, settings, nodes, onEnded, muteAlerts: focusOpen });
  const { timer, view } = ctl;

  const focus = () => {
    const result = openFocusTab();
    if (result === 'blocked')
      toast('The browser blocked the focus tab. Allow pop-ups and try again.');
    if (result === 'focused') toast('The focus screen is open in another tab.');
  };

  return (
    <>
      <Glass as="section" className="p-6 flex flex-col gap-5" strong aria-label="Current session">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="subtle text-sm">{PHASE_LABEL[timer.phase]}</div>
            {ctl.nodePath && <div className="muted text-sm truncate">{ctl.nodePath}</div>}
            <h2 className="text-xl truncate">{active.nodeTitle}</h2>
            <div className="muted text-sm mt-1 flex gap-2 flex-wrap">
              <Chip tone="neutral">
                {timer.mode === 'pomodoro'
                  ? `Pomodoro · cycle ${timer.cycle + 1}`
                  : timer.mode === 'scheduled'
                    ? `Until ${fmtTime(timer.plannedEndAt)}`
                    : 'Unlimited'}
              </Chip>
              {view.graceRemainingSeconds !== null && (
                <Chip tone="warn">Ends in {view.graceRemainingSeconds} s</Chip>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={focusOpen ? 'Show the focus screen' : 'Open the focus screen'}
            title={focusOpen ? 'Focus screen is open' : 'Open the focus screen'}
            onClick={focus}
          >
            <Maximize2 size={16} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={timer.showTimer ? 'Hide timer' : 'Show timer'}
            onClick={ctl.toggleTimerVisibility}
          >
            {timer.showTimer ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
          </Button>
        </div>

        <div className="flex items-end gap-4 flex-wrap">
          {timer.showTimer ? (
            <div
              className="timer-digits"
              aria-live="off"
              aria-label={`${ctl.digits} ${timer.mode === 'unlimited' ? 'elapsed' : 'remaining'}`}
            >
              {ctl.digits}
            </div>
          ) : (
            <div className="timer-digits" aria-label="Timer hidden">
              <span aria-hidden style={{ opacity: 0.5 }}>
                · · ·
              </span>
            </div>
          )}
          <div className="muted text-sm tabular pb-2">
            {formatClock(view.workSeconds)} focused
            {view.breakSeconds > 0 && ` · ${formatClock(view.breakSeconds)} break`}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {ctl.canPause && (
            <Button onClick={() => ctl.send({ type: 'pause' })}>
              <Pause size={16} aria-hidden /> Pause
            </Button>
          )}
          {ctl.canResume && (
            <Button variant="primary" onClick={() => ctl.send({ type: 'resume' })}>
              <Play size={16} aria-hidden /> Resume
            </Button>
          )}
          {ctl.canSkip && (
            <Button onClick={() => ctl.send({ type: 'skip-break' })}>
              <SkipForward size={16} aria-hidden /> Skip break
            </Button>
          )}
          {timer.mode === 'scheduled' && timer.plannedEndAt && (
            <Button onClick={() => ctl.extend(15)}>+15 min</Button>
          )}
          <span className="flex-1" />
          <Button variant="danger" onClick={ctl.stop} disabled={ctl.busy}>
            <Square size={14} aria-hidden /> Stop
          </Button>
        </div>
        {footer}
      </Glass>
      {ctl.dialogs}
    </>
  );
}
