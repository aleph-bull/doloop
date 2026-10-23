import type { PlannedBlock, StudyNode, TagColor, UserSettings } from '@komogon/core';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  api,
  type FeedComment,
  type FeedPage,
  type FeedPost,
  type FeedScope,
  type ImportNodesInput,
  type LeaderboardScope,
  type LogTrackerInput,
  type DrillInput,
  type NewPost,
  type NodeInput,
  type NotificationsResponse,
  type Person,
  type PlanInput,
  type PlanPatch,
  type PlanView,
  type TopicInput,
  type TopicPatch,
  type RecapRangeParam,
  type TrackerBoard,
} from './api';
import { recordUndo } from './undo';

export const keys = {
  me: ['me'] as const,
  nodes: ['nodes'] as const,
  tags: ['tags'] as const,
  archivedNodes: ['nodes', 'archived'] as const,
  pace: ['pace'] as const,
  active: ['sessions', 'active'] as const,
  sessions: (nodeId?: string) => ['sessions', 'list', nodeId ?? 'all'] as const,
  quote: ['quote'] as const,
  restDays: ['rest-days'] as const,
  blocks: (from?: string, to?: string) => ['blocks', from ?? '', to ?? ''] as const,
  weekHighlights: (w?: string) => ['analytics', 'week', w ?? 'current'] as const,
  advanced: (w?: string) => ['analytics', 'advanced', w ?? 'current'] as const,
  overview: (weeks?: number) => ['analytics', 'overview', weeks ?? 'default'] as const,
  followUps: ['follow-ups'] as const,
  busy: (from: string, to: string) => ['calendar', 'busy', from, to] as const,
  commitments: ['calendar', 'commitments'] as const,
  google: ['calendar', 'google'] as const,
  feeds: ['calendar', 'feeds'] as const,
  shop: ['shop'] as const,
  background: ['me', 'background'] as const,
  rewards: ['rewards'] as const,
  routines: (from?: string, to?: string) => ['routines', from ?? '', to ?? ''] as const,
  routineList: ['routines', 'list'] as const,
  trackers: (weeks?: number) => ['trackers', weeks ?? 'default'] as const,
  grades: ['grades'] as const,
  recap: (range: string, ago = 0) => ['analytics', 'recap', range, ago] as const,
  dashboardStats: ['analytics', 'dashboard'] as const,
  screens: ['equivalents', 'screens'] as const,
  history: ['sessions', 'history'] as const,
  plans: ['plans'] as const,
  plan: (id: string) => ['plans', id] as const,
  profile: (id: string) => ['profiles', id] as const,
  feed: (scope: FeedScope) => ['social', 'feed', scope] as const,
  comments: (postId: string) => ['social', 'comments', postId] as const,
  friends: ['social', 'friends'] as const,
  people: (q: string) => ['social', 'people', q] as const,
  jams: ['social', 'jams', 2] as const,
  compare: ['social', 'compare'] as const,
  groups: ['social', 'groups', 2] as const,
  live: ['social', 'live'] as const,
  nudges: ['social', 'nudges'] as const,
  notifications: ['social', 'notifications'] as const,
  // Versioned: the persisted cache held older shapes of these without the per-row lines.
  leaderboard: (scope: LeaderboardScope) => ['leaderboard', 2, scope] as const,
  university: ['me', 'university'] as const,
  // Not under ['me']: a settings change should not refetch the picture.
  avatar: ['avatar', 'me'] as const,
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: 30_000 });
}

export function useNodes() {
  return useQuery({ queryKey: keys.nodes, queryFn: () => api.nodes(false), staleTime: 15_000 });
}

export function useTags() {
  return useQuery({ queryKey: keys.tags, queryFn: api.tags, staleTime: 60_000 });
}

export function usePace() {
  return useQuery({ queryKey: keys.pace, queryFn: api.pace, staleTime: 15_000 });
}

export function useActiveSession() {
  const qc = useQueryClient();
  // While a session runs, keep checking in from a background tab too: friends see a
  // session as live only while it reports in, and many people study with the tab hidden.
  const running = !!qc.getQueryData<{ active: unknown }>(keys.active)?.active;
  return useQuery({
    queryKey: keys.active,
    queryFn: api.activeSession,
    refetchInterval: 20_000,
    refetchIntervalInBackground: running,
    staleTime: 5_000,
  });
}

