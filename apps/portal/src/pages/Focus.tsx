import {
  advance,
  ancestorTitles,
  buildIndex,
  formatClock,
  viewTimer,
  type AdvanceOptions,
  type TimerState,
} from '@doloop/core';
import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AudioGlow, Button, Spinner, useToast } from '@doloop/ui';
import { useSystemAudio } from '../lib/use-system-audio';
import { useActiveSession, useMe, useNodes, usePace, useUpdateSettings } from '../lib/queries';

const PHASE_LABEL: Record<TimerState['phase'], string> = {
  work: 'Focus',
  'short-break': 'Short break',
  'long-break': 'Long break',
  paused: 'Paused',
  idle: 'Idle',
  ended: 'Ended',
};

/** Seconds of stillness before the surrounding text fades away. */
const IDLE_FADE_SECONDS = 4;

const SWATCHES = ['#6366f1', '#38bdf8', '#22c55e', '#f59e0b', '#f43f5e', '#a855f7', '#e2e8f0'];

function fmtHours(minutes: number): string {
  const h = minutes / 60;
  if (h < 1) return `${Math.max(1, Math.round(minutes))}m`;
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
}

/**
 * Full-screen view of the running session: the countdown, a little context around it, and
 * an ambient glow that follows whatever the computer is playing.
 *
 * The timer is not re-implemented here. The server owns the state; this ticks the same
 * pure state machine the card does, so switching between the two never loses a second.
 */
