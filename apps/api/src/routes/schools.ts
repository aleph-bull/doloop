import type { FastifyInstance } from 'fastify';
import {
  schoolDirectory,
  startOfWeekMonday,
  toLocalDate,
  universityById,
  zonedMidnightUtc,
} from '@komogon/core';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { posts, sessions, universityVerifications, users } from '../db/schema';
import { inWorldOf } from '../services/dev-accounts';
import { loadPeople } from '../services/people';
import { liveAmong } from './groups';
import { loadPosts } from './social';

/** Membership comes from email proof, never a writable profile label. */
export async function verifiedSchool(db: Db, userId: string) {
  const proof = await db.query.universityVerifications.findFirst({
    where: and(
      eq(universityVerifications.userId, userId),
      isNotNull(universityVerifications.verifiedAt),
    ),
  });
  return universityById(proof?.universityId);
}
export function schoolRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  app.get('/api/schools', async (req) => {
    const { q } = z.object({ q: z.string().trim().max(100).default('') }).parse(req.query);
    const term = q.toLocaleLowerCase();
    return {
      schools: schoolDirectory()
        .filter((s) =>
          `${s.name} ${s.short ?? ''} ${s.domains.join(' ')}`.toLocaleLowerCase().includes(term),
        )
        .slice(0, 30),
    };
  });
  app.get('/api/schools/community', async (req) => {
    const school = await verifiedSchool(db, req.user.id);
    if (!school) return { school: null, live: [], posts: [], people: {} };
    const classmates = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(universityVerifications, eq(universityVerifications.userId, users.id))
      .where(
        and(
          eq(universityVerifications.universityId, school.id),
          isNotNull(universityVerifications.verifiedAt),
          eq(users.isTestAccount, false),
          isNull(users.bannedAt),
          isNotNull(users.onboardedAt),
          inWorldOf(req.user),
          sql`${users.settings} -> 'social' ->> 'schoolActivity' = 'true'`,
        ),
      );
    const ids = classmates.map((c) => c.id);
    const live = (await liveAmong(db, ids, new Date(clock()))).slice(0, 50);
    const page = ids.length
      ? await loadPosts(
          db,
          req.user.id,
          and(
            inArray(posts.userId, ids),
            eq(posts.friendsOnly, false),
            sql`coalesce((select u.settings -> 'social' ->> 'posts' from users u where u.id = ${posts.userId}), 'everyone') = 'everyone'`,
          ),
          20,
        )
      : { posts: [], people: {} };
    const people = {
      ...page.people,
      ...(await loadPeople(
        db,
        live.map((l) => l.userId),
      )),
    };
    return { school, ...page, live, people };
  });
  app.get('/api/schools/leaderboard', async (req) => {
    const { period } = z
      .object({ period: z.enum(['week', 'all']).default('week') })
      .parse(req.query);
    const now = new Date(clock());
    const since = zonedMidnightUtc(
      startOfWeekMonday(toLocalDate(now, req.user.timezone)),
      req.user.timezone,
    );
    const rows = await db
      .select({
        schoolId: universityVerifications.universityId,
        seconds: sql<string>`sum(${sessions.workSeconds})::text`,
        members: sql<number>`count(distinct ${users.id})::int`,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(universityVerifications, eq(universityVerifications.userId, users.id))
      .where(
        and(
          isNotNull(universityVerifications.verifiedAt),
          isNotNull(sessions.endedAt),
          eq(sessions.counted, true),
          eq(users.isTestAccount, false),
          isNull(users.bannedAt),
          isNotNull(users.onboardedAt),
          inWorldOf(req.user),
          sql`coalesce(${users.settings} -> 'social' ->> 'leaderboard', 'global') in ('global', 'true')`,
          lte(sessions.startedAt, now),
          ...(period === 'week' ? [gte(sessions.startedAt, since)] : []),
        ),
      )
      .groupBy(universityVerifications.universityId)
      .having(sql`sum(${sessions.workSeconds}) > 0`)
      .orderBy(desc(sql`sum(${sessions.workSeconds})`), universityVerifications.universityId)
      .limit(100);
    const mine = await verifiedSchool(db, req.user.id);
    const entries = rows.flatMap((r) => {
      const school = universityById(r.schoolId);
      return school
        ? [
            {
              school,
              seconds: Number(r.seconds),
              focusMinutes: Math.round(Number(r.seconds) / 60),
              members: r.members,
              you: mine?.id === school.id,
            },
          ]
        : [];
    });
    return {
      period,
      school: mine,
      entries: entries.map((e) => ({
        ...e,
        rank: entries.findIndex((other) => other.seconds === e.seconds) + 1,
      })),
    };
  });
}
