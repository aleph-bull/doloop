import quotesData from '../data/quotes.json' with { type: 'json' };
import tipsData from '../data/research-tips.json' with { type: 'json' };
import { addDays } from './dates';
import { fnv1a } from './hash';
import type { ISODate, Quote, QuoteMode, QuoteSeen, ResearchTip } from './types';

export const QUOTES: Quote[] = quotesData as Quote[];
export const RESEARCH_TIPS: ResearchTip[] = tipsData as ResearchTip[];

/** Days within which a quote is not repeated for the same user. */
export const QUOTE_NO_REPEAT_DAYS = 30;

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
 * Deterministic daily pick per user. Avoids anything shown in the last 30 days;
 * if everything has been seen, the full pool is used. Returns null when mode is 'off'
 * or the pool is empty.
 */
export function pickQuote(
  userId: string,
  date: ISODate,
  mode: QuoteMode,
  seen: QuoteSeen[] = [],
): DailyPick | null {
  const pool = poolFor(mode);
  if (pool.length === 0) return null;

  // If today already has a pick recorded, return it so the card is stable all day.
  const todays = seen.find((s) => s.date === date);
  if (todays) {
    const existing = pool.find((p) => p.item.id === todays.quoteId);
    if (existing) return existing;
  }

  const cutoff = addDays(date, -QUOTE_NO_REPEAT_DAYS);
  const recent = new Set(
    seen.filter((s) => s.date >= cutoff && s.date < date).map((s) => s.quoteId),
  );
  let candidates = pool.filter((p) => !recent.has(p.item.id));
  if (candidates.length === 0) candidates = pool;
  const idx = fnv1a(`${userId}|${date}|${mode}`) % candidates.length;
  return candidates[idx]!;
}
