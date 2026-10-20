import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { forbidden, notFound } from '../errors';
import { isAdmin, listAccounts, setAccountPassword } from '../services/admin';
import { exportUserData } from '../services/export';

const passwordSchema = z.object({ password: z.string().min(1).max(200) });

/**
 * For whoever runs the alpha (`ADMIN_EMAILS`): every account, each one's data as JSON, and
 * setting a password for someone who has forgotten theirs. Testers are told on the sign-in
 * page that the person running it can see accounts and study data.
 */
export function adminRoutes(app: FastifyInstance, db: Db, admins: string[]) {
  const requireAdmin = (req: FastifyRequest) => {
    if (!isAdmin(req.user.email, admins)) throw forbidden('Admins only');
  };

  app.get('/api/admin/me', async (req) => ({ admin: isAdmin(req.user.email, admins) }));

  app.get('/api/admin/accounts', async (req) => {
    requireAdmin(req);
    return { accounts: await listAccounts(db) };
  });

  app.get<{ Params: { id: string } }>('/api/admin/accounts/:id/export', async (req, reply) => {
    requireAdmin(req);
    const user = await db.query.users.findFirst({ where: eq(users.id, req.params.id) });
    if (!user) throw notFound('No such account');
    const data = await exportUserData(db, user);
    const name = user.email.replace(/[^a-z0-9@._-]/gi, '_');
    return reply
      .header('content-disposition', `attachment; filename="komogon-${name}.json"`)
      .send(data);
  });

  app.post<{ Params: { id: string } }>('/api/admin/accounts/:id/password', async (req, reply) => {
    requireAdmin(req);
    const { password } = passwordSchema.parse(req.body);
    await setAccountPassword(db, req.params.id, password);
    return reply.code(204).send();
  });
}
