import {
  advance,
  buildIndex,
  formatClock,
  isEndedEarly,
  isUnderAssessment,
  pathLabel,
  viewTimer,
  type AdvanceOptions,
  type StudyNode,
  type SoundEvent,
  type TimerState,
  type UserSettings,
} from '@doloop/core';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Pause, Play, SkipForward, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Chip, Glass, Modal, useToast } from '@doloop/ui';
import { api, type ActiveSession, type EndSummary, type ReviewInput } from '../lib/api';
import { fmtTime } from '../lib/format';
import { useIdleDetection } from '../lib/idle';
import { keys } from '../lib/queries';
import { playSound, preloadSounds } from '../lib/sounds';
import { ReviewDialog, type ReviewSubject } from './ReviewDialog';

export interface TimerCardProps {
  active: ActiveSession;
  settings: UserSettings;
  nodes: StudyNode[];
  /** Called with the summary once the session has been finalized. */
  onEnded: (summary: EndSummary) => void;
}

const PHASE_LABEL: Record<TimerState['phase'], string> = {
  work: 'Focus',
  'short-break': 'Short break',
  'long-break': 'Long break',
  paused: 'Paused',
  idle: 'Idle',
  ended: 'Ended',
};

/** The active session card (spec §4): all three modes, idle detection, end flow. */
export function TimerCard({ active, settings, nodes, onEnded }: TimerCardProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [timer, setTimer] = useState<TimerState>(active.timer);
  const [now, setNow] = useState(() => Date.now());
  const [reviewOpen, setReviewOpen] = useState(false);
  const [idleOpen, setIdleOpen] = useState(false);
  const [earlyOpen, setEarlyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const endingRef = useRef(false);

  const opts = useMemo<AdvanceOptions>(
    () => ({
      pomodoro: active.session.pomodoroConfigSnapshot ?? settings.pomodoro,
      autoStartBreaks: settings.pomodoro.autoStartBreaks,
      autoStartWork: settings.pomodoro.autoStartWork,
    }),
    [active.session.pomodoroConfigSnapshot, settings.pomodoro],
  );

  // Adopt server state whenever the query refreshes.
  useEffect(() => setTimer(active.timer), [active.timer]);

  const node = nodes.find((n) => n.id === active.session.nodeId);
  const routineSession = active.session.routineId !== null;
  const subject: ReviewSubject | null = node
    ? { kind: 'task', node }
    : routineSession
      ? { kind: 'routine', title: active.nodeTitle }
      : null;
  // The review, when there is one. With reviews off, a routine still asks whether to tick.
  const reviews = settings.review.mode !== 'off' && subject !== null;
  const asksTick = !reviews && routineSession;
  const index = useMemo(() => buildIndex(nodes), [nodes]);
  const underAssessment = node ? isUnderAssessment(index, node.id) : false;
  const nodePath = node ? pathLabel(index.byId, node.id) : '';

  // 1 s tick: materialize transitions locally. The updater stays pure — React may call it
  // more than once, which is why playing a sound from inside it used to double-fire.
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      setTimer((prev) => advance(prev, new Date(t).toISOString(), opts));
    }, 1000);
    return () => window.clearInterval(id);
  }, [opts]);

  const nowIso = new Date(now).toISOString();
  const view = viewTimer(timer, nowIso);

  /** Play a tone for a moment, if the user has not muted it. */
  const alert = useCallback(
    (event: SoundEvent) => {
      if (!settings.sounds.enabled) return;
      playSound(settings.sounds[event], settings.sounds.volume);
    },
    [settings.sounds],
  );

  // Decode the chosen sounds up front; an alert must not wait on a fetch.
  useEffect(() => {
    preloadSounds([
      settings.sounds.workStart,
      settings.sounds.breakStart,
      settings.sounds.sessionEnd,
    ]);
  }, [settings.sounds.workStart, settings.sounds.breakStart, settings.sounds.sessionEnd]);

  // Sound on a phase change, watched as an effect so it fires exactly once per transition.
  const lastPhase = useRef(timer.phase);
  useEffect(() => {
    const from = lastPhase.current;
    const to = timer.phase;
    if (from === to) return;
    lastPhase.current = to;
    if (to === 'short-break' || to === 'long-break') alert('breakStart');
    else if (to === 'work' && from !== 'idle') alert('workStart');
    else if (to === 'ended') alert('sessionEnd');
  }, [timer.phase, alert]);

  // The planned end of a session: sound once when the grace period opens.
  const graceChimed = useRef(false);
  useEffect(() => {
    if (view.graceRemainingSeconds !== null && !graceChimed.current) {
      graceChimed.current = true;
      alert('sessionEnd');
    }
    if (view.graceRemainingSeconds === null) graceChimed.current = false;
  }, [view.graceRemainingSeconds, alert]);

  const send = useCallback(
    async (event: Parameters<typeof api.sessionEvent>[1]) => {
      try {
        const res = await api.sessionEvent(active.session.id, event);
        setTimer(res.active.timer);
        qc.setQueryData(keys.active, res);
        return res;
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not update the session');
        void qc.invalidateQueries({ queryKey: keys.active });
        return null;
      }
    },
    [active.session.id, qc, toast],
  );

  // Idle detection (spec §4): pause the work clock and ask "Still studying?".
  const resetIdle = useIdleDetection({
    enabled: settings.idle.enabled && timer.phase === 'work',
    thresholdMin: settings.idle.thresholdMin,
    onIdle: (idleSince) => {
      void send({ type: 'idle-start', idleSince }).then((r) => {
        if (r?.active.timer.phase === 'idle') setIdleOpen(true);
      });
    },
  });

  const answerIdle = async (stillStudying: boolean) => {
    setIdleOpen(false);
    resetIdle();
    const r = await send({ type: 'idle-answer', stillStudying });
    if (!stillStudying) {
      toast('Session saved');
      void qc.invalidateQueries({ queryKey: keys.active });
      void qc.invalidateQueries({ queryKey: keys.pace });
      void qc.invalidateQueries({ queryKey: keys.me });
    } else if (r === null) {
      void qc.invalidateQueries({ queryKey: keys.active });
    }
  };

  const finish = async (review: ReviewInput | null, markComplete: boolean) => {
    if (endingRef.current) return;
    endingRef.current = true;
    setBusy(true);
    try {
      const res = await api.endSession(active.session.id, { review, markComplete });
      setReviewOpen(false);
      onEnded(res.summary);
      qc.setQueryData(keys.active, { now: nowIso, active: null });
      void qc.invalidateQueries({ queryKey: keys.pace });
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.nodes });
      // A routine session may have just ticked its occurrence off.
      if (routineSession) void qc.invalidateQueries({ queryKey: ['routines'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not end the session');
      endingRef.current = false;
      void qc.invalidateQueries({ queryKey: keys.active });
    } finally {
      setBusy(false);
    }
  };

  const wouldEndEarly = isEndedEarly({
    mode: timer.mode,
    cycle: timer.cycle,
    autoEnded: timer.autoEnded,
    endedAt: nowIso,
    plannedEndAt: timer.plannedEndAt,
  });

  const stop = async (confirmed = false) => {
    if (wouldEndEarly && !confirmed) {
      setEarlyOpen(true);
      return;
    }
    setEarlyOpen(false);
    // Bank work now so filling in the review does not count as study time.
    if (timer.phase === 'work' || timer.phase === 'short-break' || timer.phase === 'long-break') {
      await send({ type: 'pause' });
    }
    if (reviews || asksTick) setReviewOpen(true);
    else await finish(null, false);
  };

  // Scheduled auto-end: run the end flow with the review once the grace period elapses.
  useEffect(() => {
    if (timer.phase === 'ended' && !reviewOpen && !endingRef.current) {
      if (reviews || asksTick) setReviewOpen(true);
      else void finish(null, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer.phase]);

  const digits =
    timer.mode === 'unlimited'
      ? formatClock(view.workSeconds)
      : view.phaseRemainingSeconds !== null
        ? formatClock(view.phaseRemainingSeconds)
        : formatClock(view.phaseElapsedSeconds);

  const inBreak = timer.phase === 'short-break' || timer.phase === 'long-break';
  const canPause = timer.phase === 'work' || inBreak;
  const canResume = timer.phase === 'paused';
  const canSkip =
    timer.mode === 'pomodoro' &&
    (inBreak || (timer.phase === 'paused' && timer.resumePhase !== 'work'));

  return (
    <>
      <Glass as="section" className="p-6 flex flex-col gap-5" strong aria-label="Current session">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="subtle text-sm">{PHASE_LABEL[timer.phase]}</div>
            {nodePath && <div className="muted text-sm truncate">{nodePath}</div>}
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
            aria-label={timer.showTimer ? 'Hide timer' : 'Show timer'}
            onClick={() => send({ type: 'set-timer-visibility', showTimer: !timer.showTimer })}
          >
            {timer.showTimer ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
          </Button>
        </div>

        <div className="flex items-end gap-4 flex-wrap">
          {timer.showTimer ? (
            <div
              className="timer-digits"
              aria-live="off"
              aria-label={`${digits} ${timer.mode === 'unlimited' ? 'elapsed' : 'remaining'}`}
            >
              {digits}
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
          {canPause && (
            <Button onClick={() => send({ type: 'pause' })}>
              <Pause size={16} aria-hidden /> Pause
            </Button>
          )}
          {canResume && (
            <Button variant="primary" onClick={() => send({ type: 'resume' })}>
              <Play size={16} aria-hidden /> Resume
            </Button>
          )}
          {canSkip && (
            <Button onClick={() => send({ type: 'skip-break' })}>
              <SkipForward size={16} aria-hidden /> Skip break
            </Button>
          )}
          {timer.mode === 'scheduled' && timer.plannedEndAt && (
            <Button
              onClick={() =>
                send({
                  type: 'extend',
                  plannedEndAt: new Date(
                    Math.max(Date.parse(timer.plannedEndAt!), Date.now()) + 15 * 60_000,
                  ).toISOString(),
                })
              }
            >
              +15 min
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="danger" onClick={() => stop()} disabled={busy || timer.phase === 'idle'}>
            <Square size={14} aria-hidden /> Stop
          </Button>
        </div>
      </Glass>

      <Modal
        open={earlyOpen}
        onClose={() => setEarlyOpen(false)}
        title="End early?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setEarlyOpen(false)}>
              Keep going
            </Button>
            <Button variant="danger" onClick={() => stop(true)}>
              End early
            </Button>
          </>
        }
      >
        <p className="muted">
          {timer.mode === 'pomodoro'
            ? 'The first work interval is not finished. Ending now still logs the minutes, but the session will not count toward your level.'
            : 'The planned end has not arrived. Ending now still logs the minutes, but the session will not count toward your level.'}
        </p>
      </Modal>

      <Modal
        open={idleOpen}
        onClose={() => {}}
        persistent
        title="Still studying?"
        actions={
          <>
            <Button onClick={() => answerIdle(false)}>No, end session</Button>
            <Button variant="primary" onClick={() => answerIdle(true)}>
              Yes, continue
            </Button>
          </>
        }
      >
        <p className="muted">
          The work clock paused while you were away. Time since then is logged as idle, not work.
        </p>
      </Modal>

      {asksTick && (
        <Modal
          open={reviewOpen}
          onClose={() => finish(null, false)}
          title={`Done with ${active.nodeTitle}?`}
          actions={
            <>
              <Button variant="ghost" onClick={() => finish(null, false)} disabled={busy}>
                Not yet
              </Button>
              <Button variant="primary" onClick={() => finish(null, true)} loading={busy}>
                Tick it off
              </Button>
            </>
          }
        >
          <p className="muted">The minutes count either way. Not yet leaves it on your list.</p>
        </Modal>
      )}

      {reviews && subject && settings.review.mode !== 'off' && (
        <ReviewDialog
          open={reviewOpen}
          mode={settings.review.mode}
          subject={subject}
          underAssessment={underAssessment}
          busy={busy}
          onSubmit={(review, markComplete) => finish(review, markComplete)}
          onSkip={(markComplete) => finish({ skipped: true }, markComplete)}
        />
      )}
    </>
  );
}
