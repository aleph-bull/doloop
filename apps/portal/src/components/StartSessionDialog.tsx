import type {
  RoutineOccurrence,
  SessionDurationKind,
  SessionStyle,
  StudyNode,
} from '@komogon/core';
import { buildIndex, describeCut, modeForPlan, pathLabel, pomodoroCut } from '@komogon/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Input, Modal, Segmented, Toggle, useToast } from '@komogon/ui';
import { api, ApiError } from '../lib/api';
import { openFocusTab } from '../lib/focus-tab';
import {
  keys,
  useActiveSession,
  useMe,
  useRoutines,
  useStartSession,
  useUpdateSettings,
} from '../lib/queries';

export interface StartSessionDialogProps {
  open: boolean;
  onClose: () => void;
  nodes: StudyNode[];
  /** Preselected node. */
  node?: StudyNode | null;
  /** Preselected routine occurrence, instead of a node. */
  routine?: RoutineOccurrence | null;
  /** Suggested minutes (from the daily plan) used to prefill the length. */
  suggestedMinutes?: number | null;
  /**
   * The session can only be on the preselected task: the picker gives way to its name.
   * The Tasks page's play button opens the dialog this way.
   */
  lockSubject?: boolean;
  /**
   * After a successful start. The default goes to the dashboard and opens the focus tab;
   * the focus screen itself passes a no-op, since it is already where the timer lives.
   */
  onStarted?: () => void;
}

function plusMinutesLocalTime(min: number): string {
  const d = new Date(Date.now() + min * 60_000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The style and length chosen last time, kept in this browser so the next start begins there. */
interface LastChoice {
  style: SessionStyle;
  duration: SessionDurationKind;
  minutes: string;
}
const LAST_KEY = 'komogon.start.last';

function readLastChoice(): LastChoice | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LastChoice>;
    const style = v.style === 'pomodoro' || v.style === 'continuous' ? v.style : null;
    const duration =
      v.duration === 'unlimited' || v.duration === 'for' || v.duration === 'until'
        ? v.duration
        : null;
    if (!style || !duration) return null;
    const minutes = Number(v.minutes);
    return {
      style,
      duration,
      minutes: Number.isFinite(minutes) && minutes > 0 ? String(Math.round(minutes)) : '60',
    };
  } catch {
    return null;
  }
}

function saveLastChoice(choice: LastChoice): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(choice));
  } catch {
    /* a convenience only */
  }
}

