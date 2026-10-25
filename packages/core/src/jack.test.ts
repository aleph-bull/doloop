import { describe, expect, it } from 'vitest';
import {
  isGambler,
  JACK_EXPECTED_MULTIPLIER,
  JACK_FACES,
  jackFace,
  jackTotals,
  rollJack,
  startJack,
} from './jack';
import { advance, applyEvent, startTimer, type AdvanceOptions } from './timer';
import type { Session } from './types';

const T0 = '2026-10-22T12:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();
const cfg = { workMin: 25, shortBreakMin: 5, longBreakMin: 15, cyclesBeforeLong: 4 };
const opts = (over: Partial<AdvanceOptions> = {}): AdvanceOptions => ({
  pomodoro: cfg,
  autoStartBreaks: true,
  autoStartWork: true,
  ...over,
});

/** A seed whose first roll lands on the given face. */
function seedFor(face: number): string {
  for (let i = 0; i < 10_000; i++) if (jackFace(`seed-${i}`, 1) === face) return `seed-${i}`;
  throw new Error(`no seed for face ${face}`);
}

describe('the slot machine', () => {
  it('runs from 0x to 3x in tenths, lands on 1x 30% of the time and averages 0.9x', () => {
    expect(JACK_FACES).toHaveLength(31);
    JACK_FACES.forEach((f, i) => expect(f.multiplier).toBeCloseTo(i / 10, 10));
    expect(JACK_FACES.map((f) => f.label).slice(0, 3)).toEqual(['0.0×', '0.1×', '0.2×']);
    expect(JACK_FACES[30]!.label).toBe('3.0×');
    expect(JACK_FACES.reduce((a, f) => a + f.weight, 0)).toBe(1000);
    expect(JACK_FACES[10]!.weight).toBe(300);
    expect(JACK_EXPECTED_MULTIPLIER).toBeCloseTo(0.9, 10);
  });

  it('lands on each result about as often as its weight says', () => {
    const counts = JACK_FACES.map(() => 0);
    const n = 200_000;
    for (let i = 0; i < n; i++) counts[jackFace(`s${Math.floor(i / 12)}`, i % 12)]! += 1;
    JACK_FACES.forEach((f, i) =>
      expect(Math.abs(counts[i]! / n - f.weight / 1000)).toBeLessThan(0.004),
    );
    // And over many spins the break comes out a tenth short on average.
    const mean = counts.reduce((a, c, i) => a + c * JACK_FACES[i]!.multiplier, 0) / n;
    expect(mean).toBeGreaterThan(0.88);
    expect(mean).toBeLessThan(0.92);
  });

  it('gives the same face for the same seed and cycle', () => {
    expect(jackFace('abc', 3)).toBe(jackFace('abc', 3));
  });

  it('tallies the break won and lost', () => {
    let jack = startJack(seedFor(30));
    jack = rollJack(jack, 1, 5 * 60_000, at(25)).jack;
    expect(jack).toMatchObject({ rolls: 1, wonSeconds: 10 * 60, lostSeconds: 0 });
    expect(jack.last).toMatchObject({ cycle: 1, face: 30, baseMs: 300_000, breakMs: 900_000 });
    let lose = startJack(seedFor(5));
    lose = rollJack(lose, 1, 5 * 60_000, at(25)).jack;
    expect(lose).toMatchObject({ rolls: 1, wonSeconds: 0, lostSeconds: 150 });
    expect(lose.last?.breakMs).toBe(150_000);
    // 1x leaves the break as it was.
    let even = startJack(seedFor(10));
    even = rollJack(even, 1, 5 * 60_000, at(25)).jack;
    expect(even).toMatchObject({ rolls: 1, wonSeconds: 0, lostSeconds: 0 });
    expect(even.last?.breakMs).toBe(300_000);
    // Tenths that don't sit exactly in floating point still come out whole.
    expect(rollJack(startJack(seedFor(3)), 1, 5 * 60_000, at(25)).roll.breakMs).toBe(90_000);
  });
});

