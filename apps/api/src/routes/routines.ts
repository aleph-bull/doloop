import type { FastifyInstance } from 'fastify';
import { ROUTINES } from '@komogon/core';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  agenda,
  createRoutine,
  deleteRoutine,
  importIcsRoutines,
  listRoutines,
  tickRoutine,
  untickRoutine,
  updateRoutine,
} from '../services/routines';
import { unlockNewBadges } from '../services/achievements';
import { settingsOf } from '../services/users';
import { isoDate, uuid } from '../validation';

const draft = z.object({
  title: z.string().trim().min(1).max(ROUTINES.TITLE_MAX),
  note: z.string().max(500).nullable().optional(),
  nodeId: uuid.nullable().optional(),
  estimatedMinutes: z.number().int().min(ROUTINES.MIN_ESTIMATE_MIN).max(ROUTINES.MAX_ESTIMATE_MIN),
  freq: z.enum(['daily', 'weekly', 'monthly']),
  interval: z.number().int().min(1).max(ROUTINES.MAX_INTERVAL).optional(),
  byWeekday: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  byMonthday: z.array(z.number().int().min(1).max(31)).max(31).optional(),
  startDate: isoDate,
  endDate: isoDate.nullable().optional(),
});

const patchSchema = draft.partial().extend({ archived: z.boolean().optional() });

export function routineRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  /** Routines plus their expanded occurrences for a window — everything the page needs. */
  app.get('/api/routines', async (req) => {
    const q = z.object({ from: isoDate.optional(), to: isoDate.optional() }).parse(req.query);
    const now = clock();
    const data = await agenda(
      db,
      req.user.id,
      now,
      req.user.timezone,
      q.from,
      q.to,
      settingsOf(req.user).routines.missedClearedThrough,
    );
    return {
      ...data,
      limits: {
        xpPerMinute: ROUTINES.XP_PER_MINUTE,
        maxXpPerTick: ROUTINES.MAX_XP_PER_TICK,
        maxXpPerDay: ROUTINES.MAX_XP_PER_DAY,
      },
    };
  });

  app.get('/api/routines/list', async (req) => {
    const { archived } = z
      .object({ archived: z.enum(['true', 'false']).optional() })
      .parse(req.query);
    return { routines: await listRoutines(db, req.user.id, archived === 'true') };
  });

  app.post('/api/routines', async (req, reply) => {
    const body = draft.parse(req.body);
    const routine = await createRoutine(db, req.user.id, body, clock());
    return reply.code(201).send({ routine });
  });

  app.patch('/api/routines/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = patchSchema.parse(req.body);
    return { routine: await updateRoutine(db, req.user.id, id, body, clock()) };
  });

  app.delete('/api/routines/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await deleteRoutine(db, req.user.id, id);
    return reply.code(204).send();
  });

  /** Tick one occurrence off. Idempotent by (routine, date). */
  app.post('/api/routines/:id/tick', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { date } = z.object({ date: isoDate }).parse(req.body);
    const now = clock();
    const out = await tickRoutine(db, req.user, id, date, now);
    const user = { ...req.user, xp: out.xpTotal };
    const badges = await unlockNewBadges(db, user, now);
    // The total includes whatever a newly unlocked badge paid.
    return { ...out, xpTotal: user.xp, badges };
  });

  app.delete('/api/routines/:id/tick/:date', async (req) => {
    const { id, date } = z.object({ id: uuid, date: isoDate }).parse(req.params);
    return untickRoutine(db, req.user, id, date, clock());
  });

  /** Import recurring events from an .ics document as routines. */
  app.post('/api/routines/import-ics', async (req) => {
    const { ics, defaultEstimate } = z
      .object({
        ics: z.string().min(1).max(2_000_000),
        defaultEstimate: z
          .number()
          .int()
          .min(ROUTINES.MIN_ESTIMATE_MIN)
          .max(ROUTINES.MAX_ESTIMATE_MIN)
          .optional(),
      })
      .parse(req.body);
    const out = await importIcsRoutines(db, req.user.id, ics, clock(), { defaultEstimate });
    return {
      created: out.created.length,
      updated: out.updated.length,
      routines: [...out.created, ...out.updated],
      skipped: out.skipped,
    };
  });
}
