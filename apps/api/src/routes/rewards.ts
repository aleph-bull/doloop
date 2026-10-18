import type { FastifyInstance } from 'fastify';
import { REWARDS } from '@komogon/core';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  createReward,
  deleteReward,
  listRewards,
  redeem,
  redemptionHistory,
  updateReward,
} from '../services/rewards';
import { uuid } from '../validation';

const draft = z.object({
  name: z.string().trim().min(1).max(REWARDS.NAME_MAX),
  note: z.string().max(REWARDS.NOTE_MAX).nullable().optional(),
  emoji: z.string().max(16).nullable().optional(),
  // A task reward costs nothing, so the floor is checked in the core validator instead.
  costXp: z.number().int().min(0).max(REWARDS.MAX_COST_XP),
  cooldownDays: z.number().int().min(0).max(REWARDS.MAX_COOLDOWN_DAYS).optional(),
  unlock: z.enum(['xp', 'task']).optional(),
  unlockNodeId: uuid.nullable().optional(),
});

const patchSchema = draft.partial().extend({ archived: z.boolean().optional() });

export function rewardRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  app.get('/api/rewards', async (req) => {
    const { archived } = z
      .object({ archived: z.enum(['true', 'false']).optional() })
      .parse(req.query);
    const now = clock();
    return {
      rewards: await listRewards(
        db,
        req.user.id,
        req.user.xp,
        now,
        req.user.timezone,
        archived === 'true',
      ),
      xp: req.user.xp,
      limits: {
        minCostXp: REWARDS.MIN_COST_XP,
        maxCostXp: REWARDS.MAX_COST_XP,
        maxActive: REWARDS.MAX_ACTIVE,
        maxCooldownDays: REWARDS.MAX_COOLDOWN_DAYS,
      },
      history: await redemptionHistory(db, req.user.id),
    };
  });

  app.post('/api/rewards', async (req, reply) => {
    const body = draft.parse(req.body);
    const reward = await createReward(db, req.user.id, body);
    return reply.code(201).send({ reward });
  });

  app.patch('/api/rewards/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = patchSchema.parse(req.body);
    return { reward: await updateReward(db, req.user.id, id, body) };
  });

  app.delete('/api/rewards/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await deleteReward(db, req.user.id, id);
    return reply.code(204).send();
  });

  app.post('/api/rewards/:id/redeem', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const now = clock();
    const out = await redeem(db, req.user, id, now);
    return {
      reward: out.reward,
      xp: out.xp,
      spent: out.spent,
      rewards: await listRewards(db, req.user.id, out.xp, now, req.user.timezone),
    };
  });
}
