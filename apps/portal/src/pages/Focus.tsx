import {
  advance,
  buildIndex,
  expectedMinutes,
  focusContext,
  focusProgress,
  visualizerPalette,
  visualizerTuning,
  viewTimer,
  type StudyNode,
  type UserSettings,
} from '@komogon/core';
import { useQueryClient } from '@tanstack/react-query';
import {
  Eye,
  EyeOff,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  SkipForward,
  Square,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router';
import {
  accentHexFor,
  AudioVisualizer,
  Backdrop,
  Button,
  fireConfetti,
  Glass,
  Spinner,
  useToast,
  Reveal,
} from '@komogon/ui';
import type { ActiveSession, EndSummary } from '../lib/api';
import { useAppearance } from '../lib/appearance';
import { useFocusTabBeacon } from '../lib/focus-tab';
import { fmtTime } from '../lib/format';
import {
  keys,
  useActiveSession,
  useMe,
  useNodes,
  usePace,
  useRoutines,
  useUpdateSettings,
} from '../lib/queries';
import { PHASE_LABEL, useSessionController } from '../lib/session-controller';
import { useAudioCapture } from '../lib/use-audio-capture';
import { AudioPermissionModal } from '../components/focus/AudioPermissionModal';
import { ProgressDisplay } from '../components/focus/ProgressDisplay';
import { TaskContext } from '../components/focus/TaskContext';
import { TimerDisplay } from '../components/focus/TimerDisplay';
import { VisualizerSettings } from '../components/focus/VisualizerSettings';
import { StartSessionDialog } from '../components/StartSessionDialog';
import { SessionSummary } from '../components/SessionSummary';
import { announceAchievements } from '../lib/achievements';
import { cameraSupported, useTimelapseRecorder } from '../lib/timelapse';
import {
  recorderProblem,
  TimelapseBadge,
  TimelapseExport,
  TimelapsePrompt,
  TimelapseSettings,
  timelapseSpaceWarning,
} from '../components/focus/Timelapse';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Seconds of stillness before the controls fade away. */
const STILL_SECONDS = 4;
/** How long after the timer appears the audio prompt shows, so it never lands on a blank screen. */
const PROMPT_DELAY_MS = 900;

/** Controls appear on any input and fade once the hands are still. */
function useStillness(): boolean {
  const [visible, setVisible] = useState(true);
  const lastMove = useRef(0);
  useEffect(() => {
    lastMove.current = Date.now();
    const wake = () => {
      lastMove.current = Date.now();
      setVisible(true);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'] as const;
    for (const ev of events) window.addEventListener(ev, wake, { passive: true });
    const id = window.setInterval(() => {
      if ((Date.now() - lastMove.current) / 1000 > STILL_SECONDS) setVisible(false);
    }, 1000);
    return () => {
      for (const ev of events) window.removeEventListener(ev, wake);
      window.clearInterval(id);
    };
  }, []);
  return visible;
}

/**
 * The focus screen: its own browser tab, opened when a session starts. A large clock, the
 * unit and task under it, the elapsed time, and, if wanted, light that moves with the music
 * and a note of what is playing. Nothing else.
 *
 * The timer is not reimplemented. The server owns the state and this runs the same
 * controller the dashboard card does, so the two can never disagree.
 */
export function Focus() {
  const navigate = useNavigate();
  const me = useMe();
  const nodes = useNodes();
  const active = useActiveSession();
  const update = useUpdateSettings();
  const qc = useQueryClient();
  // Another tab reaching for this one usually means a session just started there.
  useFocusTabBeacon(() => void qc.invalidateQueries({ queryKey: keys.active }));
  const { toast } = useToast();

  const settings = me.data?.user.settings;
  const appearance = useAppearance(settings);
  const chromeVisible = useStillness();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [summary, setSummary] = useState<EndSummary | null>(null);
  const [startOpen, setStartOpen] = useState(false);

  const patch = useCallback(
    (p: DeepPartial<UserSettings>) =>
      update
        .mutateAsync(p)
        .catch((err) => toast(err instanceof Error ? err.message : 'Could not save')),
    [update, toast],
  );

  /* ---------- audio + visualizer ---------- */
  const audio = useAudioCapture();
  const vis = settings?.visualizer;
  const [askOpen, setAskOpen] = useState(false);
  const askedRef = useRef(false);
  const session = active.data?.active ?? null;
  /* ---------- timelapse ---------- */
  const tl = settings?.timelapse;
  const [recording, setRecording] = useState(false);
  const [tlAskOpen, setTlAskOpen] = useState(false);
  /** The session the timelapse question was settled for, so it is asked once per session. */
  const tlAskedFor = useRef<string | null>(null);
  /** How many stills there were when the video was last saved. */
  const [tlSavedAt, setTlSavedAt] = useState(0);

  // Where the session stands right now, from the server's timer and the wall clock: the
  // recorder takes stills only in focus, and stamps each with the time studied.
  const sessionRef = useRef(session);
  const settingsRef = useRef(settings);
  useEffect(() => {
    sessionRef.current = session;
    settingsRef.current = settings;
  });
  const sample = useCallback(() => {
    const s = sessionRef.current;
    const st = settingsRef.current;
    if (!s || !st) return { phase: null, workSeconds: 0, breakSeconds: null, totalSeconds: 0 };
    const now = new Date().toISOString();
    const t = advance(s.timer, now, {
      pomodoro: s.session.pomodoroConfigSnapshot ?? st.pomodoro,
      autoStartBreaks: st.pomodoro.autoStartBreaks,
      autoStartWork: st.pomodoro.autoStartWork,
    });
    const v = viewTimer(t, now);
    const onBreak = t.phase === 'short-break' || t.phase === 'long-break';
    return {
      phase: t.phase,
      workSeconds: v.workSeconds,
      breakSeconds: onBreak ? v.phaseElapsedSeconds : null,
      totalSeconds: v.workSeconds + v.breakSeconds,
    };
  }, []);
  const [inFocus, setInFocus] = useState(false);
  useEffect(() => {
    if (!recording) return;
    // Stills are taken in focus, and in breaks too when the user asked for them.
    const tick = () => {
      const phase = sample().phase;
      const onBreak = phase === 'short-break' || phase === 'long-break';
      setInFocus(phase === 'work' || (onBreak && !!settingsRef.current?.timelapse.recordBreaks));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [recording, sample]);
  const tlOptions = useMemo(
    () => ({
      lengthMode: tl?.lengthMode ?? 'auto',
      lengthSeconds: tl?.lengthSeconds ?? 30,
      speed: tl?.speed ?? 300,
      fps: tl?.fps ?? 30,
    }),
    [tl?.lengthMode, tl?.lengthSeconds, tl?.speed, tl?.fps],
  );
  const recorder = useTimelapseRecorder({
    recording,
    capturing: inFocus,
    options: tlOptions,
    stamp: () => {
      const { workSeconds, breakSeconds, totalSeconds } = sample();
      return { workSeconds, breakSeconds, totalSeconds };
    },
  });

  /** Stills not yet saved as a video, or thrown away: they live only in this tab. */
  const tlPending = recorder.count > 0 && recorder.count !== tlSavedAt;

  // The camera would not start: say why once, and stop trying.
  const problem = recorderProblem(recorder.status);
  useEffect(() => {
    if (!problem) return;
    toast(problem);
    setRecording(false);
  }, [problem, toast]);

  // Recording started: if these settings hold an unusually large pile of stills, or the disk
  // is short, say so once per session while there is still time to change them.
  const tlSpaceWarnedFor = useRef<string | null>(null);
  const spaceSessionId = session?.session.id ?? null;
  useEffect(() => {
    if (!recording || !spaceSessionId || tlSpaceWarnedFor.current === spaceSessionId) return;
    tlSpaceWarnedFor.current = spaceSessionId;
    // Not cancelled on re-render: it is marked as said already, so it must get said.
    void timelapseSpaceWarning(tlOptions).then((msg) => {
      if (msg) toast(msg);
    });
  }, [recording, spaceSessionId, tlOptions, toast]);

  // The session ended, here or elsewhere: the camera goes off and the stills wait for the video.
  useEffect(() => {
    if (!session) setRecording(false);
  }, [session]);

  // Once per session, after the audio question if there is one: record, ask, or nothing.
  const sessionId = session?.session.id ?? null;
  useEffect(() => {
    if (!tl || !sessionId || tlAskedFor.current === sessionId) return;
    if (askOpen || audio.state === 'requesting' || !cameraSupported()) return;
    // Last session's stills are still waiting to be saved; they come first.
    if (tlPending) return;
    if (tl.record === 'never') {
      tlAskedFor.current = sessionId;
      return;
    }
    const id = window.setTimeout(() => {
      tlAskedFor.current = sessionId;
      if (tl.record === 'always') setRecording(true);
      else setTlAskOpen(true);
    }, PROMPT_DELAY_MS * 1.6);
    return () => window.clearTimeout(id);
  }, [tl, sessionId, askOpen, audio.state, tlPending]);

  // Unsaved stills live only in this tab: ask before it closes.
  useEffect(() => {
    if (!tlPending) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [tlPending]);

  /**
   * While a question or the browser's picker is up, the clock waits: choosing a window to
   * share, or whether to film, is not studying. Released the moment it closes, however it went.
   */
  const holdTimer = askOpen || tlAskOpen || audio.state === 'requesting';
  /** The "try again" line after a share that fell short. Closed with its x for this visit. */
  const [retryClosed, setRetryClosed] = useState(false);
  useEffect(() => {
    // Each new attempt earns the line again if it fails again.
    if (audio.state === 'requesting') setRetryClosed(false);
  }, [audio.state]);
  const retryVisible =
    (audio.state === 'denied' || audio.state === 'no-audio') &&
    !!vis &&
    !vis.promptDismissed &&
    !retryClosed;

  // Offer to share audio once per visit, once the timer is on screen, unless told never to.
  useEffect(() => {
    if (askedRef.current || !vis || !session) return;
    if (vis.promptDismissed || !audio.supported || audio.state !== 'idle') return;
    askedRef.current = true;
    const id = window.setTimeout(() => setAskOpen(true), PROMPT_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [vis, session, audio.supported, audio.state]);

  const answerYes = () => {
    setAskOpen(false);
    if (vis && !vis.enabled) void patch({ visualizer: { enabled: true } });
    // The share prompt must start on the click itself, so nothing is awaited before it.
    void audio.request().then((state) => {
      if (state === 'no-audio') toast('That share had no audio. Tick "share audio" and try again.');
    });
  };
  const answerNever = () => {
    setAskOpen(false);
    void patch({ visualizer: { promptDismissed: true } });
  };

  // Turning the visualizer off keeps the audio share: it lives for the whole visit, until
  // "Stop listening", the browser's own banner, or the tab closing.

  // From the setting, not the DOM: <html> is themed in an effect, after this has rendered.
  const accent = accentHexFor(settings?.theme.accent ?? 'indigo');
  const palette = useMemo(
    () =>
      visualizerPalette({
        colorMode: vis?.colorMode ?? 'accent',
        color: vis?.color ?? accent,
        accentHex: accent,
      }),
    [vis?.colorMode, vis?.color, accent],
  );
  // How it listens: the preset, or the custom sliders.
  const tuning = useMemo(() => (vis ? visualizerTuning(vis) : null), [vis]);

  /* ---------- leaving ---------- */
  const leave = useCallback(() => {
    // A tab the app opened closes; one the user opened by hand goes home instead.
    window.close();
    window.setTimeout(() => navigate('/'), 150);
  }, [navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (sheetOpen) setSheetOpen(false);
      else if (!askOpen && !startOpen) leave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leave, sheetOpen, askOpen, startOpen]);

  // The session ended (here or in another tab): drop the summary once a new one starts.
  useEffect(() => {
    if (session) setSummary(null);
  }, [session]);

  useEffect(() => {
    document.title = session ? `${session.nodeTitle} · Komogon` : 'Focus · Komogon';
    return () => {
      document.title = 'Komogon';
    };
  }, [session]);

  if (!settings || !active.data || !nodes.data) {
    return (
      <div className="focus-screen focus-centre on-backdrop">
        <Backdrop
          backgroundId={appearance.backgroundId}
          theme={appearance.theme}
          customImageUrl={appearance.customImageUrl}
        />
        <Spinner />
      </div>
    );
  }

  return (
    <div className={`focus-screen on-backdrop${chromeVisible ? '' : ' is-still'}`}>
      <Backdrop
        backgroundId={appearance.backgroundId}
        theme={appearance.theme}
        customImageUrl={appearance.customImageUrl}
      />
      {vis?.enabled && (
        <AudioVisualizer
          enabled
          getCapture={audio.getCapture}
          intensity={vis.intensity}
          opacity={vis.opacity}
          layers={{
            mist: vis.mist,
            ribbons: vis.ribbons,
            shockwave: vis.shockwave,
            rings: vis.rings,
            bars: vis.bars,
            waveform: vis.waveform,
            burst: vis.burst,
          }}
          mist={{ height: vis.mistHeight, drift: vis.mistDrift, opacity: vis.mistOpacity }}
          waves={{ count: vis.waveCount, top: vis.waveTop, bottom: vis.waveBottom }}
          bars={{
            count: vis.barCount,
            height: vis.barHeight,
            gap: vis.barGap,
            glow: vis.barGlow,
            reflection: vis.barReflection,
            symmetric: vis.barSymmetric,
            position: vis.barPosition,
            width: vis.barWidth,
            opacity: vis.barOpacity,
          }}
          waveform={{ position: vis.waveformPosition, mirror: vis.waveformMirror }}
          rings={{ count: vis.ringCount }}
          burst={{
            radius: vis.burstRadius,
            reach: vis.burstReach,
            spikes: vis.burstSpikes,
            blob: vis.burstBlob,
            rays: vis.burstRays,
            showSpikes: vis.burstShowSpikes,
            spikeOpacity: vis.burstSpikeOpacity,
          }}
          speed={vis.speed}
          fadeWhenSilent={vis.fadeWhenSilent}
          palette={palette}
          analysis={tuning?.analysis}
          barsAnalysis={tuning?.bars}
        />
      )}

      <div className={`focus-top focus-chrome${chromeVisible ? '' : ' is-hidden'}`}>
        <Link to="/" className="focus-brand" title="Back to Komogon">
          Komogon
        </Link>
        <span className="flex-1" />
        {audio.state === 'listening' && <span className="focus-hint">Listening</span>}
        {recording && recorder.status === 'on' && (
          <TimelapseBadge
            recorder={recorder}
            capturing={inFocus}
            onStop={() => setRecording(false)}
          />
        )}
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label="Focus screen controls"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((v) => !v)}
        >
          <Settings2 size={18} aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" icon aria-label="Leave the focus screen" onClick={leave}>
          <X size={18} aria-hidden />
        </Button>
      </div>

      {retryVisible && (
        <div className="focus-retry" role="status">
          <span>
            {audio.state === 'no-audio'
              ? 'That share had no audio. Tick "share audio" in the picker.'
              : 'Nothing was shared, so the visualizer is idling.'}
          </span>
          <button
            type="button"
            className="focus-link"
            onClick={() => {
              if (vis && !vis.enabled) void patch({ visualizer: { enabled: true } });
              void audio.request();
            }}
          >
            <RefreshCw size={14} aria-hidden /> Try again
          </button>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label="Close"
            onClick={() => setRetryClosed(true)}
          >
            <X size={14} aria-hidden />
          </Button>
        </div>
      )}

      {session ? (
        <FocusSession
          active={session}
          settings={settings}
          nodes={nodes.data.nodes}
          chromeVisible={chromeVisible}
          holdTimer={holdTimer}
          onEnded={(s) => {
            setSummary(s);
            setRecording(false);
            void qc.invalidateQueries({ queryKey: keys.active });
            if (s.confetti && settings.effects.confetti) fireConfetti();
            window.setTimeout(() => announceAchievements(s.badges), 600);
          }}
        />
      ) : summary ? (
        <main className="focus-centre is-summary">
          <Glass className="focus-summary" strong>
            <SessionSummary
              summary={summary}
              phrasesEnabled={settings.effects.phrases}
              onTrimmed={() => setSummary(null)}
            />
            {tl && (
              <TimelapseExport
                recorder={recorder}
                value={tl}
                onChange={patch}
                recording={recording}
                onSaved={() => setTlSavedAt(recorder.count)}
              />
            )}
            <div className="focus-actions" style={{ marginTop: 20 }}>
              <Button variant="primary" onClick={() => setStartOpen(true)}>
                Start another
              </Button>
              <Button variant="ghost" onClick={leave}>
                Close
              </Button>
            </div>
          </Glass>
        </main>
      ) : (
        <main className="focus-centre">
          <div className="focus-phase">Ready</div>
          <div className="focus-time tabular focus-time-hidden">
            <span aria-hidden>--:--</span>
          </div>
          <div className="focus-context">
            <div className="focus-subject">Nothing running</div>
            <div className="focus-child">Start a session and the clock takes over this screen.</div>
          </div>
          <div className="focus-actions">
            <Button variant="primary" onClick={() => setStartOpen(true)}>
              Start a session
            </Button>
          </div>
        </main>
      )}

      {sheetOpen && (
        <Glass className="focus-sheet" strong role="dialog" aria-label="Focus screen controls">
          <div className="focus-sheet-head">
            <h2 className="card-title">Focus screen</h2>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label="Close controls"
              onClick={() => setSheetOpen(false)}
            >
              <X size={16} aria-hidden />
            </Button>
          </div>
          <section className="focus-sheet-section" aria-label="Visualizer">
            <h3 className="focus-sheet-title">Visualizer</h3>
            {vis && <VisualizerSettings value={vis} onChange={patch} audio={audio} />}
          </section>
          {tl && (
            <section className="focus-sheet-section" aria-label="Timelapse">
              <h3 className="focus-sheet-title">Timelapse</h3>
              <TimelapseSettings
                value={tl}
                onChange={patch}
                recording={recording}
                onRecordingChange={
                  session && cameraSupported()
                    ? (next) => {
                        tlAskedFor.current = session.session.id;
                        setRecording(next);
                      }
                    : undefined
                }
              />
              {!summary && (
                <TimelapseExport
                  recorder={recorder}
                  value={tl}
                  onChange={patch}
                  recording={recording}
                  onSaved={() => setTlSavedAt(recorder.count)}
                />
              )}
            </section>
          )}
          <section className="focus-sheet-section">
            <Button variant="secondary" onClick={leave}>
              Exit focus
            </Button>
            <span className="field-hint">
              Your session keeps running. Press Escape to leave, Space to pause or resume, and H to
              hide the clock.
            </span>
          </section>
        </Glass>
      )}

      <TimelapsePrompt
        open={tlAskOpen}
        onYes={() => {
          setTlAskOpen(false);
          setRecording(true);
        }}
        onNo={() => setTlAskOpen(false)}
        onAlways={() => {
          setTlAskOpen(false);
          setRecording(true);
          void patch({ timelapse: { record: 'always' } });
        }}
        onNever={() => {
          setTlAskOpen(false);
          void patch({ timelapse: { record: 'never' } });
        }}
      />

      <AudioPermissionModal
        open={askOpen}
        alreadyEnabled={!!vis?.enabled}
        onYes={answerYes}
        onNo={() => setAskOpen(false)}
        onNever={answerNever}
      />

      <StartSessionDialog
        open={startOpen}
        onClose={() => setStartOpen(false)}
        nodes={nodes.data.nodes}
        onStarted={() => setSummary(null)}
      />
    </div>
  );
}

interface FocusSessionProps {
  active: ActiveSession;
  settings: UserSettings;
  nodes: StudyNode[];
  chromeVisible: boolean;
  /** Pause the clock while true and resume it when it goes false, if this paused it. */
  holdTimer: boolean;
  onEnded: (summary: EndSummary) => void;
}

/** The running session: the same controller as the dashboard card, laid out for a whole screen. */
function FocusSession({
  active,
  settings,
  nodes,
  chromeVisible,
  holdTimer,
  onEnded,
}: FocusSessionProps) {
  const ctl = useSessionController({ active, settings, nodes, onEnded });
  const routines = useRoutines();
  const pace = usePace();
  const { timer, view } = ctl;

  // The hold pauses only a running clock and resumes only what it paused: a pause the
  // user chose before the question came up is theirs to end. The resume waits for the
  // pause to land, since a picker can be dismissed before the server has answered; a
  // resume on a clock that is not paused is a no-op there.
  const held = useRef<Promise<unknown> | null>(null);
  const ctlRef = useRef(ctl);
  useEffect(() => {
    ctlRef.current = ctl;
  });
  useEffect(() => {
    if (holdTimer) {
      if (ctl.canPause && !held.current) held.current = ctl.send({ type: 'pause' });
    } else if (held.current) {
      const pausing = held.current;
      held.current = null;
      void pausing.then(() => {
        if (ctlRef.current.timer.phase !== 'ended') void ctlRef.current.send({ type: 'resume' });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdTimer]);

  // Space pauses and resumes, H hides and shows the clock. Not while typing, with a
  // modifier held, or with a dialog up, where Space belongs to the focused button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      if (document.querySelector('dialog[open], [role="dialog"]')) return;
      const c = ctlRef.current;
      if (e.key === ' ') {
        e.preventDefault();
        if (c.busy) return;
        if (c.canPause) void c.send({ type: 'pause' });
        else if (c.canResume) void c.send({ type: 'resume' });
      } else if (e.key === 'h' || e.key === 'H') {
        void c.toggleTimerVisibility();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Hide puts away everything that stays on screen when the hands are still: the clock, the
  // task, the progress. The phase word stays, so a glance still says paused or on a break.
  const hidden = !timer.showTimer;

  const index = useMemo(() => buildIndex(nodes), [nodes]);
  const context = focusContext(index.byId, active.session.nodeId, active.nodeTitle);
  const routine = active.session.routineId
    ? routines.data?.routines.find((r) => r.id === active.session.routineId)
    : undefined;
  const expected = expectedMinutes({
    nodeEstimatedMinutes: ctl.node?.estimatedMinutes,
    routineEstimatedMinutes: routine?.estimatedMinutes,
    startedAt: active.session.startedAt,
    plannedEndAt: active.session.plannedEndAt,
  });
  // Work already logged on the task (pace counts finished sessions only), so the total
  // starts where the task stands rather than at zero.
  const prior = active.session.nodeId
    ? (pace.data?.pace[active.session.nodeId]?.loggedWorkMinutes ?? 0) * 60
    : 0;
  const progress = focusProgress(view.workSeconds, expected, prior);
  // An unlimited session's clock already is this session's time; with no expectation and
  // nothing logged before, both figures would only repeat it.
  const showProgress = !(
    timer.mode === 'unlimited' &&
    progress.fraction === null &&
    progress.priorSeconds === 0
  );

  const phase =
    view.graceRemainingSeconds !== null
      ? `Ends in ${view.graceRemainingSeconds} s`
      : timer.mode === 'pomodoro' && timer.phase === 'work'
        ? `${PHASE_LABEL.work} · cycle ${timer.cycle + 1}`
        : timer.mode === 'scheduled' && timer.phase === 'work' && timer.plannedEndAt
          ? `${PHASE_LABEL.work} · until ${fmtTime(timer.plannedEndAt)}`
          : PHASE_LABEL[timer.phase];

  return (
    <>
      <main className={`focus-centre${hidden ? ' is-bare' : ''}`}>
        <div className="focus-phase">{phase}</div>
        {/* Folds away rather than vanishing: the clock fades and shrinks as its space closes. */}
        <Reveal open={!hidden} className="focus-fold">
          <div className="focus-fold-inner">
            <TimerDisplay
              digits={ctl.digits}
              meaning={timer.mode === 'unlimited' ? 'elapsed' : 'remaining'}
            />
            <TaskContext subject={context.subject} child={context.child} />
            {showProgress && <ProgressDisplay progress={progress} />}
          </div>
        </Reveal>
        <div className={`focus-actions focus-chrome${chromeVisible ? '' : ' is-hidden'}`}>
          {ctl.canPause && (
            <Button variant="ghost" onClick={() => ctl.send({ type: 'pause' })}>
              <Pause size={16} aria-hidden /> Pause
            </Button>
          )}
          {ctl.canResume && (
            <Button variant="primary" onClick={() => ctl.send({ type: 'resume' })}>
              <Play size={16} aria-hidden /> Resume
            </Button>
          )}
          {ctl.canSkip && (
            <Button variant="ghost" onClick={() => ctl.send({ type: 'skip-break' })}>
              <SkipForward size={16} aria-hidden /> Skip break
            </Button>
          )}
          {timer.mode === 'scheduled' && timer.plannedEndAt && (
            <Button variant="ghost" onClick={() => ctl.extend(15)}>
              +15 min
            </Button>
          )}
          <Button
            variant="ghost"
            icon
            aria-label={hidden ? 'Show the clock and task' : 'Hide the clock and task'}
            title={hidden ? 'Show the clock and task' : 'Hide everything but the phase'}
            onClick={ctl.toggleTimerVisibility}
          >
            {hidden ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}
          </Button>
          <Button variant="danger" onClick={ctl.stop} disabled={ctl.busy}>
            <Square size={14} aria-hidden /> Stop
          </Button>
        </div>
      </main>
      {ctl.dialogs}
    </>
  );
}
