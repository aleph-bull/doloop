import { describe, expect, it } from 'vitest';
import {
  computeSessionXp,
  focusPct,
  isEndedEarly,
  isWithheld,
  levelForXp,
  levelProgress,
  streakBonus,
  xpForLevel,
  type SessionXpInput,
} from './xp';

const base: SessionXpInput = {
  workMinutes: 25,
  reviewSubmitted: false,
  distracted: null,
  overlapsPlannedBlock: false,
  statusAfter: 'behind',
  nodeJustCompleted: false,
  loggedWorkMinutesAfter: 25,
  estimatedMinutes: 100,
  streakCurrent: 0,
};

describe('computeSessionXp', () => {
  it('awards 2 XP per focused minute with no bonuses for a skipped review on a behind node', () => {
    const r = computeSessionXp(base);
    expect(r).toEqual({
      base: 50,
      reviewSubmitted: 0,
      focus: 0,
      plannedBlock: 0,
      onPace: 0,
      estimateBeat: 0,
      streakBonus: 0,
      total: 50,
      withheld: false,
    });
  });

  it('scales with time: twice the minutes, twice the XP', () => {
    const a = computeSessionXp({
      ...base,
      workMinutes: 20,
      reviewSubmitted: true,
      distracted: 'no',
    });
    const b = computeSessionXp({
      ...base,
      workMinutes: 40,
      reviewSubmitted: true,
      distracted: 'no',
    });
    expect(b.total).toBe(a.total * 2);
  });

  it('floors minutes and never goes negative; under a minute earns nothing', () => {
    expect(computeSessionXp({ ...base, workMinutes: 4.9 }).base).toBe(8);
    expect(computeSessionXp({ ...base, workMinutes: 0.9 }).total).toBe(0);
    expect(computeSessionXp({ ...base, workMinutes: -30 }).total).toBe(0);
  });

  it('adds every bonus as a percentage of the base', () => {
    const r = computeSessionXp({
      ...base,
      workMinutes: 60,
      reviewSubmitted: true,
      distracted: 'no',
      overlapsPlannedBlock: true,
      statusAfter: 'on-track',
      nodeJustCompleted: true,
      loggedWorkMinutesAfter: 90,
      estimatedMinutes: 100,
    });
    expect(r).toMatchObject({
      base: 120,
      reviewSubmitted: 12,
      focus: 24,
      plannedBlock: 12,
      onPace: 12,
      estimateBeat: 24,
      streakBonus: 0,
      total: 204,
      withheld: false,
    });
  });

  it('gives no estimate-beat when logged exceeds estimate or node not completed', () => {
    expect(
      computeSessionXp({ ...base, nodeJustCompleted: true, loggedWorkMinutesAfter: 101 })
        .estimateBeat,
    ).toBe(0);
    expect(
      computeSessionXp({ ...base, nodeJustCompleted: false, loggedWorkMinutesAfter: 50 })
        .estimateBeat,
    ).toBe(0);
    expect(
      computeSessionXp({ ...base, nodeJustCompleted: true, estimatedMinutes: null }).estimateBeat,
    ).toBe(0);
  });

  it('awards on-pace for done as well as on-track', () => {
    expect(computeSessionXp({ ...base, statusAfter: 'done' }).onPace).toBe(5);
    expect(computeSessionXp({ ...base, statusAfter: 'critical' }).onPace).toBe(0);
  });

  it('adds a fixed streak bonus of 1 XP per day, capped at 30', () => {
    expect(streakBonus(0)).toBe(0);
    expect(streakBonus(10)).toBe(10);
    expect(streakBonus(30)).toBe(30);
    expect(streakBonus(300)).toBe(30);
    expect(streakBonus(-5)).toBe(0);
    expect(computeSessionXp({ ...base, streakCurrent: 12 }).total).toBe(62);
    // No streak bonus without any focused time.
    expect(computeSessionXp({ ...base, workMinutes: 0, streakCurrent: 12 }).total).toBe(0);
  });

  it('withholds everything when the session ended early and short', () => {
    const r = computeSessionXp({
      ...base,
      workMinutes: 8,
      reviewSubmitted: true,
      distracted: 'no',
      streakCurrent: 9,
      endedEarly: true,
    });
    expect(r.total).toBe(0);
    expect(r.withheld).toBe(true);
  });

  it('an early end still pays once ten focused minutes are in', () => {
    const short = computeSessionXp({ ...base, workMinutes: 9.9, endedEarly: true });
    expect(short.withheld).toBe(true);
    const enough = computeSessionXp({ ...base, workMinutes: 10, endedEarly: true });
    expect(enough.withheld).toBe(false);
    expect(enough.base).toBe(20);
    expect(computeSessionXp({ ...base, workMinutes: 25, endedEarly: true }).base).toBe(50);
  });

  it('finishing the task or routine pays however early and short the session was', () => {
    const task = computeSessionXp({
      ...base,
      workMinutes: 3,
      endedEarly: true,
      nodeJustCompleted: true,
      loggedWorkMinutesAfter: 3,
    });
    expect(task.withheld).toBe(false);
    expect(task.base).toBe(6);
    expect(task.estimateBeat).toBe(1);
    const routine = computeSessionXp({
      ...base,
      workMinutes: 3,
      endedEarly: true,
      subjectCompleted: true,
    });
    expect(routine.withheld).toBe(false);
    expect(routine.base).toBe(6);
    expect(isWithheld({ endedEarly: true, workMinutes: 2, subjectCompleted: true })).toBe(false);
    expect(isWithheld({ endedEarly: true, workMinutes: 2 })).toBe(true);
    expect(isWithheld({ endedEarly: false, workMinutes: 0 })).toBe(false);
  });

  it('maps distraction answers to focus percentages', () => {
    expect(focusPct('no')).toBe(20);
    expect(focusPct('a-little')).toBe(5);
    expect(focusPct('a-lot')).toBe(0);
    expect(focusPct(null)).toBe(0);
  });
});

