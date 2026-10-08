import { describe, expect, it } from 'vitest';
import {
  advance,
  applyEvent,
  currentView,
  formatClock,
  intervalMs,
  normalizeTimer,
  startTimer,
  viewTimer,
  type AdvanceOptions,
  type TimerState,
} from './timer';

const T0 = '2026-09-20T12:00:00.000Z';
const at = (minutes: number, seconds = 0) =>
  new Date(Date.parse(T0) + minutes * 60_000 + seconds * 1000).toISOString();

const cfg = { workMin: 25, shortBreakMin: 5, longBreakMin: 15, cyclesBeforeLong: 4 };
const opts = (over: Partial<AdvanceOptions> = {}): AdvanceOptions => ({
  pomodoro: cfg,
  autoStartBreaks: true,
  autoStartWork: false,
  ...over,
});

describe('startTimer', () => {
  it('starts each mode in work', () => {
    const p = startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg });
    expect(p.phase).toBe('work');
    expect(p.phaseEndsAt).toBe(at(25));
    const u = startTimer({ mode: 'unlimited', now: T0, pomodoro: cfg, showTimer: false });
    expect(u.phaseEndsAt).toBeNull();
    expect(u.showTimer).toBe(false);
    const s = startTimer({ mode: 'scheduled', now: T0, pomodoro: cfg, plannedEndAt: at(90) });
    expect(s.plannedEndAt).toBe(at(90));
    expect(s.phaseEndsAt).toBe(at(90));
  });

  it('exposes interval lengths', () => {
    expect(intervalMs('work', cfg)).toBe(25 * 60_000);
    expect(intervalMs('short-break', cfg)).toBe(5 * 60_000);
    expect(intervalMs('long-break', cfg)).toBe(15 * 60_000);
  });
});

describe('pomodoro advance', () => {
  it('stays in work before the boundary and counts live time in the view', () => {
    const s = startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg });
    const v = currentView(s, at(10), opts());
    expect(v.phase).toBe('work');
    expect(v.workSeconds).toBe(600);
    expect(v.phaseRemainingSeconds).toBe(900);
  });

  it('auto-starts the break, banks exactly 25 minutes of work', () => {
    const s = advance(startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg }), at(27), opts());
    expect(s.phase).toBe('short-break');
    expect(s.cycle).toBe(1);
    expect(s.workSeconds).toBe(1500);
    expect(s.phaseStartedAt).toBe(at(25));
    expect(s.phaseEndsAt).toBe(at(30));
    const v = viewTimer(s, at(27));
    expect(v.breakSeconds).toBe(120);
    expect(v.phaseRemainingSeconds).toBe(180);
  });

  it('pauses after the break when autoStartWork is off', () => {
    const s = advance(startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg }), at(40), opts());
    expect(s.phase).toBe('paused');
    expect(s.resumePhase).toBe('work');
    expect(s.workSeconds).toBe(1500);
    expect(s.breakSeconds).toBe(300);
    expect(s.phaseStartedAt).toBe(at(30));
    // Paused time is not banked anywhere.
    const v = viewTimer(s, at(40));
    expect(v.workSeconds + v.breakSeconds + v.idleSeconds).toBe(1800);
    expect(v.phaseRemainingSeconds).toBe(1500);
  });

  it('runs whole cycles when both auto-starts are on and uses a long break every 4th', () => {
    const o = opts({ autoStartWork: true });
    // 4 work (100) + 3 short (15) = 115 min -> at 116, in long break
    const s = advance(startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg }), at(116), o);
    expect(s.phase).toBe('long-break');
    expect(s.cycle).toBe(4);
    expect(s.workSeconds).toBe(6000);
    expect(s.breakSeconds).toBe(900);
  });

  it('pauses at the end of work when autoStartBreaks is off', () => {
    const s = advance(
      startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg }),
      at(30),
      opts({ autoStartBreaks: false }),
    );
    expect(s.phase).toBe('paused');
    expect(s.resumePhase).toBe('short-break');
    expect(s.resumeRemainingMs).toBe(300_000);
  });

  it('is idempotent', () => {
    const a = advance(startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg }), at(40), opts());
    const b = advance(a, at(40), opts());
    expect(b).toEqual(a);
  });

  it('does nothing once ended', () => {
    const s = applyEvent(
      startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg }),
      { type: 'end' },
      at(5),
      opts(),
    );
    expect(advance(s, at(60), opts())).toEqual(s);
    expect(applyEvent(s, { type: 'resume' }, at(60), opts())).toEqual(s);
  });
});

