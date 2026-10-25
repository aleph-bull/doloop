import { rollJack, startJack, type JackState } from './jack';
import type { ISODateTime, PomodoroSnapshot, SessionMode } from './types';

/**
 * Session timer state machine. Pure: the server stores `TimerState`, clients render it
 * against their local clock, and every transition is a function of (state, now).
 * Pomodoro auto-transitions are materialized lazily by `advance()`, so no cron is needed.
 */

export type TimerPhase = 'work' | 'short-break' | 'long-break' | 'paused' | 'ended';
export type IntervalPhase = 'work' | 'short-break' | 'long-break';

export interface TimerState {
  mode: SessionMode;
  phase: TimerPhase;
  /** Instant the current phase began. */
  phaseStartedAt: ISODateTime;
  /** Planned end of the current interval (pomodoro) or of the session (scheduled). */
  phaseEndsAt: ISODateTime | null;
  /** When paused: the interval to resume into and how many ms of it were left. */
  resumePhase: IntervalPhase | null;
  resumeRemainingMs: number | null;
  /** Completed work intervals (pomodoro). */
  cycle: number;
  /** Accumulated seconds up to `phaseStartedAt`. The live phase is added on read. */
  workSeconds: number;
  breakSeconds: number;
  /**
   * Seconds an older session sat in the idle phase, from when the app watched for a still
   * mouse and asked "still studying?". That feature is gone; the count is kept so old
   * sessions still add up, and is 0 on every session since.
   */
  idleSeconds: number;
  /** Scheduled mode: planned end. Extending moves it. */
  plannedEndAt: ISODateTime | null;
  /** Scheduled mode: ended automatically after the grace period. */
  autoEnded: boolean;
  /** Per-session timer visibility (remembered by the client). */
  showTimer: boolean;
  endedAt: ISODateTime | null;
  /** Jack mode, when it was on as the session started: a die decides each break. */
  jack?: JackState | null;
}

export const SCHEDULED_GRACE_SECONDS = 60;

export interface StartTimerInput {
  mode: SessionMode;
  now: ISODateTime;
  pomodoro: PomodoroSnapshot;
  plannedEndAt?: ISODateTime | null;
  showTimer?: boolean;
  /** Jack mode's seed: a pomodoro started with one rolls a die after each work interval. */
  jackSeed?: string | null;
}

function ms(iso: ISODateTime): number {
  return Date.parse(iso);
}
function iso(msValue: number): ISODateTime {
  return new Date(msValue).toISOString();
}
function minutesToMs(min: number): number {
  return Math.max(0, min) * 60_000;
}

export function intervalMs(phase: IntervalPhase, cfg: PomodoroSnapshot): number {
  switch (phase) {
    case 'work':
      return minutesToMs(cfg.workMin);
    case 'short-break':
      return minutesToMs(cfg.shortBreakMin);
    case 'long-break':
      return minutesToMs(cfg.longBreakMin);
  }
}

export function startTimer(input: StartTimerInput): TimerState {
  const base: TimerState = {
    mode: input.mode,
    phase: 'work',
    phaseStartedAt: input.now,
    phaseEndsAt: null,
    resumePhase: null,
    resumeRemainingMs: null,
    cycle: 0,
    workSeconds: 0,
    breakSeconds: 0,
    idleSeconds: 0,
    plannedEndAt: null,
    autoEnded: false,
    showTimer: input.showTimer ?? true,
    endedAt: null,
  };
  // A planned end is independent of the style: either can be open-ended or run to a time.
  base.plannedEndAt = input.plannedEndAt ?? null;
  if (input.mode === 'pomodoro') {
    // The first work interval; the planned end, if any, cuts the session short later.
    base.phaseEndsAt = iso(ms(input.now) + intervalMs('work', input.pomodoro));
    if (input.jackSeed) base.jack = startJack(input.jackSeed);
  } else {
    base.phaseEndsAt = base.plannedEndAt;
  }
  return base;
}

function counterFor(phase: TimerPhase): 'workSeconds' | 'breakSeconds' | null {
  if (phase === 'work') return 'workSeconds';
  if (phase === 'short-break' || phase === 'long-break') return 'breakSeconds';
  return null;
}

/**
 * A timer saved by an older build may be sitting in the idle phase, which no longer
 * exists. It reads as paused, about to resume into work, so the session can carry on or
 * be ended like any other. Every current state comes back untouched.
 */
export function normalizeTimer(state: TimerState): TimerState {
  if ((state.phase as string) !== 'idle') return state;
  return {
    ...state,
    phase: 'paused',
    phaseEndsAt: null,
    resumePhase: state.resumePhase ?? 'work',
  };
}