/**
 * A quote is up for six hours: fresh until the server's `nextAt`, then fetched again on the
 * dot. `staleTime` counts from the fetch and the interval from now. A floor of a minute
 * keeps a clock that disagrees with the server's from looping.
 */
const quoteMsFrom = (from: number, data?: { nextAt?: string }) =>
  data?.nextAt ? Math.max(60_000, Date.parse(data.nextAt) - from + 1_000) : 60 * 60_000;

export function useQuote() {
  return useQuery({
    queryKey: keys.quote,
    queryFn: api.quote,
    staleTime: (q) => quoteMsFrom(q.state.dataUpdatedAt, q.state.data),
    refetchInterval: (q) => quoteMsFrom(Date.now(), q.state.data),
  });
}

export function useSessions(nodeId?: string, limit = 200) {
  return useQuery({
    queryKey: keys.sessions(nodeId),
    queryFn: () => api.sessions({ nodeId, limit }),
    staleTime: 15_000,
  });
}

export function useWeekHighlights(weekStart?: string) {
  return useQuery({
    queryKey: keys.weekHighlights(weekStart),
    queryFn: () => api.weekHighlights(weekStart),
    staleTime: 60_000,
  });
}

export function useAdvancedAnalytics(weekStart?: string) {
  return useQuery({
    queryKey: keys.advanced(weekStart),
    queryFn: () => api.advancedAnalytics(weekStart),
    staleTime: 60_000,
  });
}

export function useOverviewAnalytics(weeks?: number) {
  return useQuery({
    queryKey: keys.overview(weeks),
    queryFn: () => api.overviewAnalytics(weeks),
    staleTime: 60_000,
  });
}

export function useFollowUps() {
  return useQuery({ queryKey: keys.followUps, queryFn: api.followUps, staleTime: 5 * 60_000 });
}

export function useBlocks(from?: string, to?: string) {
  return useQuery({
    queryKey: keys.blocks(from, to),
    queryFn: () => api.plannedBlocks(from, to),
    staleTime: 15_000,
    // Moving to another week keeps this one drawn until the next arrives.
    placeholderData: keepPreviousData,
  });
}

export function useBusy(from: string, to: string) {
  return useQuery({
    queryKey: keys.busy(from, to),
    queryFn: () => api.busy(from, to),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useCommitments() {
  return useQuery({ queryKey: keys.commitments, queryFn: api.commitments, staleTime: 60_000 });
}

export function useGoogleStatus() {
  return useQuery({ queryKey: keys.google, queryFn: api.googleStatus, staleTime: 30_000 });
}

export function useCalendarFeeds() {
  return useQuery({ queryKey: keys.feeds, queryFn: api.calendarFeeds, staleTime: 30_000 });
}

/* ---------- planned blocks (undoable) ---------- */

const BLOCK_KEYS = [['blocks'], keys.pace, keys.commitments] as const;

/** A block from whichever range query has it cached, for the inverse of an edit. */
function cachedBlock(qc: ReturnType<typeof useQueryClient>, id: string): PlannedBlock | undefined {
  for (const [, data] of qc.getQueriesData<{ blocks: PlannedBlock[] }>({ queryKey: ['blocks'] })) {
    const hit = data?.blocks.find((b) => b.id === id);
    if (hit) return hit;
  }
  return undefined;
}

export function useCreateBlock() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: api.createBlock,
    onSuccess: (res, input) => {
      invalidate(...BLOCK_KEYS);
      // Redoing makes a new block with a new id; the entry follows it.
      let id = res.block.id;
      recordUndo({
        label: 'Planned a block',
        undo: () => api.deleteBlock(id).then(() => invalidate(...BLOCK_KEYS)),
        redo: () =>
          api.createBlock(input).then((r) => {
            id = r.block.id;
            invalidate(...BLOCK_KEYS);
          }),
      });
    },
  });
}

export function useUpdateBlock() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateBlock>[1] }) => {
      const before = cachedBlock(qc, id);
      return api.updateBlock(id, patch).then((res) => ({ res, before }));
    },
    onSuccess: ({ before }, { id, patch }) => {
      invalidate(...BLOCK_KEYS);
      if (!before) return;
      const inverse: Parameters<typeof api.updateBlock>[1] = {};
      if (patch.nodeId !== undefined) inverse.nodeId = before.nodeId;
      if (patch.startAt !== undefined) inverse.startAt = before.startAt;
      if (patch.endAt !== undefined) inverse.endAt = before.endAt;
      if (patch.cancelled !== undefined) inverse.cancelled = before.cancelled;
      recordUndo({
        label: 'Edited a block',
        undo: () => api.updateBlock(id, inverse).then(() => invalidate(...BLOCK_KEYS)),
        redo: () => api.updateBlock(id, patch).then(() => invalidate(...BLOCK_KEYS)),
      });
    },
  });
}

