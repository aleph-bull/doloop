import { useCallback, useSyncExternalStore } from 'react';

/**
 * Small dismissable hints (spec §13). Dismissals live in localStorage per hint key.
 */
export type HintKey = 'rest-days' | 'calendar' | 'xp' | 'freezes' | 'blocking';

const KEY = 'doloop.hints.dismissed';
const listeners = new Set<() => void>();

function read(): Set<HintKey> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as HintKey[]) : []);
  } catch {
    return new Set();
  }
}

let cache: Set<HintKey> = read();
let snapshot = [...cache].sort().join(',');

function write(next: Set<HintKey>) {
  cache = next;
  snapshot = [...next].sort().join(',');
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useHints() {
  useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
  const isDismissed = useCallback((key: HintKey) => cache.has(key), []);
  const dismiss = useCallback((key: HintKey) => write(new Set([...cache, key])), []);
  return { isDismissed, dismiss };
}
