import type { SessionMode, StudyNode } from '@doloop/core';
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
  /** Suggested minutes (from the daily plan) used to prefill scheduled mode. */
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
  const [mode, setMode] = useState<SessionMode>('pomodoro');
  const [endTime, setEndTime] = useState('');
  const [showTimer, setShowTimer] = useState(true);

  useEffect(() => {
    if (!open) return;
    setNodeId(
      node?.id ??
        nodes.find((n) => !n.completedAt && n.kind !== 'course')?.id ??
        nodes[0]?.id ??
        '',
    );
    setMode('pomodoro');
    setEndTime(plusMinutesLocalTime(suggestedMinutes ?? 60));
    setShowTimer(settings?.pomodoro.showTimerByDefault ?? true);
  }, [open, node, nodes, suggestedMinutes, settings]);

  const leaves = nodes.filter((n) => !n.completedAt);

  const go = async () => {
    if (!nodeId) return toast('Pick something to study');
    try {
      await start.mutateAsync({
        nodeId,
        mode,
        plannedEndAt: mode === 'scheduled' ? todayAtLocal(endTime) : null,
        showTimer,
      });
      onClose();
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) toast('A session is already running');
      else toast(err instanceof Error ? err.message : 'Could not start');
    }
  };

  const modeHelp: Record<SessionMode, string> = {
    pomodoro: settings
      ? `${settings.pomodoro.workMin} min work, ${settings.pomodoro.shortBreakMin} min break, long break every ${settings.pomodoro.cyclesBeforeLong}`
      : '',
    unlimited: 'Runs until you stop. Shows elapsed time only.',
    scheduled:
      'Pick an end time. A chime plays, then the session ends after a minute unless you extend.',
  };

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
            Start
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
          <span className="field-label">Mode</span>
          <Segmented
            ariaLabel="Session mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'pomodoro', label: 'Pomodoro' },
              { value: 'unlimited', label: 'Unlimited' },
              { value: 'scheduled', label: 'Until a time' },
            ]}
          />
          <span className="field-hint">{modeHelp[mode]}</span>
        </div>
        {mode === 'scheduled' && (
          <Input
            label="Stop at"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            hint={`You'll stop at ${endTime}`}
          />
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
