import { badgeByKey, trimFocus } from '@komogon/core';
import { useEffect, useState } from 'react';
import { Button, Input, Modal, useToast } from '@komogon/ui';
import type { HistorySession } from '../lib/api';
import { fmtMinutes } from '../lib/format';
import { useTrimSession } from '../lib/queries';

export interface TrimSessionDialogProps {
  session: HistorySession | null;
  onClose: () => void;
  /** After the time is gone, for a caller showing figures that are now out of date. */
  onTrimmed?: () => void;
}

/** "2:09 AM", or "2:09 AM on Sat, Sep 27" when it is not today. */
function clockWords(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return time;
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${time} on ${day}`;
}

/**
 * Take focused time back off the end of a finished session: for the one left running
 * overnight. The end moves back with it, and the dialog says where it lands before
 * anything changes. XP scales down with the minutes, and badges the session earned that
 * no longer hold are taken back.
 */
export function TrimSessionDialog({ session, onClose, onTrimmed }: TrimSessionDialogProps) {
  const trim = useTrimSession();
  const { toast } = useToast();
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');

  useEffect(() => {
    if (!session) return;
    setHours('');
    setMinutes('');
  }, [session]);

  if (!session || !session.endedAt) return null;

  const h = Number(hours || 0);
  const m = Number(minutes || 0);
  const valid = Number.isFinite(h) && Number.isFinite(m) && h >= 0 && m >= 0;
  const removeMinutes = valid ? Math.round(h * 60 + m) : 0;
  const preview =
    removeMinutes > 0
      ? trimFocus(
          {
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            workSeconds: session.workSeconds,
            breakSeconds: session.breakSeconds,
            xpAwarded: session.xpAwarded,
          },
          removeMinutes * 60,
        )
      : null;
  const capped = preview !== null && preview.removedWorkSeconds < removeMinutes * 60 - 30;

  const submit = async () => {
    if (!preview) return;
    try {
      const r = await trim.mutateAsync({
        id: session.id,
        minutes: Math.round(preview.removedWorkSeconds / 60),
      });
      const names = r.badgesRevoked.map((k) => badgeByKey(k)?.name).filter((n): n is string => !!n);
      toast(
        `Deleted ${fmtMinutes(r.removedFocusSeconds / 60)} of focus${
          r.xpRemoved > 0 ? `, −${r.xpRemoved} XP` : ''
        }${names.length ? `. Taken back: ${names.join(', ')}` : ''}.`,
        { durationMs: 6000 },
      );
      onTrimmed?.();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete that time');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete time from ${session.title}`}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={trim.isPending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={trim.isPending} disabled={!preview}>
            Delete time
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="muted text-sm">
          Started {clockWords(session.startedAt)}, ended {clockWords(session.endedAt)}.{' '}
          {fmtMinutes(session.workSeconds / 60)} focused
          {session.breakSeconds > 0
            ? `, ${fmtMinutes(session.breakSeconds / 60)} on breaks`
            : ''}, {session.xpAwarded} XP.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Hours to delete"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            autoFocus
          />
          <Input
            label="Minutes"
            type="number"
            min={0}
            max={59}
            step={5}
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>
        {preview ? (
          <div className="trim-preview" role="status">
            <p className="trim-preview-end">
              You&rsquo;d have stopped at {clockWords(preview.endedAt)}.
            </p>
            <p className="text-sm">
              That&rsquo;s {fmtMinutes(preview.workSeconds / 60)} of focus
              {preview.removedBreakSeconds > 0
                ? `, ${fmtMinutes(preview.removedBreakSeconds / 60)} of breaks gone`
                : ''}
              {preview.xpRemoved > 0
                ? `, and ${preview.xpRemoved} XP off (${preview.xpAwarded} left)`
                : ''}
              .
            </p>
            {capped && <p className="text-sm muted">A session keeps at least its first minute.</p>}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
