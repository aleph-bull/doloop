import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { users, type UserRow } from '../db/schema';
import { badRequest, forbidden, notFound } from '../errors';
import {
  addStudyTime,
  deleteSession,
  isAdmin,
  listAccounts,
  restartOnboarding,
  setAccountPassword,
} from '../services/admin';
import { exportUserData } from '../services/export';
import type { MediaStore } from '../services/media-store';
import {
  blockEmail,
  deleteAccount,
  liftSuspension,
  listBlockedEmails,
  normaliseEmail,
  suspendAccount,
  unblockEmail,
} from '../services/moderation';
import { sessionHistory, trimSession } from '../services/sessions';
import { isoDate, isoDateTime, trimSessionSchema, uuid } from '../validation';

const passwordSchema = z.object({ password: z.string().min(1).max(200) });
const accountParams = z.object({ id: uuid });
const sessionParams = z.object({ id: uuid, sessionId: uuid });
const addTimeSchema = z.object({
  date: isoDate,
  minutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  start: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM')
    .optional(),
});
const emailSchema = z.object({ email: z.string().trim().email().max(320) });

/**
 * For whoever runs the alpha (`ADMIN_EMAILS`): every account, each one's data as JSON,
 * setting a password for someone who has forgotten theirs, sending an account through
 * onboarding again, adding or taking away study time, suspending or deleting an account, and
 * blocking an address. Testers are told on the sign-in page that the person running it can
 * see accounts and study data.
 */
export function adminRoutes(
  app: FastifyInstance,
  db: Db,
  admins: string[],
  clock: () => string,
  store: MediaStore | null = null,
) {
  const requireAdmin = (req: FastifyRequest) => {
    if (!isAdmin(req.user.email, admins)) throw forbidden('Admins only');
  };
  const account = async (id: string): Promise<UserRow> => {
    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) throw notFound('No such account');
    return user;
  };
  /** Admins, yourself included, can't be suspended, deleted or blocked from here. */
  const notAnAdmin = (email: string, what: string) => {
    if (isAdmin(email, admins)) throw badRequest(`An admin account can't be ${what}.`);
  };

  app.get('/api/admin/me', async (req) => ({ admin: isAdmin(req.user.email, admins) }));

  app.get('/api/admin/accounts', async (req) => {
    requireAdmin(req);
    const accounts = await listAccounts(db);
    return {
      accounts: accounts.map((a) => ({
        ...a,
        admin: isAdmin(a.email, admins),
        you: a.id === req.user.id,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/admin/accounts/:id/export', async (req, reply) => {
    requireAdmin(req);
    const user = await db.query.users.findFirst({ where: eq(users.id, req.params.id) });
    if (!user) throw notFound('No such account');
    const data = await exportUserData(db, user);
    const name = user.email.replace(/[^a-z0-9@._-]/gi, '_');
    return reply
      .header('content-disposition', `attachment; filename="komodon-${name}.json"`)
      .send(data);
  });

  app.post<{ Params: { id: string } }>('/api/admin/accounts/:id/password', async (req, reply) => {
    requireAdmin(req);
    const { password } = passwordSchema.parse(req.body);
    await setAccountPassword(db, req.params.id, password);
    return reply.code(204).send();
  });

  /* ---------- onboarding ---------- */

  app.post('/api/admin/accounts/:id/onboarding', async (req, reply) => {
    requireAdmin(req);
    const { id } = accountParams.parse(req.params);
    await restartOnboarding(db, await account(id));
    return reply.code(204).send();
  });

  /* ---------- study time ---------- */

  /** Finished sessions, newest first, a page at a time (`before` = the last one's start). */
  app.get('/api/admin/accounts/:id/sessions', async (req) => {
    requireAdmin(req);
    const { id } = accountParams.parse(req.params);
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).optional(),
        before: isoDateTime.optional(),
      })
      .parse(req.query);
    await account(id);
    return { sessions: await sessionHistory(db, id, { limit: q.limit ?? 20, before: q.before }) };
  });

  app.post('/api/admin/accounts/:id/time', async (req, reply) => {
    requireAdmin(req);
    const { id } = accountParams.parse(req.params);
    const input = addTimeSchema.parse(req.body);
    const session = await addStudyTime(db, await account(id), input, clock());
    return reply.code(201).send({ session });
  });

  /** Take focused time off the end of one of the account's finished sessions. */
  app.post('/api/admin/accounts/:id/sessions/:sessionId/trim', async (req) => {
    requireAdmin(req);
    const { id, sessionId } = sessionParams.parse(req.params);
    const { removeFocusMinutes } = trimSessionSchema.parse(req.body);
    return trimSession(db, await account(id), sessionId, removeFocusMinutes, clock());
  });

  app.delete('/api/admin/accounts/:id/sessions/:sessionId', async (req) => {
    requireAdmin(req);
    const { id, sessionId } = sessionParams.parse(req.params);
    return deleteSession(db, await account(id), sessionId, clock());
  });

  /* ---------- suspending and deleting accounts ---------- */

  app.post('/api/admin/accounts/:id/suspend', async (req, reply) => {
    requireAdmin(req);
    const { id } = accountParams.parse(req.params);
    const user = await account(id);
    notAnAdmin(user.email, 'suspended');
    await suspendAccount(db, user, clock());
    return reply.code(204).send();
  });

  app.delete('/api/admin/accounts/:id/suspend', async (req, reply) => {
    requireAdmin(req);
    const { id } = accountParams.parse(req.params);
    await liftSuspension(db, await account(id));
    return reply.code(204).send();
  });

  /** Delete an account for good; `?block=true` keeps its address from signing up again. */
  app.delete('/api/admin/accounts/:id', async (req, reply) => {
    requireAdmin(req);
    const { id } = accountParams.parse(req.params);
    const { block } = z
      .object({ block: z.enum(['true', 'false']).default('false') })
      .parse(req.query);
    const user = await account(id);
    notAnAdmin(user.email, 'deleted');
    await deleteAccount(db, id, { block: block === 'true', now: clock(), store, log: req.log });
    return reply.code(204).send();
  });

  /* ---------- blocked addresses ---------- */

  app.get('/api/admin/blocked-emails', async (req) => {
    requireAdmin(req);
    return { blocked: await listBlockedEmails(db) };
  });

  app.post('/api/admin/blocked-emails', async (req, reply) => {
    requireAdmin(req);
    const { email } = emailSchema.parse(req.body);
    notAnAdmin(email, 'blocked');
    await blockEmail(db, email, clock());
    return reply.code(204).send();
  });

  app.delete<{ Params: { email: string } }>(
    '/api/admin/blocked-emails/:email',
    async (req, reply) => {
      requireAdmin(req);
      await unblockEmail(db, normaliseEmail(req.params.email));
      return reply.code(204).send();
    },
  );
}
