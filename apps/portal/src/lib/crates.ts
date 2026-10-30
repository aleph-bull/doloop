import { petRarityRank, type PetRarity } from '@komogon/core';
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

/** `--roll-colour` set to a pet rarity's colour. */
export function rarityStyle(rarity: PetRarity): CSSProperties {
  return { '--roll-colour': `var(--rt-${RARITY_TIER[rarity]})` } as CSSProperties;
}

/** Rare pets get the fanfare when they come out of a crate. */
export function isBigPet(rarity: PetRarity): boolean {
  return petRarityRank(rarity) >= petRarityRank('legendary');
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