describe('events', () => {
  it('pause and resume keep the remaining interval', () => {
    let s = startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg });
    s = applyEvent(s, { type: 'pause' }, at(10), opts());
    expect(s.phase).toBe('paused');
    expect(s.workSeconds).toBe(600);
    expect(s.resumeRemainingMs).toBe(15 * 60_000);
    expect(applyEvent(s, { type: 'pause' }, at(11), opts())).toEqual(s);
    s = applyEvent(s, { type: 'resume' }, at(20), opts());
    expect(s.phase).toBe('work');
    expect(s.phaseEndsAt).toBe(at(35));
    expect(currentView(s, at(30), opts()).workSeconds).toBe(1200);
    expect(applyEvent(s, { type: 'resume' }, at(21), opts())).toEqual(s);
  });

  it('resume with no interval info falls back to a full interval', () => {
    let s = startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg });
    s = { ...s, phase: 'paused', resumePhase: null, resumeRemainingMs: null };
    s = applyEvent(s, { type: 'resume' }, at(1), opts());
    expect(s.phase).toBe('work');
    expect(s.phaseEndsAt).toBe(at(26));
  });

  it('pause in unlimited mode has no remaining interval', () => {
    let s = startTimer({ mode: 'unlimited', now: T0, pomodoro: cfg });
    s = applyEvent(s, { type: 'pause' }, at(10), opts());
    expect(s.resumeRemainingMs).toBeNull();
    s = applyEvent(s, { type: 'resume' }, at(20), opts());
    expect(s.phaseEndsAt).toBeNull();
    expect(currentView(s, at(25), opts()).workSeconds).toBe(900);
  });

  it('skip-break starts a fresh work interval', () => {
    let s = advance(startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg }), at(27), opts());
    s = applyEvent(s, { type: 'skip-break' }, at(27), opts());
    expect(s.phase).toBe('work');
    expect(s.breakSeconds).toBe(120);
    expect(s.phaseEndsAt).toBe(at(52));
    // skipping while in work does nothing
    expect(applyEvent(s, { type: 'skip-break' }, at(28), opts())).toEqual(s);
    // skipping while paused before a break also starts work
    let p = advance(
      startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg }),
      at(30),
      opts({ autoStartBreaks: false }),
    );
    p = applyEvent(p, { type: 'skip-break' }, at(31), opts({ autoStartBreaks: false }));
    expect(p.phase).toBe('work');
    // unlimited ignores it
    const u = startTimer({ mode: 'unlimited', now: T0, pomodoro: cfg });
    expect(applyEvent(u, { type: 'skip-break' }, at(1), opts())).toEqual(u);
  });

  it('reads an older idle timer as paused, about to resume into work', () => {
    const s = startTimer({ mode: 'pomodoro', now: T0, pomodoro: cfg });
    const legacy = {
      ...s,
      phase: 'idle' as TimerState['phase'],
      phaseEndsAt: null,
      resumePhase: null,
      resumeRemainingMs: 15 * 60_000,
      idleSeconds: 120,
    };
    const fixed = normalizeTimer(legacy);
    expect(fixed.phase).toBe('paused');
    expect(fixed.resumePhase).toBe('work');
    expect(fixed.resumeRemainingMs).toBe(15 * 60_000);
    expect(fixed.idleSeconds).toBe(120);
    const resumed = applyEvent(fixed, { type: 'resume' }, at(5), opts());
    expect(resumed.phase).toBe('work');
    expect(resumed.phaseEndsAt).toBe(at(20));
    // A current state is handed back as it is.
    expect(normalizeTimer(s)).toBe(s);
  });

  it('end banks the live phase', () => {
    let s = startTimer({ mode: 'unlimited', now: T0, pomodoro: cfg });
    s = applyEvent(s, { type: 'end' }, at(33), opts());
    expect(s.phase).toBe('ended');
    expect(s.workSeconds).toBe(1980);
    const v = viewTimer(s, at(60));
    expect(v.phaseElapsedSeconds).toBe(0);
    expect(v.workSeconds).toBe(1980);
  });

  it('toggles timer visibility even after end', () => {
    let s = startTimer({ mode: 'unlimited', now: T0, pomodoro: cfg });
    s = applyEvent(s, { type: 'set-timer-visibility', showTimer: false }, at(1), opts());
    expect(s.showTimer).toBe(false);
    s = applyEvent(s, { type: 'end' }, at(2), opts());
    s = applyEvent(s, { type: 'set-timer-visibility', showTimer: true }, at(3), opts());
    expect(s.showTimer).toBe(true);
  });
});

