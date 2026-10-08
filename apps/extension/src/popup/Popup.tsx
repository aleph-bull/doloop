import {
  advance,
  badgeByKey,
  DEFAULT_BACKGROUND_ID,
  DEFAULT_SETTINGS,
  describeCut,
  formatClock,
  modeForPlan,
  pathLabel,
  pomodoroCut,
  quoteSlot,
  viewTimer,
  type AdvanceOptions,
  type RoutineOccurrence,
  type SessionDurationKind,
  type SessionStyle,
  type TimerEvent,
  type TimerState,
} from '@komogon/core';
import {
  Check,
  ExternalLink,
  Gift,
  ListChecks,
  Maximize2,
  Pause,
  Play,
  SkipForward,
  Square,
  Timer,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  applyUserTheme,
  Backdrop,
  Button,
  Chip,
  fireConfetti,
  fireRewardBurst,
  Glass,
  resolveExtensionBackdrop,
  Segmented,
  Toggle,
} from '@komogon/ui';
import { resolveTheme as resolveThemeSafe } from '@komogon/ui';
import { getAll, onChange, set, type Stored } from '../lib/storage';

type Reply<T> = { ok: true; result: T } | { ok: false; error: string };

function send<T = unknown>(msg: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (reply: Reply<T>) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!reply) return reject(new Error('No reply'));
      if (reply.ok) resolve(reply.result);
      else reject(new Error(reply.error));
    });
  });
}

const PHASE: Record<TimerState['phase'], string> = {
  work: 'Focus',
  'short-break': 'Short break',
  'long-break': 'Long break',
  paused: 'Paused',
  ended: 'Ended',
};

type Tab = NonNullable<Stored['tab']>;

