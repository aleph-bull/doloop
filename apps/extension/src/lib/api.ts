import type {
  NodePace,
  PlanItem,
  Session,
  StudyNode,
  TimerEvent,
  TimerState,
  TimerView,
  User,
} from '@doloop/core';
import { get, set, type Connection } from './storage';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ActiveSession {
  session: Session;
  timer: TimerState;
  view: TimerView;
  nodeTitle: string;
}

async function refreshIfNeeded(conn: Connection): Promise<Connection> {
  if (!conn.refreshToken || !conn.supabaseUrl || !conn.anonKey || !conn.expiresAt) return conn;
  const now = Math.floor(Date.now() / 1000);
  if (conn.expiresAt - now > 120) return conn;
  const res = await fetch(`${conn.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: conn.anonKey },
    body: JSON.stringify({ refresh_token: conn.refreshToken }),
  });
  if (!res.ok) throw new ApiError(401, 'Session expired. Open Doloop to reconnect.');
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };
  const next: Connection = {
    ...conn,
    token: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
  };
  await set({ connection: next });
  return next;
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let conn = await get('connection');
  if (!conn) throw new ApiError(401, 'Not connected. Open Doloop and sign in.');
  conn = await refreshIfNeeded(conn);
  const headers: Record<string, string> = {
    authorization: `Bearer ${conn.token}`,
    'x-timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${conn.apiUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || res.statusText);
  return data as T;
}

export const api = {
  me: () => request<{ user: User }>('GET', '/api/me'),
  active: () =>
    request<{ now: string; active: ActiveSession | null }>('GET', '/api/sessions/active'),
  pace: () => request<{ pace: Record<string, NodePace>; plan: PlanItem[] }>('GET', '/api/pace'),
  nodes: () => request<{ nodes: StudyNode[] }>('GET', '/api/nodes'),
  start: (input: { nodeId: string; mode: Session['mode']; plannedEndAt?: string | null }) =>
    request<{ now: string; active: ActiveSession }>('POST', '/api/sessions', input),
  event: (id: string, event: TimerEvent) =>
    request<{ now: string; active: ActiveSession }>('POST', `/api/sessions/${id}/events`, event),
  end: (id: string, body: { review?: Record<string, unknown> | null }) =>
    request<{
      summary: {
        xp: { total: number };
        phrase: { text: string } | null;
        badges: string[];
        streak: { current: number };
      };
    }>('POST', `/api/sessions/${id}/end`, body),
  quote: () =>
    request<{
      date: string;
      pick: {
        kind: 'quote' | 'tip';
        item: { text: string; author?: string; citation?: string };
      } | null;
    }>('GET', '/api/quote'),
};
