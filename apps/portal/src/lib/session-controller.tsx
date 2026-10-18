import {
  advance,
  buildIndex,
  formatClock,
  isEndedEarly,
  isUnderAssessment,
  isWithheld,
  pendingSleep,
  SLEEP_MIN_MS,
  pathLabel,
  viewTimer,
  type AdvanceOptions,
  type SoundEvent,
  type StudyNode,
  type TimerState,
  type TimerView,
  type UserSettings,
} from '@komogon/core';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Modal, useToast } from '@komogon/ui';
import { ReviewDialog, type ReviewSubject } from '../components/ReviewDialog';
import { api, type ActiveSession, type EndSummary, type ReviewInput } from './api';
import { keys } from './queries';
import { playSound, preloadSounds } from './sounds';

export const PHASE_LABEL: Record<TimerState['phase'], string> = {
  work: 'Focus',
  'short-break': 'Short break',
  'long-break': 'Long break',
  paused: 'Paused',
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
  /** Stopping now would earn nothing: ended early, short of ten focused minutes, unless the task gets marked done. */
  wouldWithhold: boolean;
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
 * sending, sounds, and the whole end flow with its dialogs. The timer card and the focus
 * screen are two views of this; neither keeps timer state of its own.
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
  // The review, when there is one: a free session has nothing to review. With reviews
  // off, a routine still asks whether to tick.
  const reviews = settings.review.mode !== 'off' && subject !== null;
  const asksTick = !reviews && routineSession;
  const index = useMemo(() => buildIndex(nodes), [nodes]);
  const underAssessment = node ? isUnderAssessment(index, node.id) : false;
  const nodePath = node ? pathLabel(index.byId, node.id) : '';
  // The assessment the readiness question is about: the nearest one up the tree.
  let assessmentTitle: string | null = null;
  for (let cur = node; cur; cur = cur.parentId ? index.byId.get(cur.parentId) : undefined) {
    if (cur.kind === 'assessment') {
      assessmentTitle = cur.title;
      break;
    }
  }

  // 1 s tick against the wall clock: transitions are materialized from timestamps, so a
  // throttled or dropped tick never loses time. The updater stays pure; React may call
  // it more than once, which is why playing a sound from inside it used to double-fire.
  //
  // The same tick notices a sleep: timers stop while the computer sleeps, so on waking the
  // next tick finds the clock has jumped. A jump of ten minutes or more while the clock was
  // running is logged on the session, which keeps running; the user is asked about it.
  const lastTick = useRef(0);
  const runningRef = useRef(false);
  useEffect(() => {
    runningRef.current =
      timer.phase === 'work' || timer.phase === 'short-break' || timer.phase === 'long-break';
  }, [timer.phase]);
  const sessionId = active.session.id;
  useEffect(() => {
    lastTick.current = Date.now();
    const id = window.setInterval(() => {
      const t = Date.now();
      const slept = t - lastTick.current;
      const from = lastTick.current;
      lastTick.current = t;
      setNow(t);
      setTimer((prev) => advance(prev, new Date(t).toISOString(), opts));
      if (slept >= SLEEP_MIN_MS && runningRef.current) {
        void api
          .sessionSleep(sessionId, {
            from: new Date(from).toISOString(),
            to: new Date(t).toISOString(),
          })
          .then((res) => qc.setQueryData(keys.active, res))
          .catch(() => void qc.invalidateQueries({ queryKey: keys.active }));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [opts, sessionId, qc]);

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
    else if (to === 'work') alert('workStart');
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

  /** Set when the user says they stopped when the computer fell asleep: the end goes back to then. */
  const stopAtRef = useRef<string | null>(null);

  const finish = async (review: ReviewInput | null, markComplete: boolean) => {
    if (endingRef.current) return;
    endingRef.current = true;
    setBusy(true);
    try {
      const res = await api.endSession(active.session.id, {
        review,
        markComplete,
        ...(stopAtRef.current ? { endAt: stopAtRef.current } : {}),
      });
      setReviewOpen(false);
      onEnded(res.summary);
      qc.setQueryData(keys.active, { now: nowIso, active: null });
      void qc.invalidateQueries({ queryKey: keys.pace });
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.nodes });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
      // A routine session may have just ticked its occurrence off.
      if (routineSession) void qc.invalidateQueries({ queryKey: ['routines'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not end the session');
      endingRef.current = false;
      stopAtRef.current = null;
      setStopping(false);
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

  // Ending early only costs the XP while the session is short: from ten focused minutes on
  // the minutes pay, and finishing the task pays whatever the clock says.
  const wouldWithhold = isWithheld({
    endedEarly: wouldEndEarly,
    workMinutes: view.workSeconds / 60,
  });

  const stop = async (confirmed = false) => {
    if (wouldWithhold && !confirmed) {
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

  // The sleep still waiting for an answer, if the computer slept while this ran.
  const slept = pendingSleep(active.session.sleeps);
  const sleptAt = slept
    ? new Date(slept.from).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';
  const [answering, setAnswering] = useState(false);
  /** True once the user chose "I stopped": the question gives way to the review. */
  const [stopping, setStopping] = useState(false);

  const keptStudying = async () => {
    if (!slept) return;
    setAnswering(true);
    try {
      const res = await api.keptStudying(active.session.id, slept.from);
      qc.setQueryData(keys.active, res);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setAnswering(false);
    }
  };

  /** "I stopped when it fell asleep": end the session back then, through the usual review. */
  const stoppedAtSleep = async () => {
    if (!slept) return;
    stopAtRef.current = slept.from;
    setStopping(true);
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
        open={!!slept && !reviewOpen && !stopping}
        onClose={() => {}}
        persistent
        title={`Your computer went to sleep at ${sleptAt}`}
        actions={
          <>
            <Button onClick={stoppedAtSleep} disabled={answering || busy}>
              I stopped at {sleptAt}
            </Button>
            <Button variant="primary" onClick={keptStudying} loading={answering}>
              I kept studying
            </Button>
          </>
        }
      >
        <p className="muted">
          Did you keep studying until now, or did you stop at {sleptAt}? The session kept running
          while it slept, so nothing is lost either way.
        </p>
      </Modal>

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
          Under ten minutes of focus so far. The minutes are saved either way, but it only counts
          toward your level after ten minutes, or if you mark the task done.
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
          <p className="muted">
            The minutes are saved either way. Choose Not yet to keep it on your list.
          </p>
        </Modal>
      )}

      {reviews && subject && settings.review.mode !== 'off' && (
        <ReviewDialog
          open={reviewOpen}
          mode={settings.review.mode}
          subject={subject}
          path={nodePath}
          stats={{
            workSeconds: view.workSeconds,
            breakSeconds: view.breakSeconds,
            pomodoros: timer.mode === 'pomodoro' ? timer.cycle : null,
          }}
          underAssessment={underAssessment}
          assessmentTitle={assessmentTitle}
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
    wouldWithhold,
    send,
    stop: () => stop(),
    extend,
    toggleTimerVisibility,
    dialogs,
  };
}