export function useDeleteBlock() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      const before = cachedBlock(qc, id);
      return api.deleteBlock(id).then(() => before);
    },
    onSuccess: (before) => {
      invalidate(...BLOCK_KEYS);
      // Only a block planned here can be put back as it was; an imported one is Google's.
      if (!before || before.source !== 'app') return;
      let id: string | null = null;
      recordUndo({
        label: 'Removed a block',
        undo: () =>
          api
            .createBlock({ nodeId: before.nodeId, startAt: before.startAt, endAt: before.endAt })
            .then((r) => {
              id = r.block.id;
              invalidate(...BLOCK_KEYS);
            }),
        redo: () =>
          id ? api.deleteBlock(id).then(() => invalidate(...BLOCK_KEYS)) : Promise.resolve(),
      });
    },
  });
}

export function useCustomBackground(enabled: boolean) {
  return useQuery({
    queryKey: keys.background,
    queryFn: api.getBackground,
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}

export function useShop() {
  return useQuery({ queryKey: keys.shop, queryFn: api.shop, staleTime: 30_000 });
}

export function useRestDays() {
  return useQuery({ queryKey: keys.restDays, queryFn: api.restDays, staleTime: 30_000 });
}

/* ---------- custom rewards ---------- */

export function useRewards() {
  return useQuery({ queryKey: keys.rewards, queryFn: () => api.rewards(), staleTime: 15_000 });
}

function useRewardMutation<T, R>(fn: (input: T) => Promise<R>) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => invalidate(keys.rewards, keys.me, keys.shop),
  });
}

export function useCreateReward() {
  return useRewardMutation(api.createReward);
}

export function useUpdateReward() {
  return useRewardMutation(
    ({ id, patch }: { id: string; patch: Parameters<typeof api.updateReward>[1] }) =>
      api.updateReward(id, patch),
  );
}

export function useDeleteReward() {
  return useRewardMutation((id: string) => api.deleteReward(id));
}

export function useRedeemReward() {
  return useRewardMutation((id: string) => api.redeemReward(id));
}

/* ---------- recurring tasks ---------- */

export function useRoutines(from?: string, to?: string) {
  return useQuery({
    queryKey: keys.routines(from, to),
    queryFn: () => api.routines(from, to),
    staleTime: 15_000,
  });
}

function useRoutineMutation<T, R>(fn: (input: T) => Promise<R>) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => invalidate(['routines'], keys.me, keys.shop),
  });
}

export function useCreateRoutine() {
  return useRoutineMutation(api.createRoutine);
}

export function useUpdateRoutine() {
  return useRoutineMutation(
    ({ id, patch }: { id: string; patch: Parameters<typeof api.updateRoutine>[1] }) =>
      api.updateRoutine(id, patch),
  );
}

export function useDeleteRoutine() {
  return useRoutineMutation((id: string) => api.deleteRoutine(id));
}

const ROUTINE_KEYS = [['routines'], keys.me, keys.shop] as const;

export function useTickRoutine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) => api.tickRoutine(id, date),
    onSuccess: (_res, { id, date }) => {
      invalidate(...ROUTINE_KEYS);
      recordUndo({
        label: 'Ticked off a routine',
        undo: () => api.untickRoutine(id, date).then(() => invalidate(...ROUTINE_KEYS)),
        redo: () => api.tickRoutine(id, date).then(() => invalidate(...ROUTINE_KEYS)),
      });
    },
  });
}

export function useUntickRoutine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) => api.untickRoutine(id, date),
    onSuccess: (_res, { id, date }) => {
      invalidate(...ROUTINE_KEYS);
      recordUndo({
        label: 'Unticked a routine',
        undo: () => api.tickRoutine(id, date).then(() => invalidate(...ROUTINE_KEYS)),
        redo: () => api.untickRoutine(id, date).then(() => invalidate(...ROUTINE_KEYS)),
      });
    },
  });
}

/**
 * "Clear missed": outstanding days before today drop off the due list. One settings value
 * holds it, so the undo puts the previous one back.
 */
