import {
  isValidDate,
  toLocalDate,
  zonedMidnightUtc,
  zonedTimeUtc,
  type TimerState,
} from '@komogon/core';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { passwordAccounts, sessions, users, xpTransactions, type UserRow } from '../db/schema';
import { badRequest, conflict, notFound } from '../errors';
import { revokeLapsedBadges } from './achievements';
import { hashPassword } from './passwords';
import { logSessionBlock } from './planned-blocks';
import { FREE_SESSION_TITLE } from './sessions';
import { addXp, settingsOf, updateSettings } from './users';

/** Whether an email is one of the admins (`ADMIN_EMAILS`); case is ignored. */
export function isAdmin(email: string | null | undefined, admins: string[]): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return admins.some((a) => a.trim().toLowerCase() === e);
}

export interface AdminAccount {
  id: string;
  email: string;
  createdAt: string;
  onboarded: boolean;
  /** Whether the account signs in with an email and password kept by the API. */
  hasPassword: boolean;
  xp: number;
  level: number;
  streak: number;
  sessions: number;
  /** Focused time over every finished session. */
  focusMinutes: number;
  timezone: string;
  /** When an admin suspended it, or null. */
  bannedAt: string | null;
}

/** Every account, newest first, with a few figures to tell them apart. */
export async function listAccounts(db: Db): Promise<AdminAccount[]> {
  const [rows, passwords, counts] = await Promise.all([
    db.select().from(users),
    db.select({ userId: passwordAccounts.userId }).from(passwordAccounts),
    db
      .select({
        userId: sessions.userId,
        n: sql<number>`count(*)::int`,
        focus: sql<number>`coalesce(sum(${sessions.workSeconds}), 0)::int`,
      })
      .from(sessions)
      .where(sql`${sessions.endedAt} is not null`)
      .groupBy(sessions.userId),
  ]);
  const withPassword = new Set(passwords.map((p) => p.userId));
  const totals = new Map(counts.map((c) => [c.userId, c]));
  // Throwaway dev accounts come and go by themselves; the list is for real people.
  return rows
    .filter((u) => !u.devAccount)
    .map((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt.toISOString(),
      onboarded: u.onboardedAt !== null,
      hasPassword: withPassword.has(u.id),
      xp: u.xp,
      level: u.level,
      streak: u.streak.current,
      sessions: Number(totals.get(u.id)?.n ?? 0),
      focusMinutes: Math.round(Number(totals.get(u.id)?.focus ?? 0) / 60),
      timezone: u.timezone,
      bannedAt: u.bannedAt?.toISOString() ?? null,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Send an account through onboarding again. Nothing it made is touched: tasks, sessions,
 * XP, streaks, friends and settings all stay. The first-visit hints it closed come back.
 */
export async function restartOnboarding(db: Db, user: UserRow): Promise<void> {
  await updateSettings(db, user, { dismissed: [] });
  await db.update(users).set({ onboardedAt: null }).where(eq(users.id, user.id));
}

/**
 * Add focused time to an account as a finished session with nothing picked, on `date` in
 * the account's own timezone, so it counts everywhere studied time does (analytics, the
 * leaderboard, the streak of a day not yet judged). It earns no XP.
 *
 * It starts at `start` ("HH:MM") if given, at noon on a past day, or so that it ends now
 * on today.
 */
export async function addStudyTime(
  db: Db,
  user: UserRow,
  input: { date: string; minutes: number; start?: string },
  now: string,
) {
  const tz = user.timezone;
  if (!isValidDate(input.date)) throw badRequest('Pick a date.');
  const today = toLocalDate(now, tz);
  if (input.date > today) throw badRequest("That day hasn't happened yet.");
  const length = input.minutes * 60_000;
  let startMs: number;
  if (input.start) {
    const [h, m] = input.start.split(':').map(Number);
    startMs = zonedTimeUtc(input.date, h!, m!, tz).getTime();
  } else if (input.date === today) {
    startMs = Date.parse(now) - length;
    if (startMs < zonedMidnightUtc(today, tz).getTime())
      throw badRequest("Today doesn't have that much time in it yet. Pick an earlier day.");
  } else {
    startMs = zonedTimeUtc(input.date, 12, 0, tz).getTime();
  }
  if (startMs + length > Date.parse(now)) throw badRequest('That would end in the future.');

  const startedAt = new Date(startMs).toISOString();
  const endedAt = new Date(startMs + length).toISOString();
  const workSeconds = input.minutes * 60;
  const timer: TimerState = {
    mode: 'unlimited',
    phase: 'ended',
    phaseStartedAt: startedAt,
    phaseEndsAt: null,
    resumePhase: null,
    resumeRemainingMs: null,
    cycle: 0,
    workSeconds,
    breakSeconds: 0,
    idleSeconds: 0,
    plannedEndAt: null,
    autoEnded: false,
    showTimer: true,
    endedAt,
  };
  const [row] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      startedAt: new Date(startedAt),
      endedAt: new Date(endedAt),
      mode: 'unlimited',
      workSeconds,
      // Skipped, so nothing asks the person to review a session they never ran.
      review: {
        skipped: true,
        prepared: null,
        distracted: null,
        completedCount: null,
        correctCount: null,
        mood: null,
        effort: null,
        extraMinutesAdded: null,
        note: null,
      },
      timer,
      lastSeenAt: new Date(endedAt),
    })
    .returning();
  // On the calendar like any finished session. Best effort, as at a session's end.
  if (settingsOf(user).calendar.logSessions) {
    try {
      await logSessionBlock(
        db,
        user.id,
        {
          id: row!.id,
          nodeId: null,
          title: FREE_SESSION_TITLE,
          startedAt: row!.startedAt,
          endedAt: row!.endedAt,
        },
        now,
      );
    } catch {
      /* the calendar is a record of the session, never a condition of it */
    }
  }
  return { id: row!.id, startedAt, endedAt, workSeconds };
}

/**
 * Delete a finished session outright. Its XP comes off the account's total, and any badge
 * it earned that no longer holds is taken back. The streak is left as it was: a day already
 * counted stays counted.
 */
export async function deleteSession(db: Db, user: UserRow, sessionId: string, now: string) {
  const row = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, sessionId), eq(sessions.userId, user.id)),
  });
  if (!row) throw notFound('Session not found');
  if (!row.endedAt) throw conflict('That session is still running.');
  await db.delete(sessions).where(eq(sessions.id, row.id));
  if (row.xpAwarded > 0) {
    const before = user.xp;
    const saved = await addXp(db, user.id, -row.xpAwarded, { withLevel: true });
    await db.insert(xpTransactions).values({
      userId: user.id,
      at: new Date(now),
      delta: -Math.min(row.xpAwarded, before),
      kind: 'session',
      ref: row.id,
    });
    user.xp = saved.xp;
    user.level = saved.level;
  }
  const badgesRevoked = await revokeLapsedBadges(db, user, row.badgesAwarded, now);
  return { removedFocusSeconds: row.workSeconds, xpRemoved: row.xpAwarded, badgesRevoked };
}

/** Give an account a new password (or its first), e.g. when someone has forgotten theirs. */
export async function setAccountPassword(db: Db, userId: string, password: string): Promise<void> {
  if (password.length < 6) throw badRequest('Use a password of at least 6 characters.');
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw notFound('No such account');
  const passwordHash = await hashPassword(password);
  await db
    .insert(passwordAccounts)
    .values({ userId, email: user.email.trim().toLowerCase(), passwordHash })
    .onConflictDoUpdate({ target: passwordAccounts.userId, set: { passwordHash } });
}
