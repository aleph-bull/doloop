import type {
  NodePace,
  OnboardingAnswers,
  PlanItem,
  PlannedBlock,
  RestDayPolicy,
  Session,
  StudyNode,
  Tag,
  TagColor,
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
  ClockProfile,
  Consistency,
  Cumulative,
  DashboardStats,
  DaySubjects,
  FocusQuality,
  Forecast,
  Highlight,
  LevelProgress,
  Personality,
  PersonalRecord,
  PlanKept,
  RangeRecap,
  ScreenFacts,
  SessionHistogram,
  StudyVsGrades,
  SubjectSlice,
  DrillItem,
  DrillResult,
  PlanPacing,
  PlanWeek,
  StudyPlan,
  TopicProgress,
} from '@komogon/core';

export type RecapRangeParam = 'week' | 'month' | 'all';

/** Everything the Analytics page draws for one range, from one call. */
/**
 * The weekly streak's numbers. Optional because a response saved in the offline cache before
 * weekly streaks existed has none until it refreshes.
 */
export interface WeekStreak {
  current: number;
  longest: number;
}

export interface RecapResponse {
  now: string;
  range: RecapRangeParam;
  /** How many weeks or months back this is; 0 is the current one. */
  ago: number;
  /** The earliest day with a session, or null before the first. */
  firstDate: string | null;
  period: RangeRecap | null;
  subjects: Array<SubjectSlice & { colorIndex: number }>;
  dailySubjects: DaySubjects[] | null;
  clock: ClockProfile;
  weekday: RhythmProfile;
  histogram: SessionHistogram;
  focus: FocusQuality;
  plan: PlanKept | null;
  cumulative: Cumulative;
  heatmap: StudyHeatmapData | null;
  consistency: Consistency;
  streak: { current: number; longest: number; freezesHeld: number; weeks?: WeekStreak };
  records: PersonalRecord[];
  personality: Personality | null;
  forecast: Forecast | null;
  studyVsGrades: StudyVsGrades | null;
  insights: Highlight[];
  level: LevelProgress & { xp: number };
  totals: { minutes: number; sessions: number; rangeMinutes: number; rangeSessions: number };
}

/** The API's record of a background they uploaded; the picture is in the browser. */
export interface CustomBackground {
  id: string;
  hash: string;
  createdAt: string;
}

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

