import type {
  NodePace,
  PlanItem,
  PlannedBlock,
  RestDayPolicy,
  Session,
  StudyNode,
  TimerState,
  TimerView,
  User,
  UserSettings,
  Quote,
  ResearchTip,
  Phrase,
  SessionXpBreakdown,
  PaceStatus,
  Vacation,
  TimerEvent,
} from '@doloop/core';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

let tokenGetter: () => Promise<string | null> = async () => null;
export function setTokenGetter(fn: () => Promise<string | null>) {
  tokenGetter = fn;
}

const BASE = import.meta.env.VITE_API_URL ?? '';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await tokenGetter();
  const headers: Record<string, string> = {
    'x-timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || res.statusText, data);
  }
  return data as T;
}

export interface MeResponse {
  user: User;
  onboarded: boolean;
  streakMessage: string | null;
  streakMilestones: number[];
  restDays: { policy: RestDayPolicy; editsRemaining: number };
  purchasedBackgrounds: string[];
}

export interface ActiveSession {
  session: Session;
  timer: TimerState;
  view: TimerView;
  nodeTitle: string;
}

export interface EndSummary {
  session: Session;
  xp: SessionXpBreakdown;
  xpTotal: number;
  levelBefore: number;
  levelAfter: number;
  leveledUp: boolean;
  streak: { current: number; longest: number; message: string | null; milestonesReached: number[] };
  statusAfter: PaceStatus;
  nodeCompleted: boolean;
  phrase: Phrase | null;
  badges: string[];
  confetti: boolean;
  isFirstSessionOnNode: boolean;
}

export type DailyPick = { kind: 'quote'; item: Quote } | { kind: 'tip'; item: ResearchTip };

export interface ReviewInput {
  skipped?: boolean;
  prepared?: number | null;
  distracted?: 'no' | 'a-little' | 'a-lot' | null;
  completedCount?: number | null;
  correctCount?: number | null;
  mood?: number | null;
  extraMinutesAdded?: number | null;
  note?: string | null;
}

export interface NodeInput {
  parentId?: string | null;
  title?: string;
  kind?: StudyNode['kind'];
  estimatedMinutes?: number | null;
  dueAt?: string | null;
  sortOrder?: number;
  color?: string | null;
  countUnit?: StudyNode['countUnit'];
  countUnitLabel?: string | null;
  completedAt?: string | null;
  archived?: boolean;
  outcomeRating?: number | null;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const api = {
  health: () => request<{ ok: boolean }>('GET', '/api/health'),
  me: () => request<MeResponse>('GET', '/api/me'),
  updateMe: (patch: { timezone?: string; onboarded?: boolean }) =>
    request<{ user: User; onboarded: boolean }>('PATCH', '/api/me', patch),
  updateSettings: (patch: DeepPartial<UserSettings>) =>
    request<{ settings: UserSettings }>('PATCH', '/api/me/settings', patch),
  regenerateIcsToken: () => request<{ icsToken: string }>('POST', '/api/me/ics-token'),
  exportData: () => request<unknown>('GET', '/api/me/export'),
  deleteAccount: () => request<void>('DELETE', '/api/me'),

  nodes: (archived = false) =>
    request<{ nodes: StudyNode[] }>('GET', `/api/nodes${archived ? '?archived=true' : ''}`),
  createNode: (input: NodeInput & { title: string }) =>
    request<{ node: StudyNode }>('POST', '/api/nodes', input),
  updateNode: (id: string, patch: NodeInput) =>
    request<{ node: StudyNode }>('PATCH', `/api/nodes/${id}`, patch),
  archiveNode: (id: string) =>
    request<{ archivedIds: string[] }>('POST', `/api/nodes/${id}/archive`),
  deleteNode: (id: string) => request<void>('DELETE', `/api/nodes/${id}`),
  pace: () =>
    request<{ now: string; pace: Record<string, NodePace>; plan: PlanItem[] }>('GET', '/api/pace'),

  activeSession: () =>
    request<{ now: string; active: ActiveSession | null }>('GET', '/api/sessions/active'),
  startSession: (input: {
    nodeId: string;
    mode: Session['mode'];
    plannedEndAt?: string | null;
    showTimer?: boolean;
  }) => request<{ now: string; active: ActiveSession }>('POST', '/api/sessions', input),
  sessionEvent: (id: string, event: TimerEvent) =>
    request<{ now: string; active: ActiveSession }>('POST', `/api/sessions/${id}/events`, event),
  endSession: (id: string, body: { review?: ReviewInput | null; markComplete?: boolean }) =>
    request<{ summary: EndSummary }>('POST', `/api/sessions/${id}/end`, body),
  sessions: (params: { nodeId?: string; from?: string; to?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
    const qs = q.toString();
    return request<{ sessions: Session[] }>('GET', `/api/sessions${qs ? `?${qs}` : ''}`);
  },

  plannedBlocks: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const qs = q.toString();
    return request<{ blocks: PlannedBlock[] }>('GET', `/api/planned-blocks${qs ? `?${qs}` : ''}`);
  },
  createBlock: (input: { nodeId?: string | null; startAt: string; endAt: string }) =>
    request<{ block: PlannedBlock }>('POST', '/api/planned-blocks', input),
  updateBlock: (
    id: string,
    patch: { nodeId?: string | null; startAt?: string; endAt?: string; cancelled?: boolean },
  ) => request<{ block: PlannedBlock }>('PATCH', `/api/planned-blocks/${id}`, patch),
  deleteBlock: (id: string) => request<void>('DELETE', `/api/planned-blocks/${id}`),

  restDays: () =>
    request<{ policy: RestDayPolicy; editsRemaining: number }>('GET', '/api/rest-days'),
  setWeeklyRestDays: (days: number[]) =>
    request<{ policy: RestDayPolicy; editsRemaining: number }>('PUT', '/api/rest-days/weekly', {
      days,
    }),
  addVacation: (v: Vacation) =>
    request<{ policy: RestDayPolicy; editsRemaining: number }>(
      'POST',
      '/api/rest-days/vacations',
      v,
    ),
  removeVacation: (from: string) =>
    request<{ policy: RestDayPolicy; editsRemaining: number }>(
      'DELETE',
      `/api/rest-days/vacations/${from}`,
    ),

  quote: () => request<{ date: string; pick: DailyPick | null }>('GET', '/api/quote'),
};
