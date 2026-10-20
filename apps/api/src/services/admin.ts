import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { passwordAccounts, sessions, users } from '../db/schema';
import { badRequest, notFound } from '../errors';
import { hashPassword } from './passwords';

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
}

/** Every account, newest first, with a few figures to tell them apart. */
export async function listAccounts(db: Db): Promise<AdminAccount[]> {
  const [rows, passwords, counts] = await Promise.all([
    db.select().from(users),
    db.select({ userId: passwordAccounts.userId }).from(passwordAccounts),
    db
      .select({ userId: sessions.userId, n: sql<number>`count(*)::int` })
      .from(sessions)
      .groupBy(sessions.userId),
  ]);
  const withPassword = new Set(passwords.map((p) => p.userId));
  const sessionCount = new Map(counts.map((c) => [c.userId, Number(c.n)]));
  return rows
    .map((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt.toISOString(),
      onboarded: u.onboardedAt !== null,
      hasPassword: withPassword.has(u.id),
      xp: u.xp,
      level: u.level,
      streak: u.streak.current,
      sessions: sessionCount.get(u.id) ?? 0,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
