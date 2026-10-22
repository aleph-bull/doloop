import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { emailCodes, emailRateLimits } from '../db/schema';
import { badRequest, HttpError } from '../errors';
import type { Mailer } from './mailer';

type Purpose = typeof emailCodes.$inferInsert.purpose;
export const normalEmail = (email: string) => email.trim().toLowerCase();
const hash = (secret: string, value: string) =>
  createHmac('sha256', secret).update(value).digest('hex');

/** Atomic database counters enforce limits across API instances as well as repeated clicks. */
export async function emailLimit(
  db: Db,
  key: string,
  limit: number,
  windowMs: number,
  now: string,
) {
  const at = new Date(now),
    expiresAt = new Date(at.getTime() + windowMs);
  // As text inside sql``: the hosted database's driver can't send a Date there.
  const atText = at.toISOString(),
    expiresText = expiresAt.toISOString();
  const rows = await db
    .insert(emailRateLimits)
    .values({ key, hits: 1, expiresAt })
    .onConflictDoUpdate({
      target: emailRateLimits.key,
      set: {
        hits: sql`case when ${emailRateLimits.expiresAt} <= ${atText} then 1 else ${emailRateLimits.hits} + 1 end`,
        expiresAt: sql`case when ${emailRateLimits.expiresAt} <= ${atText} then ${expiresText}::timestamptz else ${emailRateLimits.expiresAt} end`,
      },
      setWhere: sql`${emailRateLimits.expiresAt} <= ${atText} or ${emailRateLimits.hits} < ${limit}`,
    })
    .returning();
  if (!rows.length) throw new HttpError(429, 'Too many requests. Please try again later.');
}

export async function requestLimits(
  db: Db,
  secret: string,
  email: string,
  ip: string,
  now: string,
) {
  await emailLimit(db, `ip:${hash(secret, ip)}`, 20, 60 * 60_000, now);
  await emailLimit(db, `cooldown:${hash(secret, normalEmail(email))}`, 1, 60_000, now);
  await emailLimit(db, `recipient:${hash(secret, normalEmail(email))}`, 5, 60 * 60_000, now);
}

const descriptions: Record<Purpose, string> = {
  signup: 'confirm your Komodon email address',
  account: 'confirm your Komodon email address',
  organization: 'verify your school or organization email',
  'password-reset': 'reset your Komodon password',
};

export async function issueEmailCode(
  db: Db,
  mailer: Mailer | null,
  secret: string,
  input: {
    email: string;
    purpose: Purpose;
    userId?: string;
    payload?: typeof emailCodes.$inferInsert.payload;
  },
  now: string,
) {
  if (!mailer) throw new HttpError(503, 'Email is not configured on this server yet.');
  await emailLimit(db, 'outbound-email-budget', 95, 24 * 60 * 60_000, now);
  const id = randomUUID(),
    code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const email = normalEmail(input.email);
  await db.insert(emailCodes).values({
    ...input,
    id,
    email,
    codeHash: hash(secret, `${id}:${code}`),
    expiresAt: new Date(Date.parse(now) + 10 * 60_000),
    createdAt: new Date(now),
  });
  try {
    await mailer.send({
      to: email,
      subject:
        input.purpose === 'password-reset'
          ? 'Reset your Komodon password'
          : 'Your Komodon verification code',
      text: `${code}\n\nUse this code to ${descriptions[input.purpose]}. It expires in 10 minutes.\n\nIf you did not request this, ignore this email.`,
    });
  } catch (err) {
    await db
      .update(emailCodes)
      .set({ consumedAt: new Date(now) })
      .where(eq(emailCodes.id, id));
    throw new HttpError(
      503,
      err instanceof Error ? err.message : 'Could not send email. Please try again.',
    );
  }
  await db
    .update(emailCodes)
    .set({ consumedAt: new Date(now) })
    .where(
      and(
        eq(emailCodes.email, email),
        eq(emailCodes.purpose, input.purpose),
        isNull(emailCodes.consumedAt),
        sql`${emailCodes.id} <> ${id}`,
      ),
    );
  return { challengeId: id, email };
}

/** A correct code and its database change are committed together; wrong attempts still count. */
export async function redeemEmailCode<T>(
  db: Db,
  secret: string,
  id: string,
  code: string,
  purpose: Purpose,
  userId: string | null,
  now: string,
  apply: (tx: Db, row: typeof emailCodes.$inferSelect) => Promise<T>,
): Promise<T> {
  const result = await db.transaction(async (transaction) => {
    const tx = transaction as unknown as Db;
    const [row] = await tx.select().from(emailCodes).where(eq(emailCodes.id, id)).for('update');
    if (
      !row ||
      row.purpose !== purpose ||
      (userId && row.userId !== userId) ||
      row.consumedAt ||
      row.expiresAt <= new Date(now) ||
      row.attempts >= 5
    )
      return { valid: false as const };
    const expected = Buffer.from(row.codeHash, 'hex'),
      actual = Buffer.from(hash(secret, `${id}:${code}`), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await tx
        .update(emailCodes)
        .set({ attempts: row.attempts + 1 })
        .where(eq(emailCodes.id, id));
      return { valid: false as const };
    }
    const value = await apply(tx, row);
    await tx
      .update(emailCodes)
      .set({ consumedAt: new Date(now) })
      .where(eq(emailCodes.id, id));
    return { valid: true as const, value };
  });
  if (!result.valid) throw badRequest('The code is incorrect or expired. Request a new code.');
  return result.value;
}