describe('the timer in Jack mode', () => {
  it('only starts one for a pomodoro with a seed', () => {
    expect(startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg }).jack).toBeUndefined();
    expect(
      startTimer({ mode: 'unlimited', now: T0, pomodoro: cfg, jackSeed: 'x' }).jack,
    ).toBeUndefined();
    expect(startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg, jackSeed: 'x' }).jack).toEqual(
      startJack('x'),
    );
  });

  it('waits for the lever, then gives the break the spin set', () => {
    const s = startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg, jackSeed: seedFor(20) });
    const w = advance(s, at(26), opts());
    // 2x: two breaks' worth, 10 minutes, held until the lever is pulled.
    expect(w).toMatchObject({
      phase: 'paused',
      cycle: 1,
      resumePhase: 'short-break',
      resumeRemainingMs: 10 * 60_000,
    });
    expect(w.jack).toMatchObject({ waiting: true, wonSeconds: 5 * 60 });
    expect(w.jack?.last).toMatchObject({ cycle: 1, at: at(25), face: 20 });
    // Nothing runs out while it waits.
    expect(advance(w, at(60), opts())).toEqual(w);
    const b = applyEvent(w, { type: 'jack-pull' }, at(27), opts());
    expect(b).toMatchObject({ phase: 'short-break', phaseStartedAt: at(27), phaseEndsAt: at(37) });
    expect(b.jack?.waiting).toBe(false);
    // A second pull changes nothing.
    expect(applyEvent(b, { type: 'jack-pull' }, at(28), opts())).toEqual(
      advance(b, at(28), opts()),
    );
  });

  it('goes straight back to work after the pull when the whole break is lost', () => {
    const s = startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg, jackSeed: seedFor(0) });
    const w = advance(s, at(26), opts());
    expect(w).toMatchObject({
      phase: 'paused',
      resumePhase: 'work',
      resumeRemainingMs: 25 * 60_000,
    });
    expect(w.jack?.lostSeconds).toBe(5 * 60);
    const r = applyEvent(w, { type: 'jack-pull' }, at(26), opts());
    expect(r).toMatchObject({
      phase: 'work',
      cycle: 1,
      phaseStartedAt: at(26),
      phaseEndsAt: at(51),
    });
    // With auto-start work off it waits before the next work block instead.
    const p = applyEvent(w, { type: 'jack-pull' }, at(26), opts({ autoStartWork: false }));
    expect(p).toMatchObject({
      phase: 'paused',
      resumePhase: 'work',
      resumeRemainingMs: 25 * 60_000,
    });
    expect(p.jack?.waiting).toBe(false);
  });

  it('keeps the spun break while waiting to start it', () => {
    const s = startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg, jackSeed: seedFor(30) });
    const w = advance(s, at(26), opts({ autoStartBreaks: false }));
    const p = applyEvent(w, { type: 'jack-pull' }, at(27), opts({ autoStartBreaks: false }));
    expect(p).toMatchObject({ phase: 'paused', resumePhase: 'short-break' });
    expect(p.resumeRemainingMs).toBe(15 * 60_000);
    expect(p.jack?.waiting).toBe(false);
    const r = applyEvent(p, { type: 'resume' }, at(30), opts({ autoStartBreaks: false }));
    expect(r.phaseEndsAt).toBe(at(45));
  });

  it('counts resume or skip break as the pull', () => {
    const s = startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg, jackSeed: seedFor(10) });
    const w = advance(s, at(26), opts());
    expect(applyEvent(w, { type: 'pause' }, at(27), opts())).toEqual(w);
    const r = applyEvent(w, { type: 'resume' }, at(27), opts());
    expect(r).toMatchObject({ phase: 'short-break', phaseEndsAt: at(32) });
    expect(r.jack?.waiting).toBe(false);
    const k = applyEvent(w, { type: 'skip-break' }, at(27), opts());
    expect(k).toMatchObject({ phase: 'work', phaseEndsAt: at(52) });
    expect(k.jack?.waiting).toBe(false);
  });

  it('spins once per work block, however often it is advanced', () => {
    let s = startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg, jackSeed: 'steady' });
    for (let m = 0; m <= 300; m++) {
      s = advance(s, at(m), opts());
      if (s.jack?.waiting) s = applyEvent(s, { type: 'jack-pull' }, at(m), opts());
    }
    expect(advance(s, at(300), opts())).toEqual(s);
    expect(s.cycle).toBeGreaterThan(5);
    expect(s.jack?.rolls).toBe(s.cycle);
  });
});

describe('jack totals', () => {
  const session = (workMinutes: number, jack: Session['jack']): Session => ({
    id: 's',
    userId: 'u',
    nodeId: null,
    routineId: null,
    routineDate: null,
    startedAt: T0,
    endedAt: at(workMinutes),
    mode: 'pomodoro',
    plannedEndAt: null,
    workSeconds: workMinutes * 60,
    breakSeconds: 0,
    idleSeconds: 0,
    pomodoroConfigSnapshot: cfg,
    review: null,
    xpAwarded: 0,
    badgesAwarded: [],
    sleeps: [],
    jack,
  });

  it('adds up only the sessions that ran with Jack mode on', () => {
    const list = [
      session(30, { rolls: 1, wonSeconds: 300, lostSeconds: 0 }),
      session(20, { rolls: 1, wonSeconds: 0, lostSeconds: 150 }),
      session(90, null),
    ];
    expect(jackTotals(list)).toEqual({
      rolls: 2,
      wonSeconds: 300,
      lostSeconds: 150,
      focusSeconds: 50 * 60,
    });
    expect(isGambler(list)).toBe(true);
    expect(isGambler(list.slice(1))).toBe(false);
  });
});
