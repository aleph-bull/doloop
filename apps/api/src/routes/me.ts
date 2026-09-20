import type { FastifyInstance } from 'fastify';
import { isValidTimezone } from '@doloop/core';
import type { Db } from '../db/client';
import { badRequest } from '../errors';
import { viewPolicy } from '../services/rest-days';
import {
  deleteUser,
  regenerateIcsToken,
  syncStreak,
  toUser,
  updateProfile,
  updateSettings,
} from '../services/users';
import { settingsSchema, updateMeSchema } from '../validation';
import { exportUserData } from '../services/export';

export function meRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  app.get('/api/me', async (req) => {
    const now = clock();
    const streak = await syncStreak(db, req.user, now);
    const policy = await viewPolicy(db, req.user.id, now);
    return {
      user: toUser(req.user),
      onboarded: req.user.onboardedAt !== null,
      streakMessage: streak.message,
      streakMilestones: streak.milestonesReached,
      restDays: policy,
      purchasedBackgrounds: req.user.purchasedBackgrounds,
      icsToken: req.user.icsToken,
    };
  });

  app.patch('/api/me', async (req) => {
    const body = updateMeSchema.parse(req.body);
    if (body.timezone && !isValidTimezone(body.timezone)) throw badRequest('Invalid timezone');
    const row = await updateProfile(db, req.user, body, clock());
    return { user: toUser(row), onboarded: row.onboardedAt !== null };
  });

  app.patch('/api/me/settings', async (req) => {
    const patch = settingsSchema.parse(req.body);
    const row = await updateSettings(db, req.user, patch);
    return { settings: toUser(row).settings };
  });

  app.post('/api/me/ics-token', async (req) => {
    const token = await regenerateIcsToken(db, req.user.id);
    return { icsToken: token };
  });

  app.get('/api/me/export', async (req, reply) => {
    const data = await exportUserData(db, req.user);
    reply.header('content-disposition', 'attachment; filename="doloop-export.json"');
    return data;
  });

  app.delete('/api/me', async (req, reply) => {
    await deleteUser(db, req.user.id);
    return reply.code(204).send();
  });
}
