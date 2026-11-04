import type {
  CustomReward,
  NodePace,
  PlanItem,
  RewardView,
  RoutineOccurrence,
  Session,
  StudyNode,
  TimerEvent,
  TimerState,
  TimerView,
  User,
} from '@komogon/core';
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
  if (!res.ok) throw new ApiError(401, 'Session expired. Open Komogon to reconnect.');
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
  if (!conn) throw new ApiError(401, 'Not connected. Open Komogon and sign in.');
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
  me: () => request<{ user: User; backgroundUpdatedAt: string | null }>('GET', '/api/me'),
  background: () => request<{ dataUrl: string; updatedAt: string }>('GET', '/api/me/background'),
  active: () =>
    request<{ now: string; active: ActiveSession | null }>('GET', '/api/sessions/active'),
  pace: () => request<{ pace: Record<string, NodePace>; plan: PlanItem[] }>('GET', '/api/pace'),
  nodes: () => request<{ nodes: StudyNode[] }>('GET', '/api/nodes'),
  start: (input: {
    nodeId?: string;
    routineId?: string;
    routineDate?: string;
    mode: Session['mode'];
    plannedEndAt?: string | null;
    showTimer?: boolean;
  }) => request<{ now: string; active: ActiveSession }>('POST', '/api/sessions', input),
  event: (id: string, event: TimerEvent) =>
    request<{ now: string; active: ActiveSession }>('POST', `/api/sessions/${id}/events`, event),
  end: (id: string, body: { review?: Record<string, unknown> | null; markComplete?: boolean }) =>
    request<{
      summary: {
        session: Session;
        xp: { total: number };
        phrase: { text: string } | null;
        badges: string[];
        streak: { current: number };
        routineTicked: boolean;
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

  /**
   * Routines. The window is pinned to today so the response stays small: `due` is computed
   * from its own grace period and does not depend on it.
   */
  routines: (today: string) =>
    request<{
      today: string;
      due: RoutineOccurrence[];
      xpToday: number;
      xpRemainingToday: number;
    }>('GET', `/api/routines?from=${today}&to=${today}`),
  tickRoutine: (id: string, date: string) =>
    request<{
      xpAwarded: number;
      xpTotal: number;
      cappedByDailyLimit: boolean;
      badges: string[];
    }>('POST', `/api/routines/${id}/tick`, { date }),
  untickRoutine: (id: string, date: string) =>
    request<{ xpTotal: number }>('DELETE', `/api/routines/${id}/tick/${date}`),

  rewards: () => request<{ rewards: RewardView[]; xp: number }>('GET', '/api/rewards'),
  redeem: (id: string) =>
    request<{ reward: CustomReward; xp: number; spent: number; rewards: RewardView[] }>(
      'POST',
      `/api/rewards/${id}/redeem`,
    ),
};
