import {
  addDays,
  DEFAULT_SETTINGS,
  describeStreakEvents,
  emptyStreak,
  evaluateStreak,
  evaluateWeekStreak,
  levelForXp,
  materializePendingRestDays,
  normalizeUsername,
  randomUsername,
  resolveAccent,
  resolveBackgroundId,
  startOfWeekMonday,
  streakDay,
  usernameError,
  usernameUnlocksAt,
  withDefaults,
  type RestDayPolicy,
  type Session,
  type StreakState,
  type User,
  type UserSettings,
} from '@komogon/core';
import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, gte, isNotNull, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { AuthUser } from '../auth/verify';
import type { Db } from '../db/client';
import {
  postMedia,
  posts,
  restDayPolicies,
  sessions,
  streakEvents,
  users,
  type RestDayPolicyRow,
  type UserRow,
} from '../db/schema';
import { badRequest, conflict, isUniqueViolation } from '../errors';
import type { SettingsPatch } from '../validation';
import { removeAll, type MediaLog, type MediaStore } from './media-store';
import { dt, toSession } from './sessions-mapper';

export function newIcsToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Find or create the user row for a verified auth identity. */
export async function ensureUser(
  db: Db,
  auth: AuthUser,
  timezone: string | null,
): Promise<UserRow> {
  const existing = await db.query.users.findFirst({ where: eq(users.id, auth.id) });
  if (existing) {
    if (auth.email && existing.email !== auth.email) {
      await db.update(users).set({ email: auth.email }).where(eq(users.id, auth.id));
      return { ...existing, email: auth.email };
    }
    return existing;
  }
  const [row] = await db
    .insert(users)
    .values({
      id: auth.id,
      email: auth.email ?? '',
      timezone: timezone ?? 'UTC',
      settings: {},
      streak: emptyStreak(),
      icsToken: newIcsToken(),
    })
    .onConflictDoNothing()
    .returning();
  if (row) {
    await db.insert(restDayPolicies).values({ userId: row.id }).onConflictDoNothing();
    return ensureUsername(db, row);
  }
  // Lost a race with a concurrent first request; read it back.
  return (await db.query.users.findFirst({ where: eq(users.id, auth.id) }))!;
}

export function settingsOf(row: UserRow): UserSettings {
  const settings = withDefaults(row.settings);
  // A background saved before the catalogue changed may no longer exist; read it as the
  // default rather than handing the client an id nothing can render or select.
  const backgroundId = resolveBackgroundId(settings.theme.backgroundId);
  // Likewise an accent preset that left the row (Indigo, 2026-10-20) reads as the default.
  const accent = resolveAccent(settings.theme.accent);
  if (backgroundId === settings.theme.backgroundId && accent === settings.theme.accent)
    return settings;
  return { ...settings, theme: { ...settings.theme, backgroundId, accent } };
}

export function toPolicy(row: RestDayPolicyRow | undefined, userId: string): RestDayPolicy {
  return {
    userId,
    weeklyRestDays: row?.weeklyRestDays ?? [],
    pendingWeeklyRestDays: row?.pendingWeeklyRestDays ?? null,
    vacations: row?.vacations ?? [],
    breakDays: row?.breakDays ?? [],
    changeLog: row?.changeLog ?? [],
  };
}

export async function getPolicy(db: Db, userId: string): Promise<RestDayPolicy> {
  const row = await db.query.restDayPolicies.findFirst({
    where: eq(restDayPolicies.userId, userId),
  });
  return toPolicy(row, userId);
}

export async function savePolicy(db: Db, policy: RestDayPolicy): Promise<void> {
  await db
    .insert(restDayPolicies)
    .values({
      userId: policy.userId,
      weeklyRestDays: policy.weeklyRestDays,
      pendingWeeklyRestDays: policy.pendingWeeklyRestDays,
      vacations: policy.vacations,
      breakDays: policy.breakDays,
      changeLog: policy.changeLog,
    })
    .onConflictDoUpdate({
      target: restDayPolicies.userId,
      set: {
        weeklyRestDays: policy.weeklyRestDays,
        pendingWeeklyRestDays: policy.pendingWeeklyRestDays,
        vacations: policy.vacations,
        breakDays: policy.breakDays,
        changeLog: policy.changeLog,
      },
    });
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    timezone: row.timezone,
    createdAt: row.createdAt.toISOString(),
    settings: settingsOf(row),
    xp: row.xp,
    xpEarned: row.xpEarned,
    level: row.level,
    streak: row.streak,
    devAccount: row.devAccount,
    username: row.username,
    usernameChangedAt: row.usernameChangedAt?.toISOString() ?? null,
  };
}

