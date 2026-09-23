import type { FastifyInstance } from 'fastify';
import {
  buildInsights,
  courseAnalytics,
  estimateAccuracy,
  getHighlights,
  lifetimeStats,
  nodeAnalytics,
  pendingFollowUps,
  startOfWeekMonday,
  studyHeatmap,
  timeOfDayProfile,
  toLocalDate,
  weekdayProfile,
  weeklyReview,
} from '@komodoit/core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { nodes, streakEvents, weeklyReviews } from '../db/schema';
import { getNodeRow, listNodes } from '../services/nodes';
import { loadCompletedSessions, paceContext } from '../services/pace';
import { listBlocks } from '../services/planned-blocks';
import { dt, toNode } from '../services/sessions-mapper';
import { getPolicy, settingsOf, syncStreak } from '../services/users';
import { isoDate, uuid } from '../validation';

const weekQuery = z.object({ weekStart: isoDate.optional() });

export function analyticsRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  const week = (q: { weekStart?: string }, tz: string, now: string) =>
    q.weekStart ?? startOfWeekMonday(toLocalDate(now, tz));

  async function load(userId: string, user: Parameters<typeof paceContext>[1], now: string) {
    const [n, s, b, ctx] = await Promise.all([
      listNodes(db, userId),
      loadCompletedSessions(db, userId),
      listBlocks(db, userId),
      paceContext(db, user, now),
    ]);
    return { nodes: n, sessions: s, plannedBlocks: b, ctx };
  }

  /** Positive-only highlights for the week (spec §11a). */
  app.get('/api/analytics/week', async (req) => {
    const now = clock();
    const q = weekQuery.parse(req.query);
    const weekStart = week(q, req.user.timezone, now);
    const streak = await syncStreak(db, req.user, now);
    const data = await load(req.user.id, req.user, now);
    const settings = settingsOf(req.user);
    return getHighlights({
      nodes: data.nodes,
      sessions: data.sessions,
      plannedBlocks: data.plannedBlocks,
      streak: streak.streak,
      timezone: req.user.timezone,
      policy: data.ctx.policy,
      maxComfortableMinutesPerDay: settings.pace.maxComfortableMinutesPerDay,
      now,
      weekStart,
    });
  });

  /**
   * Long-range view: lifetime totals, the contribution grid, when the user actually works,
   * and the explained insights derived from all three.
   */
  app.get('/api/analytics/overview', async (req) => {
    const now = clock();
    const { weeks } = z
      .object({ weeks: z.coerce.number().int().min(4).max(106).optional() })
      .parse(req.query);
    const sessions = await loadCompletedSessions(db, req.user.id);
    const tz = req.user.timezone;
    const lifetime = lifetimeStats({
      sessions,
      timezone: tz,
      now,
      joinedAt: req.user.createdAt.toISOString(),
    });
    const heatmap = studyHeatmap({ sessions, timezone: tz, now, weeks: weeks ?? 53 });
    const timeOfDay = timeOfDayProfile(sessions, tz);
    const weekday = weekdayProfile(sessions, tz);
    return {
      lifetime,
      heatmap,
      timeOfDay,
      weekday,
      insights: buildInsights({ lifetime, heatmap, timeOfDay, weekday, sessions, timezone: tz }),
    };
  });

  /** Everything, shown neutrally (spec §11b). */
  app.get('/api/analytics/advanced', async (req) => {
    const now = clock();
    const q = weekQuery.parse(req.query);
    const weekStart = week(q, req.user.timezone, now);
    const data = await load(req.user.id, req.user, now);
    const perNode = data.nodes
      .filter((n) => n.kind !== 'course')
      .map((n) => nodeAnalytics(data, n.id))
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return {
      weekStart,
      nodes: perNode,
      courses: courseAnalytics(data, weekStart),
      estimateAccuracy: estimateAccuracy(data),
    };
  });

  app.get('/api/analytics/weekly-review', async (req) => {
    const now = clock();
    const q = weekQuery.parse(req.query);
    const weekStart = week(q, req.user.timezone, now);
    const streak = await syncStreak(db, req.user, now);
    const data = await load(req.user.id, req.user, now);
    const [events, note] = await Promise.all([
      db.query.streakEvents.findMany({
        where: and(eq(streakEvents.userId, req.user.id), eq(streakEvents.type, 'freeze-used')),
      }),
      db.query.weeklyReviews.findFirst({
        where: and(eq(weeklyReviews.userId, req.user.id), eq(weeklyReviews.weekStart, weekStart)),
      }),
    ]);
    const review = weeklyReview({
      ...data,
      weekStart,
      streak: streak.streak,
      freezeDates: events.map((e) => e.date),
      policy: await getPolicy(db, req.user.id),
    });
    return { review, note: note?.note ?? null };
  });

  app.put('/api/analytics/weekly-review/:weekStart', async (req) => {
    const { weekStart } = z.object({ weekStart: isoDate }).parse(req.params);
    const { note } = z.object({ note: z.string().max(4000) }).parse(req.body);
    const now = clock();
    await db
      .insert(weeklyReviews)
      .values({ userId: req.user.id, weekStart, note, updatedAt: dt(now) })
      .onConflictDoUpdate({
        target: [weeklyReviews.userId, weeklyReviews.weekStart],
        set: { note, updatedAt: dt(now) },
      });
    return { weekStart, note };
  });

  /** Assessments to ask "How did it go?" about, once, a day after their due date. */
  app.get('/api/follow-ups', async (req) => {
    const now = clock();
    const rows = await db.query.nodes.findMany({
      where: and(eq(nodes.userId, req.user.id), eq(nodes.archived, false)),
    });
    const never = rows.filter((r) => r.outcomeAskedAt === null).map(toNode);
    return { followUps: pendingFollowUps(never, now, req.user.timezone) };
  });

  /** Dismiss the follow-up without rating; it is never asked again. */
  app.post('/api/nodes/:id/outcome-dismiss', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await getNodeRow(db, req.user.id, id);
    await db
      .update(nodes)
      .set({ outcomeAskedAt: dt(clock()) })
      .where(eq(nodes.id, id));
    return { ok: true };
  });
}
