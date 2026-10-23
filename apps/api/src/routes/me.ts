import type { FastifyInstance } from 'fastify';
import {
  dayStartUnlocksAt,
  displayNameError,
  minCostUnlocksAt,
  normalizeDisplayName,
  isAccentUnlocked,
  isBackgroundAvailable,
  isValidTimezone,
  MAX_SAVED_ACCENTS,
} from '@komogon/core';
import type { Db } from '../db/client';
import { badRequest } from '../errors';
import { viewPolicy } from '../services/rest-days';
import {
  deleteUser,
  ensureUsername,
  regenerateIcsToken,
  setUsername,
  settingsOf,
  syncStreak,
  toUser,
  updateProfile,
  updateSettings,
} from '../services/users';
import { settingsSchema, updateMeSchema, usernameSchema } from '../validation';
import { exportUserData } from '../services/export';
import { and, eq } from 'drizzle-orm';
import { userAssets } from '../db/schema';
import type { MediaStore } from '../services/media-store';

export function meRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string,
  store: MediaStore | null = null,
) {
  app.get('/api/me', async (req) => {
    const now = clock();
    const streak = await syncStreak(db, req.user, now);
    const policy = await viewPolicy(db, req.user.id, now);
    const row = await ensureUsername(db, req.user);
    const bg = await db.query.userAssets.findFirst({
      where: and(eq(userAssets.userId, req.user.id), eq(userAssets.kind, 'background')),
      columns: { updatedAt: true },
    });
    return {
      user: toUser(row),
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

  app.put('/api/me/username', async (req) => {
    const { username } = usernameSchema.parse(req.body);
    const row = await setUsername(db, req.user, username, clock());
    return { user: toUser(row) };
  });

  app.patch('/api/me/settings', async (req) => {
    const patch = settingsSchema.parse(req.body);
    const name = patch.profile?.name;
    if (name) {
      const error = displayNameError(name);
      if (error) throw badRequest(error);
      patch.profile!.name = normalizeDisplayName(name);
    }
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
    // Saved accents can't grow past the limit, but a longer list from an older limit can
    // still shrink.
    const saved = patch.theme?.savedAccents;
    if (saved && saved.length > MAX_SAVED_ACCENTS) {
      const had = settingsOf(req.user).theme.savedAccents.length;
      if (saved.length > had)
        throw badRequest(`You can keep up to ${MAX_SAVED_ACCENTS} colours of your own.`);
    }
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
    // So may the reward minimum.
    const minCost = patch.rewards?.minCostXp;
    if (minCost !== undefined) {
      const now = clock();
      const current = settingsOf(req.user).rewards;
      if (minCost !== current.minCostXp) {
        if (minCostUnlocksAt(current.minCostChangedAt, now))
          throw badRequest('The reward minimum can change once a day. Try again later.');
        (patch.rewards as Record<string, unknown>).minCostChangedAt = now;
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
    reply.header('content-disposition', 'attachment; filename="komodon-export.json"');
    return data;
  });

  app.delete('/api/me', async (req, reply) => {
    await deleteUser(db, req.user.id, store, req.log);
    return reply.code(204).send();
  });
}
