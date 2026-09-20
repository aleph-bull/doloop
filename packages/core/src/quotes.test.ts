import { describe, expect, it } from 'vitest';
import { pickQuote, QUOTES, RESEARCH_TIPS } from './quotes';
import type { QuoteSeen } from './types';

describe('quote data', () => {
  it('every quote has an author and source, every tip has a citation', () => {
    for (const q of QUOTES) {
      expect(q.author.length).toBeGreaterThan(0);
      expect(q.sourceUrl).toMatch(/^https?:\/\//);
      expect(q.text.split(/\s+/).length).toBeLessThanOrEqual(30);
    }
    for (const t of RESEARCH_TIPS) expect(t.citation.length).toBeGreaterThan(0);
    const ids = [...QUOTES, ...RESEARCH_TIPS].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('pickQuote', () => {
  it('returns null when off', () => {
    expect(pickQuote('u', '2026-09-20', 'off')).toBeNull();
  });

  it('is deterministic per user per day and differs across users or days', () => {
    const a = pickQuote('u1', '2026-09-20', 'both');
    expect(a).toEqual(pickQuote('u1', '2026-09-20', 'both'));
    const picks = new Set<string>();
    for (let i = 0; i < 20; i++) picks.add(pickQuote(`u${i}`, '2026-09-20', 'both')!.item.id);
    expect(picks.size).toBeGreaterThan(1);
  });

  it('respects the mode', () => {
    expect(pickQuote('u', '2026-09-20', 'quotes')!.kind).toBe('quote');
    expect(pickQuote('u', '2026-09-20', 'research-tips')!.kind).toBe('tip');
  });

  it('avoids anything seen in the last 30 days, then falls back to the full pool', () => {
    const seen: QuoteSeen[] = QUOTES.slice(0, -1).map((q, i) => ({
      userId: 'u',
      date: `2026-09-${String(1 + i).padStart(2, '0')}`,
      quoteId: q.id,
    }));
    const last = QUOTES[QUOTES.length - 1]!;
    expect(pickQuote('u', '2026-09-20', 'quotes', seen)!.item.id).toBe(last.id);

    const allSeen = QUOTES.map((q, i) => ({
      userId: 'u',
      date: `2026-09-${String(1 + i).padStart(2, '0')}`,
      quoteId: q.id,
    }));
    expect(pickQuote('u', '2026-09-20', 'quotes', allSeen)).not.toBeNull();
  });

  it('ignores sightings older than 30 days', () => {
    const seen: QuoteSeen[] = QUOTES.map((q) => ({
      userId: 'u',
      date: '2026-07-01',
      quoteId: q.id,
    }));
    const pick = pickQuote('u', '2026-09-20', 'quotes', seen)!;
    expect(pick).toEqual(pickQuote('u', '2026-09-20', 'quotes'));
  });

  it('returns the recorded pick for today when one exists', () => {
    const target = QUOTES[1]!;
    const seen: QuoteSeen[] = [{ userId: 'u', date: '2026-09-20', quoteId: target.id }];
    expect(pickQuote('u', '2026-09-20', 'quotes', seen)!.item.id).toBe(target.id);
    // unknown id recorded -> normal pick
    const bad: QuoteSeen[] = [{ userId: 'u', date: '2026-09-20', quoteId: 'gone' }];
    expect(pickQuote('u', '2026-09-20', 'quotes', bad)).not.toBeNull();
  });
});
