import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNotNull, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions, users } from '../db/schema';

/** How many people the leaderboard shows. */
export const LEADERBOARD_SIZE = 10;

export interface LeaderboardEntry {
  rank: number;
  /** The name they chose (Settings › profile); never their email. */
  name: string;
  focusMinutes: number;
  /** This row is the person asking. */
  you: boolean;
}

/**
 * The ten people with the most focused time across all finished sessions. Only the chosen
 * name and the total are shared; someone who hasn't chosen a name shows as "Someone".
 */
export function leaderboardRoutes(app: FastifyInstance, db: Db, admins: string[] = []) {
  app.get('/api/leaderboard', async (req) => {
    const focusSeconds = sql<number>`sum(${sessions.workSeconds})::int`;
    const rows = await db
      .select({
        userId: sessions.userId,
        name: sql<string | null>`${users.settings} -> 'profile' ->> 'name'`,
        focusSeconds,
      })
      .from(sessions)
      .innerJoin(users, sql`${users.id} = ${sessions.userId}`)
      .where(
        and(
          isNotNull(sessions.endedAt),
          eq(users.isTestAccount, false),
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
      .groupBy(sessions.userId, users.settings)
      .having(sql`sum(${sessions.workSeconds}) > 0`)
      .orderBy(desc(focusSeconds))
      .limit(LEADERBOARD_SIZE);
    const entries: LeaderboardEntry[] = rows.map((r, i) => ({
      rank: i + 1,
      name: r.name?.trim() || 'Someone',
      focusMinutes: Math.round(Number(r.focusSeconds) / 60),
      you: r.userId === req.user.id,
    }));
    return { entries };
  });
}