describe('scheduled mode', () => {
  it('shows grace after the planned end and auto-ends after 60 s, crediting work to the planned end', () => {
    const s = startTimer({ mode: 'scheduled', now: T0, pomodoro: cfg, plannedEndAt: at(30) });
    const v = currentView(s, at(30, 20), opts());
    expect(v.phase).toBe('work');
    expect(v.graceRemainingSeconds).toBe(40);
    expect(currentView(s, at(29), opts()).graceRemainingSeconds).toBeNull();
    const ended = advance(s, at(31, 5), opts());
    expect(ended.phase).toBe('ended');
    expect(ended.autoEnded).toBe(true);
    expect(ended.endedAt).toBe(at(30));
    expect(ended.workSeconds).toBe(1800);
  });

  it('extend moves the planned end and cancels the auto-end', () => {
    let s = startTimer({ mode: 'scheduled', now: T0, pomodoro: cfg, plannedEndAt: at(30) });
    s = applyEvent(s, { type: 'extend', plannedEndAt: at(45) }, at(30, 30), opts());
    expect(s.plannedEndAt).toBe(at(45));
    expect(s.phaseEndsAt).toBe(at(45));
    expect(advance(s, at(40), opts()).phase).toBe('work');
    // extending into the past is ignored
    expect(applyEvent(s, { type: 'extend', plannedEndAt: at(10) }, at(40), opts())).toEqual(s);
    // unlimited ignores extend
    const u = startTimer({ mode: 'unlimited', now: T0, pomodoro: cfg });
    expect(applyEvent(u, { type: 'extend', plannedEndAt: at(10) }, at(1), opts())).toEqual(u);
  });

  it('auto-ends from a paused state without crediting paused time', () => {
    let s = startTimer({ mode: 'scheduled', now: T0, pomodoro: cfg, plannedEndAt: at(30) });
    s = applyEvent(s, { type: 'pause' }, at(10), opts());
    const ended = advance(s, at(32), opts());
    expect(ended.phase).toBe('ended');
    expect(ended.workSeconds).toBe(600);
  });

  it('pause and resume in scheduled mode keep the planned end', () => {
    let s = startTimer({ mode: 'scheduled', now: T0, pomodoro: cfg, plannedEndAt: at(30) });
    s = applyEvent(s, { type: 'pause' }, at(10), opts());
    s = applyEvent(s, { type: 'resume' }, at(12), opts());
    expect(s.phaseEndsAt).toBe(at(30));
  });
});

describe('formatClock', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(1500)).toBe('25:00');
    expect(formatClock(3661)).toBe('1:01:01');
    expect(formatClock(-5)).toBe('0:00');
  });
});

describe('a pomodoro runs its cycle without being nudged', () => {
  const cfg = { workMin: 25, shortBreakMin: 5, longBreakMin: 15, cyclesBeforeLong: 4 };
  const t0 = '2026-09-21T14:00:00.000Z';
  const at = (min: number) => new Date(Date.parse(t0) + min * 60_000).toISOString();
  const opts = (autoStartWork: boolean) => ({
    pomodoro: cfg,
    autoStartBreaks: true,
    autoStartWork,
  });

  /** Walk the timer minute by minute and record the phase at each step. */
  const walk = (autoStartWork: boolean, minutes: number) => {
    let s = startTimer({ mode: 'pomodoro', now: t0, pomodoro: cfg });
    const phases: string[] = [];
    for (let m = 0; m <= minutes; m++) {
      s = advance(s, at(m), opts(autoStartWork));
      phases.push(s.phase);
    }
    return { state: s, phases };
  };

  it('loops work and break indefinitely by default', () => {
    const { phases } = walk(true, 300);
    // It never parks itself waiting to be resumed.
    expect(phases).not.toContain('paused');
    expect(phases).not.toContain('ended');
    // Both kinds of block are reached, over and over.
    expect(phases.filter((p) => p === 'work').length).toBeGreaterThan(100);
    expect(phases.filter((p) => p === 'short-break').length).toBeGreaterThan(10);
  });

  it('takes a long break every fourth work block', () => {
    const { phases } = walk(true, 300);
    expect(phases).toContain('long-break');
    // First long break follows 4 work blocks and 3 short breaks: 4*25 + 3*5 = 115 min.
    expect(phases[115]).toBe('long-break');
    expect(phases[114]).toBe('work');
  });

  it('stalls after the first break when auto-start work is off', () => {
    const { phases } = walk(false, 120);
    expect(phases[30]).toBe('paused');
    // And stays there: this is what "the timer stopped" looked like.
    expect(phases.slice(30).every((p) => p === 'paused')).toBe(true);
  });

  it('still stops at a planned end while looping', () => {
    const plannedEndAt = at(55);
    let s = startTimer({ mode: 'pomodoro', now: t0, pomodoro: cfg, plannedEndAt });
    for (let m = 0; m <= 70; m++) s = advance(s, at(m), opts(true));
    expect(s.phase).toBe('ended');
    expect(s.endedAt).toBe(plannedEndAt);
    expect(s.autoEnded).toBe(true);
  });
});
