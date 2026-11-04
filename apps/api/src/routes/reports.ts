import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { postReports, posts, users } from '../db/schema';
import { badRequest, isUniqueViolation, notFound } from '../errors';
import type { Mailer } from '../services/mailer';
import { loadPeople } from '../services/people';
import { REPORT_REASON_MAX, reportMessage } from '../services/post-reports';
import { checkLimits, RateLimiter } from '../services/rate-limit';
import { dt } from '../services/sessions-mapper';
import { uuid } from '../validation';
import { canSeePost, loadPosts } from './social';

export interface ReportOptions {
  /** How the email goes out; null keeps reports in Admin › Reports only. */
  mailer: Mailer | null;
  /** Where it goes (`REPORTS_EMAIL`). */
  to: string | null;
  /** The portal's address, for the email's link to Admin › Reports. */
  portalUrl: string;
}

/**
 * Reporting a post (2026-11-03): from the ⋯ under someone else's post. Each person's report
 * is kept once; the first one emails whoever runs Komodon with the post's ID, and a second
 * from the same person only updates what they said.
 */
export function reportRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string,
  opts: ReportOptions,
) {
  // Enough for anyone acting in good faith; it stops a flood of emails.
  const limiter = new RateLimiter({ max: 20, windowMs: 60 * 60 * 1000 });
  const params = z.object({ id: uuid });
  const bodySchema = z.object({
    reason: z.string().trim().max(REPORT_REASON_MAX).default(''),
  });

  app.post('/api/posts/:id/report', async (req, reply) => {
    const { id } = params.parse(req.params);
    const { reason } = bodySchema.parse(req.body ?? {});
    checkLimits([[limiter, req.user.id]]);
    if (!(await canSeePost(db, req.user, id))) throw notFound('No such post');
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, id),
      columns: { userId: true },
    });
    if (!post) throw notFound('No such post');
    if (post.userId === req.user.id) throw badRequest('That’s your own post');
    limiter.hit(req.user.id);

    const mine = and(eq(postReports.postId, id), eq(postReports.reporterId, req.user.id));
    const before = await db.query.postReports.findFirst({ where: mine, columns: { id: true } });
    if (before) {
      if (reason) await db.update(postReports).set({ reason }).where(mine);
      return reply.code(200).send({ reported: true });
    }
    try {
      await db
        .insert(postReports)
        .values({ postId: id, reporterId: req.user.id, reason, createdAt: dt(clock()) });
    } catch (err) {
      // Two taps at once: the other one is the report.
      if (isUniqueViolation(err)) return reply.code(200).send({ reported: true });
      throw err;
    }

    if (opts.mailer && opts.to) {
      const [page, reporter, author, [{ n } = { n: 1 }]] = await Promise.all([
        // The email goes to the owner, so it carries the post's ID.
        loadPosts(db, req.user.id, eq(posts.id, id), 1, { ids: true }),
        loadPeople(db, [req.user.id]),
        db.query.users.findFirst({ where: eq(users.id, post.userId), columns: { email: true } }),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(postReports)
          .where(eq(postReports.postId, id)),
      ]);
      const reported = page.posts[0];
      if (reported) {
        const { subject, text } = reportMessage({
          post: reported,
          people: { ...page.people, ...reporter },
          authorEmail: author?.email ?? null,
          reporterId: req.user.id,
          reporterEmail: req.user.email,
          reason,
          reports: Number(n),
          portalUrl: opts.portalUrl,
        });
        // Not waited on: the report is kept either way, and Admin › Reports lists it.
        opts.mailer
          .send({ to: opts.to, subject, text })
          .catch((err: unknown) => req.log.warn({ err }, 'report email failed'));
      }
    }
    return reply.code(201).send({ reported: true });
  });
}
