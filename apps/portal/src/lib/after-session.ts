import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { api } from './api';
import { keys, useMe } from './queries';

/**
 * Social with these sessions picked in the post box (the Composer reads `post`): one, or
 * several that went into one timelapse, for one post.
 */
export const postPath = (sessionIds: readonly string[]) =>
  `/social?post=${sessionIds.map(encodeURIComponent).join(',')}`;

/** The sessions a `post` value (or a `postPath`) is for. */
export const postSessions = (value: string | null): string[] =>
  (value ?? '').split(',').filter(Boolean);

/** The sessions a `postPath` is for. */
export const postPathSessions = (path: string): string[] =>
  postSessions(new URLSearchParams(path.split('?')[1] ?? '').get('post'));

/**
 * The timelapse made after a session, on its way to the post box with it: kept in memory
 * only, for this tab, until the Composer takes it.
 */
let handed: { sessionId: string; file: File } | null = null;

/** Send the made video along to the post box a `postPath` with this session opens. */
export function handTimelapse(sessionId: string | null, file: File | null): void {
  handed = sessionId && file ? { sessionId, file } : null;
}

/** The video sent along for one of these sessions, once: the post box attaches it. */
export function takeTimelapse(sessionIds: readonly string[]): File | null {
  if (!handed || !sessionIds.includes(handed.sessionId)) return null;
  const { file } = handed;
  handed = null;
  return file;
}

/**
 * Where closing a session's summary goes: Social, to post it, when Settings › Timer › After
 * each session says so, Social is shown and the session can still be posted. Asked as the
 * summary opens, so closing it doesn't wait; the returned function resolves to the path, or
 * null to close as usual. `earlier` are sessions before it in the same timelapse: picked
 * with it, for one post, while they can still be posted.
 */
export function useSocialAfterSession(
  session: { id: string; workSeconds: number } | null,
  earlier: readonly string[] = [],
) {
  const qc = useQueryClient();
  const settings = useMe().data?.user.settings;
  const on = Boolean(settings?.review.openSocial && settings.features.social);
  // The post box only lists sessions with a minute of focus or more.
  const id = on && session && session.workSeconds >= 60 ? session.id : null;
  // As text, so a new list with the same sessions is the same.
  const earlierKey = earlier.join(',');

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
      if (!sessionIds.includes(id)) return null;
      const before = postSessions(earlierKey).filter((e) => e !== id && sessionIds.includes(e));
      return postPath([...before, id]);
    } catch {
      return null;
    }
  }, [qc, id, earlierKey]);
}
