import type { FastifyInstance } from 'fastify';
import {
  lifetimeStats,
  studyHeatmap,
  universityById,
  weekdayProfile,
  weekStreakNumbers,
  type Heatmap,
  type RhythmProfile,
} from '@komogon/core';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { posts, userAssets, users } from '../db/schema';
import { notFound } from '../errors';
import { loadCompletedSessions } from '../services/pace';
import { dt } from '../services/sessions-mapper';
import { settingsOf } from '../services/users';
import { uuid } from '../validation';

/** How many weeks of squares a profile shows. */
export const PROFILE_HEATMAP_WEEKS = 26;
/** The newest posts a profile returns. */
export const PROFILE_POSTS_LIMIT = 50;
export const POST_MAX_LENGTH = 500;

export interface PublicProfile {
  id: string;
  /** The chosen name, or "Someone"; never an email. */
  name: string;
  university: { id: string; name: string; short?: string } | null;
  bio: string | null;
  /** The profile picture as a data URL, or null for the initial. */
  avatarUrl: string | null;
  joinedAt: string;
  /** This is the person asking. */
  you: boolean;
}

export interface ProfileStats {
  totalMinutes: number;
  totalSessions: number;
  /** Distinct days with a session, since joining. */
  activeDays: number;
  avgMinutesPerActiveDay: number;
  longestSessionMinutes: number;
  bestDay: { date: string; minutes: number } | null;
  last28Minutes: number;
  streak: { current: number; longest: number; weeks: { current: number; longest: number } };
  level: number;
}

export interface Post {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
}

export interface ProfileResponse {
  profile: PublicProfile;
  stats: ProfileStats;
  heatmap: Heatmap;
  weekday: RhythmProfile;
  posts: Post[];
}

const toPost = (r: typeof posts.$inferSelect): Post => ({
  id: r.id,
  userId: r.userId,
  body: r.body,
  createdAt: r.createdAt.toISOString(),
});

/**
 * Profiles: the public face of an account. Anyone signed in can open anyone's, so only what
 * a person chose to share is here (name, university, bio, picture) plus study totals and
 * posts. The email, settings and tasks never leave the account.
 */
export function profileRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  const idParam = z.object({ id: z.union([z.literal('me'), uuid]) });

  app.get('/api/profiles/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const userId = id === 'me' ? req.user.id : id;
    const row =
      userId === req.user.id
        ? req.user
        : await db.query.users.findFirst({ where: eq(users.id, userId) });
    // An account that never finished onboarding has nothing to show, and no name to show it under.
    if (!row || row.onboardedAt === null) throw notFound('No such profile');
    const now = clock();
    const settings = settingsOf(row);
    const [sessions, avatar, postRows] = await Promise.all([
      loadCompletedSessions(db, row.id),
      db.query.userAssets.findFirst({
        where: and(eq(userAssets.userId, row.id), eq(userAssets.kind, 'avatar')),
      }),
      db.query.posts.findMany({
        where: eq(posts.userId, row.id),
        orderBy: [desc(posts.createdAt)],
        limit: PROFILE_POSTS_LIMIT,
      }),
    ]);
    const tz = row.timezone;
    const lifetime = lifetimeStats({
      sessions,
      timezone: tz,
      now,
      joinedAt: row.createdAt.toISOString(),
    });
    const uni = universityById(settings.profile.university);
    const response: ProfileResponse = {
      profile: {
        id: row.id,
        name: settings.profile.name?.trim() || 'Someone',
        university: uni ? { id: uni.id, name: uni.name, short: uni.short } : null,
        bio: settings.profile.bio?.trim() || null,
        avatarUrl: avatar ? `data:${avatar.mime};base64,${avatar.data}` : null,
        joinedAt: row.createdAt.toISOString(),
        you: row.id === req.user.id,
      },
      stats: {
        totalMinutes: lifetime.totalMinutes,
        totalSessions: lifetime.totalSessions,
        activeDays: lifetime.activeDays,
        avgMinutesPerActiveDay: lifetime.avgMinutesPerActiveDay,
        longestSessionMinutes: lifetime.longestSessionMinutes,
        bestDay: lifetime.bestDay,
        last28Minutes: lifetime.last28Minutes,
        streak: {
          current: row.streak.current,
          longest: row.streak.longest,
          weeks: weekStreakNumbers(row.streak),
        },
        level: row.level,
      },
      heatmap: studyHeatmap({ sessions, timezone: tz, now, weeks: PROFILE_HEATMAP_WEEKS }),
      weekday: weekdayProfile(sessions, tz),
      posts: postRows.map(toPost),
    };
    return response;
  });

  app.post('/api/profiles/me/posts', async (req, reply) => {
    const { body } = z
      .object({ body: z.string().trim().min(1).max(POST_MAX_LENGTH) })
      .parse(req.body);
    const [row] = await db
      .insert(posts)
      .values({ userId: req.user.id, body, createdAt: dt(clock()) })
      .returning();
    return reply.code(201).send({ post: toPost(row!) });
  });

  app.delete('/api/posts/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    // Only your own: a post that isn't yours reads as not there.
    const deleted = await db
      .delete(posts)
      .where(and(eq(posts.id, id), eq(posts.userId, req.user.id)))
      .returning({ id: posts.id });
    if (deleted.length === 0) throw notFound('No such post');
    return reply.code(204).send();
  });
}
