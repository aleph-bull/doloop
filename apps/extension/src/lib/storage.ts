import type { TimerState, UserSettings, Session } from '@doloop/core';

/** Everything the extension persists, all in chrome.storage.local. */
export interface Connection {
  apiUrl: string;
  token: string;
  /** Supabase only: lets the background refresh the access token. */
  refreshToken?: string | null;
  expiresAt?: number | null; // epoch seconds
  supabaseUrl?: string | null;
  anonKey?: string | null;
  portalUrl: string;
  email?: string | null;
}

export interface ActiveSnapshot {
  session: Session;
  timer: TimerState;
  nodeTitle: string;
  fetchedAt: string;
}

export interface Snapshot {
  active: ActiveSnapshot | null;
  settings: UserSettings | null;
  timezone: string | null;
  /** Leaves the user can start, from the daily plan (already ordered). */
  plan: Array<{ nodeId: string; title: string; suggestedMinutes: number }>;
  /** Every non-archived node (parents included, for path labels). */
  nodes: Array<{
    id: string;
    title: string;
    kind: string;
    parentId: string | null;
    completedAt: string | null;
  }>;
  updatedAt: string;
}

export interface Stored {
  connection?: Connection;
  snapshot?: Snapshot;
  /** Pending "Still studying?" question after chrome.idle fired. */
  idlePrompt?: { sessionId: string; since: string } | null;
  /** Date (user tz) the daily quote was last shown in the popup. */
  quoteShownOn?: string;
  lastError?: string | null;
  /** Cached uploaded background, keyed by the API's updatedAt. */
  customBackground?: { dataUrl: string; updatedAt: string } | null;
}

export async function get<K extends keyof Stored>(key: K): Promise<Stored[K]> {
  const out = await chrome.storage.local.get(key);
  return out[key] as Stored[K];
}

export async function getAll(): Promise<Stored> {
  return (await chrome.storage.local.get(null)) as Stored;
}

export async function set(patch: Partial<Stored>): Promise<void> {
  await chrome.storage.local.set(patch);
}

export async function remove(...keys: Array<keyof Stored>): Promise<void> {
  await chrome.storage.local.remove(keys as string[]);
}

export function onChange(cb: (changes: Partial<Stored>) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(changes)) out[k] = v.newValue;
    cb(out as Partial<Stored>);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
