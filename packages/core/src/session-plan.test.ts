import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import { describeCut, hasPlannedEnd, modeForPlan, pomodoroCut, styleForMode } from './session-plan';
import type { PomodoroConfig } from './types';

/** 25 work / 5 short / 15 long / long every 4. */
const CFG: PomodoroConfig = DEFAULT_SETTINGS.pomodoro;
const END = '2026-09-21T18:00:00.000Z';

describe('the two axes map onto the stored mode', () => {
  it('keeps the three existing modes meaning exactly what they did', () => {
    expect(modeForPlan({ style: 'pomodoro', plannedEndAt: null })).toBe('pomodoro');
    expect(modeForPlan({ style: 'continuous', plannedEndAt: null })).toBe('unlimited');
    expect(modeForPlan({ style: 'continuous', plannedEndAt: END })).toBe('scheduled');
  });

  it('stores a pomodoro with an end time as a pomodoro, so no migration is needed', () => {
    expect(modeForPlan({ style: 'pomodoro', plannedEndAt: END })).toBe('pomodoro');
  });

  it('reads the style back out of a stored mode', () => {
    expect(styleForMode('pomodoro')).toBe('pomodoro');
    expect(styleForMode('unlimited')).toBe('continuous');
    expect(styleForMode('scheduled')).toBe('continuous');
  });

  it('knows which sessions run to a planned end', () => {
    expect(hasPlannedEnd('scheduled', END)).toBe(true);
    expect(hasPlannedEnd('pomodoro', END)).toBe(true);
    expect(hasPlannedEnd('pomodoro', null)).toBe(false);
    expect(hasPlannedEnd('unlimited', null)).toBe(false);
  });
});

describe('pomodoroCut', () => {
  // The schedule is 25 work, 5 break, 25, 5, 25, 5, 25, 15 long, then repeats.
  it('returns null on a clean block boundary', () => {
    expect(pomodoroCut(25, CFG)).toBeNull(); // end of the first work block
    expect(pomodoroCut(30, CFG)).toBeNull(); // end of the first short break
    expect(pomodoroCut(55, CFG)).toBeNull(); // end of the second work block
    expect(pomodoroCut(115, CFG)).toBeNull(); // end of the fourth work block
    expect(pomodoroCut(130, CFG)).toBeNull(); // end of the long break
  });

  it('reports a work block cut short', () => {
    expect(pomodoroCut(20, CFG)).toMatchObject({ phase: 'work', minutesEarly: 5 });
    expect(pomodoroCut(45, CFG)).toMatchObject({ phase: 'work', minutesEarly: 10 });
  });

  it('reports a short break cut short', () => {
    expect(pomodoroCut(27, CFG)).toMatchObject({ phase: 'short-break', minutesEarly: 3 });
  });

  it('reports a long break cut short', () => {
    // Four work blocks and three short breaks end at 115; the long break runs to 130.
    expect(pomodoroCut(120, CFG)).toMatchObject({ phase: 'long-break', minutesEarly: 10 });
  });

  it('carries the clean lengths either side', () => {
    expect(pomodoroCut(20, CFG)).toMatchObject({
      previousBoundaryMinutes: 0,
      nextBoundaryMinutes: 25,
    });
    expect(pomodoroCut(45, CFG)).toMatchObject({
      previousBoundaryMinutes: 30,
      nextBoundaryMinutes: 55,
    });
  });

  it('keeps working across several long-break cycles', () => {
    // A full set is 130 min; the next work block runs 130 to 155, then a break to 160.
    expect(pomodoroCut(155, CFG)).toBeNull();
    expect(pomodoroCut(160, CFG)).toBeNull();
    expect(pomodoroCut(150, CFG)).toMatchObject({ phase: 'work', minutesEarly: 5 });
  });

  it('says nothing for a non-length', () => {
    expect(pomodoroCut(0, CFG)).toBeNull();
    expect(pomodoroCut(-10, CFG)).toBeNull();
    expect(pomodoroCut(Number.NaN, CFG)).toBeNull();
  });

  it('does not hang on a degenerate configuration', () => {
    const zero: PomodoroConfig = { ...CFG, workMin: 0, shortBreakMin: 0, longBreakMin: 0 };
    expect(pomodoroCut(60, zero)).toBeNull();
  });

  it('handles a config with no breaks at all', () => {
    const noBreaks: PomodoroConfig = { ...CFG, shortBreakMin: 0, longBreakMin: 0 };
    expect(pomodoroCut(50, noBreaks)).toBeNull();
    expect(pomodoroCut(40, noBreaks)).toMatchObject({ phase: 'work', minutesEarly: 10 });
  });
});

describe('describeCut', () => {
  it('names the block and how much is lost', () => {
    expect(describeCut(pomodoroCut(20, CFG))).toBe(
      'Are you sure? This will end your work block 5 minutes early.',
    );
    expect(describeCut(pomodoroCut(27, CFG))).toBe(
      'Are you sure? This will end your short break 3 minutes early.',
    );
    expect(describeCut(pomodoroCut(120, CFG))).toBe(
      'Are you sure? This will end your long break 10 minutes early.',
    );
  });

  it('uses the singular for one minute', () => {
    expect(describeCut(pomodoroCut(24, CFG))).toContain('1 minute early');
  });

  it('says nothing for a clean length', () => {
    expect(describeCut(pomodoroCut(25, CFG))).toBeNull();
    expect(describeCut(null)).toBeNull();
  });
});
