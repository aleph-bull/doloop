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
