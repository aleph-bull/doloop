import type { UserSettings } from '@komogon/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type NodeInput } from './api';

export const keys = {
  me: ['me'] as const,
  nodes: ['nodes'] as const,
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
  weeklyReview: (w?: string) => ['analytics', 'review', w ?? 'current'] as const,
  followUps: ['follow-ups'] as const,
  busy: (from: string, to: string) => ['calendar', 'busy', from, to] as const,
  commitments: ['calendar', 'commitments'] as const,
  google: ['calendar', 'google'] as const,
  shop: ['shop'] as const,
  background: ['me', 'background'] as const,
  rewards: ['rewards'] as const,
  routines: (from?: string, to?: string) => ['routines', from ?? '', to ?? ''] as const,
  routineList: ['routines', 'list'] as const,
  trackers: (weeks?: number) => ['trackers', weeks ?? 'default'] as const,
  grades: ['grades'] as const,
  spotify: ['spotify', 'status'] as const,
  nowPlaying: ['spotify', 'now-playing'] as const,
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: 30_000 });
}

export function useNodes() {
  return useQuery({ queryKey: keys.nodes, queryFn: () => api.nodes(false), staleTime: 15_000 });
}

export function usePace() {
  return useQuery({ queryKey: keys.pace, queryFn: api.pace, staleTime: 15_000 });
}

export function useActiveSession() {
  return useQuery({
    queryKey: keys.active,
    queryFn: api.activeSession,
    refetchInterval: 20_000,
    staleTime: 5_000,
  });
/**
 * A quote is up for six hours: fresh until the server's `nextAt`, then fetched again on the
 * dot. `staleTime` counts from the fetch and the interval from now. A floor of a minute
 * keeps a clock that disagrees with the server's from looping.
 */
const quoteMsFrom = (from: number, data?: { nextAt?: string }) =>
  data?.nextAt ? Math.max(60_000, Date.parse(data.nextAt) - from + 1_000) : 60 * 60_000;

}

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

export function useWeeklyReview(weekStart?: string) {
  return useQuery({
    queryKey: keys.weeklyReview(weekStart),
    queryFn: () => api.weeklyReview(weekStart),
    staleTime: 60_000,
  });
}

export function useSaveWeeklyNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ weekStart, note }: { weekStart: string; note: string }) =>
      api.saveWeeklyNote(weekStart, note),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['analytics', 'review'] }),
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
  });
}

export function useBusy(from: string, to: string) {
  return useQuery({
    queryKey: keys.busy(from, to),
    queryFn: () => api.busy(from, to),
    staleTime: 5 * 60_000,
  });
}

export function useCommitments() {
  return useQuery({ queryKey: keys.commitments, queryFn: api.commitments, staleTime: 60_000 });
}

export function useGoogleStatus() {
  return useQuery({ queryKey: keys.google, queryFn: api.googleStatus, staleTime: 30_000 });
}

export function useSpotifyStatus() {
  return useQuery({ queryKey: keys.spotify, queryFn: api.spotifyStatus, staleTime: 30_000 });
}

/**
 * What is playing, polled while the focus screen is showing. A failed poll keeps the last
 * answer on screen rather than blanking the card: the timer never depends on this.
 */
export function useNowPlaying(enabled: boolean) {
  return useQuery({
    queryKey: keys.nowPlaying,
    queryFn: api.spotifyNowPlaying,
    enabled,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    staleTime: 2_000,
    retry: 1,
  });
}

export function useCreateBlock() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: api.createBlock,
    onSuccess: () => invalidate(['blocks'], keys.pace, keys.commitments),
  });
}

export function useUpdateBlock() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateBlock>[1] }) =>
      api.updateBlock(id, patch),
    onSuccess: () => invalidate(['blocks'], keys.pace, keys.commitments),
  });
}

export function useDeleteBlock() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.deleteBlock(id),
    onSuccess: () => invalidate(['blocks'], keys.pace, keys.commitments),
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

export function useTickRoutine() {
  return useRoutineMutation(({ id, date }: { id: string; date: string }) =>
    api.tickRoutine(id, date),
  );
}

export function useUntickRoutine() {
  return useRoutineMutation(({ id, date }: { id: string; date: string }) =>
    api.untickRoutine(id, date),
  );
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

export function useUpdateSettings() {
  const invalidate = useInvalidate();
  type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
  return useMutation({
    mutationFn: (patch: DeepPartial<UserSettings>) => api.updateSettings(patch),
    onSuccess: () => invalidate(keys.me, keys.quote, keys.pace),
  });
}

export function useCreateNode() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: NodeInput & { title: string }) => api.createNode(input),
    onSuccess: () => invalidate(keys.nodes, keys.pace),
  });
}

export function useUpdateNode() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: NodeInput }) => api.updateNode(id, patch),
    onSuccess: () => invalidate(keys.nodes, keys.pace),
  });
}

export function useArchiveNode() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.archiveNode(id),
    onSuccess: () => invalidate(keys.nodes, keys.pace, keys.active),
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
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.logTracker>[1] }) =>
      api.logTracker(id, input),
    onSuccess: () => invalidate(['trackers']),
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
