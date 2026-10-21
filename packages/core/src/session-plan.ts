import type { PomodoroConfig, SessionMode } from './types';

/**
 * A session is chosen along two independent axes:
 *
 *  - **style**: pomodoro (work intervals separated by breaks) or continuous (straight,
 *    uninterrupted work);
 *  - **duration**: unlimited, a length ("three hours"), or a clock time ("until 18:00").
 *
 * `SessionMode`, which is what gets stored, is the old single axis. It maps onto the two
 * new ones without a migration: the three existing modes keep their exact meaning, and
 * the combination that did not exist before — a pomodoro with an end time — is stored as
 * mode `pomodoro` with `plannedEndAt` set.
 */

export type SessionStyle = 'pomodoro' | 'continuous';
export type SessionDurationKind = 'unlimited' | 'for' | 'until';

export interface SessionPlan {
  style: SessionStyle;
  /** Null for an unlimited session. */
  plannedEndAt: string | null;
}

/** The stored mode for a plan. Chosen so existing sessions keep reading correctly. */
export function modeForPlan(plan: SessionPlan): SessionMode {
  if (plan.style === 'pomodoro') return 'pomodoro';
  return plan.plannedEndAt ? 'scheduled' : 'unlimited';
}

/** The style a stored session was run in. */
export function styleForMode(mode: SessionMode): SessionStyle {
  return mode === 'pomodoro' ? 'pomodoro' : 'continuous';
}

/** True when the session runs to a planned end rather than until it is stopped. */
export function hasPlannedEnd(mode: SessionMode, plannedEndAt: string | null): boolean {
  return mode === 'scheduled' || (mode === 'pomodoro' && plannedEndAt !== null);
}

/* ---------- landing on a block boundary ---------- */

export type BlockPhase = 'work' | 'short-break' | 'long-break';

export interface BlockCut {
  /** The block the chosen end time falls inside. */
  phase: BlockPhase;
  /** How many minutes of that block are lost, rounded to the nearest minute. */
  minutesEarly: number;
  /** Total minutes of a whole number of blocks at or below the chosen length. */
  previousBoundaryMinutes: number;
  /** Total minutes of the next whole boundary above it. */
  nextBoundaryMinutes: number;
}

/** Hard cap on how far the schedule is walked, so a silly duration cannot hang. */
const MAX_BLOCKS = 500;

const PHASE_WORDS: Record<BlockPhase, string> = {
  work: 'work block',
  'short-break': 'short break',
  'long-break': 'long break',
};

/**
 * Where a session of `minutes` lands in the pomodoro schedule.
 *
 * Returns null when it lands exactly on a boundary — i.e. the session ends cleanly at the
 * close of a block — and otherwise which block it cuts short and by how much.
 */
export function pomodoroCut(minutes: number, cfg: PomodoroConfig): BlockCut | null {
  const work = Math.max(0, cfg.workMin);
  const short = Math.max(0, cfg.shortBreakMin);
  const long = Math.max(0, cfg.longBreakMin);
  const cycles = Math.max(1, cfg.cyclesBeforeLong);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  // A schedule with no length to it can never be cut.
  if (work + short + long === 0) return null;

  let elapsed = 0;
  for (let i = 0; i < MAX_BLOCKS; i++) {
    for (const [phase, length] of [
      ['work', work],
      [
        (i + 1) % cycles === 0 ? 'long-break' : 'short-break',
        (i + 1) % cycles === 0 ? long : short,
      ],
    ] as Array<[BlockPhase, number]>) {
      if (length <= 0) continue;
      const end = elapsed + length;
      if (minutes === end) return null; // lands exactly on a boundary
      if (minutes < end) {
        return {
          phase,
          minutesEarly: Math.round(end - minutes),
          previousBoundaryMinutes: elapsed,
          nextBoundaryMinutes: end,
        };
      }
      elapsed = end;
    }
  }
  return null;
}

/**
 * The confirmation shown when a chosen length does not land on a block boundary. Returns
 * null when nothing needs confirming.
 */
export function describeCut(cut: BlockCut | null): string | null {
  if (!cut || cut.minutesEarly <= 0) return null;
  const m = cut.minutesEarly;
  return `This ends your ${PHASE_WORDS[cut.phase]} ${m} minute${m === 1 ? '' : 's'} early.`;
}

/** The nearest clean lengths either side, for a "use 90 min instead" affordance. */
export function nearestBoundaries(cut: BlockCut | null): { below: number; above: number } | null {
  if (!cut) return null;
  return { below: cut.previousBoundaryMinutes, above: cut.nextBoundaryMinutes };
}
