import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { pickQuote, QUOTES, quoteSlot, RESEARCH_TIPS } from './quotes';
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

  it('avoids anything seen in the last 30 days, then still finds something', () => {
    // Several sightings can share a recent date; only the ids matter for the no-repeat window.
    const seen: QuoteSeen[] = QUOTES.slice(0, -1).map((q) => ({
      userId: 'u',
      date: '2026-09-19',
      quoteId: q.id,
    }));
    const last = QUOTES[QUOTES.length - 1]!;
    expect(pickQuote('u', '2026-09-20', 'quotes', seen)!.item.id).toBe(last.id);

    const allSeen = QUOTES.map((q) => ({ userId: 'u', date: '2026-09-19', quoteId: q.id }));
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

describe('six-hour quotes', () => {
  it('slots each local day into four, keyed by date and start hour', () => {
    const tz = 'America/Toronto'; // UTC-4 in September
    expect(quoteSlot('2026-09-24T04:30:00.000Z', tz).key).toBe('2026-09-24T00');
    expect(quoteSlot('2026-09-24T09:59:00.000Z', tz).key).toBe('2026-09-24T00');
    expect(quoteSlot('2026-09-24T10:00:00.000Z', tz).key).toBe('2026-09-24T06');
    expect(quoteSlot('2026-09-24T21:00:00.000Z', tz).key).toBe('2026-09-24T12');
    expect(quoteSlot('2026-09-25T03:00:00.000Z', tz).key).toBe('2026-09-24T18');
  });

  it('ends each slot where the next begins, midnight included', () => {
    const tz = 'America/Toronto';
    expect(quoteSlot('2026-09-24T12:00:00.000Z', tz).endsAt.toISOString()).toBe(
      '2026-09-24T16:00:00.000Z',
    );
    expect(quoteSlot('2026-09-25T01:00:00.000Z', tz).endsAt.toISOString()).toBe(
      '2026-09-25T04:00:00.000Z',
    );
  });

  it('sorts a slot key after the bare date of the one-a-day picks', () => {
    expect('2026-09-24T00' > '2026-09-24').toBe(true);
  });

  it('brings a different quote with each slot', () => {
    const seen: QuoteSeen[] = [];
    let prev: string | null = null;
    for (const hour of ['00', '06', '12', '18']) {
      const slot = `2026-09-24T${hour}`;
      const pick = pickQuote('u', slot, 'quotes', seen)!;
      expect(pick.item.id).not.toBe(prev);
      seen.push({ userId: 'u', date: slot, quoteId: pick.item.id });
      prev = pick.item.id;
    }
  });

  it('once the pool is used up, brings back the longest unseen, never the last one up', () => {
    // Four a day gets through the 35 tips in nine days: each shown once, the last most recently.
    const seen: QuoteSeen[] = RESEARCH_TIPS.map((t, i) => ({
      userId: 'u',
      date: `${addDays('2026-09-20', Math.floor(i / 4))}T${String((i % 4) * 6).padStart(2, '0')}`,
      quoteId: t.id,
    }));
    const half = Math.ceil(RESEARCH_TIPS.length / 2);
    const recentHalf = new Set(RESEARCH_TIPS.slice(half).map((t) => t.id));
    for (let u = 0; u < 20; u++) {
      const pick = pickQuote(`u${u}`, '2026-09-30T06', 'research-tips', seen)!;
      expect(recentHalf.has(pick.item.id)).toBe(false);
    }
  });
});

describe('sourced data (spec §12)', () => {
  it('has 40+ quotes, all from the three source pages, none about illness or trauma', () => {
    expect(QUOTES.length).toBeGreaterThanOrEqual(40);
    expect(QUOTES.length).toBeLessThanOrEqual(200);
    const sources = new Set(QUOTES.map((q) => q.sourceUrl));
    expect(sources.size).toBe(3);
    for (const q of QUOTES) {
      expect(q.text).not.toMatch(/\b(depression|illness|trauma|disorder|suicide)/i);
      expect(q.text.split(/\s+/).length).toBeLessThanOrEqual(30);
      expect(q.tags.length).toBeGreaterThan(0);
    }
  });

  it('has 30+ research tips, each with a citation naming a researcher or paper', () => {
    expect(RESEARCH_TIPS.length).toBeGreaterThanOrEqual(30);
    for (const t of RESEARCH_TIPS) {
      expect(t.citation).toMatch(/[A-Z][a-z]+.*\(\d{4}\)/);
      expect(t.text.length).toBeLessThan(160);
    }
  });
});
