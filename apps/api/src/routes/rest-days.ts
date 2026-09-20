import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  addVacationFor,
  changeWeeklyRestDays,
  removeVacationFor,
  viewPolicy,
} from '../services/rest-days';
import { isoDate, vacationSchema, weeklyRestDaysSchema } from '../validation';

export function restDayRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  app.get('/api/rest-days', async (req) => viewPolicy(db, req.user.id, clock()));

  app.put('/api/rest-days/weekly', async (req) => {
    const { days } = weeklyRestDaysSchema.parse(req.body);
    return changeWeeklyRestDays(db, req.user.id, days, clock(), req.user.timezone);
  });

  app.post('/api/rest-days/vacations', async (req, reply) => {
    const v = vacationSchema.parse(req.body);
    const out = await addVacationFor(db, req.user.id, v, clock(), req.user.timezone);
    return reply.code(201).send(out);
  });

  app.delete('/api/rest-days/vacations/:from', async (req) => {
    const { from } = z.object({ from: isoDate }).parse(req.params);
    return removeVacationFor(db, req.user.id, from, clock());
  });
}