/** Close the current phase at `at`, banking its elapsed time into the right counter. */
function bank(state: TimerState, at: ISODateTime): TimerState {
  const key = counterFor(state.phase);
  const elapsed = Math.max(0, Math.round((ms(at) - ms(state.phaseStartedAt)) / 1000));
  if (!key || elapsed === 0) return { ...state, phaseStartedAt: at };
  return { ...state, [key]: state[key] + elapsed, phaseStartedAt: at };
}

function nextBreak(cycleAfterWork: number, cfg: PomodoroSnapshot): IntervalPhase {
  const every = Math.max(1, cfg.cyclesBeforeLong);
  return cycleAfterWork % every === 0 ? 'long-break' : 'short-break';
}

export interface AdvanceOptions {
  pomodoro: PomodoroSnapshot;
  autoStartBreaks: boolean;
  autoStartWork: boolean;
}

/**
 * Materialize every automatic transition between `state.phaseStartedAt` and `now`.
 * Idempotent: advancing twice to the same `now` yields the same state.
 */
export function advance(state: TimerState, now: ISODateTime, opts: AdvanceOptions): TimerState {
  if (state.phase === 'ended') return state;
  let s = state;

  /**
   * A planned end applies to either style: a continuous session runs straight to it, and a
   * pomodoro runs its intervals until it arrives. Reaching it ends the session regardless
   * of which interval is in progress — which is exactly why the start dialog warns when
   * the chosen length would cut a block short.
   */
  if (s.plannedEndAt && s.phase !== 'ended') {
    const hardEnd = ms(s.plannedEndAt) + SCHEDULED_GRACE_SECONDS * 1000;
    if (ms(now) >= hardEnd) {
      // Time is credited up to the planned end, not through the grace period.
      const at = iso(Math.max(ms(s.phaseStartedAt), ms(s.plannedEndAt)));
      s = bank(s, at);
      return {
        ...s,
        phase: 'ended',
        endedAt: s.plannedEndAt,
        autoEnded: true,
        phaseEndsAt: null,
      };
    }
  }

  if (s.mode !== 'pomodoro') return s;

  // Pomodoro: walk interval boundaries.
  for (let guard = 0; guard < 10_000; guard++) {
    if (s.phase !== 'work' && s.phase !== 'short-break' && s.phase !== 'long-break') break;
    if (!s.phaseEndsAt || ms(now) < ms(s.phaseEndsAt)) break;
    const boundary = s.phaseEndsAt;
    const wasWork = s.phase === 'work';
    s = bank(s, boundary);
    const cycle = wasWork ? s.cycle + 1 : s.cycle;
    let next: IntervalPhase = wasWork ? nextBreak(cycle, opts.pomodoro) : 'work';
    let length = intervalMs(next, opts.pomodoro);
    // Jack mode: the slot machine decides the break. 0x goes straight on to work.
    if (wasWork && s.jack) {
      const rolled = rollJack(s.jack, cycle, length, boundary);
      s = { ...s, jack: rolled.jack };
      length = rolled.roll.breakMs;
      if (length === 0) {
        next = 'work';
        length = intervalMs('work', opts.pomodoro);
      }
    }
    const autoStart = next === 'work' ? opts.autoStartWork : opts.autoStartBreaks;
    if (autoStart) {
      s = {
        ...s,
        cycle,
        phase: next,
        phaseStartedAt: boundary,
        phaseEndsAt: iso(ms(boundary) + length),
      };
    } else {
      s = {
        ...s,
        cycle,
        phase: 'paused',
        phaseStartedAt: boundary,
        phaseEndsAt: null,
        resumePhase: next,
        resumeRemainingMs: length,
      };
      break;
    }
  }
  return s;
}

export type TimerEvent =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'skip-break' }
  | { type: 'extend'; plannedEndAt: ISODateTime }
  | { type: 'set-timer-visibility'; showTimer: boolean }
  | { type: 'end' };