export function useClearMissedRoutines() {
  const invalidate = useInvalidate();
  const save = (through: string | null) =>
    api
      .updateSettings({ routines: { missedClearedThrough: through } })
      .then(() => invalidate(...ROUTINE_KEYS));
  return useMutation({
    mutationFn: ({ through }: { through: string; previous: string | null; count: number }) =>
      save(through),
    onSuccess: (_res, { through, previous, count }) => {
      recordUndo({
        label: `Cleared ${count} missed routine${count === 1 ? '' : 's'}`,
        undo: () => save(previous),
        redo: () => save(through),
      });
    },
  });
}

export function useImportRoutineIcs() {
  return useRoutineMutation(({ ics, defaultEstimate }: { ics: string; defaultEstimate?: number }) =>
    api.importRoutineIcs(ics, defaultEstimate),
  );
}

function useInvalidate() {
  const qc = useQueryClient();
  return (...groups: Array<readonly unknown[]>) => {
    for (const g of groups) void qc.invalidateQueries({ queryKey: g });
  };
}

/** A profile: 'me' for your own, or a user id. */
export function useProfile(id: string) {
  return useQuery({
    queryKey: keys.profile(id),
    queryFn: () => api.profile(id),
    staleTime: 30_000,
  });
}

/** Your own picture as a data URL, or null. Changes only when the picture is changed. */
export function useAvatar() {
  return useQuery({ queryKey: keys.avatar, queryFn: api.avatar, staleTime: 10 * 60_000 });
}

export function useUniversityStatus(enabled = true) {
  return useQuery({
    queryKey: keys.university,
    queryFn: api.universityStatus,
    staleTime: 30_000,
    enabled,
  });
}

/* ---------- Social ---------- */

/** Everything that lists posts: the feed and the profiles. */
const POST_KEYS = [['social', 'feed'], ['profiles']] as const;

export function useFeed(scope: FeedScope) {
  return useInfiniteQuery({
    queryKey: keys.feed(scope),
    queryFn: ({ pageParam }) => api.feed(scope, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: FeedPage) => last.nextBefore,
    staleTime: 30_000,
  });
}

/** How big a post's file may be here; it only changes when the API's setup does. */
export function useMediaLimits() {
  return useQuery({
    queryKey: ['social', 'media-limits'],
    queryFn: () => api.mediaLimits(),
    staleTime: 60 * 60_000,
  });
}

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewPost) => api.createPost(input),
    onSuccess: () => {
      for (const key of POST_KEYS) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePost(id),
    onSuccess: () => {
      for (const key of POST_KEYS) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

/** Writes new counts into every cached list that holds the post, instead of refetching. */
function patchPost(
  qc: ReturnType<typeof useQueryClient>,
  id: string,
  patch: (p: FeedPost) => FeedPost,
) {
  const apply = (posts: FeedPost[]) => posts.map((p) => (p.id === id ? patch(p) : p));
  qc.setQueriesData<{ pages: FeedPage[]; pageParams: unknown[] }>(
    { queryKey: ['social', 'feed'] },
    (data) =>
      data && { ...data, pages: data.pages.map((pg) => ({ ...pg, posts: apply(pg.posts) })) },
  );
  qc.setQueriesData<{ posts: FeedPost[] }>(
    { queryKey: ['profiles'] },
    (data) => data && { ...data, posts: apply(data.posts) },
  );
}

export function useLikePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, liked }: { id: string; liked: boolean }) =>
      liked ? api.unlike(id) : api.like(id),
    onMutate: ({ id, liked }) =>
      patchPost(qc, id, (p) => ({ ...p, liked: !liked, likes: p.likes + (liked ? -1 : 1) })),
    onSuccess: (counts, { id }) => patchPost(qc, id, (p) => ({ ...p, ...counts })),
    onError: (_err, { id, liked }) =>
      patchPost(qc, id, (p) => ({ ...p, liked, likes: p.likes + (liked ? 1 : -1) })),
  });
}

export function useComments(postId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.comments(postId),
    queryFn: () => api.comments(postId),
    staleTime: 30_000,
    enabled,
  });
}

type CommentsData = { comments: FeedComment[]; people: Record<string, Person> };

export function useAddComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.addComment(postId, body),
    onSuccess: ({ comment, people }) => {
      qc.setQueryData<CommentsData>(
        keys.comments(postId),
        (data) =>
          data && { comments: [...data.comments, comment], people: { ...data.people, ...people } },
      );
      patchPost(qc, postId, (p) => ({ ...p, comments: p.comments + 1 }));
    },
  });
}

