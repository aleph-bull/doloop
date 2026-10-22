import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { and, eq, lt, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../db/client';
import { users, type UserRow } from '../db/schema';
import { buildJerryWorld } from './dev-world';
import { deleteUser, ensureUser } from './users';

/**
 * "I'm a dev" accounts: throwaway accounts made from the sign-in page with the shared dev
 * password, so the owner (and the agents working with them) can try a change on the hosted
 * app in seconds. Two kinds: a fresh account, exactly as a new person starts, or Jerry, a
 * long-time user with months of study, friends, posts, a group and jams. Both keep the
 * app's default settings. They have no password and no real email, are never admins, live
 * in a world of their own (they see only each other, and real people never see them), and
 * are deleted a day after they were made.
 */

/**
 * The dev password, as an scrypt hash like `password_accounts` keeps (the repository is
 * public, so the password itself is never written down here). Make a new one with
 * `hashPassword` in services/passwords.ts.
 */
export const DEV_PASSWORD_HASH =
  'scrypt$eRoiqVKDgF23jLxvGUgbYw$6IvDHODPkl9fLkjhKfkcHZA0fTGZD58qUlvztb9F1sgQkDzVXNADEs1Gw8bYBbSD2Za62c8jNykHlzGJbDirtA';

/** How long a dev account lives, and its sign-in with it. */
export const DEV_ACCOUNT_LIFE_SECONDS = 24 * 60 * 60;

export const DEV_KINDS = ['fresh', 'jerry'] as const;
export type DevKind = (typeof DEV_KINDS)[number];

/** `.invalid` can never be a real mailbox, so nothing is ever sent anywhere. */
const DEV_EMAIL_DOMAIN = '@dev.komodon.invalid';

export const isDevEmail = (email: string | null | undefined) =>
  !!email && email.toLowerCase().endsWith(DEV_EMAIL_DOMAIN);

export const devEmail = () => `dev-${randomBytes(3).toString('hex')}${DEV_EMAIL_DOMAIN}`;

export const DEV_OFF_LIMITS = "Dev accounts can't use this.";

/** The world a new dev account (and, for Jerry, his friends) is made in: one id, one expiry. */
export interface DevWorld {
  id: string;
  expiresAt: Date;
}

/** Make the dev account (and, for Jerry, his friends) and answer who to sign in as. */
export async function createDevAccount(
  db: Db,
  kind: DevKind,
  timezone: string | null,
  now: string,
): Promise<{ id: string; email: string }> {
  await sweepDevAccounts(db, now);
  const world: DevWorld = {
    id: randomUUID(),
    expiresAt: new Date(Date.parse(now) + DEV_ACCOUNT_LIFE_SECONDS * 1000),
  };
  if (kind === 'jerry') return buildJerryWorld(db, world, timezone ?? 'America/Toronto', now);
  const identity = { id: randomUUID(), email: devEmail() };
  await ensureUser(db, identity, timezone);
  await markDev(db, identity.id, world, new Date(now));
  return identity;
}

/** Make a user row a dev account in `world`, as if it was made at `createdAt`. */
export async function markDev(db: Db, userId: string, world: DevWorld, createdAt: Date) {
  await db
    .update(users)
    .set({ devAccount: true, devWorld: world.id, devExpiresAt: world.expiresAt, createdAt })
    .where(eq(users.id, userId));
}

/** Delete the dev accounts whose day is up, with everything in them. */
export async function sweepDevAccounts(db: Db, now: string): Promise<number> {
  const old = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.devAccount, true), lt(users.devExpiresAt, new Date(now))));
  for (const u of old) await deleteUser(db, u.id);
  return old.length;
}

/**
 * Whether two accounts can see each other: both real, or both in the same dev world.
 * Real people have no world, so `null === null` lets them through.
 */
export const sameWorld = (
  a: Pick<UserRow, 'devWorld'>,
  b: Pick<UserRow, 'devWorld'> | undefined | null,
) => !!b && (a.devWorld ?? null) === (b.devWorld ?? null);

/** The same rule as SQL, on the `users` table's own column. */
export function inWorldOf(viewer: Pick<UserRow, 'devWorld'>): SQL {
  return sql`${users.devWorld} is not distinct from ${viewer.devWorld ?? null}::uuid`;
}

/** The same rule for the user a column points at, e.g. `posts.user_id`. */
export function ownerInWorldOf(viewer: Pick<UserRow, 'devWorld'>, userId: AnyPgColumn): SQL {
  return sql`(select u.dev_world from users u where u.id = ${userId}) is not distinct from ${viewer.devWorld ?? null}::uuid`;
}

/**
 * Routes a dev account is turned away from: the ones that send email (university checks,
 * account email and password changes) and admin. Social works, inside its own world.
 */
const OFF_LIMITS = [
  /^\/api\/me\/university(\/|$)/,
  /^\/api\/auth\/(email|password)(\/|$)/,
  /^\/api\/admin(\/|$)/,
];

export function devOffLimits(req: FastifyRequest): boolean {
  const route = req.routeOptions.url ?? req.url;
  return OFF_LIMITS.some((r) => r.test(route));
}
