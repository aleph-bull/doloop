/**
 * RNG Rolls (asked for by the owner, 2026-10-25): on Achievements, 10 XP pulls the slot
 * machine for a rarity, each one half as likely as the one before: 1 in 2, 1 in 4, 1 in 8,
 * up to 1 in 32768 (owner: "up until like 1/32000"). Everyone keeps their rarest roll. Each rarity has a title, shown on the
 * profile; from 1 in 32 each has its own flowing gradient, wilder the rarer, and from
 * Sapphire (1 in 256) a name can wear one; every
 * rarity past 1 in 256 is a badge, and so are a few gambling feats (`rollBadges`).
 *
 * The server draws the roll (`rollTier` on a random ticket); the portal only shows it.
 */

/** What one roll costs. */
export const ROLL_COST = 10;

/** How many can be rolled in one pull (owner: "roll multiple at once"). */
export const ROLL_BATCHES = [1, 10, 100] as const;
export type RollBatch = (typeof ROLL_BATCHES)[number];

/** How many rarities there are: 1 in 2 up to 1 in 2^15 (32768). */
export const ROLL_TIERS_COUNT = 15;

/** Tickets are drawn from 0 to this, exclusive: one for each of the rarest roll's chances. */
export const ROLL_TICKETS = 2 ** ROLL_TIERS_COUNT;

/** From this rarity (1 in 32) each has a gradient. */
export const ROLL_GRADIENT_FROM = 5;

/**
 * From this rarity (1 in 256, Sapphire) a name can wear a look (owner: "only saphire and above
 * can change name colour"), and takes the rarest roll's by itself ('auto').
 */
export const ROLL_NAME_TIER = 8;

/** Every rarity past 1 in 256 is a badge. */
export const ROLL_BADGE_FROM = ROLL_NAME_TIER + 1;

export interface RollTier {
  /** 1 is 1 in 2, 15 is 1 in 32768. */
  tier: number;
  /** The 2^tier in "1 in ...". */
  odds: number;
  title: string;
}