export function useDeleteComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteComment(id),
    onSuccess: (_void, id) => {
      qc.setQueryData<CommentsData>(
        keys.comments(postId),
        (data) => data && { ...data, comments: data.comments.filter((c) => c.id !== id) },
      );
      patchPost(qc, postId, (p) => ({ ...p, comments: Math.max(0, p.comments - 1) }));
    },
  });
}

export function useFriends() {
  return useQuery({ queryKey: keys.friends, queryFn: api.friends, staleTime: 30_000 });
}

export function useFindPeople(q: string) {
  return useQuery({
    queryKey: keys.people(q),
    queryFn: () => api.findPeople(q),
    enabled: q.trim().length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/** Every list that says where you stand with someone. */
const FRIEND_KEYS = [
  keys.friends,
  ['profiles'],
  ['social', 'people'],
  keys.jams,
  ['leaderboard'],
  ['social', 'feed'],
] as const;

function useFriendMutation<A>(fn: (arg: A) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of FRIEND_KEYS) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useSendFriendRequest() {
  return useFriendMutation((userId: string) => api.sendFriendRequest(userId));
}

export function useAcceptFriendRequest() {
  return useFriendMutation((id: string) => api.acceptFriendRequest(id));
}

export function useDeleteFriendRequest() {
  return useFriendMutation((id: string) => api.deleteFriendRequest(id));
}

export function useRemoveFriend() {
  return useFriendMutation((userId: string) => api.removeFriend(userId));
}

export function useJams() {
  return useQuery({ queryKey: keys.jams, queryFn: api.jams, staleTime: 30_000 });
}

function useJamMutation<A>(fn: (arg: A) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.jams }),
  });
}

export function useCreateJam() {
  return useJamMutation((input: { title?: string; days: number }) => api.createJam(input));
}
export function useJoinJamByCode() {
  return useJamMutation((code: string) => api.joinJamByCode(code));
}
export function useJoinJam() {
  return useJamMutation((id: string) => api.joinJam(id));
}
export function useLeaveJam() {
  return useJamMutation((id: string) => api.leaveJam(id));
}
export function useEndJam() {
  return useJamMutation((id: string) => api.endJam(id));
}

/** Friends in a session right now. Polled, since sessions start and stop all the time. */
export function useLiveFriends() {
  return useQuery({
    queryKey: keys.live,
    queryFn: api.liveFriends,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useGroups() {
  // Live timers and nudges go stale fast: refetch while the tab is open.
  return useQuery({
    queryKey: keys.groups,
    queryFn: api.groups,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

function useGroupMutation<A>(fn: (arg: A) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.groups }),
  });
}
export function useCreateGroup() {
  return useGroupMutation((name: string) => api.createGroup(name));
}
export function useJoinGroupByCode() {
  return useGroupMutation((code: string) => api.joinGroupByCode(code));
}
export function useJoinGroup() {
  return useGroupMutation((id: string) => api.joinGroup(id));
}
export function useLeaveGroup() {
  return useGroupMutation((id: string) => api.leaveGroup(id));
}
export function useNudge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, groupId }: { userId: string; groupId?: string }) =>
      api.nudge(userId, groupId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.groups });
      // The friends card swaps the bell for a crossed-out one until they can be nudged
      // again; stay pending until that has loaded so the bell doesn't flash back first.
      return qc.invalidateQueries({ queryKey: keys.friends });
    },
  });
}
export function useNudges() {
  return useQuery({
    queryKey: keys.nudges,
    queryFn: api.nudges,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
export function useNudgesSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.nudgesSeen(),
    onSuccess: () => qc.setQueryData(keys.nudges, { nudges: [], people: {} }),
  });
}

/** The bell on Social: kudos, comments and nudges, refreshed while the tab is open. */
export function useNotifications() {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: api.notifications,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
/** The bell was opened: the count goes at once, the dots stay until the list next loads. */
export function useNotificationsSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.notificationsSeen(),
    onSuccess: () =>
      qc.setQueryData<NotificationsResponse>(keys.notifications, (old) =>
        old ? { ...old, unread: 0 } : old,
      ),
  });
}

export function useCompare() {
  return useQuery({ queryKey: keys.compare, queryFn: api.compare, staleTime: 60_000 });
}

