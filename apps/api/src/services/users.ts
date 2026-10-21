import {
  DEFAULT_SETTINGS,
  describeStreakEvents,
  emptyStreak,
  evaluateStreak,
  levelForXp,
  materializePendingRestDays,
  resolveAccent,
  resolveBackgroundId,
  streakDay,
  withDefaults,
  type RestDayPolicy,
  type Session,
  type StreakState,
  type User,
  type UserSettings,
} from '@komogon/core';
import { randomBytes } from 'node:crypto';
import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/verify';
import type { Db } from '../db/client';
import {
  restDayPolicies,
  sessions,
  streakEvents,
  users,
  type RestDayPolicyRow,
  type UserRow,
} from '../db/schema';
import type { SettingsPatch } from '../validation';
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
    return row;
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
    level: row.level,
    streak: row.streak,
  };
}

export interface StreakSync {
  streak: StreakState;
  message: string | null;
  milestonesReached: number[];
}

/**
 * Bring the streak and pending rest-day pattern up to date. Called on every /me read
 * and at session end. Persists only when something changed.
 */
export async function syncStreak(db: Db, row: UserRow, now: string): Promise<StreakSync> {
  const settings = settingsOf(row);
  // The streak's own day, which can start a few hours after midnight.
  const dayStartHour = settings.streak.dayStartHour;
  const today = streakDay(now, row.timezone, dayStartHour);
  let policy = await getPolicy(db, row.id);
  const materialized = materializePendingRestDays(policy, today);
  if (materialized !== policy) {
    policy = materialized;
    await savePolicy(db, policy);
  }

  // Only completed sessions since the last judged day matter.
  const since = row.streak.lastCountedDate ? `${row.streak.lastCountedDate}T00:00:00.000Z` : null;
  const rows = await db.query.sessions.findMany({
    where: since
      ? and(
          eq(sessions.userId, row.id),
          isNotNull(sessions.endedAt),
          gte(sessions.startedAt, new Date(Date.parse(since) - 2 * 86_400_000)),
        )
      : and(eq(sessions.userId, row.id), isNotNull(sessions.endedAt)),
  });
  const sess: Session[] = rows.map(toSession);

  const result = evaluateStreak({
    state: row.streak,
    sessions: sess,
    policy,
    minMinutes: settings.streak.minMinutes,
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
    // First sign-in goes straight to a timer. Keep existing accounts' choices intact.
    const settings = settingsOf(row);
    set.settings = {
      ...settings,
      dashboard: { focusOnly: true },
      focusScreen: { openOnStart: 'never' },
      timelapse: { ...settings.timelapse, record: 'never' },
      visualizer: { ...settings.visualizer, promptDismissed: true },
    };
  }
  if (Object.keys(set).length === 0) return row;
  const [updated] = await db.update(users).set(set).where(eq(users.id, row.id)).returning();
  return updated!;
}

/**
 * Add `delta` XP (negative to take some away, never below zero) in one statement, so two
 * requests landing together both count. `withLevel` also moves the stored level to match.
 * Returns the totals as saved.
 */
export async function addXp(
  db: Db,
  userId: string,
  delta: number,
  opts: { withLevel?: boolean } = {},
): Promise<{ xp: number; level: number }> {
  const [row] = await db
    .update(users)
    .set({ xp: sql`greatest(0, ${users.xp} + ${Math.round(delta)})` })
    .where(eq(users.id, userId))
    .returning({ xp: users.xp, level: users.level });
  if (!row) return { xp: 0, level: 0 };
  if (!opts.withLevel) return row;
  const level = levelForXp(row.xp);
  if (level !== row.level) await db.update(users).set({ level }).where(eq(users.id, userId));
  return { xp: row.xp, level };
}

export async function setXp(
  db: Db,
  userId: string,
  xp: number,
): Promise<{ xp: number; level: number }> {
  const level = levelForXp(xp);
  await db.update(users).set({ xp, level }).where(eq(users.id, userId));
  return { xp, level };
}

export async function regenerateIcsToken(db: Db, userId: string): Promise<string> {
  const token = newIcsToken();
  await db.update(users).set({ icsToken: token }).where(eq(users.id, userId));
  return token;
}

export async function deleteUser(db: Db, userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}

export { DEFAULT_SETTINGS };
