import type {
  RoutineOccurrence,
  SessionDurationKind,
  SessionStyle,
  StudyNode,
} from '@komogon/core';
import { buildIndex, describeCut, modeForPlan, pathLabel, pomodoroCut } from '@komogon/core';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Hourglass,
  Minus,
  Play,
  Plus,
  Timer,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Modal, Segmented, Toggle, useToast } from '@komogon/ui';
import { api, ApiError } from '../lib/api';
import { fmtTime } from '../lib/format';
import { isPhone } from '../lib/device';
import { FOCUS_PATH, openFocusTab } from '../lib/focus-tab';
import { NARROW_QUERY, useMediaQuery } from '../lib/media';
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

import { Popout } from './Popout';
import { SubjectPages } from './SubjectPages';
import {
  describeSubject,
  nodeKey,
  routineKey,
  SubjectButton,
  useSubjectIndex,
} from './SubjectPicker';

function fmtLength(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** The phone's minutes control: steps of 5 under an hour and 15 from there, or type a number. */
function MinutesStepper({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  const down = n > 60 ? 15 : 5;
  const up = n >= 60 ? 15 : 5;
  return (
    <div className="ss-stepper" role="group" aria-label="Minutes">
      <button
        type="button"
        className="ss-step"
        aria-label={`${down} minutes less`}
        disabled={n <= 5}
        onClick={() => onChange(String(Math.max(5, n - down)))}
      >
        <Minus size={18} aria-hidden />
      </button>
      <label className="ss-step-value">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={1440}
          className="ss-step-input tabular"
          aria-label="Minutes"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="ss-step-unit">min</span>
      </label>
      <button
        type="button"
        className="ss-step"
        aria-label={`${up} minutes more`}
        disabled={n >= 1440}
        onClick={() => onChange(String(Math.min(1440, n + up)))}
      >
        <Plus size={18} aria-hidden />
      </button>
    </div>
  );
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
  /**
   * On a phone the session is a screen of its own, and what to study is a page pushed over
   * it; on a computer it stays the card with the picker inside.
   */
  const narrow = useMediaQuery(NARROW_QUERY);
  const phone = useMemo(() => isPhone(), []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const subjectRowRef = useRef<HTMLButtonElement>(null);
  const subjectIndex = useSubjectIndex(nodes);
  // Back from the picker, focus returns to the row that opened it, once the form is no
  // longer inert under the page.
  const pickerWasOpen = useRef(false);
  useEffect(() => {
    if (pickerWasOpen.current && !pickerOpen) subjectRowRef.current?.focus({ preventScroll: true });
    pickerWasOpen.current = pickerOpen;
  }, [pickerOpen]);

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
    setPickerOpen(false);
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
          navigate(mode === 'always' ? openAndReport() : '/');
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

  /**
   * Open the focus screen: on a computer its own tab, opened on the click itself (which is
   * what lets a tab open at all); on a phone this tab. Returns where this tab goes next.
   */
  const openAndReport = (): string => {
    const r = openFocusTab();
    if (r === 'blocked') toast('Allow pop-ups to open the focus screen in its own tab.');
    if (r === 'focused') toast('The focus screen is open in another tab.');
    return r === 'here' ? FOCUS_PATH : '/';
  };

  /** The prompt's answer: open this time or not, and optionally make that the rule. */
  const answerFocus = (open: boolean, remember?: 'always' | 'never') => {
    setAskFocus(false);
    const next = open ? openAndReport() : '/';
    if (remember)
      void update
        .mutateAsync({ focusScreen: { openOnStart: remember } })
        .catch(() => toast('Could not save that. Change it in Settings.'));
    navigate(next);
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

  const styleField = (
    <div className="field">
      <span className="field-label">How you work</span>
      <Segmented
        ariaLabel="Session style"
        className={narrow ? 'ss-seg' : undefined}
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
  );

  const lengthChoice = (
    <Segmented
      ariaLabel="Session length"
      className={narrow ? 'ss-seg' : undefined}
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
  );

  const untilHint =
    plannedMinutes && plannedMinutes > 0
      ? isTomorrow(endTime)
        ? `Tomorrow, ${fmtLength(plannedMinutes)} from now.`
        : `${fmtLength(plannedMinutes)} from now`
      : undefined;

  const cutLine = cutMessage && (
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
  );

  const chosen = describeSubject(subject, subjectIndex, routineOptions);

  /** Back from the picker page to the session. */
  const closePicker = () => setPickerOpen(false);

  // On a phone, Escape and the system back gesture step back out of the picker first.
  const closeSheet = () => (narrow && pickerOpen ? closePicker() : onClose());

  /** The computer's length pill: how long, in a word or two. */
  const lengthLabel =
    duration === 'unlimited'
      ? 'Unlimited'
      : duration === 'for'
        ? plannedMinutes
          ? fmtLength(plannedMinutes)
          : 'For a while'
        : endTime
          ? `Until ${fmtTime(todayAtLocal(endTime))}`
          : 'Until a time';

  /** One choice in a pill's pop-out on a computer, ticked when it is the one. */
  const menuOption = (on: boolean, title: string, sub: string | undefined, pick: () => void) => (
    <li key={title}>
      <button type="button" className="start-option" aria-pressed={on} onClick={pick}>
        <span className="start-option-text">
          <span>{title}</span>
          {sub && <span className="start-option-sub">{sub}</span>}
        </span>
        {on && <Check size={16} aria-hidden className="start-option-check" />}
      </button>
    </li>
  );

  const phoneForm = (
    <div className="ss-form" inert={pickerOpen}>
      {lockSubject && node ? (
        <div className="ss-subject is-locked">
          <span className="ss-subject-text">
            <span className="ss-subject-label">Studying</span>
            <span className="ss-subject-title">{node.title}</span>
            {lockedPath && <span className="ss-subject-where">{lockedPath}</span>}
          </span>
        </div>
      ) : (
        <button
          ref={subjectRowRef}
          type="button"
          className={`ss-subject${chosen ? '' : ' is-empty'}`}
          onClick={() => setPickerOpen(true)}
          aria-haspopup="dialog"
        >
          <span className="ss-subject-text">
            <span className="ss-subject-label">Studying</span>
            <span className="ss-subject-title">{chosen?.title ?? 'Choose what to study'}</span>
            {chosen?.where && <span className="ss-subject-where">{chosen.where}</span>}
          </span>
          <ChevronRight size={20} aria-hidden className="ss-subject-chevron" />
        </button>
      )}

      {styleField}

      <div className="field">
        <span className="field-label">How long</span>
        {lengthChoice}
        {duration === 'unlimited' && <span className="field-hint">{durationHelp}</span>}
        {duration === 'for' && (
          <>
            <MinutesStepper
              value={minutes}
              onChange={(v) => {
                setMinutes(v);
                setConfirmCut(null);
              }}
            />
            {/* Over an hour, the length in hours too; "60 min" already says "1 h". */}
            {plannedMinutes && plannedMinutes > 60 ? (
              <span className="field-hint">{fmtLength(plannedMinutes)}</span>
            ) : null}
          </>
        )}
        {duration === 'until' && (
          <>
            <input
              type="time"
              className="input ss-time"
              aria-label="Stop at"
              value={endTime}
              onChange={(e) => {
                setEndTime(e.target.value);
                setConfirmCut(null);
              }}
            />
            {untilHint && <span className="field-hint">{untilHint}</span>}
          </>
        )}
      </div>

      {cutLine}

      <Toggle checked={showTimer} onChange={setShowTimer} label="Show the timer" />
    </div>
  );

  const phonePicker = !lockSubject && (
    <div className={`ss-cover${pickerOpen ? ' is-open' : ''}`} inert={!pickerOpen}>
      <SubjectPages
        index={subjectIndex}
        routines={routineOptions}
        today={today}
        value={subject}
        onPick={(v) => {
          setSubject(v);
          setConfirmCut(null);
          closePicker();
        }}
        onBack={closePicker}
        active={pickerOpen}
      />
    </div>
  );

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
        <p className="muted">
          {phone
            ? 'A screen with just the timer.'
            : 'Opens a new tab with a focus screen that just has the timer.'}
        </p>
      </Modal>
      {narrow ? (
        <Modal
          open={open}
          onClose={closeSheet}
          title="Start a session"
          phone="full"
          className="ss-sheet"
          cover={phonePicker}
          actions={
            <div className="ss-actions" inert={pickerOpen}>
              <Button
                variant="primary"
                onClick={go}
                loading={start.isPending}
                disabled={!subject}
                className="ss-start"
              >
                {confirmCut ? 'Start anyway' : 'Start'}
              </Button>
            </div>
          }
        >
          {phoneForm}
        </Modal>
      ) : (
        <Modal
          open={open}
          onClose={onClose}
          title="Start a session"
          className="start-dialog"
          actions={
            <Button
              variant="primary"
              size="lg"
              className="start-go"
              onClick={go}
              loading={start.isPending}
              disabled={!subject}
            >
              <Play size={16} aria-hidden className="start-go-icon" />
              {confirmCut ? 'Start anyway' : 'Start'}
            </Button>
          }
        >
          <div className="start-body">
            {lockSubject && node ? (
              <div className="start-subject is-locked">
                <span className="start-subject-text">
                  <span className="start-subject-title truncate">{node.title}</span>
                  {lockedPath && <span className="start-subject-where truncate">{lockedPath}</span>}
                </span>
              </div>
            ) : (
              <SubjectButton
                nodes={nodes}
                routines={routineOptions}
                today={today}
                value={subject}
                onChange={setSubject}
              />
            )}

            {/* How it runs, a pill each; the first two pop out their choices. */}
            <div className="start-pills">
              <Popout
                label="How you work"
                triggerClassName="start-pill"
                className="is-menu"
                width={260}
                room={200}
                trigger={
                  <>
                    <Timer size={15} aria-hidden />
                    {style === 'pomodoro' ? 'Pomodoro' : 'Continuous'}
                    <ChevronDown size={14} aria-hidden className="start-pill-chevron" />
                  </>
                }
              >
                {(close) => (
                  <ul className="start-menu">
                    {menuOption(
                      style === 'pomodoro',
                      'Pomodoro',
                      settings
                        ? `${settings.pomodoro.workMin} min work, ${settings.pomodoro.shortBreakMin} min break`
                        : undefined,
                      () => {
                        setStyle('pomodoro');
                        setConfirmCut(null);
                        close();
                      },
                    )}
                    {menuOption(style === 'continuous', 'Continuous', undefined, () => {
                      setStyle('continuous');
                      setConfirmCut(null);
                      close();
                    })}
                    <li className="start-menu-foot">
                      <button
                        type="button"
                        className="start-option is-link"
                        onClick={() => {
                          // The lengths live in Settings, under Timer; the dialog closes on the way.
                          onClose();
                          navigate('/settings#timer');
                        }}
                      >
                        Change lengths
                      </button>
                    </li>
                  </ul>
                )}
              </Popout>

              <Popout
                label="How long"
                triggerClassName="start-pill"
                className="is-menu"
                width={260}
                room={240}
                trigger={
                  <>
                    <Hourglass size={15} aria-hidden />
                    {lengthLabel}
                    <ChevronDown size={14} aria-hidden className="start-pill-chevron" />
                  </>
                }
              >
                {(close) => (
                  <div className="start-length">
                    <ul className="start-menu">
                      {menuOption(duration === 'unlimited', 'Unlimited', undefined, () => {
                        setDuration('unlimited');
                        setConfirmCut(null);
                        close();
                      })}
                      {menuOption(duration === 'for', 'For a while', undefined, () => {
                        setDuration('for');
                        setConfirmCut(null);
                      })}
                      {menuOption(duration === 'until', 'Until a time', undefined, () => {
                        setDuration('until');
                        setConfirmCut(null);
                      })}
                    </ul>
                    {duration === 'for' && (
                      <div className="start-length-field">
                        <MinutesStepper
                          value={minutes}
                          onChange={(v) => {
                            setMinutes(v);
                            setConfirmCut(null);
                          }}
                        />
                      </div>
                    )}
                    {duration === 'until' && (
                      <div className="start-length-field">
                        <input
                          type="time"
                          className="input"
                          aria-label="Stop at"
                          value={endTime}
                          onChange={(e) => {
                            setEndTime(e.target.value);
                            setConfirmCut(null);
                          }}
                        />
                        {untilHint && <span className="field-hint">{untilHint}</span>}
                      </div>
                    )}
                  </div>
                )}
              </Popout>

              <button
                type="button"
                className={`start-pill${showTimer ? '' : ' is-off'}`}
                aria-pressed={showTimer}
                onClick={() => setShowTimer(!showTimer)}
              >
                {showTimer ? <Eye size={15} aria-hidden /> : <EyeOff size={15} aria-hidden />}
                {showTimer ? 'Timer shown' : 'Timer hidden'}
              </button>
            </div>

            {cutLine}
          </div>
          {/* Last in the card so the keys reach it after the form; drawn at the top right. */}
          <button type="button" className="start-close" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </Modal>
      )}
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
