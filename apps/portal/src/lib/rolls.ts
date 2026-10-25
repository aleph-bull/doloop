import { ROLL_NAME_TIER } from '@komogon/core';
import type { CSSProperties } from 'react';

/**
 * The classes for a name coloured by a roll of 1/256 or rarer (core rolls.ts); nothing for
 * the rest. The colours are `--name-tier-8` to `--name-tier-13` in index.css.
 */
export function nameClass(tier: number | null | undefined): string | undefined {
  return tier && tier >= ROLL_NAME_TIER ? `name-tier name-tier-${tier}` : undefined;
}

/** `--roll-colour` set to a rarity's colour, from 1/256; nothing below. */
export function tierStyle(tier: number | null | undefined): CSSProperties | undefined {
  return tier && tier >= ROLL_NAME_TIER
    ? ({ '--roll-colour': `var(--name-tier-${tier})` } as CSSProperties)
    : undefined;
}

/** `base` plus the name colour classes, for a name's className. */
export function named(base: string, tier: number | null | undefined): string {
  const extra = nameClass(tier);
  return extra ? `${base} ${extra}` : base;
}
