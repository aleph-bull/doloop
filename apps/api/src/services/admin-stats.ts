import { addDays, startOfWeekMonday, toLocalDate, zonedMidnightUtc } from '@komogon/core';
import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  friendships,
  postComments,
  postLikes,
  postMedia,
  posts,
  sessions,
  userActiveDays,
  userAssets,
  users,
} from '../db/schema';
import type { MediaLog, MediaStore } from './media-store';
import { BUCKET_MAX_BYTES, MEASURE_EVERY_MS } from './upload-quota';

/**
 * The figures on the admin page (2026-11-03): how many people use Komogon, how much they
 * study and post, and how much room their files take. Counts are over real accounts only:
 * "I'm a dev" accounts and local test accounts are left out, as on the accounts list.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Days in the activity chart and in an account's activity strip. */
export const ACTIVITY_DAYS = 30;
/** Weeks of focus on an account's activity. */
export const FOCUS_WEEKS = 8;

const real = sql`not ${users.devAccount} and not ${users.isTestAccount}`;

export interface AdminStats {
  accounts: { total: number; newThisWeek: number; onboarded: number };
  /** People who used the app within each window, by their last request. */
  active: { now: number; day: number; week: number; month: number };
  /** People who used the app each day of the last 30, oldest first, by their own calendars. */
  daily: { day: string; people: number }[];
  study: { sessions: number; focusMinutes: number; focusMinutesWeek: number };
  social: { posts: number; comments: number; kudos: number; postBans: number };
  storage: {
    /** Files in the R2 bucket, measured there or, when it won't say, counted from posts. */
    cloud: { bytes: number; maxBytes: number; measured: boolean } | null;
    /** The whole Postgres database, when the server says. */
    databaseBytes: number | null;
    /** Post files kept in the database as base64 (before R2, or without it). */
    mediaInDatabaseBytes: number;
  };
}

/** Bytes of post files each account keeps in R2 and in the database. */
async function mediaBytesByUser(db: Db, userIds?: string[]) {
  const rows = await db
    .select({
      userId: posts.userId,
      cloud: sql<number>`coalesce(sum(${postMedia.bytes}) filter (where ${postMedia.key} is not null), 0)::bigint`,
      inline: sql<number>`coalesce(sum(${postMedia.bytes}) filter (where ${postMedia.data} is not null), 0)::bigint`,
    })
    .from(postMedia)
    .innerJoin(posts, eq(posts.id, postMedia.postId))
    .where(userIds ? inArray(posts.userId, userIds) : undefined)
    .groupBy(posts.userId);
  return new Map(
    rows.map((r) => [r.userId, { cloud: Number(r.cloud), inline: Number(r.inline) }]),
  );
}

/** Figures for the accounts list: files kept, posts made. */
export async function accountExtras(db: Db) {
  const [media, postCounts, assets] = await Promise.all([
    mediaBytesByUser(db),
    db
      .select({ userId: posts.userId, n: sql<number>`count(*)::int` })
      .from(posts)
      .groupBy(posts.userId),
    db
      .select({ userId: userAssets.userId, bytes: sql<number>`sum(${userAssets.bytes})::bigint` })
      .from(userAssets)
      .groupBy(userAssets.userId),
  ]);
  const postsOf = new Map(postCounts.map((p) => [p.userId, Number(p.n)]));
  const assetsOf = new Map(assets.map((a) => [a.userId, Number(a.bytes)]));
  return (userId: string) => {
    const m = media.get(userId);
    return {
      posts: postsOf.get(userId) ?? 0,
      storageBytes: (m?.cloud ?? 0) + (m?.inline ?? 0) + (assetsOf.get(userId) ?? 0),
    };
  };
}

/**
 * The size of the R2 bucket, asked of R2 at most every ten minutes (listing it is slow and
 * costs a request a thousand files). When R2 won't answer, the posts' own record of their
 * files stands in.
 */
