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

/**
 * The pastel row (2026-10-20). Ids are stored in settings, so the old ones are kept where a
 * pastel took their place; Indigo left the row and reads as the default, Powder blue (`resolveAccent`).
 * Every accent is free; levels only unlock backgrounds.
 */
export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'sky', name: 'Powder', minLevel: 0 },
  { id: 'rose', name: 'Blush', minLevel: 0 },
  { id: 'mint', name: 'Sage', minLevel: 0 },
  { id: 'violet', name: 'Lilac', minLevel: 0 },
  { id: 'amber', name: 'Peach', minLevel: 0 },
  { id: 'lemon', name: 'Lemon', minLevel: 0 },
];

/** The accent new accounts start on, and what a retired preset reads as. */
export const DEFAULT_ACCENT = 'sky';

/** A stored accent as one that still exists: a custom colour, a preset, or the default. */
export function resolveAccent(accent: string | null | undefined): string {
  if (accent && (accent.startsWith('custom:') || ACCENT_PRESETS.some((a) => a.id === accent)))
    return accent;
  return DEFAULT_ACCENT;
}

/** How many of the user's own colours can be saved beside the built-in accents. */
export const MAX_SAVED_ACCENTS = 8;
/** Accents in all: the built-in ones plus the user's own saved colours. */
export const MAX_ACCENTS = ACCENT_PRESETS.length + MAX_SAVED_ACCENTS;
/** A user's own accent: 'custom:<hue>,<saturation>,<lightness>'. */
export const CUSTOM_ACCENT = /^custom:\d{1,3},\d{1,3},\d{1,3}$/;

