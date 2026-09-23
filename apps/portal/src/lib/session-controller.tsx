import {
  advance,
  buildIndex,
  formatClock,
  isEndedEarly,
  isUnderAssessment,
  pathLabel,
  viewTimer,
  type AdvanceOptions,
  type SoundEvent,
  type StudyNode,
  type TimerState,
  type TimerView,
  type UserSettings,
} from '@doloop/core';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Modal, useToast } from '@doloop/ui';
import { ReviewDialog, type ReviewSubject } from '../components/ReviewDialog';
import { api, type ActiveSession, type EndSummary, type ReviewInput } from './api';
import { useIdleDetection } from './idle';
import { keys } from './queries';
import { playSound, preloadSounds } from './sounds';

export const PHASE_LABEL: Record<TimerState['phase'], string> = {
  work: 'Focus',
  'short-break': 'Short break',
  'long-break': 'Long break',
  paused: 'Paused',
  idle: 'Idle',
  ended: 'Ended',
};

export interface SessionControllerProps {
  active: ActiveSession;
  settings: UserSettings;
  nodes: StudyNode[];
  /** Called with the summary once the session has been finalized. */
  onEnded: (summary: EndSummary) => void;
  /** Hand the alert sounds to another surface (the focus tab) rather than play them here too. */
  muteAlerts?: boolean;
}

export interface SessionController {
  timer: TimerState;
  view: TimerView;
  nowIso: string;
  /** The countdown, or the elapsed time for an open-ended phase. */
  digits: string;
  node: StudyNode | undefined;
  nodePath: string;
  routineSession: boolean;
  busy: boolean;
  canPause: boolean;
  canResume: boolean;
  canSkip: boolean;
  inBreak: boolean;
  wouldEndEarly: boolean;
  send: (event: Parameters<typeof api.sessionEvent>[1]) => Promise<unknown>;
  /** Stop, asking first when it would end early and running the review when there is one. */
  stop: () => Promise<void>;
  extend: (minutes: number) => Promise<unknown>;
  toggleTimerVisibility: () => Promise<unknown>;
  /** The dialogs the flow needs (end early, still studying, tick, review). Render once. */
  dialogs: ReactNode;
}

/**
 * The running session, as one hook: the local tick of the server-owned timer, the event
 * sending, idle detection, sounds, and the whole end flow with its dialogs. The timer card
 * and the focus screen are two views of this; neither keeps timer state of its own.
 */
export function useSessionController({
  active,
  settings,
  nodes,
  onEnded,
  muteAlerts = false,
}: SessionControllerProps): SessionController {
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

  // 1 s tick against the wall clock: transitions are materialized from timestamps, so a
  // throttled or dropped tick never loses time. The updater stays pure; React may call
  // it more than once, which is why playing a sound from inside it used to double-fire.
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

  /** Play a tone for a moment, if the user has not muted it and this surface owns the sound. */
  const alert = useCallback(
    (event: SoundEvent) => {
      if (!settings.sounds.enabled || muteAlerts) return;
      playSound(settings.sounds[event], settings.sounds.volume);
    },
    [settings.sounds, muteAlerts],
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

  // Another tab may have ended the session; the query then comes back empty and the card
  // unmounts. Nothing to do here beyond not treating that as an error.

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

  const extend = (minutes: number) =>
    send({
      type: 'extend',
      plannedEndAt: new Date(
        Math.max(Date.parse(timer.plannedEndAt ?? nowIso), Date.now()) + minutes * 60_000,
      ).toISOString(),
    });

  const toggleTimerVisibility = () =>
    send({ type: 'set-timer-visibility', showTimer: !timer.showTimer });

  const dialogs = (
    <>
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

  return {
    timer,
    view,
    nowIso,
    digits,
    node,
    nodePath,
    routineSession,
    busy,
    canPause,
    canResume,
    canSkip,
    inBreak,
    wouldEndEarly,
    send,
    stop: () => stop(),
    extend,
    toggleTimerVisibility,
    dialogs,
  };
}