/** Apply a user/client event at `now`. Call `advance()` first so auto-transitions are banked. */
export function applyEvent(
  state: TimerState,
  event: TimerEvent,
  now: ISODateTime,
  opts: AdvanceOptions,
): TimerState {
  let s = advance(state, now, opts);
  if (s.phase === 'ended' && event.type !== 'set-timer-visibility') return s;

  switch (event.type) {
    case 'set-timer-visibility':
      return { ...s, showTimer: event.showTimer };

    case 'pause': {
      if (s.phase === 'paused') return s;
      const interval = s.phase as IntervalPhase;
      const remaining = s.phaseEndsAt ? Math.max(0, ms(s.phaseEndsAt) - ms(now)) : null;
      s = bank(s, now);
      return {
        ...s,
        phase: 'paused',
        phaseEndsAt: null,
        resumePhase: interval,
        resumeRemainingMs: s.mode === 'pomodoro' ? remaining : null,
      };
    }

    case 'resume': {
      if (s.phase !== 'paused') return s;
      const phase = s.resumePhase ?? 'work';
      const remaining = s.resumeRemainingMs;
      const endsAt =
        s.mode === 'pomodoro'
          ? iso(ms(now) + (remaining ?? intervalMs(phase, opts.pomodoro)))
          : s.mode === 'scheduled'
            ? s.plannedEndAt
            : null;
      return {
        ...s,
        phase,
        phaseStartedAt: now,
        phaseEndsAt: endsAt,
        resumePhase: null,
        resumeRemainingMs: null,
      };
    }

    case 'skip-break': {
      if (s.mode !== 'pomodoro') return s;
      const inBreak = s.phase === 'short-break' || s.phase === 'long-break';
      const pausedBeforeBreak =
        s.phase === 'paused' && (s.resumePhase === 'short-break' || s.resumePhase === 'long-break');
      if (!inBreak && !pausedBeforeBreak) return s;
      s = bank(s, now);
      return {
        ...s,
        phase: 'work',
        phaseStartedAt: now,
        phaseEndsAt: iso(ms(now) + intervalMs('work', opts.pomodoro)),
        resumePhase: null,
        resumeRemainingMs: null,
      };
    }

    case 'extend': {
      if (s.mode !== 'scheduled') return s;
      if (ms(event.plannedEndAt) <= ms(now)) return s;
      return {
        ...s,
        plannedEndAt: event.plannedEndAt,
        phaseEndsAt: s.phase === 'work' ? event.plannedEndAt : s.phaseEndsAt,
      };
    }

    case 'end': {
      s = bank(s, now);
      return {
        ...s,
        phase: 'ended',
        endedAt: now,
        phaseEndsAt: null,
        resumePhase: null,
        resumeRemainingMs: null,
      };
    }
  }
}

export interface TimerView {
  phase: TimerPhase;
  /** Seconds elapsed in the current phase. */
  phaseElapsedSeconds: number;
  /** Seconds left in the current interval, or null for open-ended phases. */
  phaseRemainingSeconds: number | null;
  /** Totals including the live phase. */
  workSeconds: number;
  breakSeconds: number;
  idleSeconds: number;
  cycle: number;
  /** Scheduled: seconds of grace left after the planned end (null otherwise). */
  graceRemainingSeconds: number | null;
  /** Scheduled/pomodoro: the wall-clock instant this interval ends. */
  endsAt: ISODateTime | null;
}

/** Render the state for display at `now`. Does not materialize transitions; call advance() first. */
export function viewTimer(state: TimerState, now: ISODateTime): TimerView {
  const live =
    state.phase === 'ended'
      ? 0
      : Math.max(0, Math.floor((ms(now) - ms(state.phaseStartedAt)) / 1000));
  const key = counterFor(state.phase);
  const totals = {
    workSeconds: state.workSeconds + (key === 'workSeconds' ? live : 0),
    breakSeconds: state.breakSeconds + (key === 'breakSeconds' ? live : 0),
    idleSeconds: state.idleSeconds,
  };
  let remaining: number | null = null;
  if (state.phaseEndsAt && state.phase !== 'ended')
    remaining = Math.max(0, Math.ceil((ms(state.phaseEndsAt) - ms(now)) / 1000));
  if (state.phase === 'paused' && state.resumeRemainingMs !== null)
    remaining = Math.ceil(state.resumeRemainingMs / 1000);

  let grace: number | null = null;
  if (state.mode === 'scheduled' && state.plannedEndAt && state.phase !== 'ended') {
    const past = ms(now) - ms(state.plannedEndAt);
    if (past >= 0) grace = Math.max(0, SCHEDULED_GRACE_SECONDS - Math.floor(past / 1000));
  }

  return {
    phase: state.phase,
    phaseElapsedSeconds: live,
    phaseRemainingSeconds: remaining,
    ...totals,
    cycle: state.cycle,
    graceRemainingSeconds: grace,
    endsAt: state.phaseEndsAt,
  };
}

/** Convenience: advance then view. */
export function currentView(state: TimerState, now: ISODateTime, opts: AdvanceOptions): TimerView {
  return viewTimer(advance(state, now, opts), now);
}

/** Format seconds as m:ss or h:mm:ss. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}