describe('isEndedEarly', () => {
  it('pomodoro: early until the first work interval completes', () => {
    expect(
      isEndedEarly({
        mode: 'pomodoro',
        cycle: 0,
        autoEnded: false,
        endedAt: null,
        plannedEndAt: null,
      }),
    ).toBe(true);
    expect(
      isEndedEarly({
        mode: 'pomodoro',
        cycle: 1,
        autoEnded: false,
        endedAt: null,
        plannedEndAt: null,
      }),
    ).toBe(false);
  });
  it('scheduled: early when stopped before the planned end, never when auto-ended', () => {
    const planned = '2026-09-20T15:00:00.000Z';
    expect(
      isEndedEarly({
        mode: 'scheduled',
        cycle: 0,
        autoEnded: false,
        endedAt: '2026-09-20T14:30:00.000Z',
        plannedEndAt: planned,
      }),
    ).toBe(true);
    expect(
      isEndedEarly({
        mode: 'scheduled',
        cycle: 0,
        autoEnded: false,
        endedAt: planned,
        plannedEndAt: planned,
      }),
    ).toBe(false);
    expect(
      isEndedEarly({
        mode: 'scheduled',
        cycle: 0,
        autoEnded: true,
        endedAt: '2026-09-20T14:30:00.000Z',
        plannedEndAt: planned,
      }),
    ).toBe(false);
    expect(
      isEndedEarly({
        mode: 'scheduled',
        cycle: 0,
        autoEnded: false,
        endedAt: null,
        plannedEndAt: planned,
      }),
    ).toBe(false);
  });
  it('unlimited: never early', () => {
    expect(
      isEndedEarly({
        mode: 'unlimited',
        cycle: 0,
        autoEnded: false,
        endedAt: '2026-09-20T14:30:00.000Z',
        plannedEndAt: null,
      }),
    ).toBe(false);
  });
});

describe('levels', () => {
  it('computes level = floor(sqrt(xp/100))', () => {
    expect(levelForXp(0)).toBe(0);
    expect(levelForXp(99)).toBe(0);
    expect(levelForXp(100)).toBe(1);
    expect(levelForXp(399)).toBe(1);
    expect(levelForXp(400)).toBe(2);
    expect(levelForXp(-10)).toBe(0);
  });

  it('inverts with xpForLevel', () => {
    expect(xpForLevel(0)).toBe(0);
    expect(xpForLevel(1)).toBe(100);
    expect(xpForLevel(5)).toBe(2500);
    for (const l of [0, 1, 3, 7, 12]) expect(levelForXp(xpForLevel(l))).toBe(l);
  });

  it('reports progress into the current level', () => {
    const p = levelProgress(550);
    expect(p.level).toBe(2);
    expect(p.currentLevelXp).toBe(400);
    expect(p.nextLevelXp).toBe(900);
    expect(p.intoLevel).toBe(150);
    expect(p.toNext).toBe(350);
    expect(p.ratio).toBeCloseTo(0.3);
  });
});