export function useLeaderboardStats() {
  return useQuery({
    queryKey: ['leaderboard', 'stats'],
    queryFn: api.leaderboardStats,
    staleTime: 60_000,
  });
}

export function useLeaderboard(scope: LeaderboardScope) {
  return useQuery({
    queryKey: keys.leaderboard(scope),
    queryFn: () => api.leaderboard(scope),
    staleTime: 60_000,
  });
}

export function useUpdateSettings() {
  const invalidate = useInvalidate();
  type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
  return useMutation({
    mutationFn: (patch: DeepPartial<UserSettings>) => api.updateSettings(patch),
    onSuccess: () =>
      invalidate(
        keys.me,
        keys.quote,
        keys.pace,
        keys.rewards,
        ['analytics'],
        ['profiles'],
        ['social'],
        ['leaderboard'],
      ),
  });
}

/* ---------- tasks (undoable) ---------- */

const NODE_KEYS = [keys.nodes, keys.pace, keys.active, keys.grades] as const;

/** The node as the cache last saw it, for the inverse of an edit. */
function cachedNode(qc: ReturnType<typeof useQueryClient>, id: string): StudyNode | undefined {
  for (const key of [keys.nodes, keys.archivedNodes]) {
    const hit = qc.getQueryData<{ nodes: StudyNode[] }>(key)?.nodes.find((n) => n.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** What an edit is called in the undo toast, from what it changed. */
function describeNodeEdit(title: string, patch: NodeInput): string {
  const changed = Object.keys(patch);
  if (changed.length === 1 && patch.completedAt !== undefined)
    return patch.completedAt ? `Marked ${title} done` : `Marked ${title} not done`;
  if (changed.length === 1 && patch.archived !== undefined)
    return patch.archived ? `Archived ${title}` : `Restored ${title}`;
  if (changed.length === 1 && patch.childDefaults !== undefined)
    return `Changed the template on ${title}`;
  if (changed.length === 1 && patch.sortOrder !== undefined) return `Moved ${title}`;
  if (changed.length === 1 && patch.tagIds !== undefined) return `Changed the tags on ${title}`;
  return `Edited ${title}`;
}

export function useCreateNode() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: NodeInput & { title: string }) => api.createNode(input),
    onSuccess: (res) => {
      invalidate(...NODE_KEYS);
      // Taking an addition back archives it: nothing is ever hard-deleted by a keystroke.
      const id = res.node.id;
      recordUndo({
        label: `Added ${res.node.title}`,
        undo: () => api.archiveNode(id).then(() => invalidate(...NODE_KEYS)),
        redo: () => api.updateNode(id, { archived: false }).then(() => invalidate(...NODE_KEYS)),
      });
    },
  });
}

/** A pasted list added in one go. Not on the undo stack: an import is fixed in Tasks. */
export function useImportNodes() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: ImportNodesInput) => api.importNodes(input),
    onSuccess: () => invalidate(...NODE_KEYS),
  });
}

export function useUpdateNode() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: NodeInput }) => {
      const before = cachedNode(qc, id);
      return api.updateNode(id, patch).then((res) => ({ res, before }));
    },
    onSuccess: ({ res, before }, { id, patch }) => {
      invalidate(...NODE_KEYS);
      if (!before) return;
      // The inverse carries the old value of every field the patch touched, and only those.
      const inverse: NodeInput = {};
      for (const key of Object.keys(patch) as Array<keyof NodeInput>) {
        if (patch[key] === undefined) continue;
        (inverse as Record<string, unknown>)[key] = before[key as keyof StudyNode] ?? null;
      }
      if (patch.sortOrder !== undefined) inverse.sortOrder = before.sortOrder;
      recordUndo({
        label: describeNodeEdit(res.node.title, patch),
        undo: () => api.updateNode(id, inverse).then(() => invalidate(...NODE_KEYS)),
        redo: () => api.updateNode(id, patch).then(() => invalidate(...NODE_KEYS)),
      });
    },
  });
}

/**
 * Set a node's tags, shown at once: the cache changes before the server answers, so the
 * picker and the table keep up with quick clicks. A failure puts the old tags back.
 */