/** A calendar added by its link. The link itself never comes back from the API. */
export interface CalendarFeed {
  id: string;
  name: string;
  host: string;
  /** Exams and deadlines in it become tasks. */
  tasks: boolean;
  events: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface CalendarFeedResponse {
  feed: CalendarFeed;
  result: { status: string; courses: number; tasks: number; events: number } | null;
}

export interface MeResponse {
  user: User;
  onboarded: boolean;
  streakMessage: string | null;
  streakMilestones: number[];
  restDays: { policy: RestDayPolicy; editsRemaining: number };
  purchasedBackgrounds: string[];
  /** The rarest roll on Achievements, as its tier (core rolls.ts); 0 before the first. */
  rollBest?: number;
  icsToken: string;
  /** Set while the API still keeps a background uploaded before they lived in the browser. */
  backgroundUpdatedAt: string | null;
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
  /** Lifetime XP, for the level and its bar. Optional for older APIs. */
  xpEarned?: number;
  levelBefore: number;
  levelAfter: number;
  leveledUp: boolean;
  streak: {
    current: number;
    longest: number;
    message: string | null;
    milestonesReached: number[];
    weeks?: WeekStreak;
  };
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

/** A finished session with what it was for, as the history lists it. */
export type HistorySession = Session & { title: string };

/** After a session stopped counting, or counts again: the figures it changed. */
export interface CountSummary {
  session: Session;
  xpTotal: number;
  /** Lifetime XP, for the level and its bar. Optional for older APIs. */
  xpEarned?: number;
  level: number;
  streak: { current: number; longest: number; weeks: WeekStreak };
  badgesRevoked: string[];
}

export interface TrimSummary {
  session: HistorySession;
  removedFocusSeconds: number;
  removedBreakSeconds: number;
  xpRemoved: number;
  xpTotal: number;
  level: number;
  badgesRevoked: string[];
}

export type DailyPick = { kind: 'quote'; item: Quote } | { kind: 'tip'; item: ResearchTip };

export interface ReviewInput {
  skipped?: boolean;
  prepared?: number | null;
  distracted?: 'no' | 'a-little' | 'a-lot' | null;
  completedCount?: number | null;
  correctCount?: number | null;
  mood?: number | null;
  effort?: number | null;
  extraMinutesAdded?: number | null;
  note?: string | null;
}

/** A pasted list of courses and items, as `POST /api/nodes/import` takes it. */
export interface ImportNodesInput {
  courses: Array<{
    title: string;
    items: Array<{
      title: string;
      kind: 'assessment' | 'task';
      dueAt: string | null;
      estimatedMinutes: number | null;
    }>;
  }>;
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
  /** The template for items added under this node; null clears it. */
  childDefaults?: StudyNode['childDefaults'];
  /** The node's tags, in order; null clears them. */
  tagIds?: string[] | null;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** What anyone signed in can see of an account: see the API's profiles route. */
export interface PublicProfile {
  id: string;
  name: string;
  /** Without the @. */
  username: string | null;
  university: { id: string; name: string; short?: string } | null;
  bio: string | null;
  avatarUrl: string | null;
  joinedAt: string;
  you: boolean;
  friendCount: number;
  /** Where you stand with this person; 'none' on your own profile. */
  friendship: FriendshipStatus;
  /** They take friend requests. */
  acceptsRequests: boolean;
  /** Over 45 minutes of focus with Jack mode on. Optional for older cached copies. */
  gambler?: boolean;
  /** The rarest roll, as its tier: its title shows by the name; 0 for none. */
  rollBest?: number;
  /** The rarity the name is coloured by, or null. */
  nameTier?: number | null;
}

/** Someone as the feed, comments and friend lists name them. */
export interface Person {
  id: string;
  name: string;
  /** Without the @. */
  username: string | null;
  avatarUrl: string | null;
  university: { id: string; name: string; short?: string } | null;
  /** The rarity the name is coloured by (a roll of 1/256 or rarer), or null. */
  nameTier?: number | null;
}

export type FriendshipState = 'none' | 'friends' | 'requested' | 'incoming';
export interface FriendshipStatus {
  status: FriendshipState;
  requestId: string | null;
  /** When you became friends; null otherwise. */
  since: string | null;
}

/** The session on a post, as it was when shared. */
export interface PostSession {
  minutes: number;
  subject: string | null;
  elapsedMinutes: number | null;
  startedAt: string | null;
  endedAt: string | null;
  /** The badges the session unlocked, when the author shares stats; missing from older APIs. */
  badges?: string[];
  /** The daily streak when it ended, when kept and shared. */
  streak?: number | null;
}

/** A post on Social, with its counts as the viewer sees them. */
export interface FeedPost {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
  /** Focus minutes, focus and breaks together (when shown), and when it started and ended. */
  session: PostSession | null;
  /** The first file (all an API from before carousels sends). */
  media: { mime: string; bytes: number; poster: string | null } | null;
  /** Every file in the carousel's order; missing from an API (or a cached feed) before them. */
  files?: PostFile[];
  /** Shown only to the author's friends. */
  friendsOnly?: boolean;
  likes: number;
  liked: boolean;
  comments: number;
  you: boolean;
}

/** One video or picture on a post; `n` is its place, 0 first. */
export interface PostFile {
  n: number;
  mime: string;
  bytes: number;
  poster: string | null;
}

/** A post's files, from `files` or, from an older API, the one `media`. */
export const postFiles = (post: FeedPost): PostFile[] =>
  post.files ?? (post.media ? [{ n: 0, ...post.media }] : []);

export interface FeedComment {
  id: string;
  postId: string;
  userId: string;
  body: string;
  createdAt: string;
  you: boolean;
  /** Who its @usernames name (in `people`); missing from an older API. */
  mentions?: string[];
}

export interface FeedPage {
  posts: FeedPost[];
  people: Record<string, Person>;
  nextBefore: string | null;
}

export type FeedScope = 'everyone' | 'friends';

export interface NewPost {
  body?: string;
  sessionId?: string;
  /** Show the session's minutes and task on the post (the API's default); false leaves them off. */
  showTime?: boolean;
  /** Also show the time elapsed: focus and breaks together. */
  showElapsed?: boolean;
  /** Only friends see it. */
  friendsOnly?: boolean;
  /** Up to one video and three pictures, in order: each a data URL or an R2 key. */
  files?: Array<{ media?: string; upload?: string }>;
  /** One file as a data URL, when the API keeps files itself (no R2; videos under 5 MB). */
  media?: string;
  /** The key of one file already uploaded to R2 (`startUpload`). */
  upload?: string;
  /** A small JPEG data URL shown before the video loads. */
  poster?: string;
}

/** What a post's file may be, which depends on whether the API has R2. */
export interface MediaLimits {
  /** True when the file is uploaded to R2 first; false when it goes with the post. */
  direct: boolean;
  videoMaxBytes: number;
  imageMaxBytes: number;
}

/** Where to PUT a file so it goes straight to R2. */
export interface UploadLink {
  key: string;
  url: string;
  headers: Record<string, string>;
}

export interface FriendsResponse {
  /** `nudgeAgainAt`: while you can't nudge them yet, when you can (missing in older caches). */
  friends: Array<{ userId: string; since: string; nudgeAgainAt?: string | null }>;
  incoming: Array<{ id: string; userId: string; at: string }>;
  outgoing: Array<{ id: string; userId: string; at: string }>;
  people: Record<string, Person>;
}

/** A jam: a game friends enter; focused minutes from joining count, the most at the end wins. */
export interface JamMember {
  userId: string;
  joinedAt: string;
  minutes: number;
  sessions: number;
  /** Running total over the jam's days so far. */
  byDay: number[];
  subjects: Array<{ title: string; minutes: number }>;
}

export interface Jam {
  id: string;
  hostId: string;
  title: string;
  /** Members see the code; others get null. */
  code: string | null;
  startsAt: string;
  endsAt: string;
  ended: boolean;
  you: boolean;
  /** Ranked, most minutes first. */
  members: JamMember[];
  /** The jam's days so far, oldest first. */
  days: string[];
}

export interface JamsResponse {
  active: Jam[];
  open: Jam[];
  ended: Jam[];
  people: Record<string, Person>;
}

export interface CompareRow {
  userId: string;
  thisWeek: number;
  lastWeek: number;
  last28: number;
  activeDays28: number;
  sessionsThisWeek: number;
  longest28: number;
  streak: number;
  /** Minutes per week, oldest first, ending with this week. */
  weekly: number[];
}

export interface CompareResponse {
  you: CompareRow;
  friends: CompareRow[];
  people: Record<string, Person>;
  /** The Monday of each week in `weekly`, oldest first. */
  weekStarts: string[];
}

/** A study group's week: see the API's Group. */
export interface LiveMember {
  userId: string;
  startedAt: string;
  subject: string | null;
  /** Missing from responses cached before 2026-10-21; read it as 'focus'. */
  state?: 'focus' | 'break' | 'paused';
}
export interface LiveResponse {
  /** Friends in a session right now, the one at it longest first. */
  live: LiveMember[];
  people: Record<string, Person>;
}
export interface GroupMemberWeek {
  userId: string;
  minutes: number;
  /** Running total over the group's `days`. */
  byDay: number[];
  subjects: Array<{ title: string; minutes: number }>;
  nudgeable: boolean;
}
export interface Group {
  id: string;
  hostId: string;
  name: string;
  code: string | null;
  you: boolean;
  /** The last seven days ending today, or fewer for a group younger than that. */
  days: string[];
  totalMinutes: number;
  members: GroupMemberWeek[];
  live: LiveMember[];
}
export interface GroupsResponse {
  groups: Group[];
  open: Group[];
  live: LiveMember[];
  people: Record<string, Person>;
}
export interface NudgesResponse {
  nudges: Array<{ id: string; fromId: string; groupName: string | null; at: string }>;
  people: Record<string, Person>;
}

/** One line under the bell on Social; see the API's routes/notifications.ts. */
export interface SocialNotification {
  id: string;
  kind: 'kudos' | 'comment' | 'mention' | 'nudge';
  fromId: string;
  at: string;
  unread: boolean;
  postId: string | null;
  comment: string | null;
  groupName: string | null;
}
export interface NotificationPost {
  id: string;
  /** Whose post it is; missing from an older API. */
  userId?: string;
  body: string;
  subject: string | null;
  minutes: number | null;
  mime: string | null;
  poster: string | null;
}
export interface NotificationsResponse {
  notifications: SocialNotification[];
  posts: Record<string, NotificationPost>;
  people: Record<string, Person>;
  unread: number;
}

export type LeaderboardScope = 'global' | 'friends' | 'school';

/** You beside everyone on the global board; see the API's GlobalStats. */
export interface GlobalStats {
  week: {
    which: 'this' | 'last';
    weekStart: string;
    you: number;
    average: number;
    people: number;
    aheadOf: number;
  } | null;
  days: { you: number; average: number } | null;
  sessionLength: { you: number; average: number } | null;
  streak: { you: number; average: number } | null;
  rank: { position: number; of: number } | null;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** The rarity the name is coloured by, or null. */
  nameTier?: number | null;
  focusMinutes: number;
  you: boolean;
  friend: boolean;
  /** Minutes per week over the last eight, oldest first. */
  weekly: number[];
  thisWeek: number;
  streak: number;
  activeDays28: number;
}

export interface ProfileStats {
  totalMinutes: number;
  totalSessions: number;
  activeDays: number;
  avgMinutesPerActiveDay: number;
  longestSessionMinutes: number;
  bestDay: { date: string; minutes: number } | null;
  last28Minutes: number;
  streak: { current: number; longest: number; weeks?: WeekStreak };
  level: number;
  /** How far into the level, 0 to 1. Optional for older cached copies. */
  levelRatio?: number;
  /** Every XP they have earned, spent or not. Optional for older cached copies. */
  xpEarned?: number;
  /** Break Jack mode's slot machine gave and took; null before the first spin. */
  jack?: { rolls: number; wonSeconds: number; lostSeconds: number } | null;
}

/** Someone's rolls on Achievements (core rolls.ts). */
export interface RollRecord {
  cost: number;
  count: number;
  /** The rarest, as its tier; 0 before the first. */
  best: number;
  /** Rolls per rarity: index i is tier i + 1. */
  counts: number[];
}

/** One pull, of one roll or a batch: what came up, and where that leaves you. */
export interface RollResult {
  /** Every roll, in the order drawn. Optional for an API from before batches. */
  tiers?: number[];
  /** The rarest of them. */
  tier: number;
  newBest: boolean;
  best: number;
  count: number;
  xp: number;
  /** What the rolls paid back, all together. Optional for an API from before payouts. */
  won?: number;
  /** Badges it unlocked. */
  fresh: string[];
}

/** Someone's RNG Rolls on their profile, when they show them. */
export interface ProfileRolls {
  best: number;
  count: number;
  /** Rolls per rarity: index i is tier i + 1. */
  counts: number[];
  /** Their RNG Rolls badges, the biggest first. */
  badges: ProfileBadge[];
}

/** One of the badges a profile shows: the ones that paid the most XP. */
export interface ProfileBadge {
  key: string;
  name: string;
  description: string;
  unlockedAt: string;
}

/** Your own university verification, from GET /api/me/university. */
export interface UniversityStatus {
  university: { id: string; name: string } | null;
  /** The address it was verified with; shown to you only. */
  email: string | null;
  pending: { email: string; university: { id: string; name: string }; expiresAt: string } | null;
}

/** The study numbers are null when the person keeps them to themselves. */
export interface ProfileResponse {
  profile: PublicProfile;
  stats: ProfileStats | null;
  heatmap: StudyHeatmapData | null;
  weekday: RhythmProfile | null;
  /** Their top badges, biggest first, and their hours of the day; null when kept to
   * themselves. Optional for older cached copies. */
  badges?: ProfileBadge[] | null;
  clock?: ClockProfile | null;
  posts: FeedPost[];
  people: Record<string, Person>;
  /** A friend in a session right now, if they share it. Optional for older cached copies. */
  live?: LiveMember | null;
  /** Their RNG Rolls; null before the first or when kept off. Optional for older cached copies. */
  rolls?: ProfileRolls | null;
}

export interface SchoolSummary {
  id: string;
  name: string;
  short?: string;
  country?: string;
  crestUrl?: string;
  crestSource?: string;
  crestCredit?: string;
}
export interface SchoolCommunity {
  school: SchoolSummary | null;
  live: LiveMember[];
  posts: FeedPost[];
  people: Record<string, Person>;
}
export interface SchoolBoard {
  period: 'week' | 'all';
  school: SchoolSummary | null;
  entries: Array<{
    rank: number;
    school: SchoolSummary;
    focusMinutes: number;
    members: number;
    you: boolean;
  }>;
}
export const api = {
  schoolCommunity: () => request<SchoolCommunity>('GET', '/api/schools/community'),
  schoolLeaderboard: (period: 'week' | 'all') =>
    request<SchoolBoard>('GET', `/api/schools/leaderboard?period=${period}`),
  health: () => request<{ ok: boolean }>('GET', '/api/health'),
  me: () => request<MeResponse>('GET', '/api/me'),
  updateMe: (patch: { timezone?: string; onboarded?: boolean }) =>
    request<{ user: User; onboarded: boolean }>('PATCH', '/api/me', patch),
  onboarding: () => request<{ answers: OnboardingAnswers }>('GET', '/api/me/onboarding'),
  saveOnboarding: (patch: OnboardingAnswers) =>
    request<{ answers: OnboardingAnswers }>('PATCH', '/api/me/onboarding', patch),
  updateSettings: (patch: DeepPartial<UserSettings>) =>
    request<{ settings: UserSettings }>('PATCH', '/api/me/settings', patch),
  setUsername: (username: string) =>
    request<{ user: User }>('PUT', '/api/me/username', { username }),
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
  tags: () => request<{ tags: Tag[] }>('GET', '/api/tags'),
  createTag: (input: { name: string; color?: TagColor }) =>
    request<{ tag: Tag }>('POST', '/api/tags', input),
  updateTag: (id: string, patch: { name?: string; color?: TagColor; sortOrder?: number }) =>
    request<{ tag: Tag }>('PATCH', `/api/tags/${id}`, patch),
  deleteTag: (id: string) => request<void>('DELETE', `/api/tags/${id}`),

  importNodes: (input: ImportNodesInput) =>
    request<{ courses: number; items: number; skipped: number }>(
      'POST',
      '/api/nodes/import',
      input,
    ),
  pace: () =>
    request<{
      now: string;
      pace: Record<string, NodePace>;
      plannedMinutes: Record<string, number>;
      plan: PlanItem[];
    }>('GET', '/api/pace'),

  activeSession: () =>
    request<{ now: string; active: ActiveSession | null }>('GET', '/api/sessions/active'),
  /**
   * For a task (nodeId), for one occurrence of a routine (routineId + routineDate), or
   * for nothing in particular: a free session with neither.
   */
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
  endSession: (
    id: string,
    body: { review?: ReviewInput | null; markComplete?: boolean; endAt?: string },
  ) => request<{ summary: EndSummary }>('POST', `/api/sessions/${id}/end`, body),
  trimSession: (id: string, removeFocusMinutes: number) =>
    request<TrimSummary>('POST', `/api/sessions/${id}/trim`, { removeFocusMinutes }),
  countSession: (id: string, counted: boolean) =>
    request<CountSummary>('PUT', `/api/sessions/${id}/counted`, { counted }),
  sessionSleep: (id: string, gap: { from: string; to: string }) =>
    request<{ now: string; active: ActiveSession }>('POST', `/api/sessions/${id}/sleep`, gap),
  keptStudying: (id: string, from: string) =>
    request<{ now: string; active: ActiveSession }>('POST', `/api/sessions/${id}/sleep/kept`, {
      from,
    }),
  sessionHistory: (params: { limit?: number; before?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    if (params.before) q.set('before', params.before);
    const qs = q.toString();
    return request<{ sessions: HistorySession[] }>(
      'GET',
      `/api/sessions/history${qs ? `?${qs}` : ''}`,
    );
  },
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
  followUps: () => request<{ followUps: StudyNode[] }>('GET', '/api/follow-ups'),
  recap: (range: RecapRangeParam, ago = 0) =>
    request<RecapResponse>('GET', `/api/analytics/recap?range=${range}${ago ? `&ago=${ago}` : ''}`),
  dashboardStats: () =>
    request<DashboardStats & { now: string }>('GET', '/api/analytics/dashboard'),
  screens: () =>
    request<{ facts: ScreenFacts[]; source: 'tmdb' | 'fallback' }>(
      'GET',
      '/api/equivalents/screens',
    ),

  shop: () =>
    request<{
      xp: number;
      /** Every XP earned, spent or not: the level comes from it. Optional for older copies. */
      xpEarned?: number;
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
      badges: Array<{
        key: string;
        name: string;
        description: string;
        xp: number;
        jack?: true;
        roll?: true;
      }>;
      achievements: Array<{ key: string; unlockedAt: string }>;
      /** Optional for older cached copies. */
      rolls?: RollRecord;
    }>('GET', '/api/shop'),
  roll: (count = 1) => request<RollResult>('POST', '/api/rolls', { count }),
  buyFreeze: () => request<{ xp: number }>('POST', '/api/shop/freeze'),
  buyBreakDay: () => request<{ xp: number; nextCost: number }>('POST', '/api/shop/break-day'),
  applyBreakDay: (date: string) =>
    request<{ breakDays: string[] }>('POST', '/api/shop/break-day/apply', { date }),
  customBackgrounds: () =>
    request<{ backgrounds: CustomBackground[]; cost: number }>('GET', '/api/me/backgrounds'),
  /** `cost` is the price shown; a different one comes back as a 409 with the real one. */
  addCustomBackground: (body: { id: string; hash: string; cost: number }) =>
    request<{ background: CustomBackground; xp: number; cost: number }>(
      'POST',
      '/api/me/backgrounds',
      body,
    ),
  deleteCustomBackground: (id: string) => request<void>('DELETE', `/api/me/backgrounds/${id}`),
  /** A background the API kept from before: recorded as theirs, with its picture. */
  adoptBackground: (id: string) =>
    request<{ background: CustomBackground; dataUrl: string }>(
      'POST',
      '/api/me/backgrounds/adopt',
      { id },
    ),
  /** The picture is filed in this browser, so the API's copy can go. */
  adoptedBackground: () => request<void>('POST', '/api/me/backgrounds/adopted'),
  avatar: () => request<{ dataUrl: string | null }>('GET', '/api/me/avatar'),
  uploadAvatar: (dataUrl: string) =>
    request<{ ok: boolean; bytes: number }>('PUT', '/api/me/avatar', { dataUrl }),
  deleteAvatar: () => request<void>('DELETE', '/api/me/avatar'),

  universityStatus: () => request<UniversityStatus>('GET', '/api/me/university'),
  sendUniversityCode: (email: string) =>
    request<{ university: { id: string; name: string }; email: string; expiresAt: string }>(
      'POST',
      '/api/me/university/send',
      { email },
    ),
  confirmUniversityCode: (code: string) =>
    request<{ university: { id: string; name: string }; email: string }>(
      'POST',
      '/api/me/university/confirm',
      { code },
    ),
  removeUniversity: () => request<void>('DELETE', '/api/me/university'),

  /** 'me' or a user id. */
  profile: (id: string) => request<ProfileResponse>('GET', `/api/profiles/${id}`),

  /* ---------- Social ---------- */
  feed: (scope: FeedScope, before?: string | null) =>
    request<FeedPage>(
      'GET',
      `/api/social/feed?scope=${scope}${before ? `&before=${encodeURIComponent(before)}` : ''}`,
    ),
  createPost: (input: NewPost) =>
    request<{ post: FeedPost; people: Record<string, Person> }>('POST', '/api/social/posts', input),
  deletePost: (id: string) => request<void>('DELETE', `/api/posts/${id}`),
  /** Changes only the words of your own post. */
  editPost: (id: string, body: string) =>
    request<{ post: FeedPost; people: Record<string, Person> }>('PATCH', `/api/posts/${id}`, {
      body,
    }),
  /** Puts the cut of your own post's video in its place, with a new poster. */
  cutPostVideo: (id: string, input: Pick<NewPost, 'media' | 'upload' | 'poster'>) =>
    request<{ post: FeedPost; people: Record<string, Person> }>(
      'PUT',
      `/api/posts/${id}/video`,
      input,
    ),
  mediaLimits: () => request<MediaLimits>('GET', '/api/social/uploads'),
  startUpload: (mime: string, bytes: number) =>
    request<UploadLink>('POST', '/api/social/uploads', { mime, bytes }),
  /** Your sessions a post can be about. */
  postableSessions: () => request<{ sessionIds: string[] }>('GET', '/api/social/postable'),
  /** A short-lived link to a post's file (`n`, 0 first) in R2, or null when the API keeps the bytes. */
  postMediaUrl: (id: string, n = 0) =>
    request<{ url: string | null; expiresIn: number | null }>(
      'GET',
      `/api/posts/${id}/media/url?n=${n}`,
    ),
  /**
   * A file behind a post, as a blob to play from an object URL (files kept by the API).
   * `bytes`, its size, changes with a trim, so the browser's copy of the old file isn't used.
   */
  postMedia: async (id: string, n = 0, bytes?: number): Promise<Blob> => {
    const res = await fetch(`${BASE}/api/posts/${id}/media?n=${n}${bytes ? `&v=${bytes}` : ''}`, {
      headers: await authHeaders(),
    });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return res.blob();
  },
  like: (id: string) => request<{ likes: number; liked: boolean }>('POST', `/api/posts/${id}/like`),
  unlike: (id: string) =>
    request<{ likes: number; liked: boolean }>('DELETE', `/api/posts/${id}/like`),
  comments: (id: string) =>
    request<{ comments: FeedComment[]; people: Record<string, Person> }>(
      'GET',
      `/api/posts/${id}/comments`,
    ),
  addComment: (id: string, body: string) =>
    request<{ comment: FeedComment; people: Record<string, Person> }>(
      'POST',
      `/api/posts/${id}/comments`,
      { body },
    ),
  deleteComment: (id: string) => request<void>('DELETE', `/api/comments/${id}`),
  friends: () => request<FriendsResponse>('GET', '/api/social/friends'),
  findPeople: (q: string) =>
    request<{
      results: Array<{ userId: string; friendship: FriendshipStatus; acceptsRequests: boolean }>;
      people: Record<string, Person>;
    }>('GET', `/api/social/people?q=${encodeURIComponent(q)}`),
  sendFriendRequest: (userId: string) =>
    request<{ friendship: FriendshipStatus }>('POST', '/api/social/friends/requests', { userId }),
  acceptFriendRequest: (id: string) =>
    request<{ friendship: FriendshipStatus }>('POST', `/api/social/friends/requests/${id}/accept`),
  /** Decline one made to you, or take back one you made. */
  deleteFriendRequest: (id: string) =>
    request<void>('DELETE', `/api/social/friends/requests/${id}`),
  removeFriend: (userId: string) => request<void>('DELETE', `/api/social/friends/${userId}`),
  jams: () => request<JamsResponse>('GET', '/api/social/jams'),
  createJam: (input: { title?: string; days: number }) =>
    request<{ jam: Jam; people: Record<string, Person> }>('POST', '/api/social/jams', input),
  joinJamByCode: (code: string) =>
    request<{ jam: Jam; people: Record<string, Person> }>('POST', '/api/social/jams/join', {
      code,
    }),
  joinJam: (id: string) =>
    request<{ jam: Jam; people: Record<string, Person> }>('POST', `/api/social/jams/${id}/join`),
  leaveJam: (id: string) => request<void>('POST', `/api/social/jams/${id}/leave`),
  endJam: (id: string) =>
    request<{ jam: Jam; people: Record<string, Person> }>('POST', `/api/social/jams/${id}/end`),
  leaderboardStats: () => request<GlobalStats>('GET', '/api/leaderboard/stats'),
  groups: () => request<GroupsResponse>('GET', '/api/social/groups'),
  liveFriends: () => request<LiveResponse>('GET', '/api/social/live'),
  createGroup: (name: string) =>
    request<{ group: Group; people: Record<string, Person> }>('POST', '/api/social/groups', {
      name,
    }),
  joinGroupByCode: (code: string) =>
    request<{ group: Group; people: Record<string, Person> }>('POST', '/api/social/groups/join', {
      code,
    }),
  joinGroup: (id: string) =>
    request<{ group: Group; people: Record<string, Person> }>(
      'POST',
      `/api/social/groups/${id}/join`,
    ),
  leaveGroup: (id: string) => request<void>('POST', `/api/social/groups/${id}/leave`),
  nudge: (userId: string, groupId?: string) =>
    request<{ nudge: { id: string; toId: string; at: string } }>('POST', '/api/social/nudges', {
      userId,
      groupId,
    }),
  nudges: () => request<NudgesResponse>('GET', '/api/social/nudges'),
  nudgesSeen: () => request<void>('POST', '/api/social/nudges/seen'),
  notifications: () => request<NotificationsResponse>('GET', '/api/social/notifications'),
  notificationsSeen: () => request<void>('POST', '/api/social/notifications/seen'),
  /** Browser notifications (lib/push.ts): the key to subscribe with, and this browser on or off. */
  pushKey: () => request<{ key: string }>('GET', '/api/push/key'),
  pushSubscribe: (subscription: PushSubscriptionJSON) =>
    request<void>('PUT', '/api/push/subscription', subscription),
  pushUnsubscribe: (endpoint: string) =>
    request<void>('DELETE', '/api/push/subscription', { endpoint }),
  compare: () => request<CompareResponse>('GET', '/api/social/compare'),
  leaderboard: (scope: LeaderboardScope) =>
    request<{ scope: LeaderboardScope; entries: LeaderboardEntry[] }>(
      'GET',
      `/api/leaderboard?scope=${scope}`,
    ),
  buyBackground: (id: string) =>
    request<{ xp: number; purchasedBackgrounds: string[] }>('POST', '/api/shop/background', { id }),

  emailStatus: () =>
    request<{
      available: boolean;
      mode: string;
      verificationRequired: boolean;
      passwordReset: boolean;
    }>('GET', '/api/auth/email/status'),
  verifySignup: (challengeId: string, code: string) =>
    request<{ token: string; email: string }>('POST', '/api/auth/email/verify-signup', {
      challengeId,
      code,
    }),
  resendEmailCode: (challengeId: string) =>
    request<{ challengeId: string; email: string }>('POST', '/api/auth/email/resend', {
      challengeId,
    }),
  requestPasswordReset: (email: string) =>
    request<{ challengeId: string }>('POST', '/api/auth/password/request-reset', { email }),
  resetPassword: (challengeId: string, code: string, password: string) =>
    request<{ ok: boolean }>('POST', '/api/auth/password/reset', { challengeId, code, password }),
  localOutbox: (email: string) =>
    request<{ messages: Array<{ id: string; subject: string; text: string }> }>(
      'GET',
      `/api/auth/local-outbox?email=${encodeURIComponent(email)}`,
    ),
  requestAccountCode: () =>
    request<{ challengeId: string; email: string }>('POST', '/api/auth/email/request-verification'),
  verifyAccountCode: (challengeId: string, code: string) =>
    request<{ ok: boolean }>('POST', '/api/auth/email/verify-account', { challengeId, code }),
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
    request<{
      status: string;
      pushed: number;
      pulled: number;
      imported: number;
      academic?: { courses: number; tasks: number; events: number } | null;
    }>('POST', '/api/calendar/google/sync'),
  googleDisconnect: () => request<void>('DELETE', '/api/calendar/google'),
  outlookStatus: () =>
    request<{
      available: boolean;
      connected: boolean;
      revoked: boolean;
      lastSyncAt: string | null;
    }>('GET', '/api/calendar/outlook/status'),
  outlookConnect: () => request<{ url: string }>('POST', '/api/calendar/outlook/connect'),
  outlookSync: () =>
    request<{ status: string; courses: number; tasks: number; events: number }>(
      'POST',
      '/api/calendar/outlook/sync',
    ),
  outlookDisconnect: () => request<void>('DELETE', '/api/calendar/outlook'),
  calendarFeeds: () => request<{ feeds: CalendarFeed[] }>('GET', '/api/calendar/feeds'),
  addCalendarFeed: (body: { url: string; name?: string; tasks?: boolean }) =>
    request<CalendarFeedResponse>('POST', '/api/calendar/feeds', body),
  updateCalendarFeed: (id: string, body: { name?: string; tasks?: boolean }) =>
    request<CalendarFeedResponse>('PATCH', `/api/calendar/feeds/${id}`, body),
  syncCalendarFeed: (id: string) =>
    request<CalendarFeedResponse>('POST', `/api/calendar/feeds/${id}/sync`),
  removeCalendarFeed: (id: string) => request<void>('DELETE', `/api/calendar/feeds/${id}`),
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

  plans: () => request<{ plans: PlanSummary[] }>('GET', '/api/plans'),
  plan: (id: string) => request<PlanView>('GET', `/api/plans/${id}`),
  createPlan: (input: PlanInput) => request<PlanView>('POST', '/api/plans', input),
  updatePlan: (id: string, patch: PlanPatch) =>
    request<PlanView>('PATCH', `/api/plans/${id}`, patch),
  deletePlan: (id: string) => request<void>('DELETE', `/api/plans/${id}`),
  addTopic: (planId: string, input: TopicInput) =>
    request<PlanView>('POST', `/api/plans/${planId}/topics`, input),
  updateTopic: (id: string, patch: TopicPatch) =>
    request<PlanView>('PATCH', `/api/plan-topics/${id}`, patch),
  deleteTopic: (id: string) => request<PlanView>('DELETE', `/api/plan-topics/${id}`),
  logDrill: (topicId: string, input: DrillInput) =>
    request<DrillOutcome>('POST', `/api/plan-topics/${topicId}/drills`, input),
  answerItem: (id: string, result: DrillResult) =>
    request<DrillOutcome>('POST', `/api/drill-items/${id}/answer`, { result }),
  deleteItem: (id: string) => request<PlanView>('DELETE', `/api/drill-items/${id}`),
};

export interface RewardInput {
  name: string;
  note?: string | null;
  emoji?: string | null;
  costXp: number;
  cooldownDays?: number;
  unlock?: 'xp' | 'task';
  unlockNodeId?: string | null;
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

/* ---------- study plans ---------- */

export interface PlanView {
  today: string;
  plan: StudyPlan;
  color: string | null;
  topics: TopicProgress[];
  pacing: PlanPacing;
  rebalance: { raiseWeeklyTo: number | null; moveTargetTo: string | null };
  weeks: PlanWeek[];
  streak: number;
  queue: Array<DrillItem & { topicTitle: string }>;
  laterCount: number;
  milestones: Array<{ topicId: string; title: string; at: string }>;
  maintenance: Routine | null;
  totals: {
    minutes: number;
    rounds: number;
    answers: number;
    accuracy: number | null;
    cleared: number;
    days: number;
  };
}

export interface PlanSummary {
  plan: StudyPlan;
  color: string | null;
  pacing: PlanPacing;
  upNext: { id: string; title: string } | null;
  dueItems: number;
  streak: number;
}

export interface TopicInput {
  title: string;
  plannedMinutes: number;
  resource?: string | null;
  practice?: boolean;
}

export interface TopicPatch extends Partial<TopicInput> {
  sortOrder?: number;
  done?: boolean;
}

export interface PlanInput {
  title: string;
  weeklyMinutes: number;
  targetDate?: string | null;
  method?: string | null;
  topics: TopicInput[];
  maintenance?: { title: string; minutes: number } | null;
}

export interface PlanPatch {
  title?: string;
  weeklyMinutes?: number;
  targetDate?: string | null;
  method?: string | null;
  masteryTarget?: number;
}

export interface DrillInput {
  ok: number;
  shaky: number;
  miss: number;
  misses?: string[];
  shakies?: string[];
  sessionId?: string | null;
}

export interface DrillOutcome {
  view: PlanView;
  /** Set when this answer is what made the topic mastered. */
  mastered: { id: string; title: string } | null;
}