export function cloudMeter(db: Db, store: MediaStore | null) {
  let last: { bytes: number; at: number } | null = null;
  return async (now: number, log: MediaLog) => {
    if (!store) return null;
    if (last && now - last.at < MEASURE_EVERY_MS)
      return { bytes: last.bytes, maxBytes: BUCKET_MAX_BYTES, measured: true };
    try {
      const bytes = await store.usage();
      last = { bytes, at: now };
      return { bytes, maxBytes: BUCKET_MAX_BYTES, measured: true };
    } catch (err) {
      log.warn({ err }, 'Could not measure the R2 bucket for the admin page');
      const [row] = await db
        .select({ bytes: sql<number>`coalesce(sum(${postMedia.bytes}), 0)::bigint` })
        .from(postMedia)
        .where(isNotNull(postMedia.key));
      return { bytes: Number(row?.bytes ?? 0), maxBytes: BUCKET_MAX_BYTES, measured: false };
    }
  };
}

export async function adminStats(
  db: Db,
  opts: {
    now: string;
    /** The admin's own time zone, which sets where the chart's days end. */
    timezone: string;
    cloud: AdminStats['storage']['cloud'];
  },
): Promise<AdminStats> {
  const now = Date.parse(opts.now);
  const since = (ms: number) => new Date(now - ms);
  const today = toLocalDate(opts.now, opts.timezone);
  const first = addDays(today, -(ACTIVITY_DAYS - 1));

  const [people, daily, study, social, database, inline] = await Promise.all([
    db
      .select({
        createdAt: users.createdAt,
        onboardedAt: users.onboardedAt,
        lastActiveAt: users.lastActiveAt,
        socialBannedAt: users.socialBannedAt,
      })
      .from(users)
      .where(real),
    db
      .select({ day: userActiveDays.day, people: sql<number>`count(*)::int` })
      .from(userActiveDays)
      .innerJoin(users, eq(users.id, userActiveDays.userId))
      .where(and(gte(userActiveDays.day, first), real))
      .groupBy(userActiveDays.day),
    db
      .select({
        sessions: sql<number>`count(*)::int`,
        focus: sql<number>`coalesce(sum(${sessions.workSeconds}), 0)::bigint`,
        // An ISO string, never a Date, inside a hand-written template (postgres.js on Neon).
        week: sql<number>`coalesce(sum(${sessions.workSeconds}) filter (where ${sessions.startedAt} >= ${since(7 * DAY).toISOString()}), 0)::bigint`,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(isNotNull(sessions.endedAt), eq(sessions.counted, true), real)),
    Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.userId))
        .where(real),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(postComments)
        .innerJoin(users, eq(users.id, postComments.userId))
        .where(real),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(postLikes)
        .innerJoin(users, eq(users.id, postLikes.userId))
        .where(real),
    ]),
    db
      .execute(sql`select pg_database_size(current_database()) as bytes`)
      .then((r) => Number(rowsOf<{ bytes: string | number }>(r)[0]?.bytes ?? NaN))
      .catch(() => NaN),
    db
      .select({ bytes: sql<number>`coalesce(sum(${postMedia.bytes}), 0)::bigint` })
      .from(postMedia)
      .where(isNotNull(postMedia.data)),
  ]);

  const within = (at: Date | null, ms: number) => at !== null && at.getTime() > now - ms;
  const byDay = new Map(daily.map((d) => [d.day, Number(d.people)]));
  const [postCount, commentCount, kudosCount] = social;
  return {
    accounts: {
      total: people.length,
      newThisWeek: people.filter((p) => within(p.createdAt, 7 * DAY)).length,
      onboarded: people.filter((p) => p.onboardedAt !== null).length,
    },
    active: {
      now: people.filter((p) => within(p.lastActiveAt, 5 * MINUTE)).length,
      day: people.filter((p) => within(p.lastActiveAt, DAY)).length,
      week: people.filter((p) => within(p.lastActiveAt, 7 * DAY)).length,
      month: people.filter((p) => within(p.lastActiveAt, 30 * DAY)).length,
    },
    daily: Array.from({ length: ACTIVITY_DAYS }, (_, i) => {
      const day = addDays(first, i);
      return { day, people: byDay.get(day) ?? 0 };
    }),
    study: {
      sessions: Number(study[0]?.sessions ?? 0),
      focusMinutes: Math.round(Number(study[0]?.focus ?? 0) / 60),
      focusMinutesWeek: Math.round(Number(study[0]?.week ?? 0) / 60),
    },
    social: {
      posts: Number(postCount[0]?.n ?? 0),
      comments: Number(commentCount[0]?.n ?? 0),
      kudos: Number(kudosCount[0]?.n ?? 0),
      postBans: people.filter((p) => p.socialBannedAt !== null).length,
    },
    storage: {
      cloud: opts.cloud,
      databaseBytes: Number.isFinite(database) ? database : null,
      mediaInDatabaseBytes: Number(inline[0]?.bytes ?? 0),
    },
  };
}