export function Focus() {
  const navigate = useNavigate();
  const me = useMe();
  const nodes = useNodes();
  const pace = usePace();
  const active = useActiveSession();
  const update = useUpdateSettings();
  const { toast } = useToast();

  const settings = me.data?.user.settings;
  const vis = settings?.visualizer;

  const [timer, setTimer] = useState<TimerState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [chromeVisible, setChromeVisible] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Set on mount rather than during render, so the value is stable across re-renders.
  const lastMoveRef = useRef(0);
  useEffect(() => {
    lastMoveRef.current = Date.now();
  }, []);

  const audio = useSystemAudio(vis?.enabled ?? false);

  const opts = useMemo<AdvanceOptions>(
    () => ({
      pomodoro: active.data?.active?.session.pomodoroConfigSnapshot ??
        settings?.pomodoro ?? {
          workMin: 25,
          shortBreakMin: 5,
          longBreakMin: 15,
          cyclesBeforeLong: 4,
        },
      autoStartBreaks: settings?.pomodoro.autoStartBreaks ?? true,
      autoStartWork: settings?.pomodoro.autoStartWork ?? false,
    }),
    [active.data?.active?.session.pomodoroConfigSnapshot, settings?.pomodoro],
  );

  // Adopt server state whenever the query refreshes, so this screen and the card agree.
  useEffect(() => {
    if (active.data?.active) setTimer(active.data.active.timer);
  }, [active.data?.active]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      setTimer((prev) => (prev ? advance(prev, new Date(t).toISOString(), opts) : prev));
      if ((t - lastMoveRef.current) / 1000 > IDLE_FADE_SECONDS) setChromeVisible(false);
    }, 1000);
    return () => window.clearInterval(id);
  }, [opts]);

  // Any input brings the surrounding text back.
  useEffect(() => {
    const wake = () => {
      lastMoveRef.current = Date.now();
      setChromeVisible(true);
    };
    for (const ev of ['mousemove', 'keydown', 'touchstart', 'wheel'] as const)
      window.addEventListener(ev, wake, { passive: true });
    return () => {
      for (const ev of ['mousemove', 'keydown', 'touchstart', 'wheel'] as const)
        window.removeEventListener(ev, wake);
    };
  }, []);

  // Escape leaves, matching every other full-screen surface in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate('/');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const setColor = useCallback(
    (color: string) => {
      // Persisted, so Settings and this screen always show the same colour.
      void update
        .mutateAsync({ visualizer: { color } })
        .catch(() => toast('Could not save the colour'));
    },
    [update, toast],
  );

  if (!settings || !active.data)
    return (
      <div className="focus-screen focus-centre">
        <Spinner />
      </div>
    );

  const session = active.data.active;
  if (!session || !timer)
    return (
      <div className="focus-screen focus-centre">
        <div className="flex flex-col items-center gap-4">
          <p className="text-xl">No session running.</p>
          <Button variant="primary" onClick={() => navigate('/')}>
            Back to Today
          </Button>
        </div>
      </div>
    );

  const view = viewTimer(timer, new Date(now).toISOString());
  const clock =
    view.phaseRemainingSeconds !== null
      ? formatClock(view.phaseRemainingSeconds)
      : formatClock(view.phaseElapsedSeconds);

  // Subject is the course the task sits under; the child is the task itself. A task with
  // no parent is its own subject and has no child line.
  const index = buildIndex(nodes.data?.nodes ?? []);
  const node = index.byId.get(session.session.nodeId);
  const ancestors = node ? ancestorTitles(index.byId, node.id) : [];
  const subject = ancestors.length > 0 ? ancestors[0]! : (node?.title ?? null);
  const child = ancestors.length > 0 ? (node?.title ?? null) : null;

  // Hours left on the task being studied, or on whatever the plan says is next.
  const nextBest = pace.data?.plan?.[0] ?? null;
  const ownRemaining = node ? (pace.data?.pace?.[node.id]?.remainingMinutes ?? null) : null;
  const remaining: { minutes: number; label: string } | null = child
    ? ownRemaining !== null
      ? { minutes: ownRemaining, label: `left on ${child}` }
      : null
    : nextBest
      ? { minutes: nextBest.remainingMinutes, label: `left on ${nextBest.title}` }
      : ownRemaining !== null
        ? { minutes: ownRemaining, label: 'left' }
        : null;

  const sessionHours = fmtHours(view.workSeconds / 60);
  const nowDate = new Date(now);

  return (
    <div className="focus-screen">
      {vis?.enabled && (
        <AudioGlow
          read={audio.read}
          color={vis.color}
          intensity={vis.intensity}
          opacity={vis.opacity}
          enabled
        />
      )}

      <div className={`focus-chrome${chromeVisible ? '' : ' is-hidden'}`}>
        <div className="focus-corner focus-top-left">
          <div className="focus-clock tabular">
            {nowDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
          <div className="focus-date">
            {nowDate.toLocaleDateString([], {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </div>
        </div>

        <div className="focus-corner focus-top-right">
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label="Leave the focus screen"
            onClick={() => navigate('/')}
          >
            <X size={18} aria-hidden />
          </Button>
        </div>
      </div>

      <div className="focus-centre">
        <div className="focus-phase">{PHASE_LABEL[view.phase]}</div>
        <div className="focus-time tabular">{clock}</div>
        {subject && (
          <div className={`focus-context${chromeVisible ? '' : ' is-hidden'}`}>
            <div className="focus-subject">{subject}</div>
            {child && <div className="focus-child">{child}</div>}
          </div>
        )}
      </div>

      <div className={`focus-chrome${chromeVisible ? '' : ' is-hidden'}`}>
        <div className="focus-corner focus-bottom-left">
          <span className="tabular">{sessionHours} this session</span>
          {subject && remaining && (
            <span className="tabular">
              {fmtHours(remaining.minutes)} {remaining.label}
            </span>
          )}
        </div>

        <div className="focus-corner focus-bottom-right">
          {audio.hint && <span className="focus-audio-hint">{audio.hint}</span>}
          {audio.canAsk && (
            <button type="button" className="focus-link" onClick={() => void audio.request()}>
              {audio.state === 'listening' ? 'Change audio source' : 'Use system audio'}
            </button>
          )}
          {vis?.enabled && (
            <div className="focus-swatches">
              <button
                type="button"
                className="focus-swatch"
                aria-label="Glow colour"
                aria-expanded={pickerOpen}
                style={{ background: vis.color }}
                onClick={() => setPickerOpen((v) => !v)}
              />
              {pickerOpen && (
                <div className="focus-swatch-row" role="group" aria-label="Glow colour">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="focus-swatch"
                      aria-label={c}
                      aria-pressed={vis.color.toLowerCase() === c.toLowerCase()}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                    />
                  ))}
                  <input
                    type="color"
                    aria-label="Custom glow colour"
                    className="focus-swatch-input"
                    value={vis.color}
                    onChange={(e) => setColor(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
