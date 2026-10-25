import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { CUSTOM_BACKGROUND_UPLOAD, customBackgroundCost } from '@komogon/core';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { customBackgrounds, userAssets, users, xpTransactions, type UserRow } from '../db/schema';
import { badRequest, conflict, HttpError, isUniqueViolation, notFound } from '../errors';
import { dt } from '../services/sessions-mapper';
import { settingsOf } from '../services/users';

const MAX_BYTES = 5 * 1024 * 1024;
/** The profile picture is shown small, and the portal shrinks it first. */
const AVATAR_MAX_BYTES = 512 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Checks an uploaded data URL and splits it into what the row stores. */
function parseImage(
  dataUrl: string,
  maxBytes: number,
): { mime: string; data: string; bytes: number } {
  const m = dataUrl.match(/^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) throw badRequest('Expected a base64 data URL');
  const mime = m[1]!.toLowerCase();
  if (!ALLOWED.has(mime)) throw badRequest('Use a JPEG, PNG, or WebP image');
  const bytes = Math.floor((m[2]!.length * 3) / 4);
  if (bytes > maxBytes)
    throw badRequest(`Image must be under ${Math.round(maxBytes / 1024 / 1024) || 1} MB`);
  return { mime, data: m[2]!, bytes };
}

/** The portal's fingerprint of a picture: sha256 of its whole data URL, in hex. */
const hashOf = (dataUrl: string) => createHash('sha256').update(dataUrl).digest('hex');
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);

type BackgroundRow = typeof customBackgrounds.$inferSelect;
const listed = (row: BackgroundRow) => ({
  id: row.id,
  hash: row.hash,
  createdAt: row.createdAt.toISOString(),
});

async function heldBy(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(customBackgrounds)
    .where(eq(customBackgrounds.userId, userId));
  return row?.n ?? 0;
}

/** Writes these theme fields over the stored ones, leaving the rest of the settings alone. */
async function setTheme(db: Db, user: UserRow, theme: Record<string, unknown>): Promise<void> {
  const settings = { ...(user.settings ?? {}) } as Record<string, unknown>;
  settings.theme = { ...((settings.theme as object) ?? {}), ...theme };
  await db.update(users).set({ settings }).where(eq(users.id, user.id));
}

/** The background uploaded before pictures were kept in the browser, if it is still here. */
const serverCopy = (db: Db, userId: string) =>
  db.query.userAssets.findFirst({
    where: and(eq(userAssets.userId, userId), eq(userAssets.kind, 'background')),
  });

/**
 * Per-user images: the profile picture, stored here and served back as a data URL, and the
 * record of the backgrounds people upload, whose pictures stay in their browser.
 */
