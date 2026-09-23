import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { badRequest } from '../errors';
import { signState, verifyState } from '../services/oauth-state';
import {
  completeSpotifyConnection,
  controlPlayer,
  disconnectSpotify,
  nowPlaying,
  spotifyStatus,
  type SpotifyDeps,
} from '../services/spotify-connection';
import { SpotifyPlayerError } from '../services/spotify';

export interface SpotifyRouteOptions {
  deps: SpotifyDeps | null;
  /** Secret for signing the OAuth state parameter. */
  stateSecret: string;
  portalUrl: string;
}

/** Where the consent flow sends the user back to. Only paths the portal owns. */
const RETURN_PATHS = { focus: '/focus', settings: '/settings#focus' } as const;
type ReturnTo = keyof typeof RETURN_PATHS;

const connectSchema = z.object({ returnTo: z.enum(['focus', 'settings']).default('focus') });
const playerSchema = z.object({ action: z.enum(['play', 'pause', 'next', 'previous']) });

/**
 * Spotify: a separate consent from sign-in, like Google Calendar. The portal never holds a
 * Spotify token; it asks this API what is playing and the API talks to Spotify.
 */
export function spotifyRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string,
  opts: SpotifyRouteOptions,
) {
  app.get('/api/spotify/status', async (req) => ({
    available: opts.deps !== null,
    ...(await spotifyStatus(db, req.user.id)),
  }));

  /** Step 1: returns the URL to send the user to. */
  app.post('/api/spotify/connect', async (req) => {
    if (!opts.deps) throw badRequest('Spotify is not configured on this server');
    const { returnTo } = connectSchema.parse(req.body ?? {});
    const state = signState(`${req.user.id}|${returnTo}`, opts.stateSecret);
    return { url: opts.deps.spotify.authUrl(state) };
  });

  /** Step 2: Spotify redirects here. Public route; the signed state identifies the user. */
  app.get('/api/spotify/callback', { config: { public: true } }, async (req, reply) => {
    const q = z
      .object({
        code: z.string().optional(),
        state: z.string().optional(),
        error: z.string().optional(),
      })
      .parse(req.query);
    const payload = q.state ? verifyState(q.state, opts.stateSecret) : null;
    const [userId, ret] = payload ? payload.split('|') : [null, null];
    const returnTo: ReturnTo = ret === 'settings' ? 'settings' : 'focus';
    const back = (status: string) => {
      const path = RETURN_PATHS[returnTo];
      const [pathname, hash] = path.split('#');
      return reply.redirect(
        `${opts.portalUrl}${pathname}?spotify=${status}${hash ? `#${hash}` : ''}`,
      );
    };
    if (!opts.deps) return back('unavailable');
    if (!userId) return back('invalid');
    if (q.error || !q.code) return back('denied');
    try {
      await completeSpotifyConnection(db, opts.deps, userId, q.code, clock());
      return back('connected');
    } catch (err) {
      req.log.error(err);
      return back('failed');
    }
  });

  app.delete('/api/spotify', async (req, reply) => {
    await disconnectSpotify(db, req.user.id);
    return reply.code(204).send();
  });

  /** Polled by the focus screen. Never throws for an expected state; those are the body. */
  app.get('/api/spotify/now-playing', async (req) => {
    if (!opts.deps) return { status: 'not-connected' as const, fetchedAt: clock() };
    return { ...(await nowPlaying(db, opts.deps, req.user.id)), fetchedAt: clock() };
  });

  app.post('/api/spotify/player', async (req, reply) => {
    if (!opts.deps) throw badRequest('Spotify is not configured on this server');
    const { action } = playerSchema.parse(req.body);
    try {
      const status = await controlPlayer(db, opts.deps, req.user.id, action);
      if (status !== 'ok') return reply.code(409).send({ error: `Spotify is ${status}`, status });
      return { ok: true };
    } catch (err) {
      if (err instanceof SpotifyPlayerError)
        return reply.code(409).send({ error: err.message, reason: err.reason });
      throw err;
    }
  });
}
