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
  HighlightsResult,
  NodeAnalytics,
  CourseAnalytics,
  EstimateAccuracy,
  WeeklyReview,
  CustomReward,
  RewardView,
  Routine,
  RoutineOccurrence,
  LifetimeStats,
  Heatmap as StudyHeatmapData,
  RhythmProfile,
  Tracker,
  TrackerEntry,
  TrackerWidget,
  CourseGrade,
  GradeComponent,
  Gpa,
  Insight,
} from '@komogon/core';

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

/** Public base for links (feed URLs): explicit API URL or this origin. `forFetch` keeps '' for the dev proxy. */
export function apiBaseUrl(forFetch = false): string {
  if (BASE) return BASE;
  return forFetch ? '' : window.location.origin;
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await tokenGetter();
  return token ? { authorization: `Bearer ${token}` } : {};
}

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
  icsToken: string;
}

export interface ActiveSession {
  session: Session;
  timer: TimerState;
  view: TimerView;
  /** What is being studied: the task, or the routine for a routine session. */
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
  /** A routine session whose occurrence was ticked off as it ended. */
  routineTicked: boolean;
  phrase: Phrase | null;
  badges: string[];
  confetti: boolean;
  isFirstSessionOnNode: boolean;
  endedEarly: boolean;
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
  gradeMode?: StudyNode['gradeMode'];
  gradeOverall?: number | null;
  gradeCredits?: number | null;
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
    request<{
      now: string;
      pace: Record<string, NodePace>;
      plannedMinutes: Record<string, number>;
      plan: PlanItem[];
    }>('GET', '/api/pace'),

