import type { FastifyInstance } from 'fastify';
import { GRID_MAX_WEEKS } from '@komodoit/core';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  createTracker,
  deleteTracker,
  logTracker,
  trackerBoard,
  updateTracker,
} from '../services/trackers';
import { logTrackerSchema, trackerSchema, updateTrackerSchema, uuid } from '../validation';

export function trackerRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  /** The dashboard board: every tracker with its grid already built. */
  app.get('/api/trackers', async (req) => {
    const q = z
      .object({ weeks: z.coerce.number().int().min(1).max(GRID_MAX_WEEKS).optional() })
      .parse(req.query);
    return trackerBoard(db, req.user, clock(), q.weeks);
  });

  app.post('/api/trackers', async (req, reply) => {
    const body = trackerSchema.parse(req.body);
    const tracker = await createTracker(db, req.user.id, body, clock());
    reply.code(201);
    return { tracker };
  });

  app.patch('/api/trackers/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = updateTrackerSchema.parse(req.body);
    return { tracker: await updateTracker(db, req.user.id, id, body, clock()) };
  });

  app.delete('/api/trackers/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await deleteTracker(db, req.user.id, id);
    reply.code(204);
  });

  /** Log an amount for a day. Returns null when the day was cleared back to nothing. */
  app.post('/api/trackers/:id/log', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = logTrackerSchema.parse(req.body);
    const entry = await logTracker(db, req.user, id, body, clock());
    return { entry };
  });
}
