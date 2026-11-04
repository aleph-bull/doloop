import {
  advance,
  badgeByKey,
  DEFAULT_SETTINGS,
  describeCut,
  formatClock,
  isEndedEarly,
  isWithheld,
  levelProgress,
  modeForPlan,
  pomodoroCut,
  quoteSlot,
  viewTimer,
  type AdvanceOptions,
  type RewardView,
  type RoutineOccurrence,
  type SessionDurationKind,
  type SessionStyle,
  type TimerEvent,
  type TimerState,
} from '@komogon/core';
import {
  Award,
  CalendarCheck,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Flame,
  Gift,
  Hourglass,
  ListChecks,
  Maximize2,
  Minus,
  Pause,
  Play,
  Plus,
  SkipForward,
  Sparkles,
  Square,
  Timer,
  TrendingUp,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  Chip,
  fireConfetti,
  fireRewardBurst,
  Glass,
  LogoMark,
  Panel,
  Toggle,
} from '@komogon/ui';
import type { CountSummary, EndSummary } from '../lib/api';
import { blockOrigins, domainsWithoutPage } from '../lib/blocking';
import { portalOf, useLook } from '../lib/look';
import { getAll, onChange, set, type Stored } from '../lib/storage';
import { Popout } from './Popout';
import { NO_TASK, SubjectPicker, useTree } from './SubjectPicker';

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

/** The portal's phase names (`PHASE_LABEL` in lib/session-controller.tsx). */
const PHASE: Record<TimerState['phase'], string> = {
  work: 'Focus',
  'short-break': 'Short break',
  'long-break': 'Long break',
  paused: 'Paused',
  ended: 'Ended',
};

/** How the session felt, as the portal's save sheet asks it (ReviewDialog's `FOCUS`). */
const FOCUS_FELT = [
  { value: 'no', label: 'Locked in' },
  { value: 'a-little', label: 'A few drifts' },
  { value: 'a-lot', label: 'Scattered' },
] as const;
type Felt = (typeof FOCUS_FELT)[number]['value'];

type Tab = NonNullable<Stored['tab']>;