  activeSession: () =>
    request<{ now: string; active: ActiveSession | null }>('GET', '/api/sessions/active'),
  /** For a task (nodeId), or for one occurrence of a routine (routineId + routineDate). */
  startSession: (input: {
    nodeId?: string;
    routineId?: string;
    routineDate?: string;
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

  quote: () =>
    request<{ date: string; nextAt?: string; pick: DailyPick | null }>('GET', '/api/quote'),

  weekHighlights: (weekStart?: string) =>
    request<HighlightsResult>(
      'GET',
      `/api/analytics/week${weekStart ? `?weekStart=${weekStart}` : ''}`,
    ),
  advancedAnalytics: (weekStart?: string) =>
    request<{
      weekStart: string;
      nodes: NodeAnalytics[];
      courses: CourseAnalytics[];
      estimateAccuracy: EstimateAccuracy;
    }>('GET', `/api/analytics/advanced${weekStart ? `?weekStart=${weekStart}` : ''}`),
  overviewAnalytics: (weeks?: number) =>
    request<{
      lifetime: LifetimeStats;
      heatmap: StudyHeatmapData;
      timeOfDay: RhythmProfile;
      weekday: RhythmProfile;
      insights: Insight[];
    }>('GET', `/api/analytics/overview${weeks ? `?weeks=${weeks}` : ''}`),
  weeklyReview: (weekStart?: string) =>
    request<{ review: WeeklyReview; note: string | null }>(
      'GET',
      `/api/analytics/weekly-review${weekStart ? `?weekStart=${weekStart}` : ''}`,
    ),
  saveWeeklyNote: (weekStart: string, note: string) =>
    request<{ weekStart: string; note: string }>(
      'PUT',
      `/api/analytics/weekly-review/${weekStart}`,
      { note },
    ),
  followUps: () => request<{ followUps: StudyNode[] }>('GET', '/api/follow-ups'),

  shop: () =>
    request<{
      xp: number;
      level: number;
      streak: User['streak'];
      freeze: { cost: number; held: number; max: number };
      breakDay: {
        cost: number;
        held: number;
        max: number;
        boughtThisMonth: number;
        minLeadHours: number;
      };
      backgrounds: Array<{
        id: string;
        name: string;
        minLevel: number;
        costXp: number | null;
        owned: boolean;
      }>;
      accents: Array<{ id: string; name: string; minLevel: number; unlocked: boolean }>;
      badges: Array<{ key: string; name: string; description: string }>;
      achievements: Array<{ key: string; unlockedAt: string }>;
    }>('GET', '/api/shop'),
  buyFreeze: () => request<{ xp: number }>('POST', '/api/shop/freeze'),
  buyBreakDay: () => request<{ xp: number; nextCost: number }>('POST', '/api/shop/break-day'),
  applyBreakDay: (date: string) =>
    request<{ breakDays: string[] }>('POST', '/api/shop/break-day/apply', { date }),
  getBackground: () => request<{ dataUrl: string; bytes: number }>('GET', '/api/me/background'),
  uploadBackground: (dataUrl: string) =>
    request<{ ok: boolean; bytes: number }>('PUT', '/api/me/background', { dataUrl }),
  deleteBackground: () => request<void>('DELETE', '/api/me/background'),
  buyBackground: (id: string) =>
    request<{ xp: number; purchasedBackgrounds: string[] }>('POST', '/api/shop/background', { id }),

  googleStatus: () =>
    request<{
      available: boolean;
      connected: boolean;
      revoked?: boolean;
      studyCalendarId?: string | null;
      lastSyncAt?: string | null;
    }>('GET', '/api/calendar/google/status'),
  googleConnect: () => request<{ url: string }>('POST', '/api/calendar/google/connect'),
  googleSync: () =>
    request<{ status: string; pushed: number; pulled: number; imported: number }>(
      'POST',
      '/api/calendar/google/sync',
    ),
  googleDisconnect: () => request<void>('DELETE', '/api/calendar/google'),

  spotifyStatus: () => request<SpotifyStatus>('GET', '/api/spotify/status'),
  spotifyConnect: (returnTo: 'focus' | 'settings') =>
    request<{ url: string }>('POST', '/api/spotify/connect', { returnTo }),
  spotifyDisconnect: () => request<void>('DELETE', '/api/spotify'),
  spotifyNowPlaying: () => request<NowPlaying>('GET', '/api/spotify/now-playing'),
  spotifyControl: (action: 'play' | 'pause' | 'next' | 'previous') =>
    request<{ ok: boolean }>('POST', '/api/spotify/player', { action }),
  busy: (from: string, to: string) =>
    request<{ busy: Array<{ start: string; end: string }> }>(
      'GET',
      `/api/calendar/busy?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  /** Imported commitments: context to plan around, never study time. */
  commitments: () => request<{ blocks: PlannedBlock[] }>('GET', '/api/calendar/commitments'),
  suggestSlots: (minutes: number, from: string, days = 7) =>
    request<{ slots: Array<{ start: string; end: string }> }>(
      'GET',
      `/api/calendar/suggest?minutes=${minutes}&from=${encodeURIComponent(from)}&days=${days}`,
    ),
  dismissFollowUp: (id: string) =>
    request<{ ok: boolean }>('POST', `/api/nodes/${id}/outcome-dismiss`),

  rewards: (archived = false) =>
    request<RewardsResponse>('GET', `/api/rewards${archived ? '?archived=true' : ''}`),
  createReward: (input: RewardInput) =>
    request<{ reward: CustomReward }>('POST', '/api/rewards', input),
  updateReward: (id: string, patch: Partial<RewardInput> & { archived?: boolean }) =>
    request<{ reward: CustomReward }>('PATCH', `/api/rewards/${id}`, patch),
  deleteReward: (id: string) => request<void>('DELETE', `/api/rewards/${id}`),
  redeemReward: (id: string) =>
    request<{ reward: CustomReward; xp: number; spent: number; rewards: RewardView[] }>(
      'POST',
      `/api/rewards/${id}/redeem`,
    ),

  routines: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const qs = q.toString();
    return request<RoutinesResponse>('GET', `/api/routines${qs ? `?${qs}` : ''}`);
  },
  routineList: (archived = false) =>
    request<{ routines: Routine[] }>(
      'GET',
      `/api/routines/list${archived ? '?archived=true' : ''}`,
    ),
  trackers: (weeks?: number) =>
    request<TrackerBoard>('GET', `/api/trackers${weeks ? `?weeks=${weeks}` : ''}`),
  createTracker: (input: TrackerInput) =>
    request<{ tracker: Tracker }>('POST', '/api/trackers', input),
  updateTracker: (id: string, patch: Partial<TrackerInput> & { archived?: boolean }) =>
    request<{ tracker: Tracker }>('PATCH', `/api/trackers/${id}`, patch),
  deleteTracker: (id: string) => request<void>('DELETE', `/api/trackers/${id}`),
  logTracker: (id: string, input: LogTrackerInput) =>
    request<{ entry: TrackerEntry | null }>('POST', `/api/trackers/${id}/log`, input),

  grades: () => request<GradeBookResponse>('GET', '/api/grades'),
  createComponent: (input: ComponentInput) =>
    request<{ component: GradeComponent }>('POST', '/api/grades/components', input),
  updateComponent: (id: string, patch: Partial<Omit<ComponentInput, 'nodeId'>>) =>
    request<{ component: GradeComponent }>('PATCH', `/api/grades/components/${id}`, patch),
  deleteComponent: (id: string) => request<void>('DELETE', `/api/grades/components/${id}`),

  createRoutine: (input: RoutineInput) =>
    request<{ routine: Routine }>('POST', '/api/routines', input),
  updateRoutine: (id: string, patch: Partial<RoutineInput> & { archived?: boolean }) =>
    request<{ routine: Routine }>('PATCH', `/api/routines/${id}`, patch),
  deleteRoutine: (id: string) => request<void>('DELETE', `/api/routines/${id}`),
  tickRoutine: (id: string, date: string) =>
    request<TickResponse>('POST', `/api/routines/${id}/tick`, { date }),
  untickRoutine: (id: string, date: string) =>
    request<{ xpTotal: number; xpRemoved: number }>('DELETE', `/api/routines/${id}/tick/${date}`),
  importRoutineIcs: (ics: string, defaultEstimate?: number) =>
    request<ImportIcsResponse>('POST', '/api/routines/import-ics', { ics, defaultEstimate }),
};

export interface SpotifyStatus {
  /** False when the server has no Spotify credentials: the feature is simply absent. */
  available: boolean;
  connected: boolean;
  revoked?: boolean;
  displayName?: string | null;
  /** True for a Premium account, which is what play/pause/skip need. */
  canControl?: boolean;
}

export interface NowPlayingItem {
  title: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
  durationMs: number;
  url: string | null;
  kind: 'track' | 'episode';
}

export type NowPlaying =
  | { status: 'not-connected'; fetchedAt: string }
  | { status: 'revoked'; fetchedAt: string }
  | {
      status: 'ok';
      isPlaying: boolean;
      progressMs: number | null;
      item: NowPlayingItem | null;
      fetchedAt: string;
    };

export interface RewardInput {
  name: string;
  note?: string | null;
  emoji?: string | null;
  costXp: number;
  cooldownDays?: number;
}

export interface RewardsResponse {
  rewards: RewardView[];
  xp: number;
  limits: {
    minCostXp: number;
    maxCostXp: number;
    maxActive: number;
    maxCooldownDays: number;
  };
  history: Array<{
    at: string;
    rewardId: string | null;
    name: string;
    emoji: string | null;
    costXp: number;
  }>;
}

export interface RoutineInput {
  title: string;
  note?: string | null;
  nodeId?: string | null;
  estimatedMinutes: number;
  freq: Routine['freq'];
  interval?: number;
  byWeekday?: number[];
  byMonthday?: number[];
  startDate: string;
  endDate?: string | null;
}

export interface RoutinesResponse {
  today: string;
  from: string;
  to: string;
  routines: Routine[];
  occurrences: RoutineOccurrence[];
  due: RoutineOccurrence[];
  adherence: { due: number; done: number; rate: number | null };
  xpToday: number;
  xpRemainingToday: number;
  limits: { xpPerMinute: number; maxXpPerTick: number; maxXpPerDay: number };
}

export interface TickResponse {
  completion: { id: string; routineId: string; date: string; minutes: number; xpAwarded: number };
  xpAwarded: number;
  xpTotal: number;
  cappedByDailyLimit: boolean;
  badges: string[];
}

export interface ImportIcsResponse {
  created: number;
  updated: number;
  routines: Routine[];
  skipped: Array<{ summary: string; reason: string }>;
}

export interface TrackerBoard {
  trackers: Tracker[];
  widgets: TrackerWidget[];
}

export interface TrackerInput {
  title: string;
  unitLabel: string;
  dailyGoal?: number | null;
  color?: string | null;
}

export interface LogTrackerInput {
  amount: number;
  date?: string;
  /** 'set' replaces the day's total, 'add' adds to it. */
  mode?: 'set' | 'add';
  note?: string | null;
}

export interface GradeBookResponse {
  courses: Array<{ node: StudyNode; grade: CourseGrade; components: GradeComponent[] }>;
  gpa: Gpa;
}

export interface ComponentInput {
  nodeId: string;
  title: string;
  weight: number;
  score?: number | null;
}