export function useSetNodeTags() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  const write = (id: string, tagIds: string[]) =>
    qc.setQueryData<{ nodes: StudyNode[] }>(keys.nodes, (d) =>
      d ? { ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, tagIds } : n)) } : d,
    );
  return useMutation({
    mutationFn: async ({ id, tagIds }: { id: string; tagIds: string[] }) => {
      const before = cachedNode(qc, id);
      write(id, tagIds);
      try {
        const res = await api.updateNode(id, { tagIds });
        return { res, before };
      } catch (err) {
        if (before) write(id, before.tagIds ?? []);
        throw err;
      }
    },
    onSuccess: ({ res, before }, { id, tagIds }) => {
      invalidate(keys.nodes);
      if (!before) return;
      const old = before.tagIds ?? [];
      recordUndo({
        label: `Changed the tags on ${res.node.title}`,
        undo: () => api.updateNode(id, { tagIds: old }).then(() => invalidate(keys.nodes)),
        redo: () => api.updateNode(id, { tagIds }).then(() => invalidate(keys.nodes)),
      });
    },
  });
}

export function useCreateTag() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { name: string; color?: TagColor }) => api.createTag(input),
    onSuccess: () => invalidate(keys.tags),
  });
}

export function useUpdateTag() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; color?: TagColor } }) =>
      api.updateTag(id, patch),
    onSuccess: () => invalidate(keys.tags),
  });
}

/** Deleting a tag takes it off every task, so the tasks are fetched again too. */
export function useDeleteTag() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onSuccess: () => invalidate(keys.tags, keys.nodes),
  });
}

export function useArchiveNode() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.archiveNode(id),
    onSuccess: (res, id) => {
      invalidate(...NODE_KEYS);
      const title = cachedNode(qc, id)?.title ?? 'a task';
      const ids = res.archivedIds;
      recordUndo({
        label: `Archived ${title}`,
        undo: () =>
          Promise.all(ids.map((n) => api.updateNode(n, { archived: false }))).then(() =>
            invalidate(...NODE_KEYS),
          ),
        redo: () => api.archiveNode(id).then(() => invalidate(...NODE_KEYS)),
      });
    },
  });
}

export function useStartSession() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: api.startSession,
    onSuccess: () => invalidate(keys.active),
  });
}

export function useSetWeeklyRestDays() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (days: number[]) => api.setWeeklyRestDays(days),
    onSuccess: () => invalidate(keys.restDays, keys.me, keys.pace),
  });
}

export function useAddVacation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: api.addVacation,
    onSuccess: () => invalidate(keys.restDays, keys.me, keys.pace),
  });
}

export function useRemoveVacation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (from: string) => api.removeVacation(from),
    onSuccess: () => invalidate(keys.restDays, keys.me, keys.pace),
  });
}

export function useTrackers(weeks?: number) {
  return useQuery({
    queryKey: keys.trackers(weeks),
    queryFn: () => api.trackers(weeks),
  });
}

export function useCreateTracker() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: api.createTracker,
    onSuccess: () => invalidate(['trackers']),
  });
}

export function useUpdateTracker() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateTracker>[1] }) =>
      api.updateTracker(id, patch),
    onSuccess: () => invalidate(['trackers']),
  });
}

export function useDeleteTracker() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.deleteTracker(id),
    onSuccess: () => invalidate(['trackers']),
  });
}

export function useLogTracker() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: LogTrackerInput }) => {
      // Today's total as the board last showed it, which is what an undo puts back.
      let before: number | undefined;
      if (!input.date) {
        for (const [, data] of qc.getQueriesData<TrackerBoard>({ queryKey: ['trackers'] })) {
          const w = data?.widgets.find((x) => x.tracker.id === id);
          if (w) before = w.todayAmount;
        }
      }
      return api.logTracker(id, input).then((res) => ({ res, before }));
    },
    onSuccess: ({ before }, { id, input }) => {
      invalidate(['trackers']);
      if (before === undefined) return;
      const back: LogTrackerInput = { amount: before, mode: 'set' };
      recordUndo({
        label: 'Logged a tracker',
        undo: () => api.logTracker(id, back).then(() => invalidate(['trackers'])),
        redo: () => api.logTracker(id, input).then(() => invalidate(['trackers'])),
      });
    },
  });
}

export function useGrades() {
  return useQuery({ queryKey: keys.grades, queryFn: api.grades });
}

export function useCreateComponent() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: api.createComponent,
    onSuccess: () => invalidate(keys.grades),
  });
}

export function useUpdateComponent() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateComponent>[1] }) =>
      api.updateComponent(id, patch),
    onSuccess: () => invalidate(keys.grades),
  });
}

export function useDeleteComponent() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.deleteComponent(id),
    onSuccess: () => invalidate(keys.grades),
  });
}

