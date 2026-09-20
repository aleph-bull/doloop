import { describe, expect, it } from 'vitest';
import {
  computeSessionXp,
  focusXp,
  levelForXp,
  levelProgress,
  streakMultiplier,
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
  it('awards base effort only for a skipped review on a behind node', () => {
    const r = computeSessionXp(base);
    expect(r.base).toBe(10 + 5); // 25 min / 5
    expect(r.reviewSubmitted).toBe(0);
    expect(r.focus).toBe(0);
    expect(r.plannedBlock).toBe(0);
    expect(r.onPace).toBe(0);
    expect(r.estimateBeat).toBe(0);
    expect(r.streakMult).toBe(1);
    expect(r.total).toBe(15);
  });

  it('floors work minutes and never goes negative', () => {
    expect(computeSessionXp({ ...base, workMinutes: 4.9 }).base).toBe(10);
    expect(computeSessionXp({ ...base, workMinutes: -30 }).base).toBe(10);
  });

  it('adds every bonus', () => {
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
      base: 22,
      reviewSubmitted: 5,
      focus: 15,
      plannedBlock: 10,
      onPace: 10,
      estimateBeat: 10,
      subtotal: 72,
      streakMult: 1,
      total: 72,
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
    expect(computeSessionXp({ ...base, statusAfter: 'done' }).onPace).toBe(10);
    expect(computeSessionXp({ ...base, statusAfter: 'critical' }).onPace).toBe(0);
  });

  it('applies the streak multiplier, capped at 1.3x, floored', () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(10)).toBeCloseTo(1.1);
    expect(streakMultiplier(30)).toBeCloseTo(1.3);
    expect(streakMultiplier(300)).toBeCloseTo(1.3);
    expect(streakMultiplier(-5)).toBe(1);
    // 15 * 1.3 = 19.5 -> 19
    expect(computeSessionXp({ ...base, streakCurrent: 30 }).total).toBe(19);
  });

  it('maps distraction answers to focus xp', () => {
    expect(focusXp('no')).toBe(15);
    expect(focusXp('a-little')).toBe(5);
    expect(focusXp('a-lot')).toBe(0);
    expect(focusXp(null)).toBe(0);
  });
});

describe('levels', () => {
  it('computes level = floor(sqrt(xp/50))', () => {
    expect(levelForXp(0)).toBe(0);
    expect(levelForXp(49)).toBe(0);
    expect(levelForXp(50)).toBe(1);
    expect(levelForXp(199)).toBe(1);
    expect(levelForXp(200)).toBe(2);
    expect(levelForXp(-10)).toBe(0);
  });

  it('inverts with xpForLevel', () => {
    expect(xpForLevel(0)).toBe(0);
    expect(xpForLevel(1)).toBe(50);
    expect(xpForLevel(5)).toBe(1250);
    for (const l of [0, 1, 3, 7, 12]) expect(levelForXp(xpForLevel(l))).toBe(l);
  });

  it('reports progress into the current level', () => {
    const p = levelProgress(275);
    expect(p.level).toBe(2);
    expect(p.currentLevelXp).toBe(200);
    expect(p.nextLevelXp).toBe(450);
    expect(p.intoLevel).toBe(75);
    expect(p.toNext).toBe(175);
    expect(p.ratio).toBeCloseTo(0.3);
  });
});
