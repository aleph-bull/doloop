import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth';
import { clearQueryCache, lastUserKey, persistQueryCache, rememberUserKey } from './persist';

/**
 * Keeps the on-disk query cache tied to whoever is signed in: it starts mirroring once an
 * account is known, and wipes the cache the moment a different account appears or the user
 * signs out. Without this, cached task titles from one account could surface under another
 * on a shared browser.
 */
export function useCachePersistence(): void {
  const auth = useAuth();
  const client = useQueryClient();

  useEffect(() => {
    if (auth.status === 'loading') return;

    if (auth.status === 'signed-out') {
      rememberUserKey(null);
      void clearQueryCache();
      return;
    }

    const key = auth.email ?? null;
    if (!key) return;
    if (lastUserKey() !== key) {
      // A different account than the cache on disk belongs to: drop it before writing.
      void clearQueryCache().then(() => rememberUserKey(key));
      client.clear();
    } else {
      rememberUserKey(key);
    }
    return persistQueryCache(client, key);
  }, [auth.status, auth.email, client]);
}

/**
 * A text draft kept in this browser so a half-written note survives a reload or a closed
 * tab. Drafts are per-key and never leave the device; callers clear them once the text has
 * been saved to the server.
 */
export function useLocalDraft(
  key: string,
  serverValue: string,
): [string, (v: string) => void, () => void] {
  const storageKey = `komogon.draft.${key}`;
  const read = (): string | null => {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  };

  // A draft only wins over the server value when it actually differs from it.
  const [value, setValue] = useState(() => {
    const draft = read();
    return draft !== null && draft !== serverValue ? draft : serverValue;
  });

  // Track the server value so a fresh load from the API adopts it, without clobbering a
  // draft the user is still typing.
  const lastServer = useRef(serverValue);
  const touched = useRef(false);
  useEffect(() => {
    if (serverValue === lastServer.current) return;
    lastServer.current = serverValue;
    if (!touched.current) setValue(serverValue);
  }, [serverValue]);

  // Switching to a different draft (another week, another task) starts fresh from that
  // key's own stored text rather than carrying the previous one across.
  const lastKey = useRef(storageKey);
  useEffect(() => {
    if (storageKey === lastKey.current) return;
    lastKey.current = storageKey;
    touched.current = false;
    lastServer.current = serverValue;
    let draft: string | null = null;
    try {
      draft = localStorage.getItem(storageKey);
    } catch {
      /* ignore */
    }
    setValue(draft !== null && draft !== serverValue ? draft : serverValue);
  }, [storageKey, serverValue]);

  const set = useCallback(
    (next: string) => {
      touched.current = true;
      setValue(next);
      try {
        if (next === lastServer.current) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, next);
      } catch {
        /* Storage blocked: the draft just does not survive the reload. */
      }
    },
    [storageKey],
  );

  const clear = useCallback(() => {
    touched.current = false;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  return [value, set, clear];
}

/** True when the browser reports being offline, so the UI can say so rather than fail mutely. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
