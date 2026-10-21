import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNotNull, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions, userAssets, users } from '../db/schema';
import { friendIds } from './social';

/** How many people the leaderboard shows. */
export const LEADERBOARD_SIZE = 10;

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
}

/**
 * The ten people with the most focused time across all finished sessions. Only the chosen
 * name, picture and the total are shared; someone who hasn't chosen a name shows as "Someone".
 */
export function leaderboardRoutes(app: FastifyInstance, db: Db, admins: string[] = []) {
  app.get('/api/leaderboard', async (req) => {
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
          // Settings › Social › "Appear on the leaderboard", on unless turned off.
          sql`coalesce(${users.settings} -> 'social' ->> 'leaderboard', 'true') <> 'false'`,
          ...(admins.length
            ? [
                notInArray(
                  sql`lower(${users.email})`,
                  admins.map((email) => email.trim().toLowerCase()),
                ),
              ]
            : []),
        ),
      )
      .groupBy(sessions.userId, users.settings, userAssets.mime, userAssets.data)
      .having(sql`sum(${sessions.workSeconds}) > 0`)
      .orderBy(desc(focusSeconds))
      .limit(LEADERBOARD_SIZE);
    const friends = new Set(await friendIds(db, req.user.id));
    const entries: LeaderboardEntry[] = rows.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      name: r.name?.trim() || 'Someone',
      avatarUrl: r.mime && r.data ? `data:${r.mime};base64,${r.data}` : null,
      focusMinutes: Math.round(Number(r.focusSeconds) / 60),
      you: r.userId === req.user.id,
      friend: friends.has(r.userId),
    }));
    return { entries };
  });
}