export type BackgroundCategory =
  | 'minimal'
  | 'abstract'
  | 'sky'
  | 'mountains'
  | 'lakes'
  | 'night'
  | 'coast'
  | 'forest'
  | 'country'
  | 'desert'
  | 'cities'
  | 'lights';

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
  { id: 'lanterns', name: 'Lanterns', category: 'lights', minLevel: 0, costXp: null },
  // --- mountains ---
  { id: 'fuji', name: 'Fuji', category: 'mountains', minLevel: 0, costXp: null },
  { id: 'alpine-pass', name: 'Alpine Pass', category: 'mountains', minLevel: 3, costXp: null },
  { id: 'alpenglow', name: 'Alpenglow', category: 'mountains', minLevel: 12, costXp: null },
  { id: 'kirkjufell', name: 'Kirkjufell', category: 'mountains', minLevel: 0, costXp: 400 },
  // --- night ---
  { id: 'milky-way', name: 'Milky Way', category: 'night', minLevel: 5, costXp: null },
  { id: 'ice-canyon', name: 'Ice Canyon', category: 'night', minLevel: 8, costXp: null },
  // --- coast ---
  { id: 'vestrahorn', name: 'Vestrahorn', category: 'coast', minLevel: 0, costXp: 400 },
  { id: 'stormlight', name: 'Stormlight', category: 'coast', minLevel: 0, costXp: 500 },
  { id: 'shipwreck', name: 'Shipwreck', category: 'coast', minLevel: 0, costXp: 600 },
  // --- forest ---
  { id: 'redwood', name: 'Redwood', category: 'forest', minLevel: 0, costXp: null },
  { id: 'frozen-lake', name: 'Frozen Lake', category: 'forest', minLevel: 0, costXp: 400 },
  // --- open country ---
  { id: 'cloud-valley', name: 'Cloud Valley', category: 'country', minLevel: 0, costXp: null },
  { id: 'ridgeline', name: 'Ridgeline', category: 'country', minLevel: 0, costXp: null },
  { id: 'badlands', name: 'Badlands', category: 'country', minLevel: 0, costXp: 500 },
  { id: 'emberlight', name: 'Emberlight', category: 'country', minLevel: 12, costXp: null },
  // --- cities ---
  { id: 'hallstatt', name: 'Hallstatt', category: 'cities', minLevel: 8, costXp: null },
  { id: 'victoria-peak', name: 'Victoria Peak', category: 'cities', minLevel: 0, costXp: 800 },
  // --- added 2026-09-22; a handful were locked later so levels and XP keep something to open ---
  { id: 'summit-glow', name: 'Summit Glow', category: 'mountains', minLevel: 0, costXp: 450 },
  { id: 'highland', name: 'Highland', category: 'mountains', minLevel: 0, costXp: null },
  { id: 'lookout', name: 'Lookout', category: 'mountains', minLevel: 0, costXp: null },
  { id: 'polar-lights', name: 'Polar Lights', category: 'night', minLevel: 0, costXp: 600 },
  { id: 'star-field', name: 'Star Field', category: 'night', minLevel: 0, costXp: null },
  { id: 'canyon-stars', name: 'Canyon Stars', category: 'night', minLevel: 0, costXp: null },
  { id: 'shoreline', name: 'Shoreline', category: 'coast', minLevel: 0, costXp: null },
  { id: 'pier', name: 'Pier at Dawn', category: 'coast', minLevel: 0, costXp: null },
  { id: 'kualoa', name: 'Kualoa', category: 'coast', minLevel: 0, costXp: 500 },
  { id: 'rain-front', name: 'Rain Front', category: 'coast', minLevel: 0, costXp: null },
  { id: 'autumn', name: 'Autumn', category: 'forest', minLevel: 0, costXp: null },
  { id: 'pine-ridge', name: 'Pine Ridge', category: 'forest', minLevel: 0, costXp: null },
  { id: 'cloudbreak', name: 'Cloudbreak', category: 'country', minLevel: 0, costXp: null },
  { id: 'tundra', name: 'Tundra', category: 'country', minLevel: 0, costXp: null },
  { id: 'wheatland', name: 'Wheatland', category: 'country', minLevel: 0, costXp: null },
  { id: 'harbour-lights', name: 'Harbour Lights', category: 'cities', minLevel: 0, costXp: null },
  { id: 'taipei', name: 'Taipei', category: 'cities', minLevel: 0, costXp: null },
  { id: 'rooftops', name: 'Rooftops', category: 'cities', minLevel: 0, costXp: null },
  { id: 'tokyo-haze', name: 'Tokyo Haze', category: 'cities', minLevel: 8, costXp: null },
  { id: 'sherbet', name: 'Sherbet', category: 'abstract', minLevel: 0, costXp: null },
  { id: 'lagoon', name: 'Lagoon', category: 'abstract', minLevel: 0, costXp: null },
  { id: 'neon', name: 'Neon', category: 'abstract', minLevel: 0, costXp: null },
  { id: 'spectrum', name: 'Spectrum', category: 'abstract', minLevel: 0, costXp: null },
  { id: 'opal', name: 'Opal', category: 'abstract', minLevel: 0, costXp: null },
  { id: 'nebula', name: 'Nebula', category: 'abstract', minLevel: 0, costXp: 700 },
  { id: 'velvet', name: 'Velvet', category: 'abstract', minLevel: 0, costXp: null },
  { id: 'prism', name: 'Prism', category: 'abstract', minLevel: 10, costXp: null },
  { id: 'sea-glass', name: 'Sea Glass', category: 'abstract', minLevel: 0, costXp: null },
  { id: 'swell', name: 'Swell', category: 'abstract', minLevel: 0, costXp: null },
  // --- added 2026-10-19, from Pexels ---
  { id: 'seawall', name: 'Seawall', category: 'coast', minLevel: 0, costXp: 350 },
  { id: 'slot-canyon', name: 'Slot Canyon', category: 'desert', minLevel: 0, costXp: null },
  { id: 'golden-hour', name: 'Golden Hour', category: 'abstract', minLevel: 1, costXp: null },
  { id: 'tide-pool', name: 'Tide Pool', category: 'coast', minLevel: 0, costXp: null },
  { id: 'breakwater', name: 'Breakwater', category: 'coast', minLevel: 0, costXp: null },
  { id: 'ferryman', name: 'Ferryman', category: 'lakes', minLevel: 0, costXp: 400 },
  { id: 'golden-willow', name: 'Golden Willow', category: 'lakes', minLevel: 0, costXp: null },
  { id: 'ripples', name: 'Ripples', category: 'abstract', minLevel: 0, costXp: null },
  { id: 'valley-light', name: 'Valley Light', category: 'country', minLevel: 0, costXp: null },
  { id: 'violet-hour', name: 'Violet Hour', category: 'sky', minLevel: 0, costXp: 350 },
  { id: 'morning-rays', name: 'Morning Rays', category: 'lakes', minLevel: 0, costXp: 600 },
  { id: 'ember-grass', name: 'Ember Grass', category: 'country', minLevel: 0, costXp: null },
  { id: 'mist-lake', name: 'Mist Lake', category: 'lakes', minLevel: 0, costXp: 450 },
  { id: 'rolling-fields', name: 'Rolling Fields', category: 'country', minLevel: 0, costXp: 350 },
  { id: 'brushstroke', name: 'Brushstroke', category: 'abstract', minLevel: 0, costXp: 400 },
  { id: 'dusk', name: 'Dusk', category: 'abstract', minLevel: 0, costXp: null },
  { id: 'sea-mist', name: 'Sea Mist', category: 'coast', minLevel: 0, costXp: null },
  { id: 'black-sand', name: 'Black Sand', category: 'coast', minLevel: 0, costXp: 350 },
  { id: 'green-hills', name: 'Green Hills', category: 'country', minLevel: 0, costXp: 300 },
  { id: 'antelope', name: 'Antelope', category: 'desert', minLevel: 8, costXp: null },
  { id: 'blue-ridges', name: 'Blue Ridges', category: 'mountains', minLevel: 0, costXp: null },
  { id: 'peyto', name: 'Peyto', category: 'lakes', minLevel: 6, costXp: null },
  { id: 'gilded-surf', name: 'Gilded Surf', category: 'coast', minLevel: 0, costXp: 500 },
  { id: 'valley-lake', name: 'Valley Lake', category: 'lakes', minLevel: 0, costXp: 500 },
  { id: 'storm-ridge', name: 'Storm Ridge', category: 'mountains', minLevel: 0, costXp: 450 },
  { id: 'agave', name: 'Agave', category: 'forest', minLevel: 0, costXp: 350 },
  { id: 'feather-grass', name: 'Feather Grass', category: 'country', minLevel: 0, costXp: null },
  { id: 'dune-lagoon', name: 'Dune Lagoon', category: 'desert', minLevel: 4, costXp: null },
  { id: 'shallows', name: 'Shallows', category: 'coast', minLevel: 0, costXp: null },
  { id: 'red-tide', name: 'Red Tide', category: 'coast', minLevel: 0, costXp: 400 },
  { id: 'still-bay', name: 'Still Bay', category: 'coast', minLevel: 0, costXp: 400 },
  { id: 'midnight-silk', name: 'Midnight Silk', category: 'abstract', minLevel: 0, costXp: 500 },
  { id: 'rosy-clouds', name: 'Rosy Clouds', category: 'sky', minLevel: 0, costXp: 300 },
  { id: 'lilac-sky', name: 'Lilac Sky', category: 'sky', minLevel: 2, costXp: null },
  { id: 'cotton-candy', name: 'Cotton Candy', category: 'sky', minLevel: 0, costXp: null },
  { id: 'rainfall', name: 'Rainfall', category: 'abstract', minLevel: 0, costXp: 300 },
  { id: 'wild-oats', name: 'Wild Oats', category: 'country', minLevel: 0, costXp: null },
  { id: 'afterglow', name: 'Afterglow', category: 'abstract', minLevel: 0, costXp: 450 },
];

