import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { passwordAccounts, users } from '../db/schema';
import { badRequest, HttpError } from '../errors';
import { accountSession } from '../services/account-session';
import { normalEmail, redeemEmailCode } from '../services/email-codes';
import type { Mailer } from '../services/mailer';
import { checkPassword, hashPassword } from '../services/passwords';
import { RateLimiter, checkLimits } from '../services/rate-limit';
import { codeInput } from './email-auth';

export interface SecurityOptions {
  mailer: Mailer | null;
  /** Signs the API's own tokens and keys the email codes. */
  secret: string;
}

const passwordChange = z.object({
  current: z.string().min(1).max(200),
  password: z.string().min(6).max(200),
});

/**
 * Settings › Security: the account's email and whether it is verified, two-step sign-in
 * (a code from that email after the password, never required), and changing the password.
 * Codes for verifying and for turning two-step on or off come from
 * `POST /api/auth/email/request-verification`.
 */
export function securityRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string,
  opts: SecurityOptions,
) {
  // Wrong current passwords, per account, so a stolen sign-in can't guess its way in.
  const wrongCurrent = new RateLimiter({ max: 10, windowMs: 15 * 60_000 });

  const hasPassword = async (userId: string) =>
    !!(await db.query.passwordAccounts.findFirst({
      where: eq(passwordAccounts.userId, userId),
      columns: { userId: true },
    }));

  app.get('/api/account/security', async (req) => {
    const user = req.user;
    return {
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      hasPassword: await hasPassword(user.id),
      twoStep: user.twoStepAt !== null,
      // A code can be sent: there is a mailer, and a real address (dev accounts have none).
      canVerify: !!opts.mailer && !user.devAccount && !!user.email,
    };
  });

  /** Turn two-step sign-in on or off with a code from the account's email (which verifies it too). */
  app.post('/api/account/two-step', async (req) => {
    const body = codeInput.extend({ on: z.boolean() }).parse(req.body);
    if (body.on && !(await hasPassword(req.user.id)))
      throw badRequest('Two-step sign-in is for signing in with a password.');
    await redeemEmailCode(
      db,
      opts.secret,
      body.challengeId,
      body.code,
      'account',
      req.user.id,
      clock(),
      async (tx, row) => {
        if (row.email !== normalEmail(req.user.email))
          throw badRequest('Your account email changed. Request a new code.');
        await tx
          .update(users)
          .set({
            twoStepAt: body.on ? new Date(clock()) : null,
            emailVerifiedAt: new Date(clock()),
          })
          .where(eq(users.id, req.user.id));
      },
    );
    return { twoStep: body.on, emailVerified: true };
  });

  /**
   * A new password, given the current one. Every other device is signed out (the account's
   * auth version moves on); this one gets a fresh token.
   */
  app.post('/api/account/password', async (req) => {
    const body = passwordChange.parse(req.body);
    checkLimits([[wrongCurrent, req.user.id]]);
    const account = await db.query.passwordAccounts.findFirst({
      where: eq(passwordAccounts.userId, req.user.id),
    });
    if (!account) throw badRequest('This account has no password.');
    if (!(await checkPassword(body.current, account.passwordHash))) {
      wrongCurrent.hit(req.user.id);
      throw new HttpError(400, "That isn't your current password.");
    }
    wrongCurrent.clear(req.user.id);
    await db
      .update(passwordAccounts)
      .set({ passwordHash: await hashPassword(body.password) })
      .where(eq(passwordAccounts.userId, req.user.id));
    await db
      .update(users)
      .set({ authVersion: sql`${users.authVersion} + 1` })
      .where(eq(users.id, req.user.id));
    return accountSession(db, opts.secret, { id: req.user.id, email: account.email });
  });
}
