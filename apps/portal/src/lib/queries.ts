import type { UserSettings } from '@doloop/core';
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
  weeklyReview: (w?: string) => ['analytics', 'review', w ?? 'current'] as const,
  followUps: ['follow-ups'] as const,
  busy: (from: string, to: string) => ['calendar', 'busy', from, to] as const,
  unlinked: ['calendar', 'unlinked'] as const,
  google: ['calendar', 'google'] as const,
  shop: ['shop'] as const,
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
}

export function useQuote() {
  return useQuery({ queryKey: keys.quote, queryFn: api.quote, staleTime: 60 * 60_000 });
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

export function useUnlinkedBlocks() {
  return useQuery({ queryKey: keys.unlinked, queryFn: api.unlinkedBlocks, staleTime: 60_000 });
}

export function useGoogleStatus() {
  return useQuery({ queryKey: keys.google, queryFn: api.googleStatus, staleTime: 30_000 });
}

export function useCreateBlock() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: api.createBlock,
    onSuccess: () => invalidate(['blocks'], keys.pace, keys.unlinked),
  });
}

export function useUpdateBlock() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateBlock>[1] }) =>
      api.updateBlock(id, patch),
    onSuccess: () => invalidate(['blocks'], keys.pace, keys.unlinked),
  });
}

export function useDeleteBlock() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.deleteBlock(id),
    onSuccess: () => invalidate(['blocks'], keys.pace, keys.unlinked),
  });
}

export function useShop() {
  return useQuery({ queryKey: keys.shop, queryFn: api.shop, staleTime: 30_000 });
}

export function useRestDays() {
  return useQuery({ queryKey: keys.restDays, queryFn: api.restDays, staleTime: 30_000 });
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