export interface StreakSync {
  streak: StreakState;
  message: string | null;
  milestonesReached: number[];
}

/**
 * Bring the daily and weekly streaks and the pending rest-day pattern up to date. Called on
 * every /me read and at session end. Persists only when something changed. Rest days are
 * the plan's; neither streak reads them.
 */
export async function syncStreak(db: Db, row: UserRow, now: string): Promise<StreakSync> {
  const settings = settingsOf(row);
  // The streak's own day, which can start a few hours after midnight.
  const dayStartHour = settings.streak.dayStartHour;
  const today = streakDay(now, row.timezone, dayStartHour);
  const policy = await getPolicy(db, row.id);
  const materialized = materializePendingRestDays(policy, today);
  if (materialized !== policy) await savePolicy(db, materialized);

  // Only completed sessions since the last judged day, and since the start of the first
  // unjudged week, matter. A streak saved before weekly streaks reads everything once.
  const weeks = row.streak.weeks;
  const fromWeek = weeks?.lastCountedWeek ? addDays(weeks.lastCountedWeek, 7) : null;
  const fromDay = row.streak.lastCountedDate;
  const from = fromDay && fromWeek ? (fromDay < fromWeek ? fromDay : fromWeek) : null;
  const since = from ? `${from}T00:00:00.000Z` : null;
  const rows = await db.query.sessions.findMany({
    where: since
      ? and(
          eq(sessions.userId, row.id),
          isNotNull(sessions.endedAt),
          eq(sessions.counted, true),
          gte(sessions.startedAt, new Date(Date.parse(since) - 2 * 86_400_000)),
        )
      : and(eq(sessions.userId, row.id), isNotNull(sessions.endedAt), eq(sessions.counted, true)),
  });
  const sess: Session[] = rows.map(toSession);

  const result = evaluateStreak({
    state: row.streak,
    sessions: sess,
    minMinutes: settings.streak.minMinutes,
    today,
    timezone: row.timezone,
    dayStartHour,
  });
  result.state.weeks = evaluateWeekStreak({
    state: weeks,
    sessions: sess,
    minMinutes: settings.streak.minMinutes,
    daysPerWeek: settings.streak.daysPerWeek,
    today,
    timezone: row.timezone,
    dayStartHour,
  });
  if (JSON.stringify(result.state) !== JSON.stringify(row.streak)) {
    await db.update(users).set({ streak: result.state }).where(eq(users.id, row.id));
    row.streak = result.state;
    const logged = result.events.filter((e) => e.type === 'freeze-used' || e.type === 'reset');
    if (logged.length) {
      await db
        .insert(streakEvents)
        .values(
          logged.map((e) => ({
            userId: row.id,
            date: e.date,
            type: e.type as 'freeze-used' | 'reset',
            at: dt(now),
          })),
        )
        .onConflictDoNothing();
    }
  }
  return {
    streak: result.state,
    message: describeStreakEvents(result.events),
    milestonesReached: result.milestonesReached,
  };
}

/**
 * Undo the streak's judging from `day` on, so the next sync judges those days again: for
 * when a session on that day stops counting, or counts again. Each finished session keeps
 * the streak as it stood before it ended (`streak_before`); the daily streak goes back to
 * the newest copy that hadn't judged `day` yet, the weekly one to the newest that hadn't
 * judged its week. Freezes spent on days since are handed back and their events dropped,
 * as the sync spends them again where they are still needed. Freezes and break days bought
 * since are kept. With no such copy (sessions from before 0036) that streak stays as it is.
 */