/** Display order and labels for the grouped pickers. */
export const BACKGROUND_CATEGORY_LABELS: Array<{ id: BackgroundCategory; label: string }> = [
  { id: 'minimal', label: 'Minimal' },
  { id: 'abstract', label: 'Abstract' },
  { id: 'sky', label: 'Sky' },
  { id: 'mountains', label: 'Mountains' },
  { id: 'lakes', label: 'Lakes' },
  { id: 'night', label: 'Night' },
  { id: 'coast', label: 'Coast' },
  { id: 'forest', label: 'Forest' },
  { id: 'country', label: 'Open country' },
  { id: 'desert', label: 'Desert' },
  { id: 'cities', label: 'Cities' },
  { id: 'lights', label: 'Lights' },
];

/**
 * A plain colour the user picked, stored as a background id: `solid:#1a2b3c`. Free, and
 * every screen that draws a backdrop understands it without a separate setting.
 */
export const SOLID_BACKGROUND_PREFIX = 'solid:';
const SOLID_ID = /^solid:#[0-9a-f]{6}$/i;

export function solidBackgroundId(hex: string): string {
  return `${SOLID_BACKGROUND_PREFIX}${hex.toLowerCase()}`;
}

/** The hex of a solid-colour background id, or null when the id is not one. */
export function solidColorOf(id: string | null | undefined): string | null {
  return id && SOLID_ID.test(id) ? id.slice(SOLID_BACKGROUND_PREFIX.length).toLowerCase() : null;
}

/** What an unrecognised id falls back to. New accounts start on Cotton Candy (`DEFAULT_SETTINGS`). */
export const DEFAULT_BACKGROUND_ID = 'graphite';

/**
 * Normalise a stored background id. Settings saved before the catalogue changed can name
 * a background that no longer exists; those read as the default rather than as nothing.
 */
export function resolveBackgroundId(id: string | null | undefined): string {
  if (solidColorOf(id)) return id!.toLowerCase();
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
  if (solidColorOf(id)) return true;
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
