import { fallbackFacts, SCREEN_TITLES, type ScreenFacts, type ScreenTitle } from '@komogon/core';

/**
 * Posters and runtimes for the "enough time to watch…" cards, from TMDB. The key stays on
 * the server; the portal only ever sees the finished facts and public poster URLs.
 *
 * Results are held in memory for a week: runtimes and posters do not change, and the
 * portal keeps its own copy on disk besides, so TMDB is asked about each title rarely. A
 * title TMDB cannot answer for falls back to its listed runtime with no poster, and the
 * card shows an icon instead of a broken image.
 */

export interface TmdbCredentials {
  readToken?: string;
  apiKey?: string;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

const API = 'https://api.themoviedb.org/3';
const IMAGES = 'https://image.tmdb.org/t/p/w342';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 4000;

interface CacheEntry {
  at: number;
  facts: ScreenFacts;
}

const cache = new Map<string, CacheEntry>();
const keyOf = (t: ScreenTitle) => `${t.type}:${t.tmdbId}:${t.season ?? ''}`;

/** Drop everything cached, for tests. */
export function clearTmdbCache(): void {
  cache.clear();
}

export function tmdbConfigured(creds: TmdbCredentials | null | undefined): boolean {
  return !!(creds?.readToken || creds?.apiKey);
}

async function getJson(
  path: string,
  creds: TmdbCredentials,
  fetchFn: FetchLike,
): Promise<Record<string, unknown> | null> {
  const url = new URL(`${API}${path}`);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (creds.readToken) headers.authorization = `Bearer ${creds.readToken}`;
  else if (creds.apiKey) url.searchParams.set('api_key', creds.apiKey);
  try {
    const res = await Promise.race([
      fetchFn(url.toString(), { headers }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);
    if (!res || !res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const poster = (path: unknown) => (typeof path === 'string' && path ? `${IMAGES}${path}` : null);

/** One title's facts from TMDB, or null when TMDB could not say. */
async function lookup(
  t: ScreenTitle,
  creds: TmdbCredentials,
  fetchFn: FetchLike,
): Promise<ScreenFacts | null> {
  if (t.type === 'movie') {
    const m = await getJson(`/movie/${t.tmdbId}`, creds, fetchFn);
    const runtime = typeof m?.runtime === 'number' ? m.runtime : 0;
    if (!m || runtime <= 0) return null;
    return {
      tmdbId: t.tmdbId,
      type: 'movie',
      title: typeof m.title === 'string' ? m.title : t.title,
      minutes: runtime,
      posterUrl: poster(m.poster_path),
      approximate: false,
    };
  }
  const season = t.season ?? 1;
  const [show, s] = await Promise.all([
    getJson(`/tv/${t.tmdbId}`, creds, fetchFn),
    getJson(`/tv/${t.tmdbId}/season/${season}`, creds, fetchFn),
  ]);
  const episodes = Array.isArray(s?.episodes) ? (s.episodes as Array<{ runtime?: unknown }>) : [];
  // Some episodes come back without a runtime; the listed average stands in for those.
  const known = episodes.map((e) => (typeof e.runtime === 'number' ? e.runtime : 0));
  const avg =
    known.filter((x) => x > 0).reduce((a, b) => a + b, 0) /
    Math.max(1, known.filter((x) => x > 0).length);
  const minutes = known.reduce((a, x) => a + (x > 0 ? x : avg), 0);
  if (!s || episodes.length === 0 || minutes <= 0) return null;
  return {
    tmdbId: t.tmdbId,
    type: 'tv',
    title: typeof show?.name === 'string' ? show.name : t.title,
    season,
    minutes: Math.round(minutes),
    episodes: episodes.length,
    posterUrl: poster(s.poster_path) ?? poster(show?.poster_path),
    approximate: false,
  };
}

/**
 * Facts for every listed title: TMDB's where it answers, the listed fallback where it does
 * not or is not configured. Never throws.
 */
export async function screenFacts(
  creds: TmdbCredentials | null | undefined,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
  now = Date.now(),
): Promise<{ facts: ScreenFacts[]; source: 'tmdb' | 'fallback' }> {
  if (!creds || !tmdbConfigured(creds))
    return { facts: SCREEN_TITLES.map(fallbackFacts), source: 'fallback' };
  const facts = await Promise.all(
    SCREEN_TITLES.map(async (t) => {
      const hit = cache.get(keyOf(t));
      if (hit && now - hit.at < TTL_MS) return hit.facts;
      const found = await lookup(t, creds, fetchFn);
      if (found) cache.set(keyOf(t), { at: now, facts: found });
      return found ?? fallbackFacts(t);
    }),
  );
  return { facts, source: 'tmdb' };
}
