import { fnv1a } from './hash';
import type { ISODateTime, Session } from './types';

/**
 * Jack mode (asked for by the owner, 2026-10-22, named after the friend it is for): after
 * each work interval of a pomodoro a slot machine sets the break that follows. It lands on a
 * multiplier of the usual break from 0x (no break) to 3x, in steps of 0.1x: 0.5x is half the
 * break. Re-rated by the owner on 2026-10-25 (it was a die from -1x to +3x): 1x comes up 30%
 * of the time and the average spin is 0.9x.
 *
 * The spin is a pure function of the session's seed and the cycle, so the server, the
 * portal and the extension all land on the same result without asking each other.
 */

export interface JackFace {
  /** The break it gives, in usual breaks: 0 is none, 0.5 half, 3 three times as long. */
  multiplier: number;
  /** Chances in 1000. */
  weight: number;
  /** What the machine shows. */
  label: string;
}

/**
 * Chances in 1000 of each result, 0.0x up to 3.0x: index i is i / 10. They add to 1000 and
 * average exactly 0.9x. Under 1x 45% of the time (0x 8.4%), 1x 30%, more 25% (2x or more
 * 6.8%, 3x 1.5%).
 */
const WEIGHTS = [
  // 0.0x to 0.9x
  84, 40, 42, 42, 44, 44, 40, 40, 38, 36,
  // 1.0x
  300,
  // 1.1x to 1.9x
  36, 31, 26, 20, 24, 14, 12, 11, 8,
  // 2.0x to 2.9x
  14, 6, 5, 5, 4, 7, 3, 3, 3, 3,
  // 3.0x
  15,
];

/** Every result, lowest first: index i is i / 10 of a break. */
export const JACK_FACES: readonly JackFace[] = WEIGHTS.map((weight, i) => ({
  multiplier: i / 10,
  weight,
  label: `${(i / 10).toFixed(1)}×`,
}));

const TOTAL_WEIGHT = JACK_FACES.reduce((a, f) => a + f.weight, 0);

/** The average spin, in breaks (0.9). */
export const JACK_EXPECTED_MULTIPLIER =
  JACK_FACES.reduce((a, f) => a + f.multiplier * f.weight, 0) / TOTAL_WEIGHT;

/** Kept on a session's timer while Jack mode is on for it. */
export interface JackState {
  /** Fixed when the session starts; every roll is drawn from it. */
  seed: string;
  /** Spins so far, one after each work interval. */
  rolls: number;
  /** Break seconds the spins added, and took away, this session. */
  wonSeconds: number;
  lostSeconds: number;
  /** The latest spin, for the machine on screen. */
  last: JackRoll | null;
  /**
   * The timer is paused at the end of a work interval until the lever is pulled (owner,
   * 2026-10-25): the break, or after 0x the next work block, waits for it. Absent on
   * sessions from before.
   */
  waiting?: boolean;
}

export interface JackRoll {
  /** The work interval it followed (the timer's cycle once that interval was done). */
  cycle: number;
  /** When that interval ended and the machine spun. */
  at: ISODateTime;
  /** Index into `JACK_FACES`. */
  face: number;
  /** The break before the roll, and after it, in ms. */
  baseMs: number;
  breakMs: number;
}

export function startJack(seed: string): JackState {
  return { seed, rolls: 0, wonSeconds: 0, lostSeconds: 0, last: null };
}

/** Spreads fnv1a's bits so neighbouring cycles don't land on neighbouring numbers. */
function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Which result the machine lands on after the given work interval. */
export function jackFace(seed: string, cycle: number): number {
  let ticket = mix(fnv1a(`${seed}:${cycle}`)) % TOTAL_WEIGHT;
  for (let i = 0; i < JACK_FACES.length; i++) {
    ticket -= JACK_FACES[i]!.weight;
    if (ticket < 0) return i;
  }
  return JACK_FACES.length - 1;
}

/** Spin at `at` for the break after `cycle`, whose usual length is `baseMs`, and tally it. */
export function rollJack(
  jack: JackState,
  cycle: number,
  baseMs: number,
  at: ISODateTime,
): { jack: JackState; roll: JackRoll } {
  const face = jackFace(jack.seed, cycle);
  const breakMs = Math.round(baseMs * JACK_FACES[face]!.multiplier);
  const delta = breakMs - baseMs;
  const roll: JackRoll = { cycle, at, face, baseMs, breakMs };
  const seconds = Math.round(Math.abs(delta) / 1000);
  return {
    roll,
    jack: {
      ...jack,
      rolls: jack.rolls + 1,
      wonSeconds: jack.wonSeconds + (delta > 0 ? seconds : 0),
      lostSeconds: jack.lostSeconds + (delta < 0 ? seconds : 0),
      last: roll,
    },
  };
}

/** Focus with Jack mode on that earns the Gambler badge and the die by the name. */
export const GAMBLER_FOCUS_SECONDS = 45 * 60;

export interface JackTotals {
  rolls: number;
  wonSeconds: number;
  lostSeconds: number;
  /** Focus in the sessions that ran with Jack mode on. */
  focusSeconds: number;
}

/** What Jack mode's spins did across some sessions. */
export function jackTotals(sessions: Session[]): JackTotals {
  const totals: JackTotals = { rolls: 0, wonSeconds: 0, lostSeconds: 0, focusSeconds: 0 };
  for (const s of sessions) {
    if (!s.jack) continue;
    totals.rolls += s.jack.rolls;
    totals.wonSeconds += s.jack.wonSeconds;
    totals.lostSeconds += s.jack.lostSeconds;
    totals.focusSeconds += s.workSeconds;
  }
  return totals;
}

/** More than 45 minutes of focus with Jack mode on: the Gambler badge and the die. */
export function isGambler(sessions: Session[]): boolean {
  return jackTotals(sessions).focusSeconds > GAMBLER_FOCUS_SECONDS;
}
