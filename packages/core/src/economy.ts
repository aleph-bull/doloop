import { hoursBetween, isValidDate, zonedMidnightUtc } from './dates';
import type { ISODate, ISODateTime, RestDayPolicy, StreakState } from './types';

/** Shop constants (spec §6). Cosmetic and safety-net only; nothing inflates XP or streaks. */
export const SHOP = {
  FREEZE_COST: 150,
  MAX_FREEZES: 2,
  BREAK_DAY_BASE_COST: 300,
  BREAK_DAY_MULTIPLIER: 1.5,
  MAX_BREAK_DAYS: 2,
  BREAK_DAY_MIN_LEAD_HOURS: 24,
} as const;

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface Wallet {
  xp: number;
  streak: StreakState;
}

/** Cost of the next break day given how many were bought this calendar month. */
export function breakDayCost(purchasedThisMonth: number): number {
  const n = Math.max(0, Math.floor(purchasedThisMonth));
  return Math.round(SHOP.BREAK_DAY_BASE_COST * SHOP.BREAK_DAY_MULTIPLIER ** n);
}

export function purchaseFreeze(w: Wallet): Result<Wallet> {
  if (w.streak.freezesHeld >= SHOP.MAX_FREEZES)
    return { ok: false, reason: `You can hold at most ${SHOP.MAX_FREEZES} freezes.` };
  if (w.xp < SHOP.FREEZE_COST)
    return { ok: false, reason: `A freeze costs ${SHOP.FREEZE_COST} XP.` };
  return {
    ok: true,
    value: {
      xp: w.xp - SHOP.FREEZE_COST,
      streak: { ...w.streak, freezesHeld: w.streak.freezesHeld + 1 },
    },
  };
}

export function purchaseBreakDay(w: Wallet, purchasedThisMonth: number): Result<Wallet> {
  if (w.streak.breakDaysHeld >= SHOP.MAX_BREAK_DAYS)
    return { ok: false, reason: `You can hold at most ${SHOP.MAX_BREAK_DAYS} break days.` };
  const cost = breakDayCost(purchasedThisMonth);
  if (w.xp < cost) return { ok: false, reason: `The next break day costs ${cost} XP.` };
  return {
    ok: true,
    value: {
      xp: w.xp - cost,
      streak: { ...w.streak, breakDaysHeld: w.streak.breakDaysHeld + 1 },
    },
  };
}

export interface ApplyBreakDayInput {
  policy: RestDayPolicy;
  streak: StreakState;
  date: ISODate;
  now: ISODateTime;
  timezone: string;
}

/** Spend a held break day on a date at least 24 h in the future. Never retroactive. */
export function applyBreakDay(
  input: ApplyBreakDayInput,
): Result<{ policy: RestDayPolicy; streak: StreakState }> {
  const { policy, streak, date, now, timezone } = input;
  if (!isValidDate(date)) return { ok: false, reason: 'Invalid date.' };
  if (streak.breakDaysHeld <= 0) return { ok: false, reason: 'You have no break days to apply.' };
  if (policy.breakDays.includes(date))
    return { ok: false, reason: 'That day is already a break day.' };
  const startOfDay = zonedMidnightUtc(date, timezone);
  if (hoursBetween(now, startOfDay) < SHOP.BREAK_DAY_MIN_LEAD_HOURS)
    return {
      ok: false,
      reason: `Break days must be applied at least ${SHOP.BREAK_DAY_MIN_LEAD_HOURS} hours ahead.`,
    };
  return {
    ok: true,
    value: {
      policy: {
        ...policy,
        breakDays: [...policy.breakDays, date].sort(),
        changeLog: [...policy.changeLog, { at: now, what: `break-day:${date}` }],
      },
      streak: { ...streak, breakDaysHeld: streak.breakDaysHeld - 1 },
    },
  };
}

/* ---------- Cosmetics ---------- */

export interface AccentPreset {
  id: string;
  name: string;
  minLevel: number;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'indigo', name: 'Indigo', minLevel: 0 },
  { id: 'sky', name: 'Sky', minLevel: 0 },
  { id: 'mint', name: 'Mint', minLevel: 0 },
  { id: 'amber', name: 'Amber', minLevel: 5 },
  { id: 'rose', name: 'Rose', minLevel: 10 },
  { id: 'violet', name: 'Violet', minLevel: 20 },
];

export type BackgroundCategory =
  'minimal' | 'mountains' | 'night' | 'coast' | 'forest' | 'country' | 'cities';

export interface BackgroundMeta {
  id: string;
  name: string;
  category: BackgroundCategory;
  /** Level required, 0 = always available. */
  minLevel: number;
  /** XP price if purchasable instead of level-gated; null = free. */
  costXp: number | null;
}

/**
 * Catalogue only; the visuals live in packages/ui. Ids are persisted in user settings,
 * so they are stable — renaming one orphans whatever a user had selected.
 *
 * Minimal is the Graphite family: CSS gradients, always free, nothing to download. The
 * photographs are mostly free too; a handful are level-gated or purchasable so the shop
 * still has something to sell, but the set is not something to grind for.
 */
