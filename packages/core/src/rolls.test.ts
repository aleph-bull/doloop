import { describe, expect, it } from 'vitest';
import { BADGES, satisfiedBadges, type BadgeInput } from './badges';
import { withDefaults } from './defaults';
import {
  advanceRollStats,
  nameTier,
  PRESTIGE_RATE,
  prestigeAll,
  prestigeOnce,
  rollBadges,
  ROLL_TICKETS,
  ROLL_TIERS,
  rollBadgeKey,
  rollOdds,
  rollPayout,
  rollTier,
  type RollStats,
} from './rolls';
import { emptyStreak } from './streak';

describe('rolls', () => {
  it('lands each rarity on exactly 1 in 2^tier of the tickets', () => {
    const hits = new Map<number, number>();
    for (let t = 0; t < ROLL_TICKETS; t++) hits.set(rollTier(t), (hits.get(rollTier(t)) ?? 0) + 1);
    // Ticket 0 goes to the commonest, so 1 in 2 has one extra.
    expect(hits.get(1)).toBe(ROLL_TICKETS / 2 + 1);
    for (const { tier } of ROLL_TIERS.slice(1))
      expect(hits.get(tier)).toBe(ROLL_TICKETS / 2 ** tier);
  });

  it('pays back a tenth of the denominator, rounded', () => {
    expect([1, 2, 3, 4, 5, 8, 15].map(rollPayout)).toEqual([0, 0, 1, 2, 3, 26, 3277]);
    // On average about 1.5 XP back on each 10 XP roll.
    const average = ROLL_TIERS.reduce((a, t) => a + rollPayout(t.tier) / 2 ** t.tier, 0);
    expect(average).toBeGreaterThan(1.3);
    expect(average).toBeLessThan(1.6);
  });

  it('has a title for every rarity, 1/2 to 1/32768', () => {
    expect(ROLL_TIERS).toHaveLength(15);
    expect(new Set(ROLL_TIERS.map((t) => t.title)).size).toBe(15);
    expect(rollOdds(1)).toBe('1/2');
    expect(rollOdds(15)).toBe('1/32768');
  });

  it('styles the name by the rarest from 1/256, or by a pick from Sapphire up to it', () => {
    expect(nameTier(7)).toBeNull();
    expect(nameTier(8)).toBe(8);
    expect(nameTier(12, 'off')).toBeNull();
    expect(nameTier(12, 9)).toBe(9);
    expect(nameTier(12, 8)).toBe(8);
    // Not reached yet, or below Sapphire: the rarest instead.
    expect(nameTier(9, 12)).toBe(9);
    expect(nameTier(12, 6)).toBe(12);
    expect(nameTier(6, 5)).toBeNull();
  });

  it('turns the old name colour switch, when off, into a plain name', () => {
    expect(withDefaults({ social: { rollColour: false } } as never).rolls.name).toBe('off');
    expect(withDefaults({ social: { rollColour: true } } as never).rolls.name).toBe('auto');
    expect(
      withDefaults({ social: { rollColour: false }, rolls: { name: 9 } } as never).rolls.name,
    ).toBe(9);
    expect('rollColour' in withDefaults({ social: { rollColour: false } } as never).social).toBe(
      false,
    );
  });

  it('keeps the running record the gambling badges read', () => {
    let s: RollStats = {};
    const tiers = [1, 1, 4, 5, 1, 1, 1];
    tiers.forEach((t, i) => (s = advanceRollStats(s, t, i)));
    expect(s).toMatchObject({
      hit: (1 << 1) | (1 << 4) | (1 << 5),
      last: 1,
      commonRun: 3,
      longestCommonRun: 3,
      doubles: 1,
      firstTen: 5,
    });
    // Past the first ten, firstTen stays.
    s = advanceRollStats(s, 9, 10);
    expect(s.firstTen).toBe(5);
  });

  it('has a badge for every rarity past 1/256 and the gambling feats', () => {
    const keys = BADGES.filter((b) => b.roll).map((b) => b.key);
    expect(keys).toEqual([
      'rolls-10',
      'roll-rare',
      'roll-double',
      'rolls-100',
      'roll-beginner',
      'roll-cold',
      'roll-full-house',
      'rolls-500',
      'rolls-1000',
      'roll-512',
      'roll-1024',
      'roll-2048',
      'roll-4096',
      'roll-8192',
      'roll-16384',
      'roll-32768',
    ]);
    expect(rollBadgeKey(8)).toBeNull();
    const full = (1 << 7) - 2;
    expect(
      [...rollBadges({ count: 120, best: 10, stats: { hit: full, longestCommonRun: 8 } })].sort(),
    ).toEqual(
      [
        'roll-1024',
        'roll-512',
        'roll-cold',
        'roll-full-house',
        'roll-rare',
        'rolls-10',
        'rolls-100',
      ].sort(),
    );
    const input: BadgeInput = {
      nodes: [],
      sessions: [],
      plannedBlocks: [],
      streak: emptyStreak(),
      freezeDates: [],
      timezone: 'UTC',
      unlocked: [],
      today: '2026-10-25',
      rolls: { count: 3, best: 9, stats: { doubles: 1, firstTen: 9 } },
    };
    const done = satisfiedBadges(input);
    for (const k of ['roll-512', 'roll-double', 'roll-beginner', 'roll-rare'])
      expect(done.has(k)).toBe(true);
    expect(done.has('roll-1024')).toBe(false);
  });
});

describe('prestige', () => {
  it('makes one of the next rarity from five', () => {
    expect(prestigeOnce([12, 1], 1)).toEqual({
      held: [7, 2, ...Array(13).fill(0)],
      made: [0, 1, ...Array(13).fill(0)],
    });
    expect(prestigeOnce([12], 1, 2)?.held.slice(0, 2)).toEqual([2, 2]);
    expect(prestigeOnce([4], 1)).toBeNull();
    // Nothing past the rarest.
    expect(prestigeOnce(Array(15).fill(9), 15)).toBeNull();
  });

  it('prestiges everything it can, carrying up as it goes', () => {
    // 27 commons make 5 uncommons (2 left); with 1 held that is 6, making 1 good (1 left).
    const r = prestigeAll([27, 1]);
    expect(r?.held.slice(0, 3)).toEqual([2, 1, 1]);
    expect(r?.made.slice(0, 3)).toEqual([0, 5, 1]);
    expect(prestigeAll([4, 4, 4])).toBeNull();
  });

  it('is two and a half times dearer than rolling for it', () => {
    // A rarity is worth two of the one below; five go for one.
    expect(PRESTIGE_RATE / 2).toBe(2.5);
  });
});
