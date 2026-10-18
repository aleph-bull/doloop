import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  addTopic,
  answerItem,
  createPlan,
  deleteItem,
  deletePlan,
  deleteTopic,
  listPlans,
  logDrill,
  planView,
  updatePlan,
  updateTopic,
} from '../services/plans';
import {
  createPlanSchema,
  createTopicSchema,
  drillItemResultSchema,
  logDrillSchema,
  updatePlanSchema,
  updateTopicSchema,
  uuid,
} from '../validation';

const idParam = z.object({ id: uuid });

export function planRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  app.get('/api/plans', async (req) => ({ plans: await listPlans(db, req.user, clock()) }));

  app.post('/api/plans', async (req, reply) => {
    const body = createPlanSchema.parse(req.body);
    const view = await createPlan(db, req.user, body, clock());
    reply.code(201);
    return view;
  });

  app.get('/api/plans/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return planView(db, req.user, id, clock());
  });

  app.patch('/api/plans/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return updatePlan(db, req.user, id, updatePlanSchema.parse(req.body), clock());
  });

  app.delete('/api/plans/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await deletePlan(db, req.user.id, id);
    reply.code(204);
  });

  app.post('/api/plans/:id/topics', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const view = await addTopic(db, req.user, id, createTopicSchema.parse(req.body), clock());
    reply.code(201);
    return view;
  });

  app.patch('/api/plan-topics/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return updateTopic(db, req.user, id, updateTopicSchema.parse(req.body), clock());
  });

  app.delete('/api/plan-topics/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return deleteTopic(db, req.user, id, clock());
  });

  /** Log a drilling round on a topic. `mastered` is set when this round crossed the bar. */
  app.post('/api/plan-topics/:id/drills', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const res = await logDrill(db, req.user, id, logDrillSchema.parse(req.body), clock());
    reply.code(201);
    return res;
  });

  /** Answer a queued miss again: it moves on, or comes back tomorrow. */
  app.post('/api/drill-items/:id/answer', async (req) => {
    const { id } = idParam.parse(req.params);
    const { result } = drillItemResultSchema.parse(req.body);
    return answerItem(db, req.user, id, result, clock());
  });

  app.delete('/api/drill-items/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return deleteItem(db, req.user, id, clock());
  });
}
