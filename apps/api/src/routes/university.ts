import type { FastifyInstance } from 'fastify';
import { universityById, universityForEmail } from '@komogon/core';
import { createHash, randomInt } from 'node:crypto';
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { universityVerifications, users, type UserRow } from '../db/schema';
import { badRequest, HttpError } from '../errors';
import type { Mailer } from '../services/mailer';
import { checkLimits, RateLimiter } from '../services/rate-limit';
import { dt } from '../services/sessions-mapper';
import { settingsOf } from '../services/users';

/** How long a code is good for. */
export const CODE_TTL_MS = 15 * 60_000;
/** Wrong guesses before the code is thrown away. */
export const CODE_MAX_ATTEMPTS = 5;
/** A new code may be asked for this often. */
export const RESEND_AFTER_MS = 60_000;

const hashCode = (userId: string, code: string) =>
  createHash('sha256').update(`${userId}:${code}`).digest('hex');

/** Six digits, as a string so a leading zero survives. */
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export interface UniversityStatus {
  /** The verified university on the profile, or null. */
  university: { id: string; name: string } | null;
  /** The address it was verified with, or null. */
  email: string | null;
  /** A code sent and not yet confirmed. */
  pending: { email: string; university: { id: string; name: string }; expiresAt: string } | null;
}

/**
 * Putting a university on a profile: the person gives an address on that university's
 * domain, a six-digit code goes there, and the university is written to the profile only
 * when the code comes back. Nothing else can set it; the settings route refuses the field.
 */
