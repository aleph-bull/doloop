import { fnv1a } from './hash';
import type { ISODateTime, Session } from './types';

/**
 * Jack mode (asked for by the owner, 2026-10-22, named after the friend it is for): after
 * each work interval of a pomodoro a die is rolled, and the break that follows grows or
 * shrinks by what it lands on, from losing the whole break (-1x) to three breaks more
 * (+3x). The odds are weighted so the average roll costs a fifth of a break (-0.2x).
 *
 * The roll is a pure function of the session's seed and the cycle, so the server, the
 * portal and the extension all land on the same face without asking each other.
 */

export interface JackFace {
  /** Break added (positive) or taken away (negative), in breaks. */
  multiplier: number;
  /** Chances in 100. */
  weight: number;
  /** What the die shows. */
  label: string;
}

/** The six faces, worst first. Weights add to 100 and average -0.2x. */
export const JACK_FACES: readonly JackFace[] = [
  { multiplier: -1, weight: 46, label: '−1×' },
  { multiplier: -0.5, weight: 20, label: '−½×' },
  { multiplier: 0, weight: 12, label: '0×' },
  { multiplier: 1, weight: 12, label: '+1×' },
  { multiplier: 2, weight: 6, label: '+2×' },
  { multiplier: 3, weight: 4, label: '+3×' },
];

const TOTAL_WEIGHT = JACK_FACES.reduce((a, f) => a + f.weight, 0);

/** The average roll, in breaks (-0.2). */
export const JACK_EXPECTED_MULTIPLIER =
  JACK_FACES.reduce((a, f) => a + f.multiplier * f.weight, 0) / TOTAL_WEIGHT;

/** Kept on a session's timer while Jack mode is on for it. */
export interface JackState {
  /** Fixed when the session starts; every roll is drawn from it. */
  seed: string;
  /** Dice rolled so far, one after each work interval. */
  rolls: number;
  /** Break seconds the dice added, and took away, this session. */
  wonSeconds: number;
  lostSeconds: number;
  /** The latest roll, for the dice on screen. */
  last: JackRoll | null;
}

export interface JackRoll {
  /** The work interval it followed (the timer's cycle once that interval was done). */
  cycle: number;
  /** When that interval ended and the die was rolled. */
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

/** Which face the die lands on after the given work interval. */
export function jackFace(seed: string, cycle: number): number {
  let ticket = mix(fnv1a(`${seed}:${cycle}`)) % TOTAL_WEIGHT;
  for (let i = 0; i < JACK_FACES.length; i++) {
    ticket -= JACK_FACES[i]!.weight;
    if (ticket < 0) return i;
  }
  return JACK_FACES.length - 1;
}

/** Roll at `at` for the break after `cycle`, whose usual length is `baseMs`, and tally it. */
export function rollJack(
  jack: JackState,
  cycle: number,
  baseMs: number,
  at: ISODateTime,
): { jack: JackState; roll: JackRoll } {
  const face = jackFace(jack.seed, cycle);
  const delta = Math.round(baseMs * JACK_FACES[face]!.multiplier);
  const breakMs = Math.max(0, baseMs + delta);
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

/** What Jack mode's dice did across some sessions. */
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
