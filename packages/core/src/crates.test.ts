import { describe, expect, it } from 'vitest';
import {
  CRATE_TICKETS,
  CRATE_TIERS,
  crateName,
  crateOdds,
  crateOffersFrom,
  isCrateTier,
  openCrate,
  PET_RARITIES,
  PETS,
  petsOf,
} from './crates';

describe('crates', () => {
  it('comes from 1/64 up, named after the title', () => {
    expect(CRATE_TIERS).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(isCrateTier(5)).toBe(false);
    expect(isCrateTier(6)).toBe(true);
    expect(isCrateTier(16)).toBe(false);
    expect(crateName(6)).toBe('Crystal crate');
    expect(crateName(15)).toBe('Genesis crate');
  });

  it('has a table of a thousand tickets for every crate', () => {
    for (const tier of CRATE_TIERS) {
      const sum = crateOdds(tier).reduce((s, l) => s + l.weight, 0);
      expect(sum, `tier ${tier}`).toBe(CRATE_TICKETS);
    }
    expect(crateOdds(5)).toEqual([]);
  });

  it('gives mostly 5 XP, and 100 at most and rarely', () => {
    for (const tier of CRATE_TIERS) {
      const xp = crateOdds(tier).filter((l) => l.drop.kind === 'xp');
      const top = Math.max(...xp.map((l) => (l.drop.kind === 'xp' ? l.drop.xp : 0)));
      expect(top).toBe(100);
      const five = xp.find((l) => l.drop.kind === 'xp' && l.drop.xp === 5)!;
      expect(xp.every((l) => l === five || l.weight < five.weight)).toBe(true);
      const hundred = xp.find((l) => l.drop.kind === 'xp' && l.drop.xp === 100)!;
      expect(hundred.weight).toBeLessThanOrEqual(10);
    }
  });

  it('is better the rarer the crate: rarer pets and rarer crates', () => {
    const rareShare = (tier: number) =>
      crateOdds(tier)
        .filter((l) => l.drop.kind === 'pet' && PET_RARITIES.indexOf(l.drop.rarity) >= 3)
        .reduce((s, l) => s + l.weight, 0);
    const crateShare = (tier: number) =>
      crateOdds(tier)
        .filter((l) => l.drop.kind === 'crate')
        .reduce((s, l) => s + l.weight, 0);
    for (let tier = 7; tier <= 15; tier++) {
      expect(rareShare(tier)).toBeGreaterThan(rareShare(tier - 1));
      expect(crateShare(tier)).toBeGreaterThan(crateShare(tier - 1));
    }
    // Crystal has no legendary or mythic pets; Genesis has both.
    expect(crateOdds(6).some((l) => l.drop.kind === 'pet' && l.drop.rarity === 'mythic')).toBe(
      false,
    );
    expect(crateOdds(15).some((l) => l.drop.kind === 'pet' && l.drop.rarity === 'mythic')).toBe(
      true,
    );
  });

  it('only holds crates rarer or as rare as itself', () => {
    for (const tier of CRATE_TIERS)
      for (const l of crateOdds(tier))
        if (l.drop.kind === 'crate') expect(l.drop.tier).toBeGreaterThanOrEqual(tier);
  });

  it('opens on the line a ticket lands in', () => {
    expect(openCrate(6, 0, 0)).toEqual({ kind: 'xp', xp: 5 });
    expect(openCrate(6, 459, 0)).toEqual({ kind: 'xp', xp: 5 });
    expect(openCrate(6, 460, 0)).toEqual({ kind: 'xp', xp: 10 });
    // After 557 tickets of XP come the commons; `pick` chooses one.
    expect(openCrate(6, 557, 0)).toEqual({ kind: 'pet', pet: petsOf('common')[0]!.id });
    expect(openCrate(6, 557, 1)).toEqual({ kind: 'pet', pet: petsOf('common')[1]!.id });
    // The last ten tickets of a Crystal crate are an Ember crate.
    expect(openCrate(6, 999, 0)).toEqual({ kind: 'crate', tier: 7 });
    expect(openCrate(5, 0, 0)).toBeNull();
  });

  it('can give every pet from some crate', () => {
    const rarities = new Set(
      CRATE_TIERS.flatMap((t) =>
        crateOdds(t).flatMap((l) => (l.drop.kind === 'pet' ? [l.drop.rarity] : [])),
      ),
    );
    for (const p of PETS) expect(rarities.has(p.rarity)).toBe(true);
    expect(new Set(PETS.map((p) => p.id)).size).toBe(PETS.length);
  });

  it('offers a crate for each prestiged rarity of 1/64 or rarer still held', () => {
    const made = Array(15).fill(0);
    const held = Array(15).fill(0);
    made[4] = 5; // 1/32s: no crates
    made[5] = 2; // two 1/64s made, one went on into a 1/128
    held[5] = 1;
    made[6] = 1;
    held[6] = 3;
    expect(crateOffersFrom(made, held)).toEqual([6, 7]);
  });
});
