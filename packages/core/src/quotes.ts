import quotesData from '../data/quotes.json' with { type: 'json' };
import tipsData from '../data/research-tips.json' with { type: 'json' };
import { addDays, localHour, toLocalDate, zonedMidnightUtc, zonedTimeUtc } from './dates';
import { fnv1a } from './hash';
import type { ISODateTime, Quote, QuoteMode, QuoteSeen, ResearchTip } from './types';

export const QUOTES: Quote[] = quotesData as Quote[];
export const RESEARCH_TIPS: ResearchTip[] = tipsData as ResearchTip[];

/** Days within which a quote is not repeated for the same user. */
export const QUOTE_NO_REPEAT_DAYS = 30;

/** Hours a quote or tip stays up before the next one: four a day, on local 0/6/12/18. */
export const QUOTE_PERIOD_HOURS = 6;

export interface QuoteSlot {
  /**
   * "2026-09-24T12": the local date and the hour the slot starts. Recorded as
   * `QuoteSeen.date`, where it sorts after the bare dates of the one-a-day picks before it.
   */
  key: string;
  /** When the next quote is due. */
  endsAt: Date;
}

export function quoteSlot(instant: ISODateTime | Date, tz: string): QuoteSlot {
  const date = toLocalDate(instant, tz);
  const start = Math.floor(localHour(instant, tz) / QUOTE_PERIOD_HOURS) * QUOTE_PERIOD_HOURS;
  const next = start + QUOTE_PERIOD_HOURS;
  return {
    key: `${date}T${String(start).padStart(2, '0')}`,
    endsAt: next >= 24 ? zonedMidnightUtc(addDays(date, 1), tz) : zonedTimeUtc(date, next, 0, tz),
  };
}

export type DailyPick = { kind: 'quote'; item: Quote } | { kind: 'tip'; item: ResearchTip };

function poolFor(mode: QuoteMode): DailyPick[] {
  const quotes: DailyPick[] = QUOTES.map((item) => ({ kind: 'quote', item }));
  const tips: DailyPick[] = RESEARCH_TIPS.map((item) => ({ kind: 'tip', item }));
  switch (mode) {
    case 'quotes':
      return quotes;
    case 'research-tips':
      return tips;
    case 'both':
      return [...quotes, ...tips];
    case 'off':
      return [];
  }
}

/**
 * Deterministic pick per user per slot (`quoteSlot().key`; a bare date works too). Avoids
 * anything shown in the last 30 days; once four a day has been through the whole pool, the
 * half seen longest ago comes back into play, so nothing returns straight after it was up.
 * Returns null when mode is 'off' or the pool is empty.
 */
export function pickQuote(
  userId: string,
  slot: string,
  mode: QuoteMode,
  seen: QuoteSeen[] = [],
): DailyPick | null {
  const pool = poolFor(mode);
  if (pool.length === 0) return null;

  // If this slot already has a pick recorded, return it so the card holds still until the next.
  const current = seen.find((s) => s.date === slot);
  if (current) {
    const existing = pool.find((p) => p.item.id === current.quoteId);
    if (existing) return existing;
  }

  const cutoff = addDays(slot.slice(0, 10), -QUOTE_NO_REPEAT_DAYS);
  const lastUp = new Map<string, string>();
  for (const s of seen) {
    if (s.date < cutoff || s.date >= slot) continue;
    const prev = lastUp.get(s.quoteId);
    if (!prev || s.date > prev) lastUp.set(s.quoteId, s.date);
  }
  let candidates = pool.filter((p) => !lastUp.has(p.item.id));
  if (candidates.length === 0) {
    const at = (p: DailyPick) => lastUp.get(p.item.id)!;
    const oldestFirst = [...pool].sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0));
    candidates = oldestFirst.slice(0, Math.ceil(pool.length / 2));
  }
  const idx = fnv1a(`${userId}|${slot}|${mode}`) % candidates.length;
  return candidates[idx]!;
}
