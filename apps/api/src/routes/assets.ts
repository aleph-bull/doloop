import type { FastifyInstance } from 'fastify';
import { CUSTOM_BACKGROUND_UPLOAD } from '@komogon/core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { userAssets, users } from '../db/schema';
import { badRequest, notFound } from '../errors';
import { dt } from '../services/sessions-mapper';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Custom background image upload (spec §8 "Advanced"). Stored per user; served back as a data URL. */
export function assetRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  app.get('/api/me/background', async (req) => {
    const row = await db.query.userAssets.findFirst({
      where: and(eq(userAssets.userId, req.user.id), eq(userAssets.kind, 'background')),
    });
    if (!row) throw notFound('No custom background');
    return {
      dataUrl: `data:${row.mime};base64,${row.data}`,
      bytes: row.bytes,
      updatedAt: row.updatedAt.toISOString(),
    };
  });

  app.put('/api/me/background', async (req) => {
    const { dataUrl } = z.object({ dataUrl: z.string().max(MAX_BYTES * 1.4) }).parse(req.body);
    const m = dataUrl.match(/^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/=]+)$/i);
    if (!m) throw badRequest('Expected a base64 data URL');
    const mime = m[1]!.toLowerCase();
    if (!ALLOWED.has(mime)) throw badRequest('Use a JPEG, PNG, or WebP image');
    const bytes = Math.floor((m[2]!.length * 3) / 4);
    if (bytes > MAX_BYTES) throw badRequest('Image must be under 5 MB');
    const now = dt(clock());
    await db
      .insert(userAssets)
      .values({ userId: req.user.id, kind: 'background', mime, data: m[2]!, bytes, updatedAt: now })
      .onConflictDoUpdate({
        target: [userAssets.userId, userAssets.kind],
        set: { mime, data: m[2]!, bytes, updatedAt: now },
      });
    const settings = { ...(req.user.settings ?? {}) } as Record<string, unknown>;
    settings.theme = {
      ...((settings.theme as object) ?? {}),
      customBackgroundUrl: CUSTOM_BACKGROUND_UPLOAD,
    };
    await db.update(users).set({ settings }).where(eq(users.id, req.user.id));
    return { ok: true, bytes };
  });

  app.delete('/api/me/background', async (req, reply) => {
    await db
      .delete(userAssets)
      .where(and(eq(userAssets.userId, req.user.id), eq(userAssets.kind, 'background')));
    const settings = { ...(req.user.settings ?? {}) } as Record<string, unknown>;
    const theme = { ...((settings.theme as Record<string, unknown>) ?? {}) };
    if (theme.customBackgroundUrl === CUSTOM_BACKGROUND_UPLOAD) theme.customBackgroundUrl = null;
    settings.theme = theme;
    await db.update(users).set({ settings }).where(eq(users.id, req.user.id));
    return reply.code(204).send();
  });
}
