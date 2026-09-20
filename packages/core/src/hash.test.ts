import { describe, expect, it } from 'vitest';
import { fnv1a, pickIndex } from './hash';

describe('fnv1a', () => {
  it('is deterministic and spreads inputs', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
    expect(fnv1a('')).toBe(0x811c9dc5);
  });

  it('picks an index in range', () => {
    for (let i = 0; i < 100; i++) {
      const idx = pickIndex(`seed-${i}`, 7);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(7);
    }
    expect(pickIndex('x', 0)).toBe(0);
  });
});
