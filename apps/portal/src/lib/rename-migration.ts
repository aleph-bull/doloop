/**
 * The app was called Doloop until 2026-09-23, and its browser storage keys said so.
 * Carry the old keys over once so a browser that used Doloop stays signed in and keeps its
 * dismissed hints and drafts. The old IndexedDB query cache is dropped rather than copied:
 * it is only a cache and refills on the first fetch.
 *
 * Safe to delete once nobody has a Doloop-era browser profile left.
 */
const OLD_PREFIX = 'doloop.';
const NEW_PREFIX = 'komodoit.';

export function migrateDoloopStorage(): void {
  try {
    const oldKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(OLD_PREFIX)) oldKeys.push(key);
    }
    for (const key of oldKeys) {
      const next = NEW_PREFIX + key.slice(OLD_PREFIX.length);
      const value = localStorage.getItem(key);
      if (value !== null && localStorage.getItem(next) === null) localStorage.setItem(next, value);
      localStorage.removeItem(key);
    }
    if (oldKeys.length > 0) indexedDB?.deleteDatabase('doloop');
  } catch {
    // Storage blocked or unavailable: nothing to carry over.
  }
}