export async function rewindStreak(db: Db, row: UserRow, day: string): Promise<void> {
  const week = startOfWeekMonday(day);
  const newestBefore = async (judged: SQL) => {
    const [found] = await db
      .select({ streak: sessions.streakBefore })
      .from(sessions)
      .where(and(eq(sessions.userId, row.id), isNotNull(sessions.streakBefore), judged))
      .orderBy(desc(sessions.endedAt))
      .limit(1);
    return found?.streak ?? null;
  };
  const [daily, weekly] = await Promise.all([
    newestBefore(sql`coalesce(${sessions.streakBefore} ->> 'lastCountedDate', '') < ${day}`),
    newestBefore(
      sql`coalesce(${sessions.streakBefore} -> 'weeks' ->> 'lastCountedWeek', '') < ${week}`,
    ),
  ]);
  if (!daily && !weekly) return;
  const next: StreakState = { ...row.streak };
  if (daily) {
    const since = daily.lastCountedDate ?? '';
    const spent = await db
      .delete(streakEvents)
      .where(and(eq(streakEvents.userId, row.id), gt(streakEvents.date, since)))
      .returning({ type: streakEvents.type });
    next.current = daily.current;
    next.longest = daily.longest;
    next.lastCountedDate = daily.lastCountedDate;
    next.freezesHeld += spent.filter((e) => e.type === 'freeze-used').length;
  }
  if (weekly) next.weeks = weekly.weeks;
  await db.update(users).set({ streak: next }).where(eq(users.id, row.id));
  row.streak = next;
}

export async function updateSettings(db: Db, row: UserRow, patch: SettingsPatch): Promise<UserRow> {
  // The merge happens in the database, against the row as it is at that moment, so two
  // writes landing together (a bio saved on blur beside a university confirm, say) both
  // keep: each adds its own keys rather than writing back the copy it started with.
  let merged = sql`${users.settings}`;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const json = JSON.stringify(v);
    // A group of settings merges field by field, so a patch of one field leaves its
    // siblings alone. An array or a scalar replaces outright: merging an array into an
    // object would store {"0": "..."} instead of a list, and there is no sensible way to
    // "merge" two lists of dismissed prompts other than taking the newer one.
    merged =
      v && typeof v === 'object' && !Array.isArray(v)
        ? sql`${merged} || jsonb_build_object(${k}::text, coalesce(${users.settings} -> ${k}::text, '{}'::jsonb) || ${json}::jsonb)`
        : sql`${merged} || jsonb_build_object(${k}::text, ${json}::jsonb)`;
  }
  const [updated] = await db
    .update(users)
    .set({ settings: merged })
    .where(eq(users.id, row.id))
    .returning();
  return updated!;
}

export async function updateProfile(
  db: Db,
  row: UserRow,
  patch: { timezone?: string; onboarded?: boolean },
  now: string,
): Promise<UserRow> {
  const set: Partial<UserRow> = {};
  if (patch.timezone) set.timezone = patch.timezone;
  if (patch.onboarded && !row.onboardedAt) {
    set.onboardedAt = dt(now);
    // First sign-in goes straight to a timer. Only what the account hasn't chosen yet is
    // set, so one an admin sent through onboarding again keeps its own choices.
    const settings = settingsOf(row);
    const stored = row.settings;
    set.settings = {
      ...settings,
      dashboard: stored.dashboard ? settings.dashboard : { focusOnly: true },
      focusScreen: stored.focusScreen ? settings.focusScreen : { openOnStart: 'never' },
      timelapse:
        stored.timelapse?.record !== undefined
          ? settings.timelapse
          : { ...settings.timelapse, record: 'never' },
      visualizer:
        stored.visualizer?.promptDismissed !== undefined
          ? settings.visualizer
          : { ...settings.visualizer, promptDismissed: true },
    };
  }
  if (Object.keys(set).length === 0) return row;
  const [updated] = await db.update(users).set(set).where(eq(users.id, row.id)).returning();
  return updated!;
}

/**
 * Give someone without a username a random one, two words ("quiet.otter"). New accounts get
 * one as they are made (`ensureUser`), and migration 0033 gave every older account one;
 * /api/me calls this too, for any row that slipped through. It doesn't count as a change:
 * the first one the person makes is free.
 */