function fmtLength(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
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

/** The instant a given number of minutes from now. */
function isoInMinutes(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString();
}

function minutesUntilLocal(time: string): number {
  return Math.round((Date.parse(todayAtLocal(time)) - Date.now()) / 60_000);
}

/** "Mon 3 Mar" for an overdue occurrence, so a backfill says which day it lands on. */
function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function Popup() {
  const [store, setStore] = useState<Stored | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ text: string; by: string } | null>(null);
  const [review, setReview] = useState<{
    sessionId: string;
    distracted: string | null;
    /** Tick the routine off at the end; null when the session is for a task. */
    tick: boolean | null;
  } | null>(null);
  const [summary, setSummary] = useState<{
    workMinutes: number;
    phrase: string | null;
    badges: string[];
    endedEarly: boolean;
    routineTicked: boolean;
  } | null>(null);
  const [style, setStyle] = useState<SessionStyle>('pomodoro');
  const [duration, setDuration] = useState<SessionDurationKind>('unlimited');
  const [minutes, setMinutes] = useState('60');
  const [endTime, setEndTime] = useState(() => plusMinutesLocalTime(60));
  /** Set when the chosen length cuts a block short; cleared by confirming. */
  const [confirmCut, setConfirmCut] = useState<string | null>(null);
  const [startNode, setStartNode] = useState('');
  const [tab, setTab] = useState<Tab>('focus');
  /** Transient feedback under the routine list after a tick. */
  const [tickNote, setTickNote] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState<string | null>(null);

  useEffect(() => {
    void getAll().then((s) => {
      setStore(s);
      if (s.tab) setTab(s.tab);
    });
    const off = onChange(() => void getAll().then(setStore));
    void send({ type: 'poll' }).catch(() => {});
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, []);

  const snapshot = store?.snapshot ?? null;
  const active = snapshot?.active ?? null;
  const settings = snapshot?.settings ?? null;

  // The quote of the moment, shown once per six-hour slot (spec §12).
  useEffect(() => {
    if (!store?.connection || !store.snapshot) return;
    const mode = store.snapshot.settings?.quote.mode ?? 'quotes';
    if (mode === 'off') return;
    const tz = store.snapshot.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const slot = quoteSlot(new Date(), tz).key;
    if (store.quoteShownOn === slot) return;
    void send<{
      pick: { kind: string; item: { text: string; author?: string; citation?: string } } | null;
    }>({ type: 'quote' })
      .then((r) => {
        if (r.pick)
          setQuote({
            text: r.pick.item.text,
            by: r.pick.item.author ?? r.pick.item.citation ?? '',
          });
        void set({ quoteShownOn: slot });
      })
      .catch(() => {});
  }, [store?.connection, store?.snapshot, store?.quoteShownOn]);

  // A session's end throws confetti in the popup too, more when it unlocked something.
  useEffect(() => {
    if (!summary) return;
    if (settings?.effects.confetti === false) return;
    fireConfetti({ count: summary.badges.length > 0 ? 90 : 50, durationMs: 1500 });
  }, [summary, settings?.effects.confetti]);

  const nodesById = useMemo(
    () => new Map((snapshot?.nodes ?? []).map((n) => [n.id, n] as const)),
    [snapshot?.nodes],
  );

  // Same theme, accent, background, and panel surface as the portal.
  useEffect(() => {
    if (settings) applyUserTheme(settings);
  }, [settings]);
  const resolvedTheme = settings ? resolveThemeSafe(settings.theme.mode) : 'dark';
  const choice = settings
    ? resolveExtensionBackdrop(settings.theme, store?.customBackground?.dataUrl ?? null)
    : { backgroundId: DEFAULT_BACKGROUND_ID, customImageUrl: null };
  const backdrop = (
    <Backdrop
      backgroundId={choice.backgroundId}
      theme={resolvedTheme}
      customImageUrl={choice.customImageUrl}
      assetBase={store?.connection?.portalUrl ?? 'http://localhost:5173'}
    />
  );

  const opts = useMemo<AdvanceOptions>(
    () => ({
      pomodoro:
        active?.session.pomodoroConfigSnapshot ?? settings?.pomodoro ?? DEFAULT_SETTINGS.pomodoro,
      autoStartBreaks:
        settings?.pomodoro.autoStartBreaks ?? DEFAULT_SETTINGS.pomodoro.autoStartBreaks,
      autoStartWork: settings?.pomodoro.autoStartWork ?? DEFAULT_SETTINGS.pomodoro.autoStartWork,
    }),
    [active?.session.pomodoroConfigSnapshot, settings?.pomodoro],
  );

  const nowIso = new Date(now).toISOString();
  const timer = active ? advance(active.timer, nowIso, opts) : null;
  const view = timer ? viewTimer(timer, nowIso) : null;

  const run = async <T = unknown,>(msg: Record<string, unknown>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await send<T>(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const event = (e: TimerEvent) =>
    active && run({ type: 'event', sessionId: active.session.id, event: e });

  const stop = async () => {
    if (!active || !timer) return;
    if (timer.phase === 'work' || timer.phase === 'short-break' || timer.phase === 'long-break')
      await event({ type: 'pause' });
    // With reviews off there is nothing to ask about a task; a routine still asks to tick.
    const routineSession = active.session.routineId !== null;
    if (settings?.review.mode === 'off' && !routineSession) await finish(null, false);
    else
      setReview({
        sessionId: active.session.id,
        distracted: null,
        tick: routineSession ? true : null,
      });
  };

  const finish = async (rev: Record<string, unknown> | null, markComplete: boolean) => {
    if (!active) return;
    const r = await run<{
      session: { workSeconds: number };
      phrase: { text: string } | null;
      badges: string[];
      endedEarly?: boolean;
      routineTicked?: boolean;
    }>({
      type: 'end',
      sessionId: active.session.id,
      review: rev,
      markComplete,
    });
    setReview(null);
    if (r)
      setSummary({
        workMinutes: Math.round(r.session.workSeconds / 60),
        phrase: r.phrase?.text ?? null,
        badges: r.badges ?? [],
        endedEarly: r.endedEarly ?? false,
        routineTicked: r.routineTicked ?? false,
      });
  };

  const portal = store?.connection?.portalUrl ?? 'http://localhost:5173';
  const open = (path = '/') => chrome.tabs.create({ url: `${portal}${path}` });

  /** The focus screen, in the tab it is already in if there is one, else a new one. */
  const openFocus = async () => {
    const url = `${portal}/focus`;
    await focusTab(url);
  };
  /** After a start: the popup cannot ask, so "ask" opens it and only "never" does not. */
  const openFocusAfterStart = () => {
    if (settings?.focusScreen?.openOnStart === 'never') return;
    void openFocus();
  };
  const focusTab = async (url: string) => {
    try {
      const [existing] = await chrome.tabs.query({ url: `${url}*` });
      if (existing?.id !== undefined) {
        await chrome.tabs.update(existing.id, { active: true });
        await chrome.windows.update(existing.windowId, { focused: true });
        return;
      }
    } catch {
      /* no tabs permission for that pattern; fall through and open one */
    }
    await chrome.tabs.create({ url });
  };

  const goTab = (next: Tab) => {
    setTab(next);
    setError(null);
    void set({ tab: next });
  };

  if (!store) return <div className="popup" />;

  if (!store.connection) {
    return (
      <div className="popup">
        <Glass className="card stack">
          <h1>Komogon</h1>
          <p>Sign in to the portal once and this remote connects automatically.</p>
          <Button variant="primary" onClick={() => open('/extension')}>
            Open Komogon <ExternalLink size={14} aria-hidden />
          </Button>
        </Glass>
      </div>
    );
  }

  /* ---------- Moments that take over the whole popup ---------- */

  if (summary) {
    return (
      <div className="popup">
        {backdrop}
        <Glass className="card stack">
          {summary.phrase && <h1>{summary.phrase}</h1>}
          <div className="xp">{fmtLength(summary.workMinutes)} focused</div>
          {summary.endedEarly && <p>Ended early. The minutes still count.</p>}
          {summary.routineTicked && <p>Ticked off.</p>}
          {summary.badges.length > 0 && (
            <p className="good">
              Achievement unlocked: {summary.badges.map((k) => badgeByKey(k)?.name ?? k).join(', ')}
            </p>
          )}
          <p>Session saved. Details are in the portal.</p>
          <Button variant="primary" onClick={() => setSummary(null)}>
            Done
          </Button>
        </Glass>
      </div>
    );
  }

  if (review && settings?.review.mode === 'off') {
    // Reviews are off, but a routine session still gets asked whether it is done.
    return (
      <div className="popup">
        {backdrop}
        <Glass className="card stack">
          <h1>Done with {active?.nodeTitle ?? 'it'}?</h1>
          <p className="hint">
            The minutes are saved either way. Choose Not yet to keep it on your list.
          </p>
          <div className="row end">
            <Button variant="ghost" onClick={() => finish(null, false)} disabled={busy}>
              Not yet
            </Button>
            <Button variant="primary" onClick={() => finish(null, true)} loading={busy}>
              Tick it off
            </Button>
          </div>
        </Glass>
      </div>
    );
  }

  if (review) {
    const markComplete = review.tick === true;
    return (
      <div className="popup">
        {backdrop}
        <Glass className="card stack">
          <h1>Distracted?</h1>
          <div className="row">
            {(['no', 'a-little', 'a-lot'] as const).map((v) => (
              <Button
                key={v}
                variant={review.distracted === v ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setReview({ ...review, distracted: v })}
              >
                {v === 'no' ? 'No' : v === 'a-little' ? 'A little' : 'A lot'}
              </Button>
            ))}
          </div>
          {review.tick !== null && (
            <Toggle
              checked={review.tick}
              onChange={(tick) => setReview({ ...review, tick })}
              label={`Tick off ${active?.nodeTitle ?? 'the routine'}`}
            />
          )}
          <p className="hint">The full review is in the app. It is fine to skip.</p>
          <div className="row end">
            <Button
              variant="ghost"
              onClick={() => finish({ skipped: true }, markComplete)}
              disabled={busy}
            >
              Skip
            </Button>
            <Button
              variant="primary"
              onClick={() => finish({ distracted: review.distracted }, markComplete)}
              loading={busy}
            >
              Save
            </Button>
          </div>
        </Glass>
      </div>
    );
  }

  /* ---------- Focus tab ---------- */

  const runningView = () => {
    if (!active || !timer || !view) return null;
    const digits =
      timer.mode === 'unlimited'
        ? formatClock(view.workSeconds)
        : view.phaseRemainingSeconds !== null
          ? formatClock(view.phaseRemainingSeconds)
          : formatClock(view.phaseElapsedSeconds);
    const inBreak = timer.phase === 'short-break' || timer.phase === 'long-break';
    const path = active.session.nodeId ? pathLabel(nodesById, active.session.nodeId) : 'Routine';
    return (
      <Glass className="card stack">
        <div className="phase">{PHASE[timer.phase]}</div>
        {path && <p className="hint">{path}</p>}
        <h1 className="title">{active.nodeTitle}</h1>
        <div className="digits tabular">{timer.showTimer ? digits : '· · ·'}</div>
        <div className="row">
          <Chip tone="neutral">
            {timer.mode === 'pomodoro' ? `Cycle ${timer.cycle + 1}` : timer.mode}
          </Chip>
          <span className="hint tabular">{formatClock(view.workSeconds)} focused</span>
        </div>
        <div className="row">
          <Button
            size="sm"
            variant="ghost"
            icon
            aria-label="Open the focus screen"
            title="Open the focus screen"
            onClick={() => void openFocus()}
          >
            <Maximize2 size={14} aria-hidden />
          </Button>
          {(timer.phase === 'work' || inBreak) && (
            <Button size="sm" onClick={() => event({ type: 'pause' })} disabled={busy}>
              <Pause size={14} aria-hidden /> Pause
            </Button>
          )}
          {timer.phase === 'paused' && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => event({ type: 'resume' })}
              disabled={busy}
            >
              <Play size={14} aria-hidden /> Resume
            </Button>
          )}
          {timer.mode === 'pomodoro' &&
            (inBreak || (timer.phase === 'paused' && timer.resumePhase !== 'work')) && (
              <Button size="sm" onClick={() => event({ type: 'skip-break' })} disabled={busy}>
                <SkipForward size={14} aria-hidden /> Skip
              </Button>
            )}
          <span className="grow" />
          <Button size="sm" variant="danger" onClick={stop} disabled={busy}>
            <Square size={12} aria-hidden /> End
          </Button>
        </div>
        {error && <p className="error">{error}</p>}
      </Glass>
    );
  };

  const nodes = (snapshot?.nodes ?? []).filter((n) => n.kind !== 'course' && !n.completedAt);
  const plan = snapshot?.plan ?? [];
  const ordered = [
    ...plan.map((p) => nodes.find((n) => n.id === p.nodeId)).filter(Boolean),
    ...nodes.filter((n) => !plan.some((p) => p.nodeId === n.id)),
  ] as typeof nodes;
  const selected = startNode || ordered[0]?.id || '';

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

  const plannedEndAt = (): string | null => {
    if (duration === 'unlimited') return null;
    if (duration === 'until') return todayAtLocal(endTime);
    return isoInMinutes(plannedMinutes ?? 0);
  };

  const startSession = async () => {
    if (!selected) return;
    if (plannedMinutes !== null && plannedMinutes <= 0) {
      setError('Pick a length in the future');
      return;
    }
    const end = plannedEndAt();
    const started = await run({
      type: 'start',
      nodeId: selected,
      mode: modeForPlan({ style, plannedEndAt: end }),
      plannedEndAt: end,
    });
    setConfirmCut(null);
    if (started) openFocusAfterStart();
  };

  const go = () => {
    // Confirm once when the length does not land on a block boundary.
    if (cutMessage && confirmCut !== cutMessage) return setConfirmCut(cutMessage);
    void startSession();
  };

  const startView = () => (
    <>
      {quote && (
        <Glass className="card quote">
          <p>{quote.text}</p>
          <p className="hint">{quote.by}</p>
        </Glass>
      )}
      <Glass className="card stack">
        <h1>Start a session</h1>
        {ordered.length === 0 ? (
          <p className="hint">No tasks yet. Add one in the portal.</p>
        ) : (
          <select
            className="select"
            value={selected}
            onChange={(e) => setStartNode(e.target.value)}
            aria-label="Task"
          >
            {ordered.map((n) => (
              <option key={n.id} value={n.id}>
                {pathLabel(nodesById, n.id)
                  ? `${pathLabel(nodesById, n.id)} · ${n.title}`
                  : n.title}
              </option>
            ))}
          </select>
        )}

        <Segmented
          ariaLabel="Session style"
          value={style}
          onChange={(v) => {
            setStyle(v);
            setConfirmCut(null);
          }}
          options={[
            { value: 'pomodoro', label: 'Pomodoro' },
            { value: 'continuous', label: 'Continuous' },
          ]}
        />
        <Segmented
          ariaLabel="Session length"
          value={duration}
          onChange={(v) => {
            setDuration(v);
            setConfirmCut(null);
          }}
          options={[
            { value: 'unlimited', label: 'Open' },
            { value: 'for', label: 'For' },
            { value: 'until', label: 'Until' },
          ]}
        />

        {duration === 'for' && (
          <label className="inline-field">
            <span className="hint">Minutes</span>
            <input
              className="select"
              type="number"
              min={1}
              max={1440}
              step={5}
              value={minutes}
              onChange={(e) => {
                setMinutes(e.target.value);
                setConfirmCut(null);
              }}
            />
          </label>
        )}
        {duration === 'until' && (
          <label className="inline-field">
            <span className="hint">Stop at</span>
            <input
              className="select"
              type="time"
              value={endTime}
              onChange={(e) => {
                setEndTime(e.target.value);
                setConfirmCut(null);
              }}
            />
          </label>
        )}
        {plannedMinutes !== null && plannedMinutes > 0 && (
          <p className="hint">{fmtLength(plannedMinutes)} of session.</p>
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

        <Button variant="primary" disabled={!selected || busy} loading={busy} onClick={go}>
          <Play size={14} aria-hidden /> {confirmCut ? 'Start anyway' : 'Start'}
        </Button>
        {store.lastError && <p className="error">{store.lastError}</p>}
        {error && <p className="error">{error}</p>}
      </Glass>
    </>
  );

  /* ---------- Routines tab ---------- */

  const routines = snapshot?.routines ?? null;

  const tickRoutine = async (o: RoutineOccurrence) => {
    setTickNote(null);
    const r = await run<{ xpAwarded: number; badges: string[] }>({
      type: 'tick-routine',
      routineId: o.routineId,
      date: o.date,
    });
    if (!r) return;
    const parts = [`Ticked off ${o.title}`];
    if (r.xpAwarded > 0) parts.push(`+${r.xpAwarded} XP`);
    if (r.badges.length) parts.push(`badge unlocked: ${r.badges.join(', ')}`);
    setTickNote(parts.join(' · '));
  };

  /** Run a routine under the timer, for as long as it says it takes, then show the timer. */
  const startRoutine = async (o: RoutineOccurrence) => {
    setTickNote(null);
    const est = o.estimatedMinutes;
    const workMin = settings?.pomodoro.workMin ?? DEFAULT_SETTINGS.pomodoro.workMin;
    const end = isoInMinutes(est);
    const started = await run({
      type: 'start',
      routineId: o.routineId,
      routineDate: o.date,
      mode: modeForPlan({ style: est < workMin ? 'continuous' : 'pomodoro', plannedEndAt: end }),
      plannedEndAt: end,
    });
    if (started) {
      goTab('focus');
      openFocusAfterStart();
    }
  };

  const routinesView = () => {
    if (!routines) {
      return (
        <Glass className="card stack">
          <h1>Routines</h1>
          <p className="hint">Loading your routines…</p>
        </Glass>
      );
    }
    return (
      <Glass className="card stack">
        <h1>Routines</h1>
        {routines.due.length === 0 ? (
          <p className="hint">Nothing outstanding. Every routine due is ticked off.</p>
        ) : (
          <ul className="list">
            {routines.due.map((o) => (
              <li className="list-row" key={`${o.routineId}:${o.date}`}>
                <div className="list-main">
                  <span className="list-title">{o.title}</span>
                  <span className="hint">
                    {o.estimatedMinutes} min
                    {o.overdue ? ` · from ${shortDate(o.date)}` : ''}
                  </span>
                </div>
                {!active && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon
                    aria-label={`Start a session for ${o.title}`}
                    title="Start a session"
                    onClick={() => startRoutine(o)}
                    disabled={busy}
                  >
                    <Play size={14} aria-hidden />
                  </Button>
                )}
                <Button size="sm" onClick={() => tickRoutine(o)} disabled={busy}>
                  <Check size={14} aria-hidden /> Tick
                </Button>
              </li>
            ))}
          </ul>
        )}
        {tickNote && <p className="good">{tickNote}</p>}
        {error && <p className="error">{error}</p>}
      </Glass>
    );
  };

  /* ---------- Rewards tab ---------- */

  const rewards = snapshot?.rewards ?? null;

  const redeem = async (id: string, name: string, emoji: string | null) => {
    setRedeemed(null);
    const r = await run<{ spent: number }>({ type: 'redeem', rewardId: id });
    if (!r) return;
    fireRewardBurst({ glyphs: emoji ? [emoji, '🎉', '✨'] : undefined });
    setRedeemed(`${name} redeemed for ${r.spent} XP. Go enjoy it.`);
  };

  const rewardsView = () => {
    if (!rewards) {
      return (
        <Glass className="card stack">
          <h1>Rewards</h1>
          <p className="hint">Loading your shelf…</p>
        </Glass>
      );
    }
    const items = rewards.items.filter((r) => !r.archived);
    return (
      <Glass className="card stack">
        <div className="row">
          <h1 className="grow">Rewards</h1>
          <span className="balance tabular">{rewards.xp} XP</span>
        </div>
        {items.length === 0 ? (
          <p className="hint">No rewards yet. Set one up in the portal and spend XP on it.</p>
        ) : (
          <ul className="list">
            {items.map((r) => (
              <li className="list-row" key={r.id}>
                <span className="reward-emoji" aria-hidden>
                  {r.emoji ?? '🎁'}
                </span>
                <div className="list-main">
                  <span className="list-title">{r.name}</span>
                  <span className="hint">
                    {r.costXp} XP
                    {r.availableOn
                      ? ` · back on ${shortDate(r.availableOn)}`
                      : r.affordable
                        ? ''
                        : ` · ${r.costXp - rewards.xp} to go`}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant={r.redeemable ? 'primary' : 'secondary'}
                  disabled={!r.redeemable || busy}
                  onClick={() => redeem(r.id, r.name, r.emoji)}
                >
                  <Gift size={14} aria-hidden /> Redeem
                </Button>
              </li>
            ))}
          </ul>
        )}
        {redeemed && <p className="good">{redeemed}</p>}
        {error && <p className="error">{error}</p>}
      </Glass>
    );
  };

  /* ---------- Shell ---------- */

  const tabs: Array<{ id: Tab; label: string; icon: typeof Timer }> = [
    { id: 'focus', label: 'Focus', icon: Timer },
    { id: 'routines', label: 'Routines', icon: ListChecks },
    { id: 'rewards', label: 'Rewards', icon: Gift },
  ];
  const dueCount = routines?.due.length ?? 0;

  return (
    <div className="popup">
      {backdrop}
      <div className="content">
        {tab === 'focus' && (active ? runningView() : startView())}
        {tab === 'routines' && routinesView()}
        {tab === 'rewards' && rewardsView()}
        <button type="button" className="link" onClick={() => open('/')}>
          Open portal <ExternalLink size={12} aria-hidden />
        </button>
      </div>
      <nav className="tabs" aria-label="Sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className="tab"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => goTab(t.id)}
          >
            <t.icon size={16} aria-hidden />
            {t.label}
            {t.id === 'routines' && dueCount > 0 && <span className="tab-count">{dueCount}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