/* ---------- the recap ---------- */

/** One range of the Analytics page. The previous range stays up, dimmed, while the next loads. */
export function useRecap(range: RecapRangeParam, ago = 0) {
  return useQuery({
    queryKey: keys.recap(range, ago),
    queryFn: () => api.recap(range, ago),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useDashboardStats() {
  return useQuery({
    queryKey: keys.dashboardStats,
    queryFn: api.dashboardStats,
    staleTime: 60_000,
  });
}

/**
 * Film and TV facts for the equivalents. They change about never: fresh for a day, and
 * the query cache on disk keeps them across reloads, so TMDB is rarely asked.
 */
export function useScreens() {
  return useQuery({
    queryKey: keys.screens,
    queryFn: api.screens,
    staleTime: 24 * 60 * 60_000,
    gcTime: 7 * 24 * 60 * 60_000,
    retry: false,
  });
}

/* ---------- session history ---------- */

const HISTORY_PAGE = 30;

/** Finished sessions, newest first, thirty at a time. */
export function useSessionHistory() {
  return useInfiniteQuery({
    queryKey: keys.history,
    queryFn: ({ pageParam }) =>
      api.sessionHistory({ limit: HISTORY_PAGE, before: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.sessions.length < HISTORY_PAGE
        ? null
        : last.sessions[last.sessions.length - 1]!.startedAt,
    staleTime: 30_000,
  });
}

/**
 * Delete focused time from a finished session. Not undoable with Ctrl+Z: it takes XP and
 * possibly badges with it, so it is confirmed in its own dialog instead.
 */
export function useTrimSession() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, minutes }: { id: string; minutes: number }) => api.trimSession(id, minutes),
    onSuccess: () =>
      invalidate(['sessions'], keys.me, keys.pace, keys.shop, ['analytics'], ['blocks']),
  });
}

/* ---------- study plans ---------- */

export function usePlans() {
  return useQuery({ queryKey: keys.plans, queryFn: api.plans, staleTime: 15_000 });
}

export function usePlan(id: string | undefined) {
  return useQuery({
    queryKey: keys.plan(id ?? ''),
    queryFn: () => api.plan(id!),
    enabled: !!id,
    staleTime: 15_000,
  });
}

/**
 * Every plan mutation answers with the plan's fresh view: it goes straight into the cache,
 * and the lists that plan topics also appear in (tasks, pace, routines) are refetched.
 */
function usePlanMutation<V, R extends PlanView | { view: PlanView }>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: fn,
    onSuccess: (res) => {
      const view: PlanView = 'view' in res ? res.view : (res as PlanView);
      qc.setQueryData(keys.plan(view.plan.id), view);
      invalidate(keys.plans, keys.nodes, keys.pace, ['routines']);
    },
  });
}

export function useCreatePlan() {
  return usePlanMutation((input: PlanInput) => api.createPlan(input));
}

export function useUpdatePlan() {
  return usePlanMutation(({ id, patch }: { id: string; patch: PlanPatch }) =>
    api.updatePlan(id, patch),
  );
}

export function useDeletePlan() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.deletePlan(id),
    onSuccess: () => invalidate(keys.plans, keys.nodes, keys.pace, ['routines']),
  });
}

export function useAddTopic() {
  return usePlanMutation(({ planId, input }: { planId: string; input: TopicInput }) =>
    api.addTopic(planId, input),
  );
}

export function useUpdateTopic() {
  return usePlanMutation(({ id, patch }: { id: string; patch: TopicPatch }) =>
    api.updateTopic(id, patch),
  );
}

export function useDeleteTopic() {
  return usePlanMutation((id: string) => api.deleteTopic(id));
}

export function useLogDrill() {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ topicId, input }: { topicId: string; input: DrillInput }) =>
      api.logDrill(topicId, input),
    onSuccess: (res) => {
      qc.setQueryData(keys.plan(res.view.plan.id), res.view);
      invalidate(keys.plans, keys.nodes, keys.pace);
    },
  });
}

export function useAnswerItem() {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, result }: { id: string; result: 'ok' | 'shaky' | 'miss' }) =>
      api.answerItem(id, result),
    onSuccess: (res) => {
      qc.setQueryData(keys.plan(res.view.plan.id), res.view);
      invalidate(keys.plans, keys.nodes, keys.pace);
    },
  });
}

export function useDeleteItem() {
  return usePlanMutation((id: string) => api.deleteItem(id));
}
