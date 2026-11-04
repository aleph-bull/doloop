import { useQuery } from '@tanstack/react-query';
import { apiBaseUrl, authHeaders, type FeedPost } from './api';

/** Calls the API's admin routes; throws the API's error message on failure. */
export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${apiBaseUrl(true)}${path}`, {
    ...init,
    headers: { ...(await authHeaders()), ...(init?.headers ?? {}) },
  });
  if (!res.ok && res.status !== 204) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? res.statusText);
  }
  return res;
}

/** An admin call with a JSON body (or none), answering JSON or nothing. */
export async function adminSend<T = void>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await adminFetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface AdminAccount {
  id: string;
  email: string;
  createdAt: string;
  onboarded: boolean;
  hasPassword: boolean;
  xp: number;
  level: number;
  streak: number;
  sessions: number;
  focusMinutes: number;
  timezone: string;
  bannedAt: string | null;
  /** Kept from posting and commenting on Social. */
  socialBannedAt: string | null;
  /** Its last request, to the minute; null if not used since 2026-11-03. */
  lastActiveAt: string | null;
  posts: number;
  /** Post files and older uploads, in R2 and the database together. */
  storageBytes: number;
  /** On `ADMIN_EMAILS`: can't be suspended, deleted or blocked. */
  admin: boolean;
  you: boolean;
}

/** `GET /api/admin/stats`: real accounts only. */
export interface AdminStats {
  accounts: { total: number; newThisWeek: number; onboarded: number };
  active: { now: number; day: number; week: number; month: number };
  daily: { day: string; people: number }[];
  study: { sessions: number; focusMinutes: number; focusMinutesWeek: number };
  social: { posts: number; comments: number; kudos: number; postBans: number };
  storage: {
    cloud: { bytes: number; maxBytes: number; measured: boolean } | null;
    databaseBytes: number | null;
    mediaInDatabaseBytes: number;
  };
}

/** `GET /api/admin/accounts/:id/activity`. */
export interface AccountActivity {
  lastActiveAt: string | null;
  lastSessionAt: string | null;
  days: { day: string; active: boolean }[];
  weeks: { week: string; focusMinutes: number }[];
  social: {
    posts: number;
    comments: number;
    kudosGiven: number;
    kudosReceived: number;
    friends: number;
  };
  storage: { cloudBytes: number; databaseBytes: number };
}

/** "None", "820 KB", "3.4 GB". */
export function fmtSize(bytes: number): string {
  if (bytes <= 0) return 'None';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

export interface AdminSession {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  workSeconds: number;
}

export interface BlockedEmail {
  email: string;
  createdAt: string;
  accountId: string | null;
}

export interface AdminReport {
  id: string;
  reporterId: string;
  reporterEmail: string | null;
  /** Empty when they didn't say. */
  reason: string;
  createdAt: string;
}

/** A post as Admin › Reports shows it: the post, its author's email and its reports. */
export interface AdminPost {
  post: FeedPost;
  authorEmail: string | null;
  reports: AdminReport[];
}

export const adminKeys = {
  accounts: ['admin', 'accounts'] as const,
  sessions: (id: string) => ['admin', 'sessions', id] as const,
  blocked: ['admin', 'blocked'] as const,
  reports: ['admin', 'reports'] as const,
  /** One post by the ID a report names, or its uuid. */
  post: (key: string) => ['admin', 'post', key] as const,
  stats: ['admin', 'stats'] as const,
  activity: (id: string) => ['admin', 'activity', id] as const,
};

/** Whether the signed-in account is an admin (`ADMIN_EMAILS` on the API). */
export function useIsAdmin(): boolean {
  const q = useQuery({
    queryKey: ['admin', 'me'],
    queryFn: async () => (await (await adminFetch('/api/admin/me')).json()) as { admin: boolean },
    staleTime: 5 * 60_000,
    retry: false,
  });
  return q.data?.admin ?? false;
}
