import type { FastifyInstance } from 'fastify';
import { findFreeSlots } from '@doloop/core';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { badRequest, notFound } from '../errors';
import {
  busyTimes,
  completeConnection,
  connectionStatus,
  disconnect,
  syncGoogle,
  importedCommitments,
  type CalendarDeps,
} from '../services/calendar-sync';
import { buildIcs } from '../services/ics';
import { listNodes } from '../services/nodes';
import { loadCompletedSessions, paceContext } from '../services/pace';
import { listBlocks } from '../services/planned-blocks';
import { listRoutines } from '../services/routines';
import { toPlannedBlock } from '../services/sessions-mapper';
import { isoDateTime } from '../validation';

export interface CalendarRouteOptions {
  deps: CalendarDeps | null;
  /** Secret for signing the OAuth state parameter. */
  stateSecret: string;
  portalUrl: string;
}

function signState(userId: string, secret: string): string {
  const ts = Date.now().toString(36);
  const sig = createHmac('sha256', secret).update(`${userId}.${ts}`).digest('base64url');
  return `${userId}.${ts}.${sig}`;
}

function verifyState(state: string, secret: string): string | null {
  const [userId, ts, sig] = state.split('.');
  if (!userId || !ts || !sig) return null;
  const expect = createHmac('sha256', secret).update(`${userId}.${ts}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Date.now() - parseInt(ts, 36) > 15 * 60_000) return null;
  return userId;
}

export function calendarRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string,
  opts: CalendarRouteOptions,
) {
  app.get('/api/calendar/google/status', async (req) => ({
    available: opts.deps !== null,
    ...(await connectionStatus(db, req.user.id)),
  }));

  /** Step 1 of the separate consent flow: returns the URL to send the user to. */
  app.post('/api/calendar/google/connect', async (req) => {
    if (!opts.deps) throw badRequest('Google Calendar is not configured on this server');
    return { url: opts.deps.google.authUrl(signState(req.user.id, opts.stateSecret)) };
  });

  /** Step 2: Google redirects here. Public route; the signed state identifies the user. */
  app.get('/api/calendar/google/callback', { config: { public: true } }, async (req, reply) => {
    const q = z
      .object({ code: z.string().optional(), state: z.string(), error: z.string().optional() })
      .parse(req.query);
    const back = (status: string) =>
      reply.redirect(`${opts.portalUrl}/settings?google=${status}#calendar`);
    if (!opts.deps) return back('unavailable');
    if (q.error || !q.code) return back('denied');
    const userId = verifyState(q.state, opts.stateSecret);
    if (!userId) return back('invalid');
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) return back('invalid');
    try {
      await completeConnection(db, opts.deps, user, q.code, clock());
      await syncGoogle(db, opts.deps, user, clock());
      return back('connected');
    } catch (err) {
      req.log.error(err);
      return back('failed');
    }
  });

  app.post('/api/calendar/google/sync', async (req) => {
    if (!opts.deps) throw badRequest('Google Calendar is not configured on this server');
    return syncGoogle(db, opts.deps, req.user, clock());
  });

  app.delete('/api/calendar/google', async (req, reply) => {
    await disconnect(db, req.user.id);
    return reply.code(204).send();
  });

  /** Busy intervals from the primary calendar, for the scheduler. */
  app.get('/api/calendar/busy', async (req) => {
    const q = z.object({ from: isoDateTime, to: isoDateTime }).parse(req.query);
    return { busy: await busyTimes(db, opts.deps, req.user.id, q.from, q.to) };
  });

  /**
   * Commitments imported from the connected calendar. Context for planning around, not
   * study time: nothing here is offered up to be turned into a task.
   */
  app.get('/api/calendar/commitments', async (req) => ({
    blocks: (await importedCommitments(db, req.user.id, clock())).map(toPlannedBlock),
  }));

  /** Free-slot suggestions for a given length, using Google busy times, existing blocks, and rest days. */
  app.get('/api/calendar/suggest', async (req) => {
    const q = z
      .object({
        minutes: z.coerce.number().int().min(5).max(600),
        from: isoDateTime.optional(),
        days: z.coerce.number().int().min(1).max(14).default(7),
      })
      .parse(req.query);
    const now = clock();
    const from = q.from ?? now;
    const to = new Date(Date.parse(from) + q.days * 86_400_000).toISOString();
    const [busy, blocks, ctx] = await Promise.all([
      busyTimes(db, opts.deps, req.user.id, from, to),
      listBlocks(db, req.user.id, from, to),
      paceContext(db, req.user, now),
    ]);
    const slots = findFreeSlots({
      from,
      to,
      busy: [
        ...busy,
        ...blocks.filter((b) => !b.cancelled).map((b) => ({ start: b.startAt, end: b.endAt })),
      ],
      minutes: q.minutes,
      timezone: req.user.timezone,
      policy: ctx.policy,
      limit: 5,
    });
    return { slots };
  });

  /** One-shot download (authenticated). */
  app.get('/api/calendar/export.ics', async (req, reply) => {
    const q = z.object({ sessions: z.enum(['true', 'false']).optional() }).parse(req.query);
    const [blocks, nodes, sessions, routines] = await Promise.all([
      listBlocks(db, req.user.id),
      listNodes(db, req.user.id, true),
      q.sessions === 'true' ? loadCompletedSessions(db, req.user.id) : Promise.resolve([]),
      listRoutines(db, req.user.id, true),
    ]);
    reply.header('content-type', 'text/calendar; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="doloop.ics"');
    return buildIcs({ blocks, nodes, sessions, routines, now: clock() });
  });

  /** Per-user secret feed URL (public route, token-authenticated). */
  app.get('/calendar.ics', { config: { public: true } }, async (req, reply) => {
    const q = z
      .object({ token: z.string().min(10), sessions: z.enum(['true', 'false']).optional() })
      .parse(req.query);
    const user = await db.query.users.findFirst({ where: eq(users.icsToken, q.token) });
    if (!user) throw notFound('Unknown feed');
    const [blocks, nodes, sessions, routines] = await Promise.all([
      listBlocks(db, user.id),
      listNodes(db, user.id, true),
      q.sessions === 'true' ? loadCompletedSessions(db, user.id) : Promise.resolve([]),
      listRoutines(db, user.id, true),
    ]);
    reply.header('content-type', 'text/calendar; charset=utf-8');
    reply.header('cache-control', 'private, max-age=300');
    return buildIcs({ blocks, nodes, sessions, routines, now: clock() });
  });
}
