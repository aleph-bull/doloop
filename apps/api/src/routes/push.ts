import type { FastifyInstance } from 'fastify';
import { and, asc, eq, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { pushSubscriptions } from '../db/schema';
import { badRequest } from '../errors';
import { isPushEndpoint } from '../services/push';

/** Browsers one account can have notifications on in; the oldest goes past this. */
export const PUSH_MAX_BROWSERS = 10;

const base64url = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+=*$/)
    .refine((s) => Buffer.from(s, 'base64url').length === bytes);

const subscription = z.object({
  endpoint: z.string().max(2048),
  keys: z.object({ p256dh: base64url(65), auth: base64url(16) }),
});

/**
 * Turning notifications on or off in one browser (services/push.ts sends them). The browser
 * subscribes with the key from `GET /api/push/key` and hands the API what its push service
 * gave it.
 */
export function pushRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/push/key', async () => ({ key: app.push.publicKey }));

  app.put('/api/push/subscription', async (req, reply) => {
    const body = subscription.parse(req.body);
    if (!isPushEndpoint(body.endpoint)) throw badRequest('Not a push service');
    const me = req.user.id;
    // One row per browser: someone else signing in there takes it over.
    await db
      .insert(pushSubscriptions)
      .values({
        userId: me,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: me, p256dh: body.keys.p256dh, auth: body.keys.auth },
      });
    const kept = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, me))
      .orderBy(asc(pushSubscriptions.createdAt));
    if (kept.length > PUSH_MAX_BROWSERS) {
      const newest = kept.slice(-PUSH_MAX_BROWSERS).map((r) => r.id);
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, me), notInArray(pushSubscriptions.id, newest)));
    }
    return reply.code(204).send();
  });

  app.delete('/api/push/subscription', async (req, reply) => {
    const { endpoint } = z.object({ endpoint: z.string().max(2048) }).parse(req.body);
    await db
      .delete(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, req.user.id)),
      );
    return reply.code(204).send();
  });
}
