import type {
  RewardView,
  RoutineOccurrence,
  TimerState,
  UserSettings,
  Session,
} from '@komogon/core';

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
  /** Routine occurrences still outstanding today or in the recent past. */
  routines: {
    /** Today in the user's timezone, which is the date a tick is banked against. */
    today: string;
    due: RoutineOccurrence[];
    xpToday: number;
    xpRemainingToday: number;
  } | null;
  /** The reward shelf, with affordability and cooldown already resolved by the server. */
  rewards: { items: RewardView[]; xp: number } | null;
  updatedAt: string;
}

export interface Stored {
  connection?: Connection;
  snapshot?: Snapshot;
  /** The quote of the moment, kept for its six-hour slot (`quoteSlot().key`) so it shows at once. */
  quote?: { slot: string; text: string; by: string; kind: 'quote' | 'tip' } | null;
  lastError?: string | null;
  /**
   * Their own background's picture and their own fonts, which live only in the app's browser
   * storage: the app hands them over through the bridge (`komogon:look`) while one is in use.
   */
  ownBackground?: { id: string; dataUrl: string } | null;
  /** Uploaded fonts in use, by id, as base64. */
  ownFonts?: Record<string, string>;
  /** The popup tab to reopen on, so a glance at routines is not undone by closing it. */
  tab?: 'focus' | 'routines' | 'rewards';
  /** The last start's choices, so the next start opens on them (the portal's `komogon.start.last`). */
  startLast?: {
    style: 'pomodoro' | 'continuous';
    duration: 'unlimited' | 'for' | 'until';
    minutes: number;
  };
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
