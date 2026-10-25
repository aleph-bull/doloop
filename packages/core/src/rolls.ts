/**
 * Rolls (asked for by the owner, 2026-10-25): on Achievements, 10 XP pulls the slot machine
 * for a rarity, each one half as likely as the one before: 1 in 2, 1 in 4, 1 in 8, up to
 * 1 in 8192. Everyone keeps their rarest roll. Each rarity has a title, shown on the
 * profile; from 1 in 256 the name takes that rarity's colour (Settings › Social can turn it
 * off), and every rarity past 1 in 256 is a badge.
 *
 * The server draws the roll (`rollTier` on a random ticket); the portal only shows it.
 */

/** What one roll costs. */
export const ROLL_COST = 10;

/** How many rarities there are: 1 in 2 up to 1 in 2^13 (8192). */
export const ROLL_TIERS_COUNT = 13;

/** Tickets are drawn from 0 to this, exclusive: one for each of the rarest roll's chances. */
export const ROLL_TICKETS = 2 ** ROLL_TIERS_COUNT;

/** From this rarity (1 in 256) the name takes the rarity's colour. */
export const ROLL_NAME_TIER = 8;

/** Every rarity past 1 in 256 is a badge. */
export const ROLL_BADGE_FROM = ROLL_NAME_TIER + 1;

export interface RollTier {
  /** 1 is 1 in 2, 13 is 1 in 8192. */
  tier: number;
  /** The 2^tier in "1 in ...". */
  odds: number;
  title: string;
}

const TITLES = [
  'Coin flipper',
  'Tourist',
  "Beginner's luck",
  'Hot streak',
  'Card counter',
  'Card shark',
  'Big spender',
  'High stakes',
  'Jackpot',
  'Lightning in a bottle',
  'Four-leaf clover',
  'Once in a blue moon',
  'Beat the house',
];

/** Every rarity, commonest first: index i is tier i + 1. */
export const ROLL_TIERS: readonly RollTier[] = TITLES.map((title, i) => ({
  tier: i + 1,
  odds: 2 ** (i + 1),
  title,
}));

export function rollTierInfo(tier: number): RollTier | null {
  return ROLL_TIERS[tier - 1] ?? null;
}

/** "1/256". */
export function rollOdds(tier: number): string {
  return `1/${2 ** tier}`;
}

/**
 * The rarity a ticket from 0 to ROLL_TICKETS lands on: one more than its trailing zero bits,
 * so tier t comes up for exactly 1 in 2^t of the tickets. Ticket 0 (all zeros) would be a
 * second 1 in 8192; it goes to the commonest instead.
 */
export function rollTier(ticket: number): number {
  const t = Math.floor(ticket) % ROLL_TICKETS;
  if (t <= 0) return 1;
  let tier = 1;
  let n = t;
  while ((n & 1) === 0) {
    n >>>= 1;
    tier++;
  }
  return tier;
}

/** The badge for a rarity past 1 in 256, by its key; null below. */
export function rollBadgeKey(tier: number): string | null {
  return tier >= ROLL_BADGE_FROM && tier <= ROLL_TIERS_COUNT ? `roll-${2 ** tier}` : null;
}

/** The rarity whose colour a name shows, or null: below 1 in 256, or turned off. */
export function nameTier(best: number, colourOn: boolean): number | null {
  return colourOn && best >= ROLL_NAME_TIER ? Math.min(best, ROLL_TIERS_COUNT) : null;
}
