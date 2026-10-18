import type { FastifyInstance } from 'fastify';
import {
  dayStartUnlocksAt,
  isAccentUnlocked,
  isBackgroundAvailable,
  isValidTimezone,
} from '@komogon/core';
import type { Db } from '../db/client';
import { badRequest } from '../errors';
import { viewPolicy } from '../services/rest-days';
import {
  deleteUser,
  regenerateIcsToken,
  settingsOf,
  syncStreak,
  toUser,
  updateProfile,
  updateSettings,
} from '../services/users';
import { settingsSchema, updateMeSchema } from '../validation';
import { exportUserData } from '../services/export';
import { and, eq } from 'drizzle-orm';
import { userAssets } from '../db/schema';

export function meRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  app.get('/api/me', async (req) => {
    const now = clock();
    const streak = await syncStreak(db, req.user, now);
    const policy = await viewPolicy(db, req.user.id, now);
    const bg = await db.query.userAssets.findFirst({
      where: and(eq(userAssets.userId, req.user.id), eq(userAssets.kind, 'background')),
      columns: { updatedAt: true },
    });
    return {
      user: toUser(req.user),
      onboarded: req.user.onboardedAt !== null,
      streakMessage: streak.message,
      streakMilestones: streak.milestonesReached,
      restDays: policy,
      purchasedBackgrounds: req.user.purchasedBackgrounds,
      icsToken: req.user.icsToken,
      backgroundUpdatedAt: bg?.updatedAt.toISOString() ?? null,
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
    const accent = patch.theme?.accent;
    if (accent && !accent.startsWith('custom:') && !isAccentUnlocked(accent, req.user.level))
      throw badRequest('That accent unlocks at a higher level');
    const bg = patch.theme?.backgroundId;
    if (bg && !isBackgroundAvailable(bg, req.user.level, req.user.purchasedBackgrounds))
      throw badRequest('That background is locked or not yet purchased');
    const ext = patch.theme?.extensionBackground;
    if (
      ext &&
      ext !== 'same' &&
      ext !== 'upload' &&
      !isBackgroundAvailable(ext, req.user.level, req.user.purchasedBackgrounds)
    )
      throw badRequest('That background is locked or not yet purchased');
    // The streak's day start may move once a day, and the server stamps when it did.
    const hour = patch.streak?.dayStartHour;
    if (hour !== undefined) {
      const now = clock();
      const current = settingsOf(req.user).streak;
      if (hour !== current.dayStartHour) {
        const until = dayStartUnlocksAt(current.dayStartChangedAt, now);
        if (until) throw badRequest('When your day starts can change once a day. Try again later.');
        (patch.streak as Record<string, unknown>).dayStartChangedAt = now;
      }
    }
    const row = await updateSettings(db, req.user, patch);
    return { settings: toUser(row).settings };
  });

  app.post('/api/me/ics-token', async (req) => {
    const token = await regenerateIcsToken(db, req.user.id);
    return { icsToken: token };
  });

  app.get('/api/me/export', async (req, reply) => {
    const data = await exportUserData(db, req.user);
    reply.header('content-disposition', 'attachment; filename="komogon-export.json"');
    return data;
  });

  app.delete('/api/me', async (req, reply) => {
    await deleteUser(db, req.user.id);
    return reply.code(204).send();
  });
}
