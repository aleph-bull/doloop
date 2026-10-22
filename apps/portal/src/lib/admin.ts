import { useQuery } from '@tanstack/react-query';
import { apiBaseUrl, authHeaders } from './api';

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
  /** On `ADMIN_EMAILS`: can't be suspended, deleted or blocked. */
  admin: boolean;
  you: boolean;
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

export const adminKeys = {
  accounts: ['admin', 'accounts'] as const,
  sessions: (id: string) => ['admin', 'sessions', id] as const,
  blocked: ['admin', 'blocked'] as const,
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
