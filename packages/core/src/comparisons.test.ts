import { describe, expect, it } from 'vitest';
import { boardsFor } from './comparisons';
import { withDefaults } from './defaults';

describe('comparisons', () => {
  it('keeps every board by default', () => {
    expect(withDefaults({}).social.comparisons).toBe('global');
    expect(boardsFor('global')).toEqual(['global', 'friends', 'school', 'schools']);
  });

  it('keeps only the one board, or none', () => {
    expect(boardsFor('school')).toEqual(['school']);
    expect(boardsFor('friends')).toEqual(['friends']);
    expect(boardsFor('off')).toEqual([]);
  });

  it('reads an odd stored value as the default', () => {
    for (const comparisons of [true, false, 'loud']) {
      const row = { social: { comparisons } } as unknown as Parameters<typeof withDefaults>[0];
      expect(withDefaults(row).social.comparisons).toBe('global');
    }
    expect(withDefaults({ social: { comparisons: 'off' } }).social.comparisons).toBe('off');
  });
});
