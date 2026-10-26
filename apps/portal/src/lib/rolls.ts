import { ROLL_GRADIENT_FROM } from '@komogon/core';
import type { CSSProperties } from 'react';

/**
 * How loud a rarity's show is, 0 to 5: the commonest are a plain colour, then from 1/32
 * a flowing gradient, a shine from 1/256, sparkle from 1/2048 and a colour cycle at the
 * very top (index.css, `.roll-fx-*`). The machine's shake, flash and confetti follow it.
 */
export function fxLevel(tier: number): number {
  if (tier >= 14) return 5;
  if (tier >= 11) return 4;
  if (tier >= 8) return 3;
  if (tier >= ROLL_GRADIENT_FROM) return 2;
  if (tier >= 3) return 1;
  return 0;
}

/** The classes that dress text in a rarity's style. */
export function rollClass(tier: number): string {
  return `roll-fx roll-fx-${tier} roll-fx-l${fxLevel(tier)}`;
}

/** The classes for a name wearing a rarity (from 1/32); nothing for a plain one. */
export function nameClass(tier: number | null | undefined): string | undefined {
  return tier && tier >= ROLL_GRADIENT_FROM ? rollClass(tier) : undefined;
}

/** `base` plus a name's rarity classes, for a name's className. */
export function named(base: string, tier: number | null | undefined): string {
  const extra = nameClass(tier);
  return extra ? `${base} ${extra}` : base;
}

/** `--roll-colour` set to a rarity's one colour (for rings, flashes and coins). */
export function tierStyle(tier: number | null | undefined): CSSProperties | undefined {
  return tier ? ({ '--roll-colour': `var(--rt-${tier})` } as CSSProperties) : undefined;
}
