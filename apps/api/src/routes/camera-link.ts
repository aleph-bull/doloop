import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { sessions } from '../db/schema';
import { notFound } from '../errors';
import { CameraLinks } from '../services/camera-link';

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
});

/**
 * A phone filming for the computer recording the same session (services/camera-link.ts).
 * Only the session's owner can pair for it, and only while it runs.
 */
export function cameraLinkRoutes(app: FastifyInstance, db: Db, clock: () => string) {
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
    if (session.endedAt) {
      links.close(key);
      return { host: false, messages: [] };
    }
    return links.exchange(key, body.role, body);
  });
}
