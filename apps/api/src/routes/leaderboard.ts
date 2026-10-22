import type { FastifyInstance } from 'fastify';
import { addDays, startOfWeekMonday, toLocalDate } from '@komogon/core';
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { sessions, userAssets, users } from '../db/schema';
import { inWorldOf } from '../services/dev-accounts';
import { compareRow } from './compare';
import { loadCompletedSessions } from '../services/pace';
import { friendIds } from './social';

/** Under this much in a week, a person is left out of the week's average. */
export const STATS_MIN_WEEK_MINUTES = 15;

/** How the person asking stands beside everyone on the global board. */
export interface GlobalStats {
  /**
   * This week's average among people with at least 15 minutes in it; when that is no one
   * but you, last week's average instead (`which` says). Null when there is no one at all.
   */
  week: {
    which: 'this' | 'last';
    weekStart: string;
    you: number;
    average: number;
    /** How many people the average is over. */
    people: number;
    /** The share of those people you are ahead of, 0..1. */
    aheadOf: number;
  } | null;
  /** Days with a session in the same week, yours and the average. */
  days: { you: number; average: number } | null;
  /** Minutes per session over the last 28 days. */
  sessionLength: { you: number; average: number } | null;
  /** Current streaks, yours and the average of everyone with one running. */
  streak: { you: number; average: number } | null;
  /** Your place by all-time focused time among everyone on the board. */
  rank: { position: number; of: number } | null;
}

/** How many people the leaderboard shows. */
export const LEADERBOARD_SIZE = 10;

export type LeaderboardScope = 'global' | 'friends';

export interface LeaderboardEntry {
  rank: number;
  /** Opens their profile. */
  userId: string;
  /** The name they chose (Settings › profile); never their email. */
  name: string;
  /** Their picture, for the board; null for the initial. */
  avatarUrl: string | null;
  focusMinutes: number;
  /** This row is the person asking. */
  you: boolean;
  friend: boolean;
  /** Minutes per week over the last eight, oldest first, in the viewer's weeks. */
  weekly: number[];
  thisWeek: number;
  streak: number;
  /** Days with a session in the last 28. */
  activeDays28: number;
}

/**
 * The people with the most focused time across all finished sessions: everyone who joined
 * the global board, or just you and your friends. Only the chosen name, picture and the
 * total are shared; someone who hasn't chosen a name shows as "Someone". Settings › Social
 * decides who is on which board: 'global' is both, 'friends' only the friends board, 'off'
 * neither (older rows hold true or false, which read as 'global' and 'off'). Test accounts
 * are never on it; admins are, like anyone else (the owner asked to be on it).
 */
