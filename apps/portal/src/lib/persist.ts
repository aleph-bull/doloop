import type { DehydratedState, QueryClient } from '@tanstack/react-query';
import { dehydrate, hydrate } from '@tanstack/react-query';

/**
 * Local persistence for the query cache.
 *
 * The server stays the source of truth: this only means the app opens showing your last
 * known tasks, XP and analytics instead of a spinner, and still shows something useful
 * when the API is unreachable. Everything restored is refetched in the background, so a
 * stale value is never more than a moment old once you are online.
 *
 * Nothing is synced anywhere. The cache lives in this browser, for this user, and is
 * dropped when you sign out or when a different account signs in.
 */

const DB_NAME = 'doloop';
const STORE = 'query-cache';
const RECORD_KEY = 'state';

/** Bump to discard every existing cache after a change to what is stored. */
const CACHE_VERSION = 1;

/** Older than this and the cache is thrown away rather than shown. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** How long to wait for IndexedDB at boot before giving up and rendering unhydrated. */
const OPEN_TIMEOUT_MS = 1500;

/** Debounce on writes: the cache changes constantly while queries settle. */
const WRITE_DEBOUNCE_MS = 1000;

const USER_KEY_STORAGE = 'doloop.user';

/**
 * Queries that must never come back from disk:
 *  - the active session carries the running timer, which only the server can be right about;
 *  - the custom background is a multi-megabyte data URL, far too large to rewrite on every
 *    cache change.
 */
const VOLATILE_PREFIXES: readonly (readonly unknown[])[] = [
  ['sessions', 'active'],
  ['me', 'background'],
];

const isVolatile = (key: readonly unknown[]): boolean =>
  VOLATILE_PREFIXES.some((prefix) => prefix.every((part, i) => key[i] === part));

interface CacheRecord {
  version: number;
  savedAt: number;
  /** Which account this cache belongs to; a mismatch means we discard it unread. */
  userKey: string | null;
  state: DehydratedState;
}

/* ---------- which user the cache belongs to ---------- */

/**
 * The last account known to be signed in, readable synchronously at boot. Without it we
 * would have to wait for auth to resolve before deciding whether the cache is safe to
 * show, which defeats the point of having one.
 */
export function lastUserKey(): string | null {
  try {
    return localStorage.getItem(USER_KEY_STORAGE);
  } catch {
    return null;
  }
}

export function rememberUserKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(USER_KEY_STORAGE, key);
    else localStorage.removeItem(USER_KEY_STORAGE);
  } catch {
    /* Private mode or blocked storage: persistence is a convenience, never required. */
  }
}

/* ---------- IndexedDB ---------- */

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let settled = false;
    const done = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };
    const timer = setTimeout(() => done(null), OPEN_TIMEOUT_MS);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      clearTimeout(timer);
      return done(null);
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      done(req.result);
    };
    req.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    req.onblocked = () => {
      clearTimeout(timer);
      done(null);
    };
  });
}

function readRecord(db: IDBDatabase): Promise<CacheRecord | null> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(RECORD_KEY);
      req.onsuccess = () => resolve((req.result as CacheRecord | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function writeRecord(db: IDBDatabase, record: CacheRecord): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record, RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

function deleteRecord(db: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const db = () => (dbPromise ??= openDb());

/* ---------- restore and persist ---------- */

/**
 * Fill the cache from disk before the first render. Best-effort in every sense: a missing,
 * stale, foreign or unreadable cache simply means the app starts empty, as it did before.
 */
export async function restoreQueryCache(client: QueryClient): Promise<boolean> {
  const conn = await db();
  if (!conn) return false;
  const record = await readRecord(conn);
  if (!record || record.version !== CACHE_VERSION) return false;
  if (Date.now() - record.savedAt > MAX_AGE_MS) {
    await deleteRecord(conn);
    return false;
  }
  // Only show a cache we can positively attribute to the account that is signing in.
  const current = lastUserKey();
  if (!current || record.userKey !== current) {
    await deleteRecord(conn);
    return false;
  }
  try {
    hydrate(client, record.state);
    return true;
  } catch {
    await deleteRecord(conn);
    return false;
  }
}

export async function clearQueryCache(): Promise<void> {
  const conn = await db();
  if (conn) await deleteRecord(conn);
}

/**
 * Mirror the cache to disk as it changes. Returns a function that stops persisting.
 * Writes are debounced and also flushed when the tab is hidden, which is the last
 * reliable moment on mobile before the page may be discarded.
 */
export function persistQueryCache(client: QueryClient, userKey: string | null): () => void {
  let timer: number | undefined;
  let stopped = false;

  const snapshot = (): CacheRecord => ({
    version: CACHE_VERSION,
    savedAt: Date.now(),
    userKey,
    state: dehydrate(client, {
      shouldDehydrateQuery: (query) =>
        query.state.status === 'success' && !isVolatile(query.queryKey),
      // In-flight mutations are not replayed on restore; this is a cache, not an outbox.
      shouldDehydrateMutation: () => false,
    }),
  });

  const flush = async () => {
    if (stopped) return;
    const conn = await db();
    if (!conn || stopped) return;
    await writeRecord(conn, snapshot());
  };

  const schedule = () => {
    if (stopped) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void flush(), WRITE_DEBOUNCE_MS);
  };

  const unsubscribe = client.getQueryCache().subscribe(schedule);
  const onHide = () => {
    if (document.visibilityState === 'hidden') {
      window.clearTimeout(timer);
      void flush();
    }
  };
  document.addEventListener('visibilitychange', onHide);

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    unsubscribe();
    document.removeEventListener('visibilitychange', onHide);
  };
}
