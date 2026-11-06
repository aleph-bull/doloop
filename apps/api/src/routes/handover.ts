import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { sessions } from '../db/schema';
import { notFound } from '../errors';
import {
  HANDOVER_MAX_BYTES,
  HANDOVER_MAX_PARTS,
  HANDOVER_PART_BYTES,
  type SessionHandovers,
} from '../services/session-handovers';

const params = z.object({ id: z.string().uuid() });
const partParams = z.object({
  id: z.string().uuid(),
  part: z.coerce
    .number()
    .int()
    .min(0)
    .max(HANDOVER_MAX_PARTS - 1),
});
const startBody = z.union([
  z.object({
    bytes: z.number().int().min(1).max(HANDOVER_MAX_BYTES),
    parts: z.number().int().min(1).max(HANDOVER_MAX_PARTS),
  }),
  z.object({ nothing: z.literal(true) }),
]);

/**
 * The computer's screen stills, handed to the phone that filmed the session
 * (services/session-handovers.ts). Only the session's owner sends or takes them. Each answer
 * carries the API's time, so both devices can line their stills up on one clock.
 */
export function handoverRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string,
  handovers: SessionHandovers,
) {
  // The parts come as they are, not as JSON.
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: HANDOVER_PART_BYTES + 1024 },
    (_req, body, done) => done(null, body),
  );

  const keyFor = async (userId: string, id: string) => {
    const [row] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
      .limit(1);
    if (!row) throw notFound('Session not found');
    return `${userId}:${id}`;
  };

  app.get('/api/sessions/:id/handover', async (req) => {
    const { id } = params.parse(req.params);
    const key = await keyFor(req.user.id, id);
    return {
      handover: handovers.view(key),
      maxBytes: HANDOVER_MAX_BYTES,
      partBytes: HANDOVER_PART_BYTES,
      now: clock(),
    };
  });

  app.post('/api/sessions/:id/handover', async (req) => {
    const { id } = params.parse(req.params);
    const body = startBody.parse(req.body);
    const key = await keyFor(req.user.id, id);
    if ('nothing' in body) handovers.nothing(key);
    else handovers.start(key, body.bytes, body.parts);
    return { handover: handovers.view(key), now: clock() };
  });

  app.put('/api/sessions/:id/handover/:part', async (req, reply) => {
    const { id, part } = partParams.parse(req.params);
    const key = await keyFor(req.user.id, id);
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    handovers.put(key, part, data);
    return reply.code(204).send();
  });

  app.post('/api/sessions/:id/handover/done', async (req) => {
    const { id } = params.parse(req.params);
    const key = await keyFor(req.user.id, id);
    return { handover: handovers.finish(key), now: clock() };
  });

  app.get('/api/sessions/:id/handover/:part', async (req, reply) => {
    const { id, part } = partParams.parse(req.params);
    const key = await keyFor(req.user.id, id);
    const data = handovers.part(key, part);
    return reply.type('application/octet-stream').header('cache-control', 'no-store').send(data);
  });

  app.post('/api/sessions/:id/handover/taken', async (req) => {
    const { id } = params.parse(req.params);
    const key = await keyFor(req.user.id, id);
    handovers.take(key);
    return { handover: handovers.view(key), now: clock() };
  });
}
