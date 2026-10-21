import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { passwordAccounts, users } from '../db/schema';
import { HttpError, badRequest, conflict } from '../errors';
import { ensureUser } from './users';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const KEY_LEN = 64;

/** `scrypt$<salt>$<hash>`, both base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length);
  return timingSafeEqual(actual, expected);
}

const normalise = (email: string) => email.trim().toLowerCase();

/**
 * Create the user and their password account; returns who to sign in as. With
 * `claimExisting` (admins only), an account that already has this email but no password
 * (made before passwords, e.g. moved over from a local copy) gets the password instead, so
 * its data and settings carry on.
 */
export async function signUp(
  db: Db,
  email: string,
  password: string,
  timezone: string | null,
  claimExisting = false,
): Promise<{ id: string; email: string }> {
  const e = normalise(email);
  if (password.length < 6) throw badRequest('Use a password of at least 6 characters.');
  return createPasswordAccount(db, e, await hashPassword(password), timezone, claimExisting);
}

export async function createPasswordAccount(
  db: Db,
  email: string,
  passwordHash: string,
  timezone: string | null,
  claimExisting = false,
) {
  const e = normalise(email);
  const taken = await db.query.passwordAccounts.findFirst({
    where: eq(passwordAccounts.email, e),
  });
  if (taken) throw conflict('There is already an account with this email. Sign in instead.');
  const existing = claimExisting
    ? await db.query.users.findFirst({ where: eq(sql`lower(${users.email})`, e) })
    : undefined;
  const id = existing?.id ?? randomUUID();
  if (!existing) await ensureUser(db, { id, email: e }, timezone);
  await db.insert(passwordAccounts).values({ userId: id, email: e, passwordHash });
  return { id, email: e };
}

export async function signIn(
  db: Db,
  email: string,
  password: string,
): Promise<{ id: string; email: string }> {
  const e = normalise(email);
  const account = await db.query.passwordAccounts.findFirst({
    where: eq(passwordAccounts.email, e),
  });
  if (!account || !(await checkPassword(password, account.passwordHash)))
    throw new HttpError(401, "That email and password don't match.");
  return { id: account.userId, email: e };
}