export function leaderboardRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string = () => new Date().toISOString(),
) {
  app.get('/api/leaderboard', async (req) => {
    const { scope } = z
      .object({ scope: z.enum(['global', 'friends']).default('global') })
      .parse(req.query);
    const friends = await friendIds(db, req.user.id);
    const joined = sql`coalesce(${users.settings} -> 'social' ->> 'leaderboard', 'global')`;
    const focusSeconds = sql<number>`sum(${sessions.workSeconds})::int`;
    const rows = await db
      .select({
        userId: sessions.userId,
        name: sql<string | null>`${users.settings} -> 'profile' ->> 'name'`,
        mime: userAssets.mime,
        data: userAssets.data,
        focusSeconds,
      })
      .from(sessions)
      .innerJoin(users, sql`${users.id} = ${sessions.userId}`)
      .leftJoin(
        userAssets,
        and(eq(userAssets.userId, sessions.userId), eq(userAssets.kind, 'avatar')),
      )
      .where(
        and(
          isNotNull(sessions.endedAt),
          eq(users.isTestAccount, false),
          inWorldOf(req.user),
          isNull(users.bannedAt),
          ...(scope === 'friends'
            ? [
                inArray(sessions.userId, [req.user.id, ...friends]),
                sql`${joined} in ('global', 'friends', 'true')`,
              ]
            : [sql`${joined} in ('global', 'true')`]),
        ),
      )
      .groupBy(sessions.userId, users.settings, userAssets.mime, userAssets.data)
      .having(sql`sum(${sessions.workSeconds}) > 0`)
      .orderBy(desc(focusSeconds))
      .limit(LEADERBOARD_SIZE);
    const friendSet = new Set(friends);
    const now = clock();
    const streaks = new Map(
      (
        await db.query.users.findMany({
          where: inArray(
            users.id,
            rows.map((r) => r.userId),
          ),
          columns: { id: true, streak: true },
        })
      ).map((u) => [u.id, u.streak.current]),
    );
    const entries: LeaderboardEntry[] = await Promise.all(
      rows.map(async (r, i) => {
        const week = compareRow(
          r.userId,
          await loadCompletedSessions(db, r.userId),
          streaks.get(r.userId) ?? 0,
          now,
          req.user.timezone,
        );
        return {
          rank: i + 1,
          userId: r.userId,
          name: r.name?.trim() || 'Someone',
          avatarUrl: r.mime && r.data ? `data:${r.mime};base64,${r.data}` : null,
          focusMinutes: Math.round(Number(r.focusSeconds) / 60),
          you: r.userId === req.user.id,
          friend: friendSet.has(r.userId),
          weekly: week.weekly,
          thisWeek: week.thisWeek,
          streak: week.streak,
          activeDays28: week.activeDays28,
        };
      }),
    );
    return { scope, entries };
  });

  /**
   * You beside everyone on the global board: this week against the average (people under
   * 15 minutes left out; last week's average when this week has no one else yet), days
   * showing up, how long sessions run, streaks, and your all-time place.
   */
  app.get('/api/leaderboard/stats', async (req) => {
    const me = req.user;
    const tz = me.timezone;
    const now = new Date(clock());
    const today = toLocalDate(now, tz);
    const thisStart = startOfWeekMonday(today);
    const lastStart = addDays(thisStart, -7);
    const from28 = addDays(today, -27);
    const onBoard = and(
      eq(users.isTestAccount, false),
      inWorldOf(me),
      isNull(users.bannedAt),
      sql`coalesce(${users.settings} -> 'social' ->> 'leaderboard', 'global') in ('global', 'true')`,
    );
    // Everyone on the board, with their streak; then every finished session of theirs from
    // the last five weeks (enough for last week and the 28 days), bucketed in your weeks.
    const people = await db
      .select({ id: users.id, streak: users.streak })
      .from(users)
      .where(onBoard);
    // Those who left the board are still counted for your rank only if they are on it: no.
    const ids = people.map((p) => p.id);
    if (!ids.includes(me.id)) ids.push(me.id);
    const since = new Date(now.getTime() - 36 * 86_400_000);
    const recent = await db
      .select({
        userId: sessions.userId,
        startedAt: sessions.startedAt,
        workSeconds: sessions.workSeconds,
      })
      .from(sessions)
      .where(
        and(
          inArray(sessions.userId, ids),
          isNotNull(sessions.endedAt),
          gte(sessions.startedAt, since),
        ),
      );
    type Week = { minutes: number; days: Set<string> };
    const weeks = new Map<string, { thisWeek: Week; lastWeek: Week }>();
    const last28 = new Map<string, { minutes: number; count: number }>();
    const week = () => ({ minutes: 0, days: new Set<string>() });
    for (const s of recent) {
      const d = toLocalDate(s.startedAt, tz);
      const entry = weeks.get(s.userId) ?? { thisWeek: week(), lastWeek: week() };
      const bucket = d >= thisStart ? entry.thisWeek : d >= lastStart ? entry.lastWeek : null;
      if (bucket) {
        bucket.minutes += s.workSeconds / 60;
        bucket.days.add(d);
      }
      weeks.set(s.userId, entry);
      if (d >= from28) {
        const l = last28.get(s.userId) ?? { minutes: 0, count: 0 };
        l.minutes += s.workSeconds / 60;
        l.count += 1;
        last28.set(s.userId, l);
      }
    }
    const mine = weeks.get(me.id) ?? { thisWeek: week(), lastWeek: week() };
    const cohort = (pick: (w: { thisWeek: Week; lastWeek: Week }) => Week) =>
      people
        .filter((p) => p.id !== me.id)
        .map((p) => ({
          id: p.id,
          w: pick(weeks.get(p.id) ?? { thisWeek: week(), lastWeek: week() }),
        }))
        .filter(({ w }) => w.minutes >= STATS_MIN_WEEK_MINUTES);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    let which: 'this' | 'last' = 'this';
    let picked = cohort((w) => w.thisWeek);
    let you = mine.thisWeek;
    let weekStart = thisStart;
    if (picked.length === 0) {
      which = 'last';
      picked = cohort((w) => w.lastWeek);
      you = mine.lastWeek;
      weekStart = lastStart;
    }
    const others = picked.map(({ w }) => w);
    const counted = new Set(picked.map(({ id }) => id));
    const stats: GlobalStats = {
      week:
        others.length === 0
          ? null
          : {
              which,
              weekStart,
              you: Math.round(you.minutes),
              average: Math.round(avg(others.map((w) => w.minutes))),
              people: others.length,
              aheadOf: others.filter((w) => w.minutes < you.minutes).length / others.length,
            },
      days:
        others.length === 0
          ? null
          : {
              you: you.days.size,
              average: Math.round(avg(others.map((w) => w.days.size)) * 10) / 10,
            },
      sessionLength: (() => {
        const lengths = people
          .filter((p) => counted.has(p.id))
          .map((p) => last28.get(p.id))
          .filter((l): l is { minutes: number; count: number } => !!l && l.count > 0)
          .map((l) => l.minutes / l.count);
        const yours = last28.get(me.id);
        if (lengths.length === 0 || !yours || yours.count === 0) return null;
        return { you: Math.round(yours.minutes / yours.count), average: Math.round(avg(lengths)) };
      })(),
      streak: (() => {
        const running = people
          .filter((p) => counted.has(p.id))
          .map((p) => p.streak.current)
          .filter((n) => n > 0);
        if (running.length === 0) return null;
        return { you: me.streak.current, average: Math.round(avg(running) * 10) / 10 };
      })(),
      rank: null,
    };
    // All-time place among everyone on the board, by focused time.
    const totals = await db
      .select({ userId: sessions.userId, seconds: sql<number>`sum(${sessions.workSeconds})::int` })
      .from(sessions)
      .where(and(inArray(sessions.userId, ids), isNotNull(sessions.endedAt)))
      .groupBy(sessions.userId)
      .having(sql`sum(${sessions.workSeconds}) > 0`);
    const yourTotal = totals.find((t) => t.userId === me.id);
    if (yourTotal && totals.length > 1) {
      const above = totals.filter((t) => Number(t.seconds) > Number(yourTotal.seconds)).length;
      stats.rank = { position: above + 1, of: totals.length };
    }
    return stats;
  });
}