export async function ensureUsername(db: Db, row: UserRow): Promise<UserRow> {
  if (row.username) return row;
  for (let attempt = 0; attempt < 16; attempt++) {
    // About four thousand pairs; if they keep colliding, a third word follows.
    const name = randomUsername(Math.random, attempt >= 8);
    const taken = await db.query.users.findFirst({
      where: eq(users.username, name),
      columns: { id: true },
    });
    if (taken) continue;
    try {
      const [updated] = await db
        .update(users)
        .set({ username: name })
        .where(and(eq(users.id, row.id), isNull(users.username)))
        .returning({ username: users.username });
      if (updated) return { ...row, username: updated.username };
      // Another request picked one first.
      const current = await db.query.users.findFirst({
        where: eq(users.id, row.id),
        columns: { username: true },
      });
      return { ...row, username: current?.username ?? null };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  return row;
}

/**
 * Change someone's username. Unique across everyone, and once chosen it holds for
 * `USERNAME.LOCK_DAYS` days; the one we picked can be swapped straight away.
 */
export async function setUsername(
  db: Db,
  row: UserRow,
  raw: string,
  now: string,
): Promise<UserRow> {
  const error = usernameError(raw);
  if (error) throw badRequest(error);
  const name = normalizeUsername(raw);
  if (name === row.username) return row;
  const until = usernameUnlocksAt(row.usernameChangedAt?.toISOString() ?? null, now);
  if (until) {
    const day = new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
      timeZone: row.timezone,
    }).format(new Date(until));
    throw badRequest(`You can change your username again on ${day}.`);
  }
  const taken = await db.query.users.findFirst({
    where: and(eq(users.username, name), ne(users.id, row.id)),
    columns: { id: true },
  });
  if (taken) throw conflict('That username is taken.');
  try {
    const [updated] = await db
      .update(users)
      .set({ username: name, usernameChangedAt: dt(now) })
      .where(eq(users.id, row.id))
      .returning();
    return updated!;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('That username is taken.');
    throw err;
  }
}

/**
 * Earn `delta` XP, or take some back when it is negative (never below zero), in one
 * statement, so two requests landing together both count. It goes on the balance and on
 * the lifetime total alike; spending is never done through here. `withLevel` also moves the
 * stored level to match the lifetime total. Returns the totals as saved.
 */
export async function addXp(
  db: Db,
  userId: string,
  delta: number,
  opts: { withLevel?: boolean } = {},
): Promise<{ xp: number; xpEarned: number; level: number }> {
  const d = Math.round(delta);
  const [row] = await db
    .update(users)
    .set({
      xp: sql`greatest(0, ${users.xp} + ${d})`,
      xpEarned: sql`greatest(0, ${users.xpEarned} + ${d})`,
    })
    .where(eq(users.id, userId))
    .returning({ xp: users.xp, xpEarned: users.xpEarned, level: users.level });
  if (!row) return { xp: 0, xpEarned: 0, level: 0 };
  if (!opts.withLevel) return row;
  const level = levelForXp(row.xpEarned);
  if (level !== row.level) await db.update(users).set({ level }).where(eq(users.id, userId));
  return { ...row, level };
}

export async function regenerateIcsToken(db: Db, userId: string): Promise<string> {
  const token = newIcsToken();
  await db.update(users).set({ icsToken: token }).where(eq(users.id, userId));
  return token;
}

/**
 * Delete an account and everything in it. The rows go with the user by cascade; files in
 * R2 (post videos and pictures) have to be deleted by name, so they are listed first.
 */
export async function deleteUser(
  db: Db,
  userId: string,
  store: MediaStore | null = null,
  log: MediaLog = console,
): Promise<void> {
  const files = store
    ? await db
        .select({ key: postMedia.key })
        .from(postMedia)
        .innerJoin(posts, eq(posts.id, postMedia.postId))
        .where(and(eq(posts.userId, userId), isNotNull(postMedia.key)))
    : [];
  await db.delete(users).where(eq(users.id, userId));
  if (store && files.length)
    await removeAll(
      store,
      files.map((f) => f.key!),
      log,
    );
}

export { DEFAULT_SETTINGS };
