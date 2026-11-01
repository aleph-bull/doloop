import {
  CRATE_FROM,
  CRATE_XP,
  PET_RARITIES,
  petInfo,
  petRarityRank,
  type CrateWin,
  type PetRarity,
} from '@komogon/core';
import type { CSSProperties } from 'react';
import { PET_SPRITES } from './pet-sprites';

/** Each pet rarity wears one of the rolls' colours (index.css, --rt-N), so it follows the theme. */
const RARITY_TIER: Record<PetRarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 12,
  legendary: 4,
  mythic: 14,
};

/**
 * How loud a crate's prize is, 0 to 5, like the rolls' `fxLevel`: a pet by its rarity, XP by
 * its amount (5 XP 0, 100 XP 4), a crate by how rare it is (the ones just past Crystal 1,
 * Genesis 5).
 */
export function winLevel(win: CrateWin): number {
  if (win.kind === 'crate') return Math.min(5, Math.max(1, Math.ceil((win.tier - CRATE_FROM) / 2)));
  if (win.kind === 'xp') return Math.max(0, CRATE_XP.indexOf(win.xp as (typeof CRATE_XP)[number]));
  return petRarityRank(petInfo(win.pet)?.rarity ?? 'common');
}

/**
 * The colour a prize wears: a pet its rarity's, XP the rarity of the same level (100 XP is a
 * legendary's gold), a crate its own title's.
 */
export function winColour(win: CrateWin): string {
  if (win.kind === 'crate') return `var(--rt-${win.tier})`;
  const rarity =
    win.kind === 'xp' ? PET_RARITIES[winLevel(win)]! : (petInfo(win.pet)?.rarity ?? 'common');
  return `var(--rt-${RARITY_TIER[rarity]})`;
}

/** `--roll-colour` set to a prize's colour. */
export function winStyle(win: CrateWin): CSSProperties {
  return { '--roll-colour': winColour(win) } as CSSProperties;
}

/** `--roll-colour` set to a pet rarity's colour. */
export function rarityStyle(rarity: PetRarity): CSSProperties {
  return { '--roll-colour': `var(--rt-${RARITY_TIER[rarity]})` } as CSSProperties;
}

/** A table weight per thousand as a percentage: "46%", "2.5%", "0.1%". */
export function pct(weight: number): string {
  return `${weight % 10 === 0 ? weight / 10 : (weight / 10).toFixed(1)}%`;
}

/** "1 exists globally", "12 exist globally". */
export function existLine(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? 'exists' : 'exist'} globally`;
}

/**
 * The whole-pixel scale that fits a pet's frame in a box, never past `max` and never under 1,
 * so the pixels stay square.
 */
export function petScale(id: string, box: readonly [number, number], max: number): number {
  const s = PET_SPRITES[id];
  if (!s) return 1;
  return Math.max(1, Math.min(max, Math.floor(Math.min(box[0] / s[0], box[1] / s[1]))));
}
