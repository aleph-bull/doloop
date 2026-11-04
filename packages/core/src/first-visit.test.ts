import { describe, expect, it } from 'vitest';
import { shouldOpenHomepage, type FirstVisit } from './first-visit';

const first: FirstVisit = {
  path: '/',
  search: '',
  hash: '',
  referrer: 'https://www.google.com/',
  homepage: 'https://app.komogon.app/',
  installed: false,
  storageKeys: [],
};

describe('a first visit straight onto sign in', () => {
  it('goes to the homepage from a search, a link or a typed address', () => {
    expect(shouldOpenHomepage(first)).toBe(true);
    expect(shouldOpenHomepage({ ...first, referrer: '' })).toBe(true);
    expect(shouldOpenHomepage({ ...first, path: '/signin' })).toBe(true);
  });

  it('stays when it came from the homepage', () => {
    expect(shouldOpenHomepage({ ...first, referrer: 'https://app.komogon.app/' })).toBe(false);
    expect(shouldOpenHomepage({ ...first, referrer: 'https://app.komogon.app/changelog/' })).toBe(
      false,
    );
  });

  it('stays once this browser has been here or is signed in', () => {
    expect(shouldOpenHomepage({ ...first, storageKeys: ['komogon.seen'] })).toBe(false);
    expect(shouldOpenHomepage({ ...first, storageKeys: ['komogon.token'] })).toBe(false);
    expect(shouldOpenHomepage({ ...first, storageKeys: ['doloop.token'] })).toBe(false);
    expect(shouldOpenHomepage({ ...first, storageKeys: ['sb-abc-auth-token'] })).toBe(false);
    expect(shouldOpenHomepage({ ...first, storageKeys: ['something-else'] })).toBe(true);
  });

  it('stays in the installed app', () => {
    expect(shouldOpenHomepage({ ...first, installed: true })).toBe(false);
  });

  it('leaves every other address alone', () => {
    for (const path of ['/signup', '/reset-password', '/auth/callback', '/tasks', '/profile/x'])
      expect(shouldOpenHomepage({ ...first, path })).toBe(false);
    expect(shouldOpenHomepage({ ...first, search: '?email=a%40b.c' })).toBe(false);
    expect(shouldOpenHomepage({ ...first, hash: '#access_token=x' })).toBe(false);
  });

  it('does nothing without a usable homepage address', () => {
    expect(shouldOpenHomepage({ ...first, homepage: '' })).toBe(false);
  });
});