function fmtLength(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtTime = (iso: string | Date) => timeFormat.format(new Date(iso));

function plusMinutesLocalTime(min: number): string {
  const d = new Date(Date.now() + min * 60_000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The next time the clock reads `time`: today, or tomorrow once it has gone by. */
function nextAtLocal(time: string, now: number): Date {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(now);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d;
}

/** The instant a given number of minutes from now. */
function isoInMinutes(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString();
}

/** "Mon 3 Mar" for an overdue occurrence or a reward's cooldown. */
function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

/** Each figure in its own box, which a timer font of their own needs to hold still. */
function ClockDigits({ text }: { text: string }) {
  return (
    <>
      {[...text].map((c, i) =>
        /\d/.test(c) ? (
          <span key={i} className="clock-digit">
            {c}
          </span>
        ) : (
          c
        ),
      )}
    </>
  );
}

/** The quote of the moment as the dashboard's cards end (QuoteCard's `inline`). */
function QuoteFoot({ quote }: { quote: Stored['quote'] }) {
  if (!quote) return null;
  return (
    <div role="note" aria-label="Quote">
      <div className="divider" style={{ marginTop: 4 }} />
      <p className="quote-text">{quote.kind === 'quote' ? `“${quote.text}”` : quote.text}</p>
      {quote.by && <p className="muted text-sm quote-by">{quote.by}</p>}
    </div>
  );
}

/** The minutes control of the portal's start card: steps of 5 under an hour and 15 from there. */
function MinutesStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const down = value > 60 ? 15 : 5;
  const up = value >= 60 ? 15 : 5;
  return (
    <div className="ss-stepper" role="group" aria-label="Minutes">
      <button
        type="button"
        className="ss-step"
        aria-label={`${down} minutes less`}
        disabled={value <= 5}
        onClick={() => onChange(Math.max(5, value - down))}
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
          onChange={(e) =>
            onChange(Math.min(1440, Math.max(1, Math.round(Number(e.target.value) || 0))))
          }
        />
        <span className="ss-step-unit">min</span>
      </label>
      <button
        type="button"
        className="ss-step"
        aria-label={`${up} minutes more`}
        disabled={value >= 1440}
        onClick={() => onChange(Math.min(1440, value + up))}
      >
        <Plus size={18} aria-hidden />
      </button>
    </div>
  );
}

/** One choice in a pill's pop-out, ticked when it is the one (the portal's `menuOption`). */
function MenuOption({
  on,
  title,
  sub,
  onPick,
}: {
  on: boolean;
  title: string;
  sub?: string;
  onPick: () => void;
}) {
  return (
    <li>
      <button type="button" className="start-option" aria-pressed={on} onClick={onPick}>
        <span className="start-option-text">
          <span>{title}</span>
          {sub && <span className="start-option-sub">{sub}</span>}
        </span>
        {on && <Check size={16} aria-hidden className="start-option-check" />}
      </button>
    </li>
  );
}

export function Popup() {
  const [store, setStore] = useState<Stored | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** "End early?", asked before the review when stopping now would cost the XP. */
  const [askEarly, setAskEarly] = useState(false);
  const [review, setReview] = useState<{
    sessionId: string;
    felt: Felt | null;
    /** Mark the task done, or tick the routine off; null when there is nothing to mark. */
    mark: boolean | null;
  } | null>(null);
  const [summary, setSummary] = useState<EndSummary | null>(null);
  /** The figures after "Don't count this session" (or its undo). */
  const [recount, setRecount] = useState<CountSummary | null>(null);
  const [style, setStyle] = useState<SessionStyle>('pomodoro');
  const [duration, setDuration] = useState<SessionDurationKind>('unlimited');
  const [minutes, setMinutes] = useState(60);
  const [endTime, setEndTime] = useState(() => plusMinutesLocalTime(60));
  /** Null until set here: then the Settings › Timer default. */
  const [showTimer, setShowTimer] = useState<boolean | null>(null);
  /** Set when the chosen length cuts a block short; cleared by confirming. */
  const [confirmCut, setConfirmCut] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [picking, setPicking] = useState(false);
  const [tab, setTab] = useState<Tab>('focus');
  /** Routines being ticked off: kept on screen while the tick plays, as on the dashboard. */
  const [ticking, setTicking] = useState<RoutineOccurrence[] | null>(null);
  const [tickNote, setTickNote] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState<string | null>(null);
  /** Blocked sites Chrome blocks with its own page, until the focus page is allowed there. */
  const [bare, setBare] = useState<string[]>([]);
  /**
   * The tab's content scrolls only when it is taller than the popup: a scroller clips the
   * cards' soft shadows at its edges, which shows as a faint box behind a short card.
   */
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  // Measured again on each change of what's shown, and with the clock once a second.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const over = el.scrollHeight > el.clientHeight + 1;
    if (over !== scrolls) setScrolls(over);
  }, [scrolls, tab, now, store, error, tickNote, redeemed, picking, ticking]);

  useEffect(() => {
    void getAll().then((s) => {
      setStore(s);
      if (s.tab) setTab(s.tab);
      if (s.startLast) {
        setStyle(s.startLast.style);
        setDuration(s.startLast.duration);
        setMinutes(s.startLast.minutes);
        setEndTime(plusMinutesLocalTime(s.startLast.minutes));
      }
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

  // The quote of the moment, a new one every six hours, at the foot of the timer card as on
  // the dashboard. Kept for its slot so it shows at once.
  const quoteMode = settings?.quote.mode ?? 'quotes';
  const slot = snapshot
    ? quoteSlot(
        new Date(now),
        snapshot.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      ).key
    : null;
  const quote = quoteMode !== 'off' && store?.quote?.slot === slot ? store.quote : null;
  useEffect(() => {
    if (!store?.connection || !slot || quoteMode === 'off' || store.quote?.slot === slot) return;
    void send<{
      pick: {
        kind: 'quote' | 'tip';
        item: { text: string; author?: string; citation?: string };
      } | null;
    }>({ type: 'quote' })
      .then((r) => {
        void set({
          quote: r.pick
            ? {
                slot,
                kind: r.pick.kind,
                text: r.pick.item.text,
                by: r.pick.item.author ?? r.pick.item.citation ?? '',
              }
            : null,
        });
      })
      .catch(() => {});
  }, [store?.connection, store?.quote?.slot, slot, quoteMode]);

  // A session's end throws confetti in the popup too, more when it unlocked something.
  useEffect(() => {
    if (!summary) return;
    if (settings?.effects.confetti === false) return;
    fireConfetti({ count: summary.badges.length > 0 ? 90 : 50, durationMs: 1500 });
    // Only when a new summary opens, not when the settings refresh under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  const blockedDomains = settings?.blocking.enabled ? settings.blocking.domains : [];
  const blockedKey = blockedDomains.join(',');
  useEffect(() => {
    if (!blockedKey) return setBare([]);
    void domainsWithoutPage(blockedKey.split(',')).then(setBare);
  }, [blockedKey]);

  const tree = useTree(snapshot?.nodes ?? []);

  // Same theme, accent, background, fonts and panels as the portal.
  const backdrop = useLook(store);
  const portal = portalOf(store);

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

  const open = (path = '/') => chrome.tabs.create({ url: `${portal}${path}` });

  /** The focus screen, in the tab it is already in if there is one, else a new one. */
  const openFocus = async () => {
    const url = `${portal}/focus`;
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
  /** After a start: the popup cannot ask, so "ask" opens it and only "never" does not. */
  const openFocusAfterStart = () => {
    if (settings?.focusScreen?.openOnStart === 'never') return;
    void openFocus();
  };

  const goTab = (next: Tab) => {
    setTab(next);
    setError(null);
    setPicking(false);
    void set({ tab: next });
  };

  /** Asks Chrome for the blocked sites, so they show the focus page instead of Chrome's. */
  const allowFocusPage = async () => {
    try {
      await chrome.permissions.request({ origins: bare.flatMap(blockOrigins) });
    } catch {
      /* closed without an answer */
    }
    setBare(await domainsWithoutPage(blockedDomains));
  };
  const blockingRow = bare.length > 0 && (
    <button type="button" className="link-button hint" onClick={() => void allowFocusPage()}>
      Show the focus page on blocked sites
    </button>
  );

  /** One screen of the popup on the backdrop, with nothing else around it. */
  const screen = (body: ReactNode) => (
    <div className="popup">
      {backdrop}
      <div className="content" data-scrolls="">
        {body}
      </div>
    </div>
  );

  if (!store) return <div className="popup" />;

  if (!store.connection) {
    return screen(
      <Glass className="card stack">
        <div className="brand">
          <LogoMark size={28} />
          <h2 className="card-title">Komogon</h2>
        </div>
        <p className="muted text-sm">
          {store.lastError === 'Account suspended'
            ? 'Account suspended.'
            : 'Sign in to Komogon in this browser.'}
        </p>
        <Button variant="primary" size="lg" onClick={() => open('/')}>
          Open Komogon <ExternalLink size={14} aria-hidden />
        </Button>
      </Glass>,
    );
  }

  /* ---------- Moments that take over the whole popup ---------- */

  if (summary) {
    const counted = recount ? recount.session.counted !== false : true;
    const streak = recount?.streak ?? summary.streak;
    const weeks = streak.weeks;
    const { workSeconds, breakSeconds } = summary.session;
    const lp = levelProgress(summary.xpEarned ?? summary.xpTotal ?? 0);
    const badges = summary.badges
      .filter((k) => !recount || recount.session.badgesAwarded.includes(k))
      .map((k) => badgeByKey(k))
      .filter((b): b is NonNullable<typeof b> => !!b);
    let step = 0;
    const stagger = () => ({ animationDelay: `${(step++ * 110).toString()}ms` }) as const;
    const setCounted = async (next: boolean) => {
      const r = await run<CountSummary>({
        type: 'count',
        sessionId: summary.session.id,
        counted: next,
      });
      if (r) setRecount(r);
    };
    /** Closing goes to Social to post it, as the app does (Settings › Timer › After each session). */
    const close = async () => {
      const toSocial =
        counted &&
        settings?.review.openSocial &&
        settings.features.social &&
        summary.session.workSeconds >= 60;
      const id = summary.session.id;
      setSummary(null);
      setRecount(null);
      if (!toSocial) return;
      try {
        const { sessionIds } = await send<{ sessionIds: string[] }>({ type: 'postable' });
        if (sessionIds.includes(id)) void open(`/social?post=${id}`);
      } catch {
        /* closes as usual */
      }
    };
    return screen(
      <Glass className="card summary">
        <div className="summary-reveal" style={stagger()}>
          <h2 className="summary-title">{summary.phrase?.text ?? 'Nice work.'}</h2>
        </div>
        <div className="summary-hero summary-reveal" style={stagger()}>
          <span className="summary-hero-label">Focused time</span>
          <span className="summary-hero-figure tabular">{formatClock(workSeconds)}</span>
          <span className={`summary-xp${summary.xp.withheld || !counted ? ' is-withheld' : ''}`}>
            <Sparkles size={15} aria-hidden />
            {!counted ? (
              'Not counted'
            ) : summary.xp.withheld ? (
              'Ended early, so no XP this time'
            ) : (
              <>
                <strong className="tabular">+{summary.xp.total} XP</strong>
                {summary.leveledUp && <span> · level {summary.levelAfter} reached</span>}
              </>
            )}
          </span>
        </div>
        <dl className="summary-stats summary-reveal" style={stagger()}>
          {breakSeconds > 0 && (
            <div>
              <dt>Breaks</dt>
              <dd className="tabular">{fmtLength(Math.round(breakSeconds / 60))}</dd>
            </div>
          )}
          {breakSeconds > 0 && (
            <div>
              <dt>Elapsed</dt>
              <dd className="tabular">
                {fmtLength(Math.round((workSeconds + breakSeconds) / 60))}
              </dd>
            </div>
          )}
          <div>
            <dt>
              <Flame size={12} aria-hidden /> Daily streak
            </dt>
            <dd className="tabular">
              {streak.current} day{streak.current === 1 ? '' : 's'}
              {streak.longest > streak.current && (
                <span className="summary-stat-aside">Best {streak.longest}</span>
              )}
            </dd>
          </div>
          {weeks && weeks.current > 0 && (
            <div>
              <dt>
                <CalendarCheck size={12} aria-hidden /> Weekly streak
              </dt>
              <dd className="tabular">
                {weeks.current} week{weeks.current === 1 ? '' : 's'}
              </dd>
            </div>
          )}
          <div>
            <dt>
              <TrendingUp size={12} aria-hidden /> Level
            </dt>
            <dd className="tabular">
              {lp.level}
              <span className="summary-stat-aside">
                {lp.toNext} XP to {lp.level + 1}
              </span>
            </dd>
          </div>
        </dl>
        {badges.length > 0 && (
          <div className="summary-badges">
            <div className="summary-section-title summary-reveal" style={stagger()}>
              Achievement{badges.length === 1 ? '' : 's'} unlocked
            </div>
            {badges.map((b) => (
              <div key={b.key} className="summary-badge summary-reveal" style={stagger()}>
                <span className="summary-badge-icon" aria-hidden>
                  <Award size={18} />
                </span>
                <div>
                  <div className="badge-name">{b.name}</div>
                  <div className="muted text-sm">{b.description}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {(summary.streak.message ||
          (summary.streak.milestonesReached.length > 0 && counted) ||
          summary.nodeCompleted ||
          summary.routineTicked) && (
          <div className="text-sm muted stack tight summary-reveal" style={stagger()}>
            {summary.streak.milestonesReached.length > 0 && counted && (
              <span>{Math.max(...summary.streak.milestonesReached)}-day streak. Keep it up!</span>
            )}
            {summary.streak.message && <span>{summary.streak.message}</span>}
            {summary.nodeCompleted && <span>Marked as done.</span>}
            {summary.routineTicked && <span>Ticked off.</span>}
          </div>
        )}
        <div className="row summary-reveal" style={stagger()}>
          <button
            type="button"
            className="link-button text-sm muted"
            onClick={() => void setCounted(!counted)}
            disabled={busy}
          >
            {counted ? 'Don’t count this session' : 'Count this session'}
          </button>
          <span className="grow" />
          <Button variant="primary" onClick={() => void close()}>
            Done
          </Button>
        </div>
        {error && <p className="error">{error}</p>}
      </Glass>,
    );
  }

  const finish = async (rev: Record<string, unknown> | null, markComplete: boolean) => {
    if (!active) return;
    const r = await run<EndSummary>({
      type: 'end',
      sessionId: active.session.id,
      review: rev,
      markComplete,
    });
    setReview(null);
    if (r) setSummary(r);
  };

  const routineSession = active?.session.routineId != null;
  const hasSubject = active ? active.session.nodeId != null || routineSession : false;
  const reviews = settings?.review.mode !== 'off' && hasSubject;
  const asksTick = !reviews && routineSession;

  const beginEnd = async () => {
    if (!active || !timer) return;
    setAskEarly(false);
    // Bank work now so answering doesn't count as study time.
    if (timer.phase === 'work' || timer.phase === 'short-break' || timer.phase === 'long-break')
      await event({ type: 'pause' });
    if (reviews || asksTick)
      setReview({
        sessionId: active.session.id,
        felt: null,
        // Starting a routine's session is the intent to do it, so the tick starts on.
        mark: routineSession ? true : active.session.nodeId ? false : null,
      });
    else await finish(null, false);
  };

  if (askEarly && active) {
    return screen(
      <Glass strong className="card stack">
        <h2 className="card-title">End early?</h2>
        <p className="muted text-sm">
          Your time is saved, but it counts toward your level only after 10 minutes or when the task
          is done.
        </p>
        <div className="row end">
          <Button variant="ghost" onClick={() => setAskEarly(false)}>
            Keep going
          </Button>
          <Button variant="danger" onClick={() => void beginEnd()} disabled={busy}>
            End early
          </Button>
        </div>
      </Glass>,
    );
  }

  if (review && asksTick) {
    // Reviews are off, but a routine session still gets asked whether it is done.
    return screen(
      <Glass strong className="card stack">
        <h2 className="card-title">Done with {active?.nodeTitle ?? 'it'}?</h2>
        <div className="row end">
          <Button variant="ghost" onClick={() => finish(null, false)} disabled={busy}>
            Not yet
          </Button>
          <Button variant="primary" onClick={() => finish(null, true)} loading={busy}>
            Tick it off
          </Button>
        </div>
        {error && <p className="error">{error}</p>}
      </Glass>,
    );
  }

  if (review && view && timer) {
    const markComplete = review.mark === true;
    const path = active?.session.nodeId ? tree.pathOf(active.session.nodeId) : '';
    return screen(
      <Glass strong className="card save">
        <header className="save-head">
          <span className="save-kicker">Session done</span>
          <h2 className="save-title">{active?.nodeTitle}</h2>
          {path && <span className="save-path">{path}</span>}
        </header>
        <dl className="save-stats">
          <div className="save-stat is-main">
            <dt>Focused</dt>
            <dd className="tabular">{formatClock(view.workSeconds)}</dd>
          </div>
          {view.breakSeconds > 0 && (
            <div className="save-stat">
              <dt>Elapsed</dt>
              <dd className="tabular">{formatClock(view.workSeconds + view.breakSeconds)}</dd>
            </div>
          )}
          {timer.mode === 'pomodoro' && timer.cycle > 0 && (
            <div className="save-stat">
              <dt>Pomodoros</dt>
              <dd className="tabular">{timer.cycle}</dd>
            </div>
          )}
        </dl>
        <div className="save-q">
          <span className="save-q-label">Focus</span>
          <div className="save-chips" role="radiogroup" aria-label="Focus">
            {FOCUS_FELT.map((f) => (
              <button
                key={f.value}
                type="button"
                role="radio"
                className="save-chip"
                aria-checked={review.felt === f.value}
                onClick={() => setReview({ ...review, felt: f.value })}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {review.mark !== null && (
          <Toggle
            checked={review.mark}
            onChange={(mark) => setReview({ ...review, mark })}
            label={routineSession ? 'Tick it off for today' : `Mark ${active?.nodeTitle} as done`}
          />
        )}
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
            size="lg"
            onClick={() => finish({ skipped: false, distracted: review.felt }, markComplete)}
            loading={busy}
          >
            <Check size={17} aria-hidden /> Save session
          </Button>
        </div>
        {error && <p className="error">{error}</p>}
      </Glass>,
    );
  }

  /* ---------- Focus tab: the running session, as the dashboard's timer card ---------- */

  const runningView = () => {
    if (!active || !timer || !view) return null;
    const jackWaiting = timer.phase === 'paused' && !!timer.jack?.waiting;
    const digits = jackWaiting
      ? formatClock(0)
      : timer.mode === 'unlimited'
        ? formatClock(view.workSeconds)
        : view.phaseRemainingSeconds !== null
          ? formatClock(view.phaseRemainingSeconds)
          : formatClock(view.phaseElapsedSeconds);
    const inBreak = timer.phase === 'short-break' || timer.phase === 'long-break';
    const path = active.session.nodeId ? tree.pathOf(active.session.nodeId) : '';
    const roll = timer.jack?.last;
    const rolled =
      inBreak && roll && roll.cycle === timer.cycle
        ? roll.breakMs === 0
          ? 'No break'
          : roll.breakMs === roll.baseMs
            ? `Break ${fmtLength(Math.round(roll.breakMs / 60_000))}`
            : `Break ${fmtLength(Math.round(roll.baseMs / 60_000))} → ${fmtLength(Math.round(roll.breakMs / 60_000))}`
        : null;
    const stop = () => {
      const early = isWithheld({
        endedEarly: isEndedEarly({
          mode: timer.mode,
          cycle: timer.cycle,
          autoEnded: timer.autoEnded,
          endedAt: nowIso,
          plannedEndAt: timer.plannedEndAt,
        }),
        workMinutes: view.workSeconds / 60,
      });
      if (early) setAskEarly(true);
      else void beginEnd();
    };
    const extend = () =>
      event({
        type: 'extend',
        plannedEndAt: new Date(
          Math.max(Date.parse(timer.plannedEndAt ?? nowIso), Date.now()) + 15 * 60_000,
        ).toISOString(),
      });
    return (
      <Glass as="section" className="timer-card" aria-label="Current session">
        <div className="timer-top">
          <div className="timer-who">
            <div className="timer-live" data-phase={jackWaiting ? 'short-break' : timer.phase}>
              <span className="timer-live-dot" aria-hidden />
              {jackWaiting ? 'Break' : PHASE[timer.phase]}
            </div>
            {path && <div className="timer-path">{path}</div>}
            <h2 className="timer-title">{active.nodeTitle}</h2>
            <div className="timer-chips">
              <Chip tone="neutral">
                {timer.mode === 'pomodoro'
                  ? `Pomodoro · cycle ${timer.cycle + 1}`
                  : timer.mode === 'scheduled' && timer.plannedEndAt
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
            aria-label="Open the focus screen"
            title="Open the focus screen"
            onClick={() => void openFocus()}
          >
            <Maximize2 size={16} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={timer.showTimer ? 'Hide timer' : 'Show timer'}
            title={timer.showTimer ? 'Hide timer' : 'Show timer'}
            onClick={() => event({ type: 'set-timer-visibility', showTimer: !timer.showTimer })}
            disabled={busy}
          >
            {timer.showTimer ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
          </Button>
        </div>

        <div className="timer-readout">
          {timer.showTimer ? (
            <div className="timer-digits" aria-live="off">
              <ClockDigits text={digits} />
            </div>
          ) : (
            <div className="timer-digits" aria-label="Timer hidden">
              <span aria-hidden style={{ opacity: 0.5 }}>
                · · ·
              </span>
            </div>
          )}
          <div className="timer-focused tabular">
            {formatClock(view.workSeconds)} focus
            {view.breakSeconds > 0 &&
              ` · ${formatClock(view.workSeconds + view.breakSeconds)} elapsed`}
          </div>
        </div>
        {rolled && <p className="muted text-sm">{rolled}</p>}
        {jackWaiting && (
          <Button
            variant="primary"
            size="lg"
            onClick={() => event({ type: 'jack-pull' })}
            loading={busy}
          >
            Pull the lever
          </Button>
        )}

        <div className="timer-controls">
          {(timer.phase === 'work' || inBreak) && (
            <Button size="lg" onClick={() => event({ type: 'pause' })} disabled={busy}>
              <Pause size={16} aria-hidden /> Pause
            </Button>
          )}
          {timer.phase === 'paused' && !jackWaiting && (
            <Button
              variant="primary"
              size="lg"
              onClick={() => event({ type: 'resume' })}
              disabled={busy}
            >
              <Play size={16} aria-hidden /> Resume
            </Button>
          )}
          {timer.mode === 'pomodoro' &&
            !jackWaiting &&
            (inBreak || (timer.phase === 'paused' && timer.resumePhase !== 'work')) && (
              <Button size="lg" onClick={() => event({ type: 'skip-break' })} disabled={busy}>
                <SkipForward size={16} aria-hidden /> Skip break
              </Button>
            )}
          {timer.mode === 'scheduled' && timer.plannedEndAt && (
            <Button size="lg" onClick={() => void extend()} disabled={busy}>
              +15 min
            </Button>
          )}
          <span className="grow" />
          <Button variant="danger" size="lg" onClick={stop} disabled={busy}>
            <Square size={14} aria-hidden /> Stop
          </Button>
        </div>
        {blockingRow}
        {error && <p className="error">{error}</p>}
        <QuoteFoot quote={quote} />
      </Glass>
    );
  };

  /* ---------- Focus tab: starting one, as the portal's start card ---------- */

  const plan = snapshot?.plan ?? [];
  const firstUp =
    plan.map((p) => p.nodeId).find((id) => tree.byId.has(id) && !tree.kids.get(id)?.length) ??
    [...tree.byId.values()].find((n) => n.kind !== 'course' && !tree.kids.get(n.id)?.length)?.id ??
    NO_TASK;
  const chosen = subject && (subject === NO_TASK || tree.byId.has(subject)) ? subject : firstUp;
  const chosenNode = chosen === NO_TASK ? null : tree.byId.get(chosen);
  const chosenWhere = chosenNode ? tree.pathOf(chosenNode.id) : '';
  const timerShown = showTimer ?? settings?.pomodoro.showTimerByDefault ?? true;
  const pomodoro = settings?.pomodoro ?? DEFAULT_SETTINGS.pomodoro;

  /** How long the session will run, or null when it is unlimited. */
  const untilAt = duration === 'until' ? nextAtLocal(endTime, now) : null;
  const plannedMinutes =
    duration === 'unlimited'
      ? null
      : duration === 'for'
        ? minutes
        : Math.round(((untilAt?.getTime() ?? 0) - now) / 60_000);
  const untilHint = untilAt
    ? untilAt.getDate() !== new Date(now).getDate()
      ? `Tomorrow, ${timeFormat.format(untilAt)}`
      : `${fmtLength(Math.max(0, plannedMinutes ?? 0))} from now`
    : null;
  const lengthLabel =
    duration === 'unlimited'
      ? 'Unlimited'
      : duration === 'for'
        ? fmtLength(minutes)
        : `Until ${timeFormat.format(untilAt ?? new Date(now))}`;

  // Only a pomodoro has blocks to cut short; a continuous session can stop anywhere.
  const cut =
    style === 'pomodoro' && plannedMinutes !== null && settings
      ? pomodoroCut(plannedMinutes, settings.pomodoro)
      : null;
  const cutMessage = describeCut(cut);

  const startSession = async () => {
    if (plannedMinutes !== null && plannedMinutes <= 0) {
      setError(duration === 'until' ? 'Pick a later time' : 'Pick at least 1 minute');
      return;
    }
    const end =
      duration === 'unlimited'
        ? null
        : duration === 'until'
          ? (untilAt?.toISOString() ?? null)
          : isoInMinutes(minutes);
    const started = await run({
      type: 'start',
      ...(chosen === NO_TASK ? {} : { nodeId: chosen }),
      mode: modeForPlan({ style, plannedEndAt: end }),
      plannedEndAt: end,
      showTimer: timerShown,
    });
    setConfirmCut(null);
    if (started) {
      void set({ startLast: { style, duration, minutes } });
      openFocusAfterStart();
    }
  };

  const go = () => {
    // Confirm once when the length does not land on a block boundary.
    if (cutMessage && confirmCut !== cutMessage) return setConfirmCut(cutMessage);
    void startSession();
  };

  const startView = () =>
    picking ? (
      <Glass className="card">
        <SubjectPicker
          tree={tree}
          value={chosen}
          onPick={(id) => {
            setSubject(id);
            setPicking(false);
          }}
          onBack={() => setPicking(false)}
        />
      </Glass>
    ) : (
      <Glass as="section" className="card start-card" aria-label="Start a session">
        <h2 className="card-title">Start a session</h2>
        <div className="start-body">
          <button type="button" className="start-subject" onClick={() => setPicking(true)}>
            <span className="start-subject-text">
              <span className="start-subject-title truncate">{chosenNode?.title ?? 'No task'}</span>
              {chosenWhere && <span className="start-subject-where truncate">{chosenWhere}</span>}
            </span>
            <ChevronRight size={18} aria-hidden className="start-subject-chevron" />
          </button>

          {/* How it runs, a pill each; the first two pop out their choices. */}
          <div className="start-pills">
            <Popout
              label="How you work"
              trigger={
                <>
                  <Timer size={15} aria-hidden />
                  <span className="start-pill-label">
                    {style === 'pomodoro' ? 'Pomodoro' : 'Continuous'}
                  </span>
                  <ChevronDown size={14} aria-hidden className="start-pill-chevron" />
                </>
              }
            >
              {(close) => (
                <ul className="start-menu">
                  <MenuOption
                    on={style === 'pomodoro'}
                    title="Pomodoro"
                    sub={`${pomodoro.workMin} min work, ${pomodoro.shortBreakMin} min break`}
                    onPick={() => {
                      setStyle('pomodoro');
                      setConfirmCut(null);
                      close();
                    }}
                  />
                  <MenuOption
                    on={style === 'continuous'}
                    title="Continuous"
                    onPick={() => {
                      setStyle('continuous');
                      setConfirmCut(null);
                      close();
                    }}
                  />
                  <li className="start-menu-foot">
                    <button
                      type="button"
                      className="start-option is-link"
                      onClick={() => void open('/settings#timer')}
                    >
                      Change lengths
                    </button>
                  </li>
                </ul>
              )}
            </Popout>

            <Popout
              label="How long"
              trigger={
                <>
                  <Hourglass size={15} aria-hidden />
                  <span className="start-pill-label">{lengthLabel}</span>
                  <ChevronDown size={14} aria-hidden className="start-pill-chevron" />
                </>
              }
            >
              {(close) => (
                <div className="start-length">
                  <ul className="start-menu">
                    <MenuOption
                      on={duration === 'unlimited'}
                      title="Unlimited"
                      onPick={() => {
                        setDuration('unlimited');
                        setConfirmCut(null);
                        close();
                      }}
                    />
                    <MenuOption
                      on={duration === 'for'}
                      title="For a while"
                      onPick={() => {
                        setDuration('for');
                        setConfirmCut(null);
                      }}
                    />
                    <MenuOption
                      on={duration === 'until'}
                      title="Until a time"
                      onPick={() => {
                        setDuration('until');
                        setConfirmCut(null);
                      }}
                    />
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
              className={`start-pill${timerShown ? '' : ' is-off'}`}
              aria-pressed={timerShown}
              onClick={() => setShowTimer(!timerShown)}
            >
              {timerShown ? <Eye size={15} aria-hidden /> : <EyeOff size={15} aria-hidden />}
              <span className="start-pill-label">
                {timerShown ? 'Timer shown' : 'Timer hidden'}
              </span>
            </button>
          </div>

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
                      setMinutes(cut.previousBoundaryMinutes);
                      setConfirmCut(null);
                    }}
                  >
                    Use {fmtLength(cut.previousBoundaryMinutes)} instead
                  </button>
                </>
              )}
            </p>
          )}
        </div>

        <Button variant="primary" size="lg" className="start-go" loading={busy} onClick={go}>
          <Play size={16} aria-hidden className="start-go-icon" />
          {confirmCut ? 'Start anyway' : 'Start'}
        </Button>
        {blockingRow}
        {store.lastError && <p className="error">{store.lastError}</p>}
        {error && <p className="error">{error}</p>}
        <QuoteFoot quote={quote} />
      </Glass>
    );

  /* ---------- Routines tab: the dashboard's Routines card ---------- */

  const routines = snapshot?.routines ?? null;
  const keyOf = (o: RoutineOccurrence) => `${o.routineId}:${o.date}`;
  // While a tick plays, the list stays as it was, so the row can strike through and slide away.
  const shownRoutines = ticking ?? routines?.due ?? [];
  const tickedKeys = new Set(
    ticking
      ? ticking.filter((o) => !routines?.due.some((d) => keyOf(d) === keyOf(o))).map(keyOf)
      : [],
  );

  const tickRoutine = async (o: RoutineOccurrence) => {
    setTickNote(null);
    setTicking(routines?.due ?? [o]);
    const r = await run<{ xpAwarded: number; badges: string[] }>({
      type: 'tick-routine',
      routineId: o.routineId,
      date: o.date,
    });
    window.setTimeout(() => setTicking(null), 1400);
    if (!r) return;
    const parts: string[] = [];
    if (r.xpAwarded > 0) parts.push(`+${r.xpAwarded} XP`);
    if (r.badges.length)
      parts.push(`Unlocked ${r.badges.map((k) => badgeByKey(k)?.name ?? k).join(', ')}`);
    setTickNote(parts.length ? parts.join(' · ') : null);
  };

  /** Run a routine under the timer, for as long as it says it takes, then show the timer. */
  const startRoutine = async (o: RoutineOccurrence) => {
    setTickNote(null);
    const est = o.estimatedMinutes;
    const end = isoInMinutes(est);
    const started = await run({
      type: 'start',
      routineId: o.routineId,
      routineDate: o.date,
      mode: modeForPlan({
        style: est < pomodoro.workMin ? 'continuous' : 'pomodoro',
        plannedEndAt: end,
      }),
      plannedEndAt: end,
      showTimer: pomodoro.showTimerByDefault,
    });
    if (started) {
      goTab('focus');
      openFocusAfterStart();
    }
  };

  const routinesView = () => (
    <Panel as="section" className="dash-card" aria-label="Routines due today">
      <div className="row baseline">
        <h2 className="card-title grow">Routines</h2>
        <button type="button" className="section-link link-plain" onClick={() => open('/routines')}>
          All routines
        </button>
      </div>
      {!routines ? (
        <p className="muted text-sm">Loading…</p>
      ) : shownRoutines.length === 0 ? (
        <p className="routine-empty muted text-sm">Everything due is ticked off.</p>
      ) : (
        <ul className="routine-list">
          {shownRoutines.map((o) => {
            const key = keyOf(o);
            const ticked = tickedKeys.has(key);
            return (
              <li key={key} className={`routine-row${ticked ? ' is-done is-ticked' : ''}`}>
                <button
                  type="button"
                  className="routine-tick"
                  role="checkbox"
                  aria-checked={ticked}
                  aria-label={`Tick off ${o.title}`}
                  disabled={busy || !!ticking}
                  onClick={() => void tickRoutine(o)}
                >
                  <Check size={14} aria-hidden />
                </button>
                <span className="routine-name">
                  <span className="routine-title">{o.title}</span>
                  {o.overdue && <span className="subtle text-xs"> · {shortDate(o.date)}</span>}
                </span>
                <span className="routine-mins tabular">{o.estimatedMinutes}m</span>
                {!active && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label={`Start a session for ${o.title}`}
                    title="Start a session"
                    disabled={ticked || busy}
                    onClick={() => void startRoutine(o)}
                  >
                    <Play size={14} aria-hidden />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {tickNote && <p className="good">{tickNote}</p>}
      {error && <p className="error">{error}</p>}
    </Panel>
  );

  /* ---------- Rewards tab: Your rewards, as on Achievements ---------- */

  const rewards = snapshot?.rewards ?? null;

  const redeem = async (r: RewardView) => {
    setRedeemed(null);
    const out = await run<{ spent: number }>({ type: 'redeem', rewardId: r.id });
    if (!out) return;
    fireRewardBurst({ glyphs: r.emoji ? [r.emoji] : undefined });
    setRedeemed(`Redeemed ${r.name}`);
  };

  const rewardsView = () => {
    const items = (rewards?.items ?? []).filter((r) => !r.archived);
    return (
      <>
        <div className="section-head">
          <div className="grow">
            <h2 className="section-title">Your rewards</h2>
            {rewards && <p className="muted text-sm tabular">{rewards.xp} XP to spend</p>}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="section-button"
            onClick={() => open('/achievements')}
          >
            <Plus size={14} aria-hidden /> New reward
          </Button>
        </div>
        {!rewards ? (
          <p className="muted text-sm">Loading…</p>
        ) : items.length === 0 ? (
          <Panel className="dash-card">
            <p className="muted text-sm">No rewards yet.</p>
          </Panel>
        ) : (
          items.map((r) => {
            const short = Math.max(0, r.costXp - rewards.xp);
            return (
              <Panel key={r.id} className="reward-card">
                <div className="reward-card-head">
                  <span className="reward-card-glyph" aria-hidden>
                    {r.emoji ?? <Gift size={20} />}
                  </span>
                  <div className="grow min-w-0">
                    <div className="reward-name">{r.name}</div>
                    {r.note && <div className="muted text-sm">{r.note}</div>}
                  </div>
                </div>
                <div className="reward-card-meta">
                  {r.unlock === 'task' ? (
                    <span className="truncate">
                      {r.unlockTask ? `When ${r.unlockTask.title} is done` : 'Its task was deleted'}
                    </span>
                  ) : (
                    <span className="tabular">{r.costXp} XP</span>
                  )}
                  {r.cooldownDays > 0 && (
                    <Chip tone="neutral">
                      every {r.cooldownDays} day{r.cooldownDays === 1 ? '' : 's'}
                    </Chip>
                  )}
                </div>
                <div className="row">
                  <span className="muted text-sm tabular">
                    {r.unlock === 'task'
                      ? r.redeemedCount > 0
                        ? 'Redeemed'
                        : r.unlockTask?.done
                          ? 'Ready'
                          : r.unlockTask
                            ? 'Not done yet'
                            : 'Pick a new task to unlock it'
                      : r.availableOn
                        ? `Back on ${shortDate(r.availableOn)}`
                        : !r.affordable
                          ? `${short} XP to go`
                          : 'Ready'}
                  </span>
                  <span className="grow" />
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!r.redeemable || busy}
                    onClick={() => void redeem(r)}
                  >
                    Redeem
                  </Button>
                </div>
              </Panel>
            );
          })
        )}
        {redeemed && <p className="good">{redeemed}</p>}
        {error && <p className="error">{error}</p>}
      </>
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
      <div className="content" ref={contentRef} data-scrolls={scrolls ? '' : undefined}>
        {tab === 'focus' && (active ? runningView() : startView())}
        {tab === 'routines' && routinesView()}
        {tab === 'rewards' && rewardsView()}
        <button type="button" className="link" onClick={() => open('/')}>
          Open Komogon <ExternalLink size={12} aria-hidden />
        </button>
      </div>
      <nav className="tabs glass" aria-label="Sections">
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
