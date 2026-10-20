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
