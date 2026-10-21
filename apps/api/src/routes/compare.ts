import type { FastifyInstance } from 'fastify';
import { addDays, startOfWeekMonday, toLocalDate, type Session } from '@komogon/core';
import { inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { loadCompletedSessions } from '../services/pace';
import { loadPeople } from '../services/people';
import { friendIds } from './social';

/** The weeks the comparison looks back over, this week included. */
export const COMPARE_WEEKS = 8;

export interface CompareRow {
  userId: string;
  thisWeek: number;
  lastWeek: number;
  last28: number;
  activeDays28: number;
  sessionsThisWeek: number;
  longest28: number;
  streak: number;
  /** Minutes per week, oldest first, ending with this week. */
  weekly: number[];
}

/** Minutes of focus per local day, for a run of finished sessions. */
function minutesByDay(done: Session[], tz: string): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const s of done) {
    const d = toLocalDate(s.startedAt, tz);
    byDay.set(d, (byDay.get(d) ?? 0) + s.workSeconds / 60);
  }
  return byDay;
}

/** One person's numbers for the comparison, all in the viewer's weeks. */
export function compareRow(
  userId: string,
  done: Session[],
  streak: number,
  now: string,
  tz: string,
): CompareRow {
  const today = toLocalDate(now, tz);
  const weekStart = startOfWeekMonday(today);
  const byDay = minutesByDay(done, tz);
  const inRange = (from: string, to: string) => {
    let total = 0;
    for (const [d, m] of byDay) if (d >= from && d <= to) total += m;
    return total;
  };
  const weekly: number[] = [];
  for (let i = COMPARE_WEEKS - 1; i >= 0; i--) {
    const from = addDays(weekStart, -7 * i);
    weekly.push(Math.round(inRange(from, addDays(from, 6))));
  }
  const from28 = addDays(today, -27);
  let activeDays28 = 0;
  for (const [d, m] of byDay) if (d >= from28 && d <= today && m > 0) activeDays28++;
  let sessionsThisWeek = 0;
  let longest28 = 0;
  for (const s of done) {
    const d = toLocalDate(s.startedAt, tz);
    if (d >= weekStart && d <= today) sessionsThisWeek++;
    if (d >= from28 && d <= today) longest28 = Math.max(longest28, s.workSeconds / 60);
  }
  return {
    userId,
    thisWeek: weekly[weekly.length - 1] ?? 0,
    lastWeek: weekly[weekly.length - 2] ?? 0,
    last28: Math.round(inRange(from28, today)),
    activeDays28,
    sessionsThisWeek,
    longest28: Math.round(longest28),
    streak,
    weekly,
  };
}

/**
 * Your weeks beside your friends': this week, the last 28 days, streaks and eight weeks of
 * totals, all in your timezone and Monday weeks. Friendship is the consent: both said yes.
 */
export function compareRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  app.get('/api/social/compare', async (req) => {
    const me = req.user;
    const now = clock();
    const tz = me.timezone;
    const ids = await friendIds(db, me.id);
    const rows = await db.query.users.findMany({
      where: inArray(users.id, [me.id, ...ids]),
      columns: { id: true, streak: true },
    });
    const streaks = new Map(rows.map((r) => [r.id, r.streak.current]));
    const compute = async (id: string) =>
      compareRow(id, await loadCompletedSessions(db, id), streaks.get(id) ?? 0, now, tz);
    const [you, ...friends] = await Promise.all([me.id, ...ids].map(compute));
    const people = await loadPeople(db, [me.id, ...ids]);
    const today = toLocalDate(now, tz);
    const weekStart = startOfWeekMonday(today);
    const weekStarts: string[] = [];
    for (let i = COMPARE_WEEKS - 1; i >= 0; i--) weekStarts.push(addDays(weekStart, -7 * i));
    return { you, friends, people, weekStarts };
  });
}
