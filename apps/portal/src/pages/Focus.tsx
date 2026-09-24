import {
  buildIndex,
  expectedMinutes,
  focusContext,
  focusProgress,
  visualizerPalette,
  type StudyNode,
  type UserSettings,
} from '@komogon/core';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Pause, Play, Settings2, SkipForward, Square, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  accentHexFor,
  AudioVisualizer,
  Backdrop,
  Button,
  fireConfetti,
  Glass,
  Spinner,
  useToast,
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
import { SpotifyNowPlaying, SpotifySettings } from '../components/focus/SpotifyNowPlaying';
import { TaskContext } from '../components/focus/TaskContext';
import { TimerDisplay } from '../components/focus/TimerDisplay';
import { VisualizerSettings } from '../components/focus/VisualizerSettings';
import { StartSessionDialog } from '../components/StartSessionDialog';
import { SessionSummary } from '../components/SessionSummary';
import { announceAchievements } from '../lib/achievements';

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
      <div className="focus-screen focus-centre">
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
    <div className={`focus-screen${chromeVisible ? '' : ' is-still'}`}>
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
          layers={{ ribbons: vis.ribbons, rings: vis.rings, border: vis.border }}
          palette={palette}
        />
      )}

      <div className={`focus-top focus-chrome${chromeVisible ? '' : ' is-hidden'}`}>
        <span className="focus-brand">Komogon</span>
        <span className="flex-1" />
        {audio.state === 'listening' && <span className="focus-hint">Listening</span>}
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

      {session ? (
        <FocusSession
          active={session}
          settings={settings}
          nodes={nodes.data.nodes}
          chromeVisible={chromeVisible}
          onEnded={(s) => {
            setSummary(s);
            void qc.invalidateQueries({ queryKey: keys.active });
            if (s.confetti && settings.effects.confetti) fireConfetti();
            window.setTimeout(() => announceAchievements(s.badges), 600);
          }}
        />
      ) : summary ? (
        <main className="focus-centre">
          <Glass className="focus-summary" strong>
            <SessionSummary summary={summary} phrasesEnabled={settings.effects.phrases} />
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

      <div className="focus-bottom">
        <SpotifyNowPlaying />
      </div>

      {sheetOpen && (
        <Glass className="focus-sheet" strong role="dialog" aria-label="Focus screen controls">
          <div className="focus-sheet-head">
            <h2 className="text-lg">Focus screen</h2>
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
          <section className="focus-sheet-section" aria-label="Spotify">
            <SpotifySettings />
          </section>
          <section className="focus-sheet-section">
            <Button variant="secondary" onClick={leave}>
              Exit focus
            </Button>
            <span className="field-hint">The session keeps running. Escape does the same.</span>
          </section>
        </Glass>
      )}

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
  onEnded: (summary: EndSummary) => void;
}

/** The running session: the same controller as the dashboard card, laid out for a whole screen. */
function FocusSession({ active, settings, nodes, chromeVisible, onEnded }: FocusSessionProps) {
  const ctl = useSessionController({ active, settings, nodes, onEnded });
  const routines = useRoutines();
  const pace = usePace();
  const { timer, view } = ctl;

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
      <main className="focus-centre">
        <div className="focus-phase">{phase}</div>
        <TimerDisplay
          digits={ctl.digits}
          hidden={!timer.showTimer}
          meaning={timer.mode === 'unlimited' ? 'elapsed' : 'remaining'}
        />
        <TaskContext subject={context.subject} child={context.child} />
        {showProgress && <ProgressDisplay progress={progress} />}
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
            aria-label={timer.showTimer ? 'Hide timer' : 'Show timer'}
            onClick={ctl.toggleTimerVisibility}
          >
            {timer.showTimer ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
          </Button>
          <Button variant="danger" onClick={ctl.stop} disabled={ctl.busy || timer.phase === 'idle'}>
            <Square size={14} aria-hidden /> Stop
          </Button>
        </div>
      </main>
      {ctl.dialogs}
    </>
  );
}
