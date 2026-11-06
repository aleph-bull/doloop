import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { sessions } from '../db/schema';
import { notFound } from '../errors';
import { CameraLinks } from '../services/camera-link';
import type { SessionHandovers } from '../services/session-handovers';

/** An offer or answer with every address in it is a few kB; this leaves plenty of room. */
const SDP_MAX = 24_000;

const exchangeBody = z.object({
  sessionId: z.string().uuid(),
  role: z.enum(['host', 'camera']),
  after: z.number().int().nonnegative().default(0),
  send: z
    .array(
      z.object({
        link: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
        kind: z.enum(['offer', 'answer', 'bye']),
        sdp: z.string().max(SDP_MAX).optional(),
      }),
    )
    .max(4)
    .default([]),
  leave: z.boolean().default(false),
  /** The host's kind of device, so the other end knows whether to film or to take the stills. */
  device: z.enum(['phone', 'computer']).optional(),
  /** A phone: it films for the computer (or has stopped). */
  films: z.boolean().optional(),
  /** The host: it is recording its screen, which a filming phone will want at the end. */
  screen: z.boolean().optional(),
});

/**
 * A phone filming for the computer recording the same session (services/camera-link.ts).
 * Only the session's owner can pair for it, and only while it runs.
 */
export function cameraLinkRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string,
  handovers: SessionHandovers,
) {
  const links = new CameraLinks(() => Date.parse(clock()));

  app.post('/api/camera-link', async (req) => {
    const body = exchangeBody.parse(req.body);
    const [session] = await db
      .select({ endedAt: sessions.endedAt })
      .from(sessions)
      .where(and(eq(sessions.id, body.sessionId), eq(sessions.userId, req.user.id)))
      .limit(1);
    if (!session) throw notFound('Session not found');
    const key = `${req.user.id}:${body.sessionId}`;
    // Ended: said, so a device that missed it (no link) shows its ending screen straight away.
    if (session.endedAt) {
      links.close(key);
      return { host: false, ended: true, messages: [] };
    }
    const state = links.exchange(key, body.role, body);
    // A phone films while the computer records its screen: the phone will make the video, and
    // waits for the screen once the session is over (services/session-handovers.ts).
    if (body.role === 'host' && body.screen && state.phoneFilms) handovers.expect(key);
    return state;
  });
}