export const BACKGROUNDS: BackgroundMeta[] = [
  // --- minimal (gradients) ---
  { id: 'graphite', name: 'Graphite', category: 'minimal', minLevel: 0, costXp: null },
  { id: 'slate', name: 'Slate', category: 'minimal', minLevel: 0, costXp: null },
  { id: 'ash', name: 'Ash', category: 'minimal', minLevel: 0, costXp: null },
  { id: 'onyx', name: 'Onyx', category: 'minimal', minLevel: 0, costXp: null },
  { id: 'basalt', name: 'Basalt', category: 'minimal', minLevel: 0, costXp: null },
  { id: 'fog', name: 'Fog', category: 'minimal', minLevel: 0, costXp: null },
  { id: 'lanterns', name: 'Lanterns', category: 'minimal', minLevel: 0, costXp: null },
  // --- mountains ---
  { id: 'fuji', name: 'Fuji', category: 'mountains', minLevel: 0, costXp: null },
  { id: 'alpine-pass', name: 'Alpine Pass', category: 'mountains', minLevel: 3, costXp: null },
  { id: 'alpenglow', name: 'Alpenglow', category: 'mountains', minLevel: 12, costXp: null },
  { id: 'kirkjufell', name: 'Kirkjufell', category: 'mountains', minLevel: 0, costXp: 400 },
  // --- night ---
  { id: 'still-water', name: 'Still Water', category: 'night', minLevel: 0, costXp: null },
  { id: 'milky-way', name: 'Milky Way', category: 'night', minLevel: 5, costXp: null },
  { id: 'ice-canyon', name: 'Ice Canyon', category: 'night', minLevel: 8, costXp: null },
  // --- coast ---
  { id: 'vestrahorn', name: 'Vestrahorn', category: 'coast', minLevel: 3, costXp: null },
  { id: 'stormlight', name: 'Stormlight', category: 'coast', minLevel: 5, costXp: null },
  { id: 'shipwreck', name: 'Shipwreck', category: 'coast', minLevel: 0, costXp: 600 },
  // --- forest ---
  { id: 'redwood', name: 'Redwood', category: 'forest', minLevel: 0, costXp: null },
  { id: 'frozen-lake', name: 'Frozen Lake', category: 'forest', minLevel: 3, costXp: null },
  // --- open country ---
  { id: 'cloud-valley', name: 'Cloud Valley', category: 'country', minLevel: 0, costXp: null },
  { id: 'ridgeline', name: 'Ridgeline', category: 'country', minLevel: 0, costXp: null },
  { id: 'badlands', name: 'Badlands', category: 'country', minLevel: 5, costXp: null },
  { id: 'emberlight', name: 'Emberlight', category: 'country', minLevel: 12, costXp: null },
  // --- cities ---
  { id: 'hallstatt', name: 'Hallstatt', category: 'cities', minLevel: 8, costXp: null },
  { id: 'victoria-peak', name: 'Victoria Peak', category: 'cities', minLevel: 0, costXp: 800 },
];

/** Display order and labels for the grouped pickers. */
export const BACKGROUND_CATEGORY_LABELS: Array<{ id: BackgroundCategory; label: string }> = [
  { id: 'minimal', label: 'Minimal' },
  { id: 'mountains', label: 'Mountains' },
  { id: 'night', label: 'Night' },
  { id: 'coast', label: 'Coast' },
  { id: 'forest', label: 'Forest' },
  { id: 'country', label: 'Open country' },
  { id: 'cities', label: 'Cities' },
];

/** The quiet default, and what an unrecognised id falls back to. */
export const DEFAULT_BACKGROUND_ID = 'graphite';

/**
 * Normalise a stored background id. Settings saved before the catalogue changed can name
 * a background that no longer exists; those read as the default rather than as nothing.
 */
export function resolveBackgroundId(id: string | null | undefined): string {
  return id && BACKGROUNDS.some((b) => b.id === id) ? id : DEFAULT_BACKGROUND_ID;
}

export function backgroundsInCategory(category: BackgroundCategory): BackgroundMeta[] {
  return BACKGROUNDS.filter((b) => b.category === category);
}

export function unlockedAccents(level: number): AccentPreset[] {
  return ACCENT_PRESETS.filter((a) => a.minLevel <= level);
}

export function isAccentUnlocked(id: string, level: number): boolean {
  const a = ACCENT_PRESETS.find((x) => x.id === id);
  return !!a && a.minLevel <= level;
}

export function isBackgroundAvailable(id: string, level: number, purchasedIds: string[]): boolean {
  const b = BACKGROUNDS.find((x) => x.id === id);
  if (!b) return false;
  if (b.costXp !== null) return purchasedIds.includes(id);
  return b.minLevel <= level;
}

export function purchaseBackground(
  xp: number,
  id: string,
  purchasedIds: string[],
): Result<{ xp: number; purchasedIds: string[] }> {
  const b = BACKGROUNDS.find((x) => x.id === id);
  if (!b || b.costXp === null) return { ok: false, reason: 'That background is not for sale.' };
  if (purchasedIds.includes(id)) return { ok: false, reason: 'Already owned.' };
  if (xp < b.costXp) return { ok: false, reason: `${b.name} costs ${b.costXp} XP.` };
  return { ok: true, value: { xp: xp - b.costXp, purchasedIds: [...purchasedIds, id] } };
}
