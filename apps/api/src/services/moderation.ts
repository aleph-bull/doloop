import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { blockedEmails, users, type UserRow } from '../db/schema';
import { HttpError, badRequest, notFound } from '../errors';
import type { MediaLog, MediaStore } from './media-store';
import { deleteUser } from './users';

/**
 * Admins can suspend an account, delete one, and block an email address. A suspended
 * account's every request is refused (the portal signs it out and says why); a blocked
 * address can't sign up or sign in. Suspending an account blocks its address too, and
 * lifting either lifts both, so the two never disagree.
 */

/** What the API answers to a suspended account or a blocked address. */
export const SUSPENDED = 'account_suspended';

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

export async function isEmailBlocked(db: Db, email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const row = await db.query.blockedEmails.findFirst({
    where: eq(blockedEmails.email, normaliseEmail(email)),
  });
  return !!row;
}

/** Refuse a sign-in or sign-up for a suspended account or a blocked address. */
export async function assertMayEnter(
  db: Db,
  identity: { id?: string; email: string | null | undefined },
): Promise<void> {
  if (await isEmailBlocked(db, identity.email)) throw new HttpError(403, SUSPENDED);
  if (!identity.id) return;
  const user = await db.query.users.findFirst({
    where: eq(users.id, identity.id),
    columns: { bannedAt: true },
  });
  if (user?.bannedAt) throw new HttpError(403, SUSPENDED);
}

export interface BlockedEmail {
  email: string;
  createdAt: string;
  /** The account with this address, if there still is one. */
  accountId: string | null;
}

export async function listBlockedEmails(db: Db): Promise<BlockedEmail[]> {
  const rows = await db
    .select({
      email: blockedEmails.email,
      createdAt: blockedEmails.createdAt,
      // Written out by hand: Drizzle drops the table from a column in a select list, and a
      // bare "email" inside the subquery would be the user's own.
      accountId: sql<
        string | null
      >`(select u.id from users u where lower(u.email) = blocked_emails.email limit 1)`,
    })
    .from(blockedEmails)
    .orderBy(sql`${blockedEmails.createdAt} desc`);
  return rows.map((r) => ({
    email: r.email,
    createdAt: r.createdAt.toISOString(),
    accountId: r.accountId ?? null,
  }));
}

/** Block an address; an account that has it is suspended with it. */
export async function blockEmail(db: Db, email: string, now: string): Promise<void> {
  const e = normaliseEmail(email);
  await db
    .insert(blockedEmails)
    .values({ email: e, createdAt: new Date(now) })
    .onConflictDoNothing();
  await db
    .update(users)
    .set({ bannedAt: new Date(now) })
    .where(sql`lower(${users.email}) = ${e} and ${users.bannedAt} is null`);
}

/** Unblock an address; an account that has it can sign in again. */
export async function unblockEmail(db: Db, email: string): Promise<void> {
  const e = normaliseEmail(email);
  await db.delete(blockedEmails).where(eq(blockedEmails.email, e));
  await db
    .update(users)
    .set({ bannedAt: null })
    .where(sql`lower(${users.email}) = ${e}`);
}

export async function suspendAccount(db: Db, user: UserRow, now: string): Promise<void> {
  if (!user.email) throw badRequest('This account has no email to block.');
  await blockEmail(db, user.email, now);
  await db
    .update(users)
    .set({ bannedAt: new Date(now) })
    .where(eq(users.id, user.id));
}

export async function liftSuspension(db: Db, user: UserRow): Promise<void> {
  if (user.email) await unblockEmail(db, user.email);
  await db.update(users).set({ bannedAt: null }).where(eq(users.id, user.id));
}

/**
 * Delete an account and everything in it, for good. With `block`, its address stays
 * blocked so it can't sign up again.
 */
export async function deleteAccount(
  db: Db,
  userId: string,
  opts: { block: boolean; now: string; store?: MediaStore | null; log?: MediaLog },
): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw notFound('No such account');
  if (opts.block && user.email) {
    await db
      .insert(blockedEmails)
      .values({ email: normaliseEmail(user.email), createdAt: new Date(opts.now) })
      .onConflictDoNothing();
  }
  await deleteUser(db, userId, opts.store ?? null, opts.log);
}
