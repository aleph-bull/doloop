import { describe, expect, it } from 'vitest';
import { BADGES, satisfiedBadges, type BadgeInput } from './badges';
import { nameTier, ROLL_TICKETS, ROLL_TIERS, rollBadgeKey, rollOdds, rollTier } from './rolls';
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

  it('has a title for every rarity, 1/2 to 1/8192', () => {
    expect(ROLL_TIERS).toHaveLength(13);
    expect(new Set(ROLL_TIERS.map((t) => t.title)).size).toBe(13);
    expect(rollOdds(1)).toBe('1/2');
    expect(rollOdds(13)).toBe('1/8192');
  });

  it('colours the name from 1 in 256 when on', () => {
    expect(nameTier(7, true)).toBeNull();
    expect(nameTier(8, true)).toBe(8);
    expect(nameTier(12, false)).toBeNull();
  });

  it('has a badge for every rarity past 1 in 256, earned by the rarest roll', () => {
    const keys = BADGES.filter((b) => b.roll).map((b) => b.key);
    expect(keys).toEqual(['roll-512', 'roll-1024', 'roll-2048', 'roll-4096', 'roll-8192']);
    expect(rollBadgeKey(8)).toBeNull();
    const input: BadgeInput = {
      nodes: [],
      sessions: [],
      plannedBlocks: [],
      streak: emptyStreak(),
      freezeDates: [],
      timezone: 'UTC',
      unlocked: [],
      today: '2026-10-25',
      rollBest: 10,
    };
    const done = satisfiedBadges(input);
    expect(done.has('roll-512')).toBe(true);
    expect(done.has('roll-1024')).toBe(true);
    expect(done.has('roll-2048')).toBe(false);
  });
});