export function universityRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string,
  mailer: Mailer | null,
) {
  // Codes sent per account per day, so a mistake can't turn the API into a mailer.
  const sends = new RateLimiter({ max: 8, windowMs: 24 * 3_600_000 }, () => Date.parse(clock()));

  const status = async (row: UserRow): Promise<UniversityStatus> => {
    const uni = universityById(settingsOf(row).profile.university);
    const v = await db.query.universityVerifications.findFirst({
      where: eq(universityVerifications.userId, row.id),
    });
    const now = Date.parse(clock());
    const pendingUni = v && !v.verifiedAt ? universityById(v.universityId) : null;
    return {
      university: uni ? { id: uni.id, name: uni.name } : null,
      email: uni && v?.verifiedAt ? v.email : null,
      pending:
        v && pendingUni && v.expiresAt.getTime() > now
          ? {
              email: v.email,
              university: { id: pendingUni.id, name: pendingUni.name },
              expiresAt: v.expiresAt.toISOString(),
            }
          : null,
    };
  };

  /**
   * Writes profile.university in the database itself, merging into whatever the settings
   * row holds now, so a settings PATCH landing at the same moment (the Account form saves
   * the bio on blur) is not overwritten by the copy this request started with.
   */
  const setUniversity = (userId: string, universityId: string | null) =>
    db
      .update(users)
      .set({
        settings: sql`${users.settings} || jsonb_build_object(
          'profile',
          coalesce(${users.settings} -> 'profile', '{}'::jsonb)
            || jsonb_build_object('university', ${universityId}::text)
        )`,
      })
      .where(eq(users.id, userId));

  /** Whether another account has already verified this address. One address, one account. */
  const takenByAnother = async (email: string, userId: string) =>
    !!(await db.query.universityVerifications.findFirst({
      where: and(
        eq(universityVerifications.email, email),
        isNotNull(universityVerifications.verifiedAt),
        ne(universityVerifications.userId, userId),
      ),
      columns: { userId: true },
    }));

  app.get('/api/me/university', async (req) => status(req.user));

  app.post('/api/me/university/send', async (req) => {
    const { email } = z
      .object({ email: z.string().trim().toLowerCase().email().max(320) })
      .parse(req.body);
    if (!mailer)
      throw new HttpError(
        503,
        'This server cannot send email yet, so a university cannot be verified here.',
      );
    const uni = universityForEmail(email);
    if (!uni)
      throw badRequest(
        'That address is not from an Ontario university we know. Use the one your university gave you.',
      );
    const now = Date.parse(clock());
    const existing = await db.query.universityVerifications.findFirst({
      where: eq(universityVerifications.userId, req.user.id),
    });
    // A verified row is the proof behind the university on the profile; it is never
    // overwritten by a new attempt. Remove first, then verify another address.
    if (existing?.verifiedAt)
      throw badRequest(
        'Your university is already verified. Remove it first to use another address.',
      );
    if (existing && now - existing.createdAt.getTime() < RESEND_AFTER_MS)
      throw badRequest('A code was just sent. Give it a minute before asking for another.');
    if (await takenByAnother(email, req.user.id))
      throw badRequest('That address is already on another account.');
    checkLimits([[sends, req.user.id]]);

    const code = newCode();
    const values = {
      userId: req.user.id,
      universityId: uni.id,
      email,
      codeHash: hashCode(req.user.id, code),
      attempts: 0,
      expiresAt: new Date(now + CODE_TTL_MS),
      verifiedAt: null,
      createdAt: new Date(now),
    };
    // The mail goes first: a code that never left should cost nothing, so the next try
    // is not met by the cooldown or the daily count.
    try {
      await mailer.send({
        to: email,
        subject: `${code} is your Komodon code`,
        text: `Enter this code in Komodon to put ${uni.name} on your profile: ${code}\n\nIt works for 15 minutes. If you didn't ask for it, you can ignore this email.`,
      });
    } catch (err) {
      req.log.error(err, 'verification mail failed');
      throw new HttpError(
        502,
        'The code could not be sent right now. Please try again in a moment.',
      );
    }
    sends.hit(req.user.id);
    await db
      .insert(universityVerifications)
      .values(values)
      .onConflictDoUpdate({ target: universityVerifications.userId, set: values });
    return {
      university: { id: uni.id, name: uni.name },
      email,
      expiresAt: values.expiresAt.toISOString(),
    };
  });

  app.post('/api/me/university/confirm', async (req) => {
    const { code } = z
      .object({
        code: z
          .string()
          .trim()
          .regex(/^\d{6}$/),
      })
      .parse(req.body);
    const v = await db.query.universityVerifications.findFirst({
      where: eq(universityVerifications.userId, req.user.id),
    });
    const now = Date.parse(clock());
    if (!v || v.verifiedAt || v.expiresAt.getTime() <= now || v.attempts >= CODE_MAX_ATTEMPTS)
      throw badRequest('That code has expired. Ask for a new one.');
    if (v.codeHash !== hashCode(req.user.id, code)) {
      await db
        .update(universityVerifications)
        .set({ attempts: v.attempts + 1 })
        .where(eq(universityVerifications.userId, req.user.id));
      const left = CODE_MAX_ATTEMPTS - v.attempts - 1;
      throw badRequest(
        left > 0
          ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : 'That code is not right, and it has now expired. Ask for a new one.',
      );
    }
    // Checked again here: two accounts could have asked for codes to the same address.
    if (await takenByAnother(v.email, req.user.id))
      throw badRequest('That address is already on another account.');
    try {
      await db
        .update(universityVerifications)
        .set({ verifiedAt: dt(clock()), codeHash: '' })
        .where(eq(universityVerifications.userId, req.user.id));
    } catch (err) {
      // The unique index caught a confirm that landed in the same instant. drizzle wraps
      // the driver's error, so the Postgres code is on the cause.
      const e = err as { code?: string; cause?: { code?: string } };
      if (e.code === '23505' || e.cause?.code === '23505')
        throw badRequest('That address is already on another account.');
      throw err;
    }
    await setUniversity(req.user.id, v.universityId);
    const uni = universityById(v.universityId)!;
    return { university: { id: uni.id, name: uni.name }, email: v.email };
  });

  /** Take the university off the profile (and forget the address and any pending code). */
  app.delete('/api/me/university', async (req, reply) => {
    await db.delete(universityVerifications).where(eq(universityVerifications.userId, req.user.id));
    await setUniversity(req.user.id, null);
    return reply.code(204).send();
  });
}
