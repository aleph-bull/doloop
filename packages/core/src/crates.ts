/**
 * Crates (asked for by the owner, 2026-10-29): a roll of 1 in 64 or rarer, rolled or made by
 * prestige, offers a crate of its rarity, named and coloured after its title (Crystal crate
 * up to Genesis crate). Taking it gives up that roll; keeping the title leaves it held. A
 * crate opens into a pet, a little XP (mostly 5, at most 100, rarely) or another crate, and
 * the rarer the crate the better its odds at rare pets and rare crates. Pets only sit in the
 * inventory for now: they do nothing yet (owner).
 *
 * The server draws what a crate gives (`openCrate` on two random tickets); the portal shows it.
 */
import { ROLL_TIERS_COUNT, rollTierInfo } from './rolls';

/** From this rarity (1 in 64, Crystal) a roll offers a crate. */
export const CRATE_FROM = 6;

/** Every crate's rarity, commonest first: 6 (Crystal) to 15 (Genesis). */
export const CRATE_TIERS: readonly number[] = Array.from(
  { length: ROLL_TIERS_COUNT - CRATE_FROM + 1 },
  (_, i) => CRATE_FROM + i,
);

export function isCrateTier(tier: number): boolean {
  return Number.isInteger(tier) && tier >= CRATE_FROM && tier <= ROLL_TIERS_COUNT;
}

/** "Crystal crate". */
export function crateName(tier: number): string {
  return `${rollTierInfo(tier)?.title ?? 'Mystery'} crate`;
}

/** How rare a pet is, commonest first. */
export const PET_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;
export type PetRarity = (typeof PET_RARITIES)[number];

export const PET_RARITY_NAMES: Record<PetRarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythic: 'Mythic',
};

export interface Pet {
  /** Also the name of its picture, `/pets/<id>.png` in the portal. */
  id: string;
  name: string;
  rarity: PetRarity;
}

/**
 * Every pet, from the owner's sprite packs (farm and hunt animals, slimes, the tiny heroes and
 * the axolotls in sixteen colours). Blue axolotls are the rarest, as they are in life.
 */
export const PETS: readonly Pet[] = [
  { id: 'chick', name: 'Chick', rarity: 'common' },
  { id: 'lamb', name: 'Lamb', rarity: 'common' },
  { id: 'piglet', name: 'Piglet', rarity: 'common' },
  { id: 'calf', name: 'Calf', rarity: 'common' },
  { id: 'sheep', name: 'Sheep', rarity: 'common' },
  { id: 'rooster', name: 'Rooster', rarity: 'common' },
  { id: 'hare', name: 'Hare', rarity: 'common' },
  { id: 'axolotl-pink', name: 'Pink axolotl', rarity: 'common' },
  { id: 'axolotl-brown', name: 'Brown axolotl', rarity: 'common' },
  { id: 'turkey', name: 'Turkey', rarity: 'uncommon' },
  { id: 'grouse', name: 'Grouse', rarity: 'uncommon' },
  { id: 'boar', name: 'Boar', rarity: 'uncommon' },
  { id: 'slime-1', name: 'Slime', rarity: 'uncommon' },
  { id: 'axolotl-tan', name: 'Tan axolotl', rarity: 'uncommon' },
  { id: 'axolotl-greyscale', name: 'Grey axolotl', rarity: 'uncommon' },
  { id: 'axolotl-rose-pink', name: 'Rose axolotl', rarity: 'uncommon' },
  { id: 'axolotl-swamp-green', name: 'Swamp axolotl', rarity: 'uncommon' },
  { id: 'bull', name: 'Bull', rarity: 'rare' },
  { id: 'deer', name: 'Deer', rarity: 'rare' },
  { id: 'slime-2', name: 'Bubble slime', rarity: 'rare' },
  { id: 'axolotl-red', name: 'Red axolotl', rarity: 'rare' },
  { id: 'axolotl-dark-orange', name: 'Copper axolotl', rarity: 'rare' },
  { id: 'axolotl-yellow-green', name: 'Lime axolotl', rarity: 'rare' },
  { id: 'axolotl-retrogreen', name: 'Moss axolotl', rarity: 'rare' },
  { id: 'fox', name: 'Fox', rarity: 'epic' },
  { id: 'slime-3', name: 'Magma slime', rarity: 'epic' },
  { id: 'axolotl-dark-purple', name: 'Purple axolotl', rarity: 'epic' },
  { id: 'axolotl-black', name: 'Black axolotl', rarity: 'epic' },
  { id: 'axolotl-yellow', name: 'Gold axolotl', rarity: 'epic' },
  { id: 'pink-monster', name: 'Pink monster', rarity: 'legendary' },
  { id: 'owlet', name: 'Owlet', rarity: 'legendary' },
  { id: 'dude', name: 'Dude', rarity: 'legendary' },
  { id: 'axolotl-albino', name: 'Albino axolotl', rarity: 'legendary' },
  { id: 'axolotl-blue00', name: 'Blue axolotl', rarity: 'mythic' },
  { id: 'axolotl-blue01', name: 'Sky axolotl', rarity: 'mythic' },
];

const PET_BY_ID = new Map(PETS.map((p) => [p.id, p]));

export function petInfo(id: string): Pet | null {
  return PET_BY_ID.get(id) ?? null;
}

/** The pets of one rarity, in catalogue order. */
export function petsOf(rarity: PetRarity): Pet[] {
  return PETS.filter((p) => p.rarity === rarity);
}

