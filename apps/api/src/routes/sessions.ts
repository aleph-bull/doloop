import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  applySessionEvent,
  endSession,
  getActive,
  getSession,
  listSessions,
  startSession,
} from '../services/sessions';
import {
  endSessionSchema,
  isoDateTime,
  startSessionSchema,
  timerEventSchema,
  uuid,
} from '../validation';

const idParams = z.object({ id: uuid });

export function sessionRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  app.get('/api/sessions/active', async (req) => {
    const now = clock();
    return { now, active: await getActive(db, req.user, now) };
  });

  app.post('/api/sessions', async (req, reply) => {
    const body = startSessionSchema.parse(req.body);
    const now = clock();
    const active = await startSession(db, req.user, body, now);
    return reply.code(201).send({ now, active });
  });

  app.post('/api/sessions/:id/events', async (req) => {
    const { id } = idParams.parse(req.params);
    const event = timerEventSchema.parse(req.body);
    const now = clock();
    return { now, active: await applySessionEvent(db, req.user, id, event, now) };
  });

  app.post('/api/sessions/:id/end', async (req) => {
    const { id } = idParams.parse(req.params);
    const body = endSessionSchema.parse(req.body ?? {});
    return { summary: await endSession(db, req.user, id, body, clock()) };
  });

  app.get('/api/sessions', async (req) => {
    const q = z
      .object({
        nodeId: uuid.optional(),
        from: isoDateTime.optional(),
        to: isoDateTime.optional(),
        limit: z.coerce.number().int().min(1).max(1000).optional(),
      })
      .parse(req.query);
    return { sessions: await listSessions(db, req.user.id, q) };
  });

  app.get('/api/sessions/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    return { session: await getSession(db, req.user.id, id) };
  });
}