/** True when a local clock time has already passed today, so it means tomorrow. */
function isTomorrow(time: string): boolean {
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.getTime() <= Date.now();
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

import { nodeKey, routineKey, SubjectPicker } from './SubjectPicker';

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
  routine,
  suggestedMinutes,
  lockSubject = false,
  onStarted,
}: StartSessionDialogProps) {
  const me = useMe();
  const routines = useRoutines();
  const start = useStartSession();
  const update = useUpdateSettings();
  const activeSession = useActiveSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const settings = me.data?.user.settings;
  /** The "open the focus screen?" question, asked after a start when the setting says to. */
  const [askFocus, setAskFocus] = useState(false);

  const [subject, setSubject] = useState('');
  const [style, setStyle] = useState<SessionStyle>('pomodoro');
  const [duration, setDuration] = useState<SessionDurationKind>('unlimited');
  const [minutes, setMinutes] = useState('60');
  const [endTime, setEndTime] = useState('');
  const [showTimer, setShowTimer] = useState(true);
  /** Set when the chosen length cuts a block short; cleared by confirming. */
  const [confirmCut, setConfirmCut] = useState<string | null>(null);
  /** The "still running" question, asked when another session is going. */
  const [askReplace, setAskReplace] = useState(false);
  const [replacing, setReplacing] = useState(false);

  // Fill the form once each time the dialog opens. Reading the props through a ref keeps a
  // background refetch (new task list, saved settings) from wiping what the user picked.
  const latest = useRef({ node, routine, suggestedMinutes, settings });
  useEffect(() => {
    latest.current = { node, routine, suggestedMinutes, settings };
  });
  useEffect(() => {
    if (!open) return;
    const { node, routine, suggestedMinutes, settings } = latest.current;
    if (routine) {
      // A routine already says how long it takes, so the session defaults to that. One
      // shorter than a work block runs straight through rather than being cut short.
      const est = routine.estimatedMinutes;
      setSubject(routineKey(routine));
      setStyle(settings && est < settings.pomodoro.workMin ? 'continuous' : 'pomodoro');
      setDuration('for');
      setMinutes(String(est));
      setEndTime(plusMinutesLocalTime(est));
    } else {
      // Nothing is chosen until the user chooses it; a task handed in is the one exception.
      // Style and length start where they were left last time.
      const last = readLastChoice();
      const mins = suggestedMinutes ?? (last ? Number(last.minutes) : 60);
      setSubject(node ? nodeKey(node.id) : '');
      setStyle(last?.style ?? 'pomodoro');
      setDuration(suggestedMinutes ? 'for' : (last?.duration ?? 'unlimited'));
      setMinutes(String(mins));
      setEndTime(plusMinutesLocalTime(mins));
    }
    setShowTimer(settings?.pomodoro.showTimerByDefault ?? true);
    setConfirmCut(null);
    setAskReplace(false);
  }, [open]);

  // Outstanding occurrences; the preselected one stays listed even if the query lags.
  const due = routines.data?.due ?? [];
  const routineOptions =
    routine && !due.some((o) => routineKey(o) === routineKey(routine)) ? [routine, ...due] : due;
  const today = routines.data?.today;
  const running = activeSession.data?.active ?? null;

  const lockedPath = useMemo(
    () => (lockSubject && node ? pathLabel(buildIndex(nodes).byId, node.id) : ''),
    [lockSubject, node, nodes],
  );

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
    if (!subject) return toast('Pick something to study');
    if (plannedMinutes !== null && plannedMinutes <= 0)
      return toast(duration === 'until' ? 'Pick a later time' : 'Pick at least 1 minute');
    const [kind, id, date] = subject.split(':');
    try {
      await start.mutateAsync({
        ...(kind === 'routine'
          ? { routineId: id, routineDate: date }
          : kind === 'node'
            ? { nodeId: id }
            : {}),
        mode: modeForPlan({ style, plannedEndAt: plannedEndAt() }),
        plannedEndAt: plannedEndAt(),
        showTimer,
      });
      // A routine brings its own length, so only a task or free session sets the default.
      if (kind !== 'routine') saveLastChoice({ style, duration, minutes });
      onClose();
      if (onStarted) onStarted();
      else {
        const mode = settings?.focusScreen.openOnStart ?? 'ask';
        if (mode === 'ask') {
          // The question keeps this page mounted; the dashboard comes after the answer.
          setAskFocus(true);
        } else {
          // Still within the Start click's activation, which is what lets a tab open.
          if (mode === 'always') openAndReport();
          navigate('/');
        }
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // One started somewhere else since this page last looked: ask about it.
        const res = await activeSession.refetch();
        if (res.data?.active) setAskReplace(true);
        else toast('Could not start. Try again.');
      } else toast(err instanceof Error ? err.message : 'Could not start');
    }
  };

  /** Open the focus tab on the click itself, which is what lets a tab open at all. */
  const openAndReport = () => {
    const r = openFocusTab();
    if (r === 'blocked') toast('Allow pop-ups to open the focus screen in its own tab.');
    if (r === 'focused') toast('The focus screen is open in another tab.');
  };

  /** The prompt's answer: open this time or not, and optionally make that the rule. */
  const answerFocus = (open: boolean, remember?: 'always' | 'never') => {
    setAskFocus(false);
    if (open) openAndReport();
    if (remember)
      void update
        .mutateAsync({ focusScreen: { openOnStart: remember } })
        .catch(() => toast('Could not save that. Change it in Settings.'));
    navigate('/');
  };

  const go = () => {
    if (!subject) return toast('Pick something to study');
    // Confirm once when the length does not land on a block boundary.
    if (cutMessage && confirmCut !== cutMessage) return setConfirmCut(cutMessage);
    // Only one session runs at a time: ask before replacing the one that is going.
    if (running) return setAskReplace(true);
    void submit();
  };

  /** "Cancel to start": end the running session (its minutes are saved), then start this one. */
  const replace = async () => {
    if (!running) {
      setAskReplace(false);
      return void submit();
    }
    setReplacing(true);
    try {
      await api.endSession(running.session.id, { review: null, markComplete: false });
    } catch (err) {
      // Already ended elsewhere is fine; anything else stops here.
      if (!(err instanceof ApiError && (err.status === 409 || err.status === 404))) {
        toast(err instanceof Error ? err.message : 'Could not end the running session');
        setReplacing(false);
        return;
      }
    }
    qc.setQueryData(keys.active, { now: new Date().toISOString(), active: null });
    void qc.invalidateQueries({ queryKey: keys.pace });
    void qc.invalidateQueries({ queryKey: keys.me });
    void qc.invalidateQueries({ queryKey: keys.nodes });
    void qc.invalidateQueries({ queryKey: ['analytics'] });
    void qc.invalidateQueries({ queryKey: ['routines'] });
    setAskReplace(false);
    setReplacing(false);
    await submit();
  };

  const styleHelp =
    style === 'pomodoro'
      ? settings
        ? `${settings.pomodoro.workMin} min work, ${settings.pomodoro.shortBreakMin} min break, long break every ${settings.pomodoro.cyclesBeforeLong} cycles.`
        : ''
      : 'Straight through, no breaks. Stop whenever you like.';

  const durationHelp = duration === 'unlimited' ? 'Runs until you stop it.' : '';

  return (
    <>
      <Modal
        open={askFocus}
        onClose={() => answerFocus(false)}
        title="Open the focus screen?"
        actions={
          <>
            <Button variant="ghost" onClick={() => answerFocus(false, 'never')}>
              Never open it
            </Button>
            <Button variant="ghost" onClick={() => answerFocus(true, 'always')}>
              Always open it
            </Button>
            <Button onClick={() => answerFocus(false)}>No</Button>
            <Button variant="primary" onClick={() => answerFocus(true)}>
              Yes
            </Button>
          </>
        }
      >
        <p className="muted">Opens a new tab with a focus screen that just has the timer.</p>
      </Modal>
      <Modal
        open={open}
        onClose={onClose}
        title="Start a session"
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={go} loading={start.isPending} disabled={!subject}>
              {confirmCut ? 'Start anyway' : 'Start'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {lockSubject && node ? (
            <div className="field">
              <span className="field-label">Studying</span>
              <div className="start-locked-subject">
                <strong>{node.title}</strong>
                {lockedPath && <span className="muted">{lockedPath}</span>}
              </div>
            </div>
          ) : (
            <SubjectPicker
              nodes={nodes}
              routines={routineOptions}
              today={today}
              value={subject}
              onChange={setSubject}
            />
          )}

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
            <span className="field-hint">
              {styleHelp}
              {style === 'pomodoro' && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      // The lengths live in Settings, under Timer; the dialog closes on the way.
                      onClose();
                      navigate('/settings#timer');
                    }}
                  >
                    Change these
                  </button>
                </>
              )}
            </span>
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
              hint={plannedMinutes ? fmtLength(plannedMinutes) : undefined}
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
                  ? isTomorrow(endTime)
                    ? `Tomorrow, ${fmtLength(plannedMinutes)} from now.`
                    : `${fmtLength(plannedMinutes)} from now`
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

          <Toggle checked={showTimer} onChange={setShowTimer} label="Show the timer" />
        </div>
      </Modal>
      <Modal
        open={open && askReplace}
        onClose={() => setAskReplace(false)}
        title={`End ${running?.nodeTitle ?? 'the running session'} and start a new one?`}
        actions={
          <>
            <Button variant="ghost" onClick={() => setAskReplace(false)} disabled={replacing}>
              Keep it running
            </Button>
            <Button
              variant="primary"
              onClick={() => void replace()}
              loading={replacing || start.isPending}
            >
              End and start
            </Button>
          </>
        }
      >
        <p className="muted">Its time so far is kept.</p>
      </Modal>
    </>
  );
}