/** One word each, plain to grand, the way the collecting games name their finds. */
const TITLES = [
  'Common',
  'Uncommon',
  'Good',
  'Natural',
  'Rare',
  'Crystal',
  'Ember',
  'Sapphire',
  'Emerald',
  'Starlight',
  'Comet',
  'Eclipse',
  'Celestial',
  'Supernova',
  'Genesis',
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

/**
 * What a roll pays back (owner, 2026-10-25: "1/10 of the denominator rounded to the nearest
 * whole xp"): 1/2 and 1/4 nothing, 1/8 1 XP, 1/256 26, 1/32768 3,277. About 1.5 XP a roll
 * on average, against the 10 it costs.
 */
export function rollPayout(tier: number): number {
  return Math.round(2 ** tier / 10);
}

/** "1/256". */
export function rollOdds(tier: number): string {
  return `1/${2 ** tier}`;
}

/**
 * The rarity a ticket from 0 to ROLL_TICKETS lands on: one more than its trailing zero bits,
 * so tier t comes up for exactly 1 in 2^t of the tickets. Ticket 0 (all zeros) would be a
 * second 1 in 32768; it goes to the commonest instead.
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

/**
 * What a name wears (Achievements › RNG Rolls): 'auto' is the rarest roll's style once it is
 * 1 in 256 or rarer, 'off' is plain, and a tier is that rarity's look, any from Sapphire
 * (1 in 256) up to the rarest.
 */
export type RollNameChoice = 'auto' | 'off' | number;

/** The rarity whose style a name shows, or null for a plain one. */
export function nameTier(best: number, choice: RollNameChoice = 'auto'): number | null {
  if (choice === 'off') return null;
  if (
    typeof choice === 'number' &&
    Number.isInteger(choice) &&
    choice >= ROLL_NAME_TIER &&
    choice <= Math.min(best, ROLL_TIERS_COUNT)
  )
    return choice;
  return best >= ROLL_NAME_TIER ? Math.min(best, ROLL_TIERS_COUNT) : null;
}

/** The running record the gambling badges read, kept on the account (users.roll_stats). */
export interface RollStats {
  /** Each rarity landed at least once: bit t for tier t. */
  hit?: number;
  /** The last roll's tier. */
  last?: number;
  /** 1 in 2s in a row right now, and the most ever. */
  commonRun?: number;
  longestCommonRun?: number;
  /** Two of 1 in 16 or rarer back to back. */
  doubles?: number;
  /** The rarest within the first ten rolls. */
  firstTen?: number;
}

/** The record after one more roll of `tier`; `count` is the number of rolls before it. */
export function advanceRollStats(stats: RollStats, tier: number, count: number): RollStats {
  const commonRun = tier === 1 ? (stats.commonRun ?? 0) + 1 : 0;
  return {
    hit: (stats.hit ?? 0) | (1 << tier),
    last: tier,
    commonRun,
    longestCommonRun: Math.max(stats.longestCommonRun ?? 0, commonRun),
    doubles: (stats.doubles ?? 0) + (tier >= 4 && (stats.last ?? 0) >= 4 ? 1 : 0),
    firstTen: count < 10 ? Math.max(stats.firstTen ?? 0, tier) : (stats.firstTen ?? 0),
  };
}

/** Everything the gambling badges need to know about someone's rolls. */
export interface RollRecordInput {
  count: number;
  best: number;
  stats: RollStats;
}

/** Rolls landed on every rarity up to this one: Full house. */
const FULL_HOUSE_UP_TO = 6;

/** The rolls' badges this record has earned (the catalogue is in badges.ts). */
export function rollBadges(rolls: RollRecordInput): Set<string> {
  const done = new Set<string>();
  for (let tier = ROLL_BADGE_FROM; tier <= Math.min(rolls.best, ROLL_TIERS_COUNT); tier++)
    done.add(rollBadgeKey(tier)!);
  const s = rolls.stats;
  if (rolls.count >= 10) done.add('rolls-10');
  if (rolls.count >= 100) done.add('rolls-100');
  if (rolls.count >= 500) done.add('rolls-500');
  if (rolls.count >= 1000) done.add('rolls-1000');
  if (rolls.best >= ROLL_GRADIENT_FROM) done.add('roll-rare');
  if ((s.firstTen ?? 0) >= 6) done.add('roll-beginner');
  if ((s.doubles ?? 0) >= 1) done.add('roll-double');
  if ((s.longestCommonRun ?? 0) >= 8) done.add('roll-cold');
  const all = (1 << (FULL_HOUSE_UP_TO + 1)) - 2;
  if (((s.hit ?? 0) & all) === all) done.add('roll-full-house');
  return done;
}

/**
 * Prestige (owner, 2026-10-26: "combine ... to make 1 of the next level", at 5 to 1): five of
 * a rarity held make one of the next. Exactly fair would be 2 to 1 (each rarity is half as
 * likely as the one below), so 5 to 1 costs about two and a half times what rolling for it
 * would: a use for spare commons that doesn't make the rare titles cheap. A rarity made this
 * way counts like a rolled one: rarest, title, name look and badges.
 */
export const PRESTIGE_RATE = 5;

/** What prestiging leaves: the rolls held per rarity, and how many of each it made. */
export interface PrestigeResult {
  /** Index i is tier i + 1. */
  held: number[];
  made: number[];
}

/** `held` as one count per rarity, missing ones as 0. */
function heldOf(held: readonly number[]): number[] {
  return Array.from({ length: ROLL_TIERS_COUNT }, (_, i) => Math.max(0, held[i] ?? 0));
}

/** Prestige five of `tier` into one of the next, `times` over; null when there aren't enough. */
export function prestigeOnce(
  held: readonly number[],
  tier: number,
  times = 1,
): PrestigeResult | null {
  if (tier < 1 || tier >= ROLL_TIERS_COUNT || times < 1) return null;
  const next = heldOf(held);
  if (next[tier - 1]! < PRESTIGE_RATE * times) return null;
  const made = heldOf([]);
  next[tier - 1]! -= PRESTIGE_RATE * times;
  next[tier]! += times;
  made[tier]! += times;
  return { held: next, made };
}

/**
 * Prestige everything it can, commonest first, so what one rarity makes can go on into the
 * next; null when nothing can be.
 */
export function prestigeAll(held: readonly number[]): PrestigeResult | null {
  const next = heldOf(held);
  const made = heldOf([]);
  let any = false;
  for (let i = 0; i < ROLL_TIERS_COUNT - 1; i++) {
    const times = Math.floor(next[i]! / PRESTIGE_RATE);
    if (times === 0) continue;
    any = true;
    next[i]! -= PRESTIGE_RATE * times;
    next[i + 1]! += times;
    made[i + 1]! += times;
  }
  return any ? { held: next, made } : null;
}