/** 0 for common up to 5 for mythic. */
export function petRarityRank(rarity: PetRarity): number {
  return PET_RARITIES.indexOf(rarity);
}

/** What one line of a crate's table gives. */
export type CrateDrop =
  { kind: 'xp'; xp: number } | { kind: 'pet'; rarity: PetRarity } | { kind: 'crate'; tier: number };

/** A line of a crate's table, out of CRATE_TICKETS. */
export interface CrateOdds {
  drop: CrateDrop;
  weight: number;
}

/** A crate's table adds up to this: each weight is per thousand. */
export const CRATE_TICKETS = 1000;

/** XP a crate can give: mostly 5, 100 at most and rarely (owner). */
export const CRATE_XP = [5, 10, 25, 50, 100] as const;

/**
 * Each crate's table, per thousand, Crystal first: XP 5, 10, 25, 50 and 100, then a pet of
 * each rarity, common to mythic, then the crates inside it by rarity. The rarer the crate, the
 * less plain XP and the better its pets and crates.
 */
const TABLES: Record<number, { xp: number[]; pets: number[]; crates: Array<[number, number]> }> = {
  6: { xp: [460, 70, 20, 6, 1], pets: [280, 110, 35, 8, 0, 0], crates: [[7, 10]] },
  7: {
    xp: [430, 70, 22, 7, 1],
    pets: [260, 125, 50, 14, 1, 0],
    crates: [
      [8, 16],
      [9, 4],
    ],
  },
  8: {
    xp: [400, 70, 25, 8, 2],
    pets: [230, 140, 65, 22, 3, 0],
    crates: [
      [9, 25],
      [10, 10],
    ],
  },
  9: {
    xp: [370, 65, 28, 10, 2],
    pets: [200, 150, 80, 32, 6, 1],
    crates: [
      [10, 38],
      [11, 15],
      [12, 3],
    ],
  },
  10: {
    xp: [340, 60, 30, 12, 3],
    pets: [170, 155, 100, 45, 10, 2],
    crates: [
      [11, 45],
      [12, 22],
      [13, 6],
    ],
  },
  11: {
    xp: [310, 55, 32, 14, 4],
    pets: [140, 150, 120, 60, 16, 4],
    crates: [
      [12, 55],
      [13, 30],
      [14, 10],
    ],
  },
  12: {
    xp: [280, 50, 34, 16, 5],
    pets: [110, 140, 135, 80, 25, 6],
    crates: [
      [13, 65],
      [14, 40],
      [15, 14],
    ],
  },
  13: {
    xp: [250, 45, 36, 18, 6],
    pets: [80, 125, 145, 105, 38, 10],
    crates: [
      [14, 90],
      [15, 52],
    ],
  },
  14: { xp: [220, 40, 38, 20, 8], pets: [50, 105, 150, 130, 55, 15], crates: [[15, 169]] },
  15: { xp: [190, 35, 40, 22, 10], pets: [25, 80, 150, 160, 85, 25], crates: [[15, 178]] },
};

/** A crate's table, leaving out lines it can't give. Empty for a rarity with no crate. */
export function crateOdds(tier: number): CrateOdds[] {
  const t = TABLES[tier];
  if (!t) return [];
  const lines: CrateOdds[] = [
    ...CRATE_XP.map((xp, i) => ({ drop: { kind: 'xp', xp } as CrateDrop, weight: t.xp[i]! })),
    ...PET_RARITIES.map((rarity, i) => ({
      drop: { kind: 'pet', rarity } as CrateDrop,
      weight: t.pets[i]!,
    })),
    ...t.crates.map(([inner, weight]) => ({
      drop: { kind: 'crate', tier: inner } as CrateDrop,
      weight,
    })),
  ];
  return lines.filter((l) => l.weight > 0);
}

/** What opening a crate gave: XP, one pet, or a crate. */
export type CrateWin =
  { kind: 'xp'; xp: number } | { kind: 'pet'; pet: string } | { kind: 'crate'; tier: number };

/**
 * What a crate of `tier` gives for a ticket from 0 to CRATE_TICKETS (its line in the table),
 * and, for a pet, `pick` (any whole number) to choose among that rarity's pets. Null for a
 * rarity with no crate.
 */
export function openCrate(tier: number, ticket: number, pick: number): CrateWin | null {
  const lines = crateOdds(tier);
  if (!lines.length) return null;
  let left = Math.floor(ticket) % CRATE_TICKETS;
  if (left < 0) left += CRATE_TICKETS;
  const line = lines.find((l) => (left -= l.weight) < 0) ?? lines[lines.length - 1]!;
  const d = line.drop;
  if (d.kind === 'xp') return { kind: 'xp', xp: d.xp };
  if (d.kind === 'crate') return { kind: 'crate', tier: d.tier };
  const pool = petsOf(d.rarity);
  return { kind: 'pet', pet: pool[Math.abs(Math.floor(pick)) % pool.length]!.id };
}

/**
 * The rarities among `made` (index i is tier i + 1) that offer crates, one per roll made, as
 * many as are still `held` after a prestige (what one rarity made may have gone on to make the
 * next).
 */
export function crateOffersFrom(made: readonly number[], held: readonly number[]): number[] {
  const tiers: number[] = [];
  for (const tier of CRATE_TIERS) {
    const n = Math.min(made[tier - 1] ?? 0, held[tier - 1] ?? 0);
    for (let i = 0; i < n; i++) tiers.push(tier);
  }
  return tiers;
}