/** PGlite answers `{ rows }`, postgres.js an array of rows. */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

export interface AccountActivity {
  lastActiveAt: string | null;
  lastSessionAt: string | null;
  /** The days it was used in the last 30, by its own calendar, oldest first. */
  days: { day: string; active: boolean }[];
  /** Focused time in each of the last 8 Monday weeks, oldest first. */
  weeks: { week: string; focusMinutes: number }[];
  social: {
    posts: number;
    comments: number;
    kudosGiven: number;
    kudosReceived: number;
    friends: number;
  };
  storage: { cloudBytes: number; databaseBytes: number };
}

/** One account up close, for its Manage dialog. */
export async function accountActivity(
  db: Db,
  user: { id: string; timezone: string; lastActiveAt: Date | null },
  now: string,
): Promise<AccountActivity> {
  const tz = user.timezone;
  const today = toLocalDate(now, tz);
  const firstDay = addDays(today, -(ACTIVITY_DAYS - 1));
  const firstWeek = addDays(startOfWeekMonday(today), -7 * (FOCUS_WEEKS - 1));

  const [days, recent, last, counts, media, assets] = await Promise.all([
    db
      .select({ day: userActiveDays.day })
      .from(userActiveDays)
      .where(and(eq(userActiveDays.userId, user.id), gte(userActiveDays.day, firstDay))),
    db
      .select({ startedAt: sessions.startedAt, workSeconds: sessions.workSeconds })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, user.id),
          isNotNull(sessions.endedAt),
          eq(sessions.counted, true),
          gte(sessions.startedAt, zonedMidnightUtc(firstWeek, tz)),
        ),
      ),
    db
      .select({ endedAt: sessions.endedAt })
      .from(sessions)
      .where(and(eq(sessions.userId, user.id), isNotNull(sessions.endedAt)))
      .orderBy(sql`${sessions.endedAt} desc`)
      .limit(1),
    Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(posts)
        .where(eq(posts.userId, user.id)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(postComments)
        .where(eq(postComments.userId, user.id)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(postLikes)
        .where(eq(postLikes.userId, user.id)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(postLikes)
        .innerJoin(posts, eq(posts.id, postLikes.postId))
        .where(eq(posts.userId, user.id)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(friendships)
        .where(
          and(
            eq(friendships.status, 'accepted'),
            sql`(${friendships.requesterId} = ${user.id} or ${friendships.addresseeId} = ${user.id})`,
          ),
        ),
    ]),
    mediaBytesByUser(db, [user.id]),
    db
      .select({ bytes: sql<number>`coalesce(sum(${userAssets.bytes}), 0)::bigint` })
      .from(userAssets)
      .where(eq(userAssets.userId, user.id)),
  ]);

  const used = new Set(days.map((d) => d.day));
  const focus = new Map<string, number>();
  for (const s of recent) {
    const week = startOfWeekMonday(toLocalDate(s.startedAt, tz));
    focus.set(week, (focus.get(week) ?? 0) + s.workSeconds);
  }
  const [postN, commentN, givenN, receivedN, friendN] = counts.map((c) => Number(c[0]?.n ?? 0));
  const m = media.get(user.id);
  return {
    lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
    lastSessionAt: last[0]?.endedAt?.toISOString() ?? null,
    days: Array.from({ length: ACTIVITY_DAYS }, (_, i) => {
      const day = addDays(firstDay, i);
      return { day, active: used.has(day) };
    }),
    weeks: Array.from({ length: FOCUS_WEEKS }, (_, i) => {
      const week = addDays(firstWeek, 7 * i);
      return { week, focusMinutes: Math.round((focus.get(week) ?? 0) / 60) };
    }),
    social: {
      posts: postN!,
      comments: commentN!,
      kudosGiven: givenN!,
      kudosReceived: receivedN!,
      friends: friendN!,
    },
    storage: {
      cloudBytes: m?.cloud ?? 0,
      databaseBytes: (m?.inline ?? 0) + Number(assets[0]?.bytes ?? 0),
    },
  };
}
