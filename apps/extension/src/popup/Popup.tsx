import {
  advance,
  formatClock,
  viewTimer,
  type AdvanceOptions,
  type TimerEvent,
  type TimerState,
} from '@doloop/core';
import { ExternalLink, Pause, Play, SkipForward, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Glass } from '@doloop/ui';
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
  idle: 'Idle',
  ended: 'Ended',
};

function todayLocal(tz: string | null): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz ?? undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function Popup() {
  const [store, setStore] = useState<Stored | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ text: string; by: string } | null>(null);
  const [review, setReview] = useState<{ sessionId: string; distracted: string | null } | null>(
    null,
  );
  const [summary, setSummary] = useState<{ xp: number; phrase: string | null } | null>(null);
  const [startMode, setStartMode] = useState<'pomodoro' | 'unlimited'>('pomodoro');
  const [startNode, setStartNode] = useState('');

  useEffect(() => {
    void getAll().then(setStore);
    const off = onChange(() => void getAll().then(setStore));
    void send({ type: 'poll' }).catch(() => {});
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, []);

  // Daily quote, once per day (spec §12).
  useEffect(() => {
    if (!store?.connection || !store.snapshot) return;
    const mode = store.snapshot.settings?.quote.mode ?? 'quotes';
    if (mode === 'off') return;
    const today = todayLocal(store.snapshot.timezone);
    if (store.quoteShownOn === today) return;
    void send<{
      pick: { kind: string; item: { text: string; author?: string; citation?: string } } | null;
    }>({ type: 'quote' })
      .then((r) => {
        if (r.pick)
          setQuote({
            text: r.pick.item.text,
            by: r.pick.item.author ?? r.pick.item.citation ?? '',
          });
        void set({ quoteShownOn: today });
      })
      .catch(() => {});
  }, [store?.connection, store?.snapshot, store?.quoteShownOn]);

  const snapshot = store?.snapshot ?? null;
  const active = snapshot?.active ?? null;
  const settings = snapshot?.settings ?? null;

  const opts = useMemo<AdvanceOptions>(
    () => ({
      pomodoro: active?.session.pomodoroConfigSnapshot ??
        settings?.pomodoro ?? {
          workMin: 25,
          shortBreakMin: 5,
          longBreakMin: 15,
          cyclesBeforeLong: 4,
        },
      autoStartBreaks: settings?.pomodoro.autoStartBreaks ?? true,
      autoStartWork: settings?.pomodoro.autoStartWork ?? false,
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
    if (settings?.review.mode === 'off') await finish(null);
    else setReview({ sessionId: active.session.id, distracted: null });
  };

  const finish = async (rev: Record<string, unknown> | null) => {
    if (!active) return;
    const r = await run<{ xp: { total: number }; phrase: { text: string } | null }>({
      type: 'end',
      sessionId: active.session.id,
      review: rev,
    });
    setReview(null);
    if (r) setSummary({ xp: r.xp.total, phrase: r.phrase?.text ?? null });
  };

  const portal = store?.connection?.portalUrl ?? 'http://localhost:5173';
  const open = (path = '/') => chrome.tabs.create({ url: `${portal}${path}` });

  if (!store) return <div className="popup" />;

  if (!store.connection) {
    return (
      <div className="popup">
        <Glass className="card stack">
          <h1>Doloop</h1>
          <p>Sign in to the portal once and this remote connects automatically.</p>
          <Button variant="primary" onClick={() => open('/extension')}>
            Open Doloop <ExternalLink size={14} aria-hidden />
          </Button>
        </Glass>
      </div>
    );
  }

  if (summary) {
    return (
      <div className="popup">
        <Glass className="card stack">
          {summary.phrase && <h1>{summary.phrase}</h1>}
          <div className="xp">+{summary.xp} XP</div>
          <p>Session saved. Details and badges are in the portal.</p>
          <Button variant="primary" onClick={() => setSummary(null)}>
            Done
          </Button>
        </Glass>
      </div>
    );
  }

  if (review) {
    return (
      <div className="popup">
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
          <p className="hint">The full review is in the portal. Skipping never costs XP.</p>
          <div className="row end">
            <Button variant="ghost" onClick={() => finish({ skipped: true })} disabled={busy}>
              Skip
            </Button>
            <Button
              variant="primary"
              onClick={() => finish({ distracted: review.distracted })}
              loading={busy}
            >
              Save
            </Button>
          </div>
        </Glass>
      </div>
    );
  }

  if (store.idlePrompt && active && timer?.phase === 'idle') {
    return (
      <div className="popup">
        <Glass className="card stack">
          <h1>Still studying?</h1>
          <p>The work clock paused while you were away. Time since then is idle, not work.</p>
          <div className="row end">
            <Button
              onClick={() => event({ type: 'idle-answer', stillStudying: false })}
              disabled={busy}
            >
              No, end
            </Button>
            <Button
              variant="primary"
              onClick={() => event({ type: 'idle-answer', stillStudying: true })}
              loading={busy}
            >
              Yes, continue
            </Button>
          </div>
        </Glass>
      </div>
    );
  }

  if (active && timer && view) {
    const digits =
      timer.mode === 'unlimited'
        ? formatClock(view.workSeconds)
        : view.phaseRemainingSeconds !== null
          ? formatClock(view.phaseRemainingSeconds)
          : formatClock(view.phaseElapsedSeconds);
    const inBreak = timer.phase === 'short-break' || timer.phase === 'long-break';
    return (
      <div className="popup">
        <Glass className="card stack">
          <div className="phase">{PHASE[timer.phase]}</div>
          <h1 className="title">{active.nodeTitle}</h1>
          <div className="digits tabular">{timer.showTimer ? digits : '· · ·'}</div>
          <div className="row">
            <Chip tone="neutral">
              {timer.mode === 'pomodoro' ? `Cycle ${timer.cycle + 1}` : timer.mode}
            </Chip>
            <span className="hint tabular">{formatClock(view.workSeconds)} focused</span>
          </div>
          <div className="row">
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
        <button type="button" className="link" onClick={() => open('/')}>
          Open portal <ExternalLink size={12} aria-hidden />
        </button>
      </div>
    );
  }

  // Idle: start a session.
  const nodes = snapshot?.nodes ?? [];
  const plan = snapshot?.plan ?? [];
  const ordered = [
    ...plan.map((p) => nodes.find((n) => n.id === p.nodeId)).filter(Boolean),
    ...nodes.filter((n) => !plan.some((p) => p.nodeId === n.id)),
  ] as typeof nodes;
  const selected = startNode || ordered[0]?.id || '';

  return (
    <div className="popup">
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
                {n.title}
              </option>
            ))}
          </select>
        )}
        <div className="segmented">
          <button
            type="button"
            className="segmented-item"
            aria-pressed={startMode === 'pomodoro'}
            onClick={() => setStartMode('pomodoro')}
          >
            Pomodoro
          </button>
          <button
            type="button"
            className="segmented-item"
            aria-pressed={startMode === 'unlimited'}
            onClick={() => setStartMode('unlimited')}
          >
            Unlimited
          </button>
        </div>
        <Button
          variant="primary"
          disabled={!selected || busy}
          loading={busy}
          onClick={() => run({ type: 'start', nodeId: selected, mode: startMode })}
        >
          <Play size={14} aria-hidden /> Start
        </Button>
        {store.lastError && <p className="error">{store.lastError}</p>}
        {error && <p className="error">{error}</p>}
      </Glass>
      <button type="button" className="link" onClick={() => open('/')}>
        Open portal <ExternalLink size={12} aria-hidden />
      </button>
    </div>
  );
}
