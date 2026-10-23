import { describe, expect, it } from 'vitest';
import {
  USERNAME_WORDS,
  displayNameError,
  normalizeDisplayName,
  normalizeUsername,
  personName,
  randomUsername,
  showsUsername,
  usernameError,
  usernameUnlocksAt,
} from './names';

describe('usernames', () => {
  it('drops the @ and lowers the case', () => {
    expect(normalizeUsername('  @Ada.L ')).toBe('ada.l');
  });

  it('takes a to z, numbers and _ - ! .', () => {
    for (const ok of [
      'ada',
      '@ada',
      'ada.lovelace',
      'a_b-c',
      '_ada_',
      'ADA',
      'ada99',
      'wow!',
      '!ada',
    ]) {
      expect(usernameError(ok)).toBeNull();
    }
  });

  it('needs at least 3 characters after the @', () => {
    expect(usernameError('@ab')).toMatch(/at least 3/i);
    expect(usernameError('')).toMatch(/at least 3/i);
  });

  it('caps the length', () => {
    expect(usernameError('a'.repeat(30))).toBeNull();
    expect(usernameError('a'.repeat(31))).toMatch(/up to 30/i);
  });

  it('refuses spaces', () => {
    expect(usernameError('ada l')).toMatch(/no spaces/i);
  });

  it('refuses accents and other symbols', () => {
    for (const bad of ['zoë', "o'neil", 'ada?', 'ada#1', '@@ada', 'ада', 'ada+l']) {
      expect(usernameError(bad)).toMatch(/only a to z/i);
    }
  });

  it('refuses two symbols in a row', () => {
    for (const bad of ['ada..l', 'ada._l', 'ada-_l', '__ada', 'ada!!', 'ada.!']) {
      expect(usernameError(bad)).toMatch(/in a row/i);
    }
  });
});

describe('display names', () => {
  it('closes up spaces', () => {
    expect(normalizeDisplayName('  Ada   Lovelace ')).toBe('Ada Lovelace');
  });

  it('takes letters in any script, numbers and spaces', () => {
    for (const ok of ['Ada Lovelace', 'Zoë', 'José María', 'R2 D2', '李华', '']) {
      expect(displayNameError(ok)).toBeNull();
    }
  });

  it('refuses every symbol', () => {
    for (const bad of ["O'Neil", 'Ada!', 'Ada L.', 'José-María', 'ada_l', 'Ada 🙂', 'Ada@home']) {
      expect(displayNameError(bad)).toMatch(/no symbols/i);
    }
  });

  it('caps the length', () => {
    expect(displayNameError('a'.repeat(61))).toMatch(/up to 60/i);
  });
});

describe('personName', () => {
  it('is the name, else the username without its @, else Someone', () => {
    expect(personName('  Ada ', 'ada')).toBe('Ada');
    expect(personName('', 'komodev')).toBe('komodev');
    expect(personName(null, null)).toBe('Someone');
  });

  it('leaves the small @username out when it is already the name', () => {
    expect(showsUsername({ name: 'Ada', username: 'ada' })).toBe(true);
    expect(showsUsername({ name: 'komodev', username: 'komodev' })).toBe(false);
    expect(showsUsername({ name: 'Someone', username: null })).toBe(false);
  });
});

describe('usernameUnlocksAt', () => {
  it('lets a picked one change at once', () => {
    expect(usernameUnlocksAt(null, '2026-10-21T12:00:00.000Z')).toBeNull();
  });

  it('holds a chosen one for 14 days', () => {
    const at = '2026-10-21T12:00:00.000Z';
    expect(usernameUnlocksAt(at, '2026-11-04T11:59:00.000Z')).toBe('2026-11-04T12:00:00.000Z');
    expect(usernameUnlocksAt(at, '2026-11-04T12:00:00.000Z')).toBeNull();
  });
});

describe('randomUsername', () => {
  it('is two words', () => {
    expect(randomUsername(() => 0)).toBe('amber.acorn');
  });

  it('always makes a valid username', () => {
    for (let i = 0; i < 200; i++) {
      expect(usernameError(randomUsername())).toBeNull();
      expect(usernameError(randomUsername(Math.random, true))).toBeNull();
    }
    const { adjectives, nouns } = USERNAME_WORDS;
    const longest = (l: readonly string[]) => Math.max(...l.map((w) => w.length));
    const worst = 'a'.repeat(longest(adjectives)) + '.' + 'n'.repeat(longest(nouns));
    expect(usernameError(`${worst}.${'n'.repeat(longest(nouns))}`)).toBeNull();
  });

  it('adds a third word on request', () => {
    expect(randomUsername(() => 0, true)).toBe('amber.acorn.acorn');
  });
});
