import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { findFreeSlots, looksLikeIcs, readIcsFeed } from '@komogon/core';
import { and, asc, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { calendarFeeds, outlookCalendar, users } from '../db/schema';
import { syncCalendarImport, outlookBusy, type OutlookDeps } from '../services/calendar-import';
import { encrypt } from '../services/crypto';
import {
  FEEDS_PER_USER,
  FeedError,
  NOT_A_CALENDAR,
  feedKey,
  feedUrlHash,
  feedView,
  feedWindow,
  fetchFeedText,
  normalizeFeedUrl,
  removeFeed,
  syncFeed,
  type FeedDeps,
  type FeedFetcher,
} from '../services/calendar-feeds';
import { registerCalendarWorker } from '../services/calendar-worker';
import { badRequest, conflict, notFound } from '../errors';
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
import { signState, verifyState } from '../services/oauth-state';
import { loadCompletedSessions, paceContext } from '../services/pace';
import { listBlocks } from '../services/planned-blocks';
import { listRoutines } from '../services/routines';
import { toPlannedBlock } from '../services/sessions-mapper';
import { isoDateTime } from '../validation';

export interface CalendarRouteOptions {
  deps: CalendarDeps | null;
  outlook: OutlookDeps | null;
  autoSync?: boolean;
  /** Secret for signing the OAuth state parameter. */
  stateSecret: string;
  portalUrl: string;
  /** Fetches calendars added by link; a fake in tests. */
  fetchFeed?: FeedFetcher;
}

export function calendarRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string,
  opts: CalendarRouteOptions,
) {
  const pending = new Map<string, { userId: string; verifier: string; expires: number }>();
  const importDeps = { google: opts.deps, outlook: opts.outlook };
  const feeds: FeedDeps = {
    fetch: opts.fetchFeed ?? fetchFeedText,
    key: feedKey(opts.stateSecret),
  };
  if (opts.autoSync) registerCalendarWorker(app, db, importDeps, clock, feeds);

  // Calendars added by their link (.ics): any calendar app can give one out, and no
  // sign-in or server setup is needed, unlike connecting Google or Outlook.
  const findFeed = async (userId: string, id: string) => {
    const row = await db.query.calendarFeeds.findFirst({
      where: and(eq(calendarFeeds.id, id), eq(calendarFeeds.userId, userId)),
    });
    if (!row) throw notFound('Calendar not found');
    return row;
  };
  const feedName = z.string().trim().min(1).max(60);

  app.get('/api/calendar/feeds', async (req) => {
    const rows = await db.query.calendarFeeds.findMany({
      where: eq(calendarFeeds.userId, req.user.id),
      orderBy: [asc(calendarFeeds.createdAt)],
    });
    return { feeds: rows.map(feedView) };
  });

  app.post('/api/calendar/feeds', async (req, reply) => {
    const body = z
      .object({
        url: z.string().trim().min(1).max(2000),
        name: feedName.optional(),
        tasks: z.boolean().optional(),
      })
      .parse(req.body);
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(calendarFeeds)
      .where(eq(calendarFeeds.userId, req.user.id));
    if (n >= FEEDS_PER_USER) throw badRequest(`You can add up to ${FEEDS_PER_USER} calendars.`);
    let url: URL;
    let text: string;
    try {
      url = normalizeFeedUrl(body.url);
      text = await feeds.fetch(url.toString());
    } catch (err) {
      if (err instanceof FeedError) throw badRequest(err.message);
      throw err;
    }
    if (!looksLikeIcs(text)) throw badRequest(NOT_A_CALENDAR);
    const urlHash = feedUrlHash(url.toString());
    const existing = await db.query.calendarFeeds.findFirst({
      where: and(eq(calendarFeeds.userId, req.user.id), eq(calendarFeeds.urlHash, urlHash)),
    });
    if (existing) throw conflict(`That calendar is already added, as ${existing.name}.`);
    const now = clock();
    const own = readIcsFeed(text, { ...feedWindow(now), timezone: req.user.timezone }).name;
    const [row] = await db
      .insert(calendarFeeds)
      .values({
        userId: req.user.id,
        name: body.name ?? own?.slice(0, 60) ?? url.hostname.replace(/^www./, ''),
        urlEnc: encrypt(url.toString(), feeds.key),
        urlHash,
        host: url.hostname,
        tasks: body.tasks ?? true,
        createdAt: new Date(now),
      })
      .returning();
    const { feed, result } = await syncFeed(db, req.user, row!, feeds, now, text);
    return reply.code(201).send({ feed: feedView(feed), result });
  });

  app.patch('/api/calendar/feeds/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ name: feedName.optional(), tasks: z.boolean().optional() })
      .parse(req.body);
    const row = await findFeed(req.user.id, id);
    const [updated] = await db
      .update(calendarFeeds)
      .set({ name: body.name ?? row.name, tasks: body.tasks ?? row.tasks })
      .where(eq(calendarFeeds.id, row.id))
      .returning();
    // Turning tasks on or off changes what the events become, so read it again.
    if (body.tasks !== undefined && body.tasks !== row.tasks) {
      const { feed, result } = await syncFeed(db, req.user, updated!, feeds, clock());
      return { feed: feedView(feed), result };
    }
    return { feed: feedView(updated!), result: null };
  });

  app.post('/api/calendar/feeds/:id/sync', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await findFeed(req.user.id, id);
    const { feed, result } = await syncFeed(db, req.user, row, feeds, clock());
    return { feed: feedView(feed), result };
  });

  app.delete('/api/calendar/feeds/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await findFeed(req.user.id, id);
    await removeFeed(db, req.user.id, id);
    return reply.code(204).send();
  });

  app.get('/api/calendar/outlook/status', async (req) => {
    const row = await db.query.outlookCalendar.findFirst({
      where: eq(outlookCalendar.userId, req.user.id),
    });
    return {
      available: !!opts.outlook,
      connected: !!row,
      revoked: !!row?.revokedAt,
      lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
    };
  });
  app.post('/api/calendar/outlook/connect', async (req) => {
    if (!opts.outlook) throw badRequest('Outlook Calendar is not configured on this server');
    for (const [key, item] of pending) if (item.expires < Date.now()) pending.delete(key);
    const verifier = randomBytes(32).toString('base64url');
    const state = signState(
      `outlook:${req.user.id}:${randomBytes(16).toString('hex')}`,
      opts.stateSecret,
    );
    pending.set(state, { userId: req.user.id, verifier, expires: Date.now() + 15 * 60_000 });
    return {
      url: opts.outlook.client.authUrl(
        state,
        createHash('sha256').update(verifier).digest('base64url'),
      ),
    };
  });
  app.get('/api/calendar/outlook/callback', { config: { public: true } }, async (req, reply) => {
    const q = z
      .object({
        code: z.string().optional(),
        state: z.string().optional(),
        error: z.string().optional(),
      })
      .parse(req.query);
    const back = (status: string) =>
      reply.redirect(`${opts.portalUrl}/settings?outlook=${status}#calendar`);
    if (!opts.outlook) return back('unavailable');
    const attempt = q.state ? pending.get(q.state) : undefined;
    if (q.state) pending.delete(q.state);
    if (
      !attempt ||
      attempt.expires < Date.now() ||
      !verifyState(q.state!, opts.stateSecret)?.startsWith(`outlook:${attempt.userId}:`)
    )
      return back('invalid');
    if (q.error || !q.code) return back('denied');
    const user = await db.query.users.findFirst({ where: eq(users.id, attempt.userId) });
    if (!user) return back('invalid');
    try {
      const tokens = await opts.outlook.client.exchangeCode(q.code, attempt.verifier);
      if (!tokens.refreshToken) throw new Error('Outlook did not grant offline access.');
      const refreshTokenEnc = encrypt(tokens.refreshToken, opts.outlook.encryptionKey);
      await db
        .insert(outlookCalendar)
        .values({ userId: user.id, refreshTokenEnc, connectedAt: new Date(clock()) })
        .onConflictDoUpdate({
          target: outlookCalendar.userId,
          set: { refreshTokenEnc, revokedAt: null, connectedAt: new Date(clock()) },
        });
      await syncCalendarImport(db, user, 'outlook', importDeps, clock());
      return back('connected');
    } catch (err) {
      req.log.error(err);
      return back('failed');
    }
  });
  app.post('/api/calendar/outlook/sync', async (req) => {
    if (!opts.outlook) throw badRequest('Outlook Calendar is not configured on this server');
    return syncCalendarImport(db, req.user, 'outlook', importDeps, clock());
  });
  app.delete('/api/calendar/outlook', async (req, reply) => {
    await db.delete(outlookCalendar).where(eq(outlookCalendar.userId, req.user.id));
    return reply.code(204).send();
  });
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
      await syncCalendarImport(db, user, 'google', importDeps, clock());
      return back('connected');
    } catch (err) {
      req.log.error(err);
      return back('failed');
    }
  });

  app.post('/api/calendar/google/sync', async (req) => {
    if (!opts.deps) throw badRequest('Google Calendar is not configured on this server');
    const result = await syncGoogle(db, opts.deps, req.user, clock());
    const academic =
      result.status === 'ok'
        ? await syncCalendarImport(db, req.user, 'google', importDeps, clock())
        : null;
    return { ...result, academic };
  });

  app.delete('/api/calendar/google', async (req, reply) => {
    await disconnect(db, req.user.id);
    return reply.code(204).send();
  });

  /** Busy intervals from the primary calendar, for the scheduler. */
  app.get('/api/calendar/busy', async (req) => {
    const q = z.object({ from: isoDateTime, to: isoDateTime }).parse(req.query);
    const [google, outlook] = await Promise.all([
      busyTimes(db, opts.deps, req.user.id, q.from, q.to),
      outlookBusy(db, req.user.id, q.from, q.to),
    ]);
    return { busy: [...google, ...outlook] };
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
    reply.header('content-disposition', 'attachment; filename="komodon.ics"');
    return buildIcs({
      blocks,
      nodes,
      sessions,
      routines,
      now: clock(),
      timezone: req.user.timezone,
    });
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
    return buildIcs({
      blocks,
      nodes,
      sessions,
      routines,
      now: clock(),
      timezone: user.timezone,
    });
  });
}