export function assetRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  /** The backgrounds they keep, newest first, and what one more costs. */
  app.get('/api/me/backgrounds', async (req) => {
    const rows = await db.query.customBackgrounds.findMany({
      where: eq(customBackgrounds.userId, req.user.id),
      orderBy: desc(customBackgrounds.createdAt),
    });
    return { backgrounds: rows.map(listed), cost: customBackgroundCost(rows.length) };
  });

  /**
   * Records an uploaded background and puts it on. The picture itself never comes here: the
   * portal keeps it in the browser under `id`, and sends its fingerprint. The first is free
   * and each one kept beside it costs XP. The portal sends the price it showed (`cost`), so
   * nobody pays a price they didn't see: a different one is a 409 carrying the real one. The
   * same picture again puts the one they have back on, free.
   */
  app.post('/api/me/backgrounds', async (req) => {
    const body = z
      .object({ id: z.string().uuid(), hash: hashSchema, cost: z.number().int().min(0) })
      .parse(req.body);
    const held = await heldBy(db, req.user.id);
    const same = await db.query.customBackgrounds.findFirst({
      where: and(eq(customBackgrounds.userId, req.user.id), eq(customBackgrounds.hash, body.hash)),
    });
    if (same) {
      await setTheme(db, req.user, {
        customBackgroundUrl: CUSTOM_BACKGROUND_UPLOAD,
        customBackgroundId: same.id,
      });
      return { background: listed(same), xp: req.user.xp, cost: customBackgroundCost(held) };
    }

    const cost = customBackgroundCost(held);
    if (body.cost !== cost)
      throw new HttpError(
        409,
        cost > 0 ? `Another background is ${cost} XP.` : 'This one is free.',
        { cost },
      );

    const now = dt(clock());
    let xp = req.user.xp;
    let row: BackgroundRow;
    try {
      row = await db.transaction(async (tx) => {
        const [added] = await tx
          .insert(customBackgrounds)
          .values({ id: body.id, userId: req.user.id, hash: body.hash, createdAt: now })
          .returning();
        if (cost > 0) {
          // Taken only if it is there, so two uploads at once can't spend it twice.
          const paid = await tx
            .update(users)
            .set({ xp: sql`${users.xp} - ${cost}` })
            .where(and(eq(users.id, req.user.id), gte(users.xp, cost)))
            .returning({ xp: users.xp });
          if (paid.length === 0) throw badRequest(`Another background is ${cost} XP.`);
          xp = paid[0]!.xp;
          await tx.insert(xpTransactions).values({
            userId: req.user.id,
            at: now,
            delta: -cost,
            kind: 'background',
            ref: `upload:${added!.id}`,
          });
        }
        return added!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('That one is already yours.');
      throw err;
    }
    await setTheme(db, req.user, {
      customBackgroundUrl: CUSTOM_BACKGROUND_UPLOAD,
      customBackgroundId: row.id,
    });
    return { background: listed(row), xp, cost: customBackgroundCost(held + 1) };
  });

  /** Deletes one, and takes it off the screen if it was showing. No XP comes back. */
  app.delete('/api/me/backgrounds/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const gone = await db
      .delete(customBackgrounds)
      .where(and(eq(customBackgrounds.userId, req.user.id), eq(customBackgrounds.id, id)))
      .returning({ id: customBackgrounds.id });
    if (gone.length === 0) throw notFound('No such background');
    const theme = settingsOf(req.user).theme;
    if (theme.customBackgroundId === id)
      await setTheme(db, req.user, {
        customBackgroundId: null,
        ...(theme.customBackgroundUrl === CUSTOM_BACKGROUND_UPLOAD
          ? { customBackgroundUrl: null }
          : {}),
      });
    return reply.code(204).send();
  });

  /**
   * Moves a background uploaded before pictures were kept in the browser: records it as one of
   * theirs (free: it already was) and hands the picture over. The copy here is deleted only
   * once the portal has filed it (`adopted`), so a lost answer loses nothing.
   */
  app.post('/api/me/backgrounds/adopt', async (req) => {
    const copy = await serverCopy(db, req.user.id);
    if (!copy) throw notFound('No custom background');
    const dataUrl = `data:${copy.mime};base64,${copy.data}`;
    const hash = hashOf(dataUrl);
    let row = await db.query.customBackgrounds.findFirst({
      where: and(eq(customBackgrounds.userId, req.user.id), eq(customBackgrounds.hash, hash)),
    });
    if (!row) {
      const id = z
        .string()
        .uuid()
        .parse((req.body as { id?: unknown } | undefined)?.id);
      [row] = await db
        .insert(customBackgrounds)
        .values({ id, userId: req.user.id, hash, createdAt: copy.updatedAt })
        .returning();
    }
    const theme = settingsOf(req.user).theme;
    if (theme.customBackgroundUrl === CUSTOM_BACKGROUND_UPLOAD && !theme.customBackgroundId)
      await setTheme(db, req.user, { customBackgroundId: row!.id });
    return { background: listed(row!), dataUrl };
  });

  app.post('/api/me/backgrounds/adopted', async (req, reply) => {
    const copy = await serverCopy(db, req.user.id);
    if (copy) {
      const hash = hashOf(`data:${copy.mime};base64,${copy.data}`);
      const kept = await db.query.customBackgrounds.findFirst({
        where: and(eq(customBackgrounds.userId, req.user.id), eq(customBackgrounds.hash, hash)),
        columns: { id: true },
      });
      if (!kept) throw badRequest('Move it first');
      await db
        .delete(userAssets)
        .where(and(eq(userAssets.userId, req.user.id), eq(userAssets.kind, 'background')));
    }
    return reply.code(204).send();
  });

  /** A background uploaded before they were kept in the browser. The extension reads it. */
  app.get('/api/me/background', async (req) => {
    const row = await serverCopy(db, req.user.id);
    if (!row) throw notFound('No custom background');
    return {
      dataUrl: `data:${row.mime};base64,${row.data}`,
      bytes: row.bytes,
      updatedAt: row.updatedAt.toISOString(),
    };
  });

  /** Older portals' one upload, kept here until a newer portal moves it into the browser. */
  app.put('/api/me/background', async (req) => {
    const { dataUrl } = z.object({ dataUrl: z.string().max(MAX_BYTES * 1.4) }).parse(req.body);
    const { mime, data, bytes } = parseImage(dataUrl, MAX_BYTES);
    const now = dt(clock());
    await db
      .insert(userAssets)
      .values({ userId: req.user.id, kind: 'background', mime, data, bytes, updatedAt: now })
      .onConflictDoUpdate({
        target: [userAssets.userId, userAssets.kind],
        set: { mime, data, bytes, updatedAt: now },
      });
    await setTheme(db, req.user, {
      customBackgroundUrl: CUSTOM_BACKGROUND_UPLOAD,
      customBackgroundId: null,
    });
    return { ok: true, bytes };
  });

  app.delete('/api/me/background', async (req, reply) => {
    await db
      .delete(userAssets)
      .where(and(eq(userAssets.userId, req.user.id), eq(userAssets.kind, 'background')));
    const theme = settingsOf(req.user).theme;
    if (theme.customBackgroundUrl === CUSTOM_BACKGROUND_UPLOAD && !theme.customBackgroundId)
      await setTheme(db, req.user, { customBackgroundUrl: null });
    return reply.code(204).send();
  });

  /** Your own picture, for the nav and the settings form; null when there is none. */
  app.get('/api/me/avatar', async (req) => {
    const row = await db.query.userAssets.findFirst({
      where: and(eq(userAssets.userId, req.user.id), eq(userAssets.kind, 'avatar')),
    });
    return { dataUrl: row ? `data:${row.mime};base64,${row.data}` : null };
  });

  /** The profile picture. Others see it through the profile (GET /api/profiles/:id). */
  app.put('/api/me/avatar', async (req) => {
    const { dataUrl } = z
      .object({ dataUrl: z.string().max(AVATAR_MAX_BYTES * 1.4) })
      .parse(req.body);
    const { mime, data, bytes } = parseImage(dataUrl, AVATAR_MAX_BYTES);
    const now = dt(clock());
    await db
      .insert(userAssets)
      .values({ userId: req.user.id, kind: 'avatar', mime, data, bytes, updatedAt: now })
      .onConflictDoUpdate({
        target: [userAssets.userId, userAssets.kind],
        set: { mime, data, bytes, updatedAt: now },
      });
    return { ok: true, bytes };
  });

  app.delete('/api/me/avatar', async (req, reply) => {
    await db
      .delete(userAssets)
      .where(and(eq(userAssets.userId, req.user.id), eq(userAssets.kind, 'avatar')));
    return reply.code(204).send();
  });
}
