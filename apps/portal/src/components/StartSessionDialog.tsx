import type { SessionDurationKind, SessionStyle, StudyNode } from '@doloop/core';
import { describeCut, modeForPlan, pomodoroCut } from '@doloop/core';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Input, Modal, Segmented, Select, Toggle, useToast } from '@doloop/ui';
import { ApiError } from '../lib/api';
import { useMe, useStartSession } from '../lib/queries';

export interface StartSessionDialogProps {
  open: boolean;
  onClose: () => void;
  nodes: StudyNode[];
  /** Preselected node. */
  node?: StudyNode | null;
  /** Suggested minutes (from the daily plan) used to prefill the length. */
  suggestedMinutes?: number | null;
}

function plusMinutesLocalTime(min: number): string {
  const d = new Date(Date.now() + min * 60_000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function todayAtLocal(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/** Minutes from now until the given local clock time, for the boundary check. */
function minutesUntilLocal(time: string): number {
  return Math.round((Date.parse(todayAtLocal(time)) - Date.now()) / 60_000);
}

function fmtLength(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function StartSessionDialog({
  open,
  onClose,
  nodes,
  node,
  suggestedMinutes,
}: StartSessionDialogProps) {
  const me = useMe();
  const start = useStartSession();
  const navigate = useNavigate();
  const { toast } = useToast();
  const settings = me.data?.user.settings;

  const [nodeId, setNodeId] = useState('');
  const [style, setStyle] = useState<SessionStyle>('pomodoro');
  const [duration, setDuration] = useState<SessionDurationKind>('unlimited');
  const [minutes, setMinutes] = useState('60');
  const [endTime, setEndTime] = useState('');
  const [showTimer, setShowTimer] = useState(true);
  /** Set when the chosen length cuts a block short; cleared by confirming. */
  const [confirmCut, setConfirmCut] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNodeId(
      node?.id ??
        nodes.find((n) => !n.completedAt && n.kind !== 'course')?.id ??
        nodes[0]?.id ??
        '',
    );
    setStyle('pomodoro');
    setDuration('unlimited');
    setMinutes(String(suggestedMinutes ?? 60));
    setEndTime(plusMinutesLocalTime(suggestedMinutes ?? 60));
    setShowTimer(settings?.pomodoro.showTimerByDefault ?? true);
    setConfirmCut(null);
  }, [open, node, nodes, suggestedMinutes, settings]);

  const leaves = nodes.filter((n) => !n.completedAt);

  /** How long the session will run, or null when it is unlimited. */
  const plannedMinutes =
    duration === 'unlimited'
      ? null
      : duration === 'for'
        ? Math.max(0, Math.round(Number(minutes) || 0))
        : minutesUntilLocal(endTime);

  // Only a pomodoro has blocks to cut short; a continuous session can stop anywhere.
  const cut =
    style === 'pomodoro' && plannedMinutes !== null && settings
      ? pomodoroCut(plannedMinutes, settings.pomodoro)
      : null;
  const cutMessage = describeCut(cut);

  const plannedEndAt = () => {
    if (duration === 'unlimited') return null;
    if (duration === 'until') return todayAtLocal(endTime);
    return new Date(Date.now() + (plannedMinutes ?? 0) * 60_000).toISOString();
  };

  const submit = async () => {
    if (!nodeId) return toast('Pick something to study');
    if (plannedMinutes !== null && plannedMinutes <= 0) return toast('Pick a length in the future');
    try {
      await start.mutateAsync({
        nodeId,
        mode: modeForPlan({ style, plannedEndAt: plannedEndAt() }),
        plannedEndAt: plannedEndAt(),
        showTimer,
      });
      onClose();
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) toast('A session is already running');
      else toast(err instanceof Error ? err.message : 'Could not start');
    }
  };

  const go = () => {
    // Confirm once when the length does not land on a block boundary.
    if (cutMessage && confirmCut !== cutMessage) return setConfirmCut(cutMessage);
    void submit();
  };

  const styleHelp =
    style === 'pomodoro'
      ? settings
        ? `${settings.pomodoro.workMin} min work, ${settings.pomodoro.shortBreakMin} min break, long break every ${settings.pomodoro.cyclesBeforeLong}.`
        : ''
      : 'Straight through, no breaks. Stop whenever you like.';

  const durationHelp =
    duration === 'unlimited'
      ? 'Runs until you stop it.'
      : 'A chime plays at the end, then the session closes after a minute unless you extend it.';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start a session"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={go} loading={start.isPending}>
            {confirmCut ? 'Start anyway' : 'Start'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select label="Studying" value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
          {leaves.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
        </Select>

        <div className="field">
          <span className="field-label">How you work</span>
          <Segmented
            ariaLabel="Session style"
            value={style}
            onChange={(v) => {
              setStyle(v as SessionStyle);
              setConfirmCut(null);
            }}
            options={[
              { value: 'pomodoro', label: 'Pomodoro' },
              { value: 'continuous', label: 'Continuous' },
            ]}
          />
          <span className="field-hint">{styleHelp}</span>
        </div>

        <div className="field">
          <span className="field-label">How long</span>
          <Segmented
            ariaLabel="Session length"
            value={duration}
            onChange={(v) => {
              setDuration(v as SessionDurationKind);
              setConfirmCut(null);
            }}
            options={[
              { value: 'unlimited', label: 'Unlimited' },
              { value: 'for', label: 'For a while' },
              { value: 'until', label: 'Until a time' },
            ]}
          />
          <span className="field-hint">{durationHelp}</span>
        </div>

        {duration === 'for' && (
          <Input
            label="Minutes"
            type="number"
            min={1}
            max={1440}
            step={5}
            value={minutes}
            onChange={(e) => {
              setMinutes(e.target.value);
              setConfirmCut(null);
            }}
            hint={plannedMinutes ? `That is ${fmtLength(plannedMinutes)}` : undefined}
          />
        )}

        {duration === 'until' && (
          <Input
            label="Stop at"
            type="time"
            value={endTime}
            onChange={(e) => {
              setEndTime(e.target.value);
              setConfirmCut(null);
            }}
            hint={
              plannedMinutes && plannedMinutes > 0
                ? `${fmtLength(plannedMinutes)} from now`
                : undefined
            }
          />
        )}

        {cutMessage && (
          <p className="cut-warning" role="alert">
            {cutMessage}
            {cut && cut.previousBoundaryMinutes > 0 && (
              <>
                {' '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    // Snap to the clean length just below.
                    setDuration('for');
                    setMinutes(String(cut.previousBoundaryMinutes));
                    setConfirmCut(null);
                  }}
                >
                  Use {fmtLength(cut.previousBoundaryMinutes)} instead
                </button>
              </>
            )}
          </p>
        )}

        <Toggle
          checked={showTimer}
          onChange={setShowTimer}
          label="Show the timer"
          description="You can hide the numbers and just study."
        />
      </div>
    </Modal>
  );
}
