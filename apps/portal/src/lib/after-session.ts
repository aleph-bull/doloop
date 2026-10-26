import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { api } from './api';
import { keys, useMe } from './queries';

/** Social with this session picked in the post box (the Composer reads `post`). */
export const postPath = (sessionId: string) => `/social?post=${encodeURIComponent(sessionId)}`;

/** The session a `postPath` is for. */
export const postPathSession = (path: string): string | null =>
  new URLSearchParams(path.split('?')[1] ?? '').get('post');

/**
 * The timelapse made after a session, on its way to the post box with it: kept in memory
 * only, for this tab, until the Composer takes it.
 */
let handed: { sessionId: string; file: File } | null = null;

/** Send the made video along to the post box `postPath(sessionId)` opens. */
export function handTimelapse(sessionId: string | null, file: File | null): void {
  handed = sessionId && file ? { sessionId, file } : null;
}

/** The video sent along for this session, once: the post box attaches it. */
export function takeTimelapse(sessionId: string): File | null {
  if (!handed || handed.sessionId !== sessionId) return null;
  const { file } = handed;
  handed = null;
  return file;
}

/**
 * Where closing a session's summary goes: Social, to post it, when Settings › Timer › After
 * each session says so, Social is shown and the session can still be posted. Asked as the
 * summary opens, so closing it doesn't wait; the returned function resolves to the path, or
 * null to close as usual.
 */
export function useSocialAfterSession(session: { id: string; workSeconds: number } | null) {
  const qc = useQueryClient();
  const settings = useMe().data?.user.settings;
  const on = Boolean(settings?.review.openSocial && settings.features.social);
  // The post box only lists sessions with a minute of focus or more.
  const id = on && session && session.workSeconds >= 60 ? session.id : null;

  useEffect(() => {
    // Asked fresh: a list from before the session ended doesn't have it.
    if (id)
      void qc.prefetchQuery({
        queryKey: keys.postable,
        queryFn: api.postableSessions,
        staleTime: 0,
      });
  }, [qc, id]);

  return useCallback(async (): Promise<string | null> => {
    if (!id) return null;
    try {
      // The answer from the prefetch, or a new one if a post went up since (Share to Social).
      const { sessionIds } = await qc.fetchQuery({
        queryKey: keys.postable,
        queryFn: api.postableSessions,
        staleTime: Infinity,
      });
      return sessionIds.includes(id) ? postPath(id) : null;
    } catch {
      return null;
    }
  }, [qc, id]);
}
