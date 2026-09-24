/**
 * The app was called Doloop until 2026-09-23, then KomodoIt for the rest of that day, and
 * its browser storage keys said so. Carry the old keys over once so a browser that used
 * either name stays signed in and keeps its dismissed hints and drafts. The old IndexedDB
 * query caches are dropped rather than copied: they are only caches and refill on the first
 * fetch.
 *
 * Safe to delete once nobody has a Doloop- or KomodoIt-era browser profile left.
 */
/** Newest first, so a key saved under both names keeps its later value. */
const OLD_NAMES = ['komodoit', 'doloop'];
const NEW_PREFIX = 'komogon.';

export function migrateOldStorage(): void {
  try {
    for (const name of OLD_NAMES) {
      const oldPrefix = `${name}.`;
      const oldKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(oldPrefix)) oldKeys.push(key);
      }
      for (const key of oldKeys) {
        const next = NEW_PREFIX + key.slice(oldPrefix.length);
        const value = localStorage.getItem(key);
        if (value !== null && localStorage.getItem(next) === null)
          localStorage.setItem(next, value);
        localStorage.removeItem(key);
      }
      if (oldKeys.length > 0) indexedDB?.deleteDatabase(name);
    }
  } catch {
    // Storage blocked or unavailable: nothing to carry over.
  }
}
