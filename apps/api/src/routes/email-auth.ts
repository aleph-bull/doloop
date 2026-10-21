import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { emailCodes, passwordAccounts, users } from '../db/schema';
import { badRequest, HttpError } from '../errors';
import { accountSession } from '../services/account-session';
import {
  issueEmailCode,
  normalEmail,
  redeemEmailCode,
  requestLimits,
} from '../services/email-codes';
import { isLocalTestEmail, requireLocalTestRequest } from '../services/local-test-accounts';
import { createPasswordAccount, hashPassword } from '../services/passwords';
import type { Mailer } from '../services/mailer';

export interface EmailOptions {
  mailer: Mailer | null;
  secret: string;
  verificationRequired: boolean;
  localTestAccounts: boolean;
  passwordAuth: boolean;
}
export const codeInput = z.object({
  challengeId: z.uuid(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});

export function emailAuthRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string,
  opts: EmailOptions,
) {
  app.get('/api/auth/email/status', { config: { public: true } }, async () => ({
    available: !!opts.mailer,
    mode: opts.mailer?.mode ?? 'unconfigured',
    verificationRequired: opts.verificationRequired,
    passwordReset: opts.passwordAuth,
  }));
  app.get('/api/auth/local-outbox', { config: { public: true } }, async (req) => {
    requireLocalTestRequest(req, opts.localTestAccounts && opts.mailer?.mode === 'local');
    const q = z.object({ email: z.string().email() }).parse(req.query);
    return {
      messages: (opts.mailer?.messages ?? [])
        .filter((m) => m.to === normalEmail(q.email))
        .slice(-5)
        .reverse(),
    };
  });
  app.post('/api/auth/email/verify-signup', { config: { public: true } }, async (req) => {
    if (!opts.passwordAuth) throw badRequest('Use your sign-in provider to verify this account.');
    const body = codeInput.parse(req.body);
    const identity = await redeemEmailCode(
      db,
      opts.secret,
      body.challengeId,
      body.code,
      'signup',
      null,
      clock(),
      async (tx, row) => {
        if (!row.payload.passwordHash || isLocalTestEmail(row.email))
          throw badRequest('Request a new signup code.');
        const account = await createPasswordAccount(
          tx,
          row.email,
          row.payload.passwordHash,
          row.payload.timezone ?? null,
          row.payload.claimExisting ?? false,
        );
        await tx
          .update(users)
          .set({ emailVerifiedAt: new Date(clock()) })
          .where(eq(users.id, account.id));
        return account;
      },
    );
    return accountSession(db, opts.secret, identity);
  });
  app.post('/api/auth/email/resend', { config: { public: true } }, async (req) => {
    const { challengeId } = z.object({ challengeId: z.uuid() }).parse(req.body);
    const row = await db.query.emailCodes.findFirst({ where: eq(emailCodes.id, challengeId) });
    if (!row || row.consumedAt || !['signup', 'password-reset'].includes(row.purpose))
      throw badRequest('Request a new code from the original form.');
    await requestLimits(db, opts.secret, row.email, req.ip, clock());
    return issueEmailCode(
      db,
      opts.mailer,
      opts.secret,
      {
        email: row.email,
        purpose: row.purpose,
        userId: row.userId ?? undefined,
        payload: row.payload,
      },
      clock(),
    );
  });
  app.post('/api/auth/password/request-reset', { config: { public: true } }, async (req) => {
    const { email } = z.object({ email: z.string().trim().email().max(320) }).parse(req.body);
    if (!opts.mailer || !opts.passwordAuth)
      throw new HttpError(503, 'Password reset email is not configured on this server yet.');
    await requestLimits(db, opts.secret, email, req.ip, clock());
    const account = await db.query.passwordAccounts.findFirst({
      where: eq(passwordAccounts.email, normalEmail(email)),
    });
    let challengeId: string = randomUUID();
    if (account) {
      if (isLocalTestEmail(email)) requireLocalTestRequest(req, opts.localTestAccounts);
      challengeId = (
        await issueEmailCode(
          db,
          opts.mailer,
          opts.secret,
          { email, userId: account.userId, purpose: 'password-reset' },
          clock(),
        )
      ).challengeId;
    }
    return {
      ok: true,
      challengeId,
      message: 'If an account uses that address, a code has been sent.',
    };
  });
  app.post('/api/auth/password/reset', { config: { public: true } }, async (req) => {
    const body = codeInput.extend({ password: z.string().min(6).max(200) }).parse(req.body);
    const passwordHash = await hashPassword(body.password);
    await redeemEmailCode(
      db,
      opts.secret,
      body.challengeId,
      body.code,
      'password-reset',
      null,
      clock(),
      async (tx, row) => {
        if (isLocalTestEmail(row.email)) requireLocalTestRequest(req, opts.localTestAccounts);
        if (!row.userId) throw badRequest('Request a new reset code.');
        const updated = await tx
          .update(passwordAccounts)
          .set({ passwordHash })
          .where(
            and(eq(passwordAccounts.userId, row.userId), eq(passwordAccounts.email, row.email)),
          )
          .returning();
        if (!updated.length) throw badRequest('Request a new reset code.');
        await tx
          .update(users)
          .set({ authVersion: sql`${users.authVersion} + 1`, emailVerifiedAt: new Date(clock()) })
          .where(eq(users.id, row.userId));
        await tx
          .update(emailCodes)
          .set({ consumedAt: new Date(clock()) })
          .where(and(eq(emailCodes.userId, row.userId), eq(emailCodes.purpose, 'password-reset')));
      },
    );
    return { ok: true };
  });
  app.post('/api/auth/email/request-verification', async (req) => {
    await requestLimits(db, opts.secret, req.user.email, req.ip, clock());
    return issueEmailCode(
      db,
      opts.mailer,
      opts.secret,
      { email: req.user.email, purpose: 'account', userId: req.user.id },
      clock(),
    );
  });
  app.post('/api/auth/email/verify-account', async (req) => {
    const body = codeInput.parse(req.body);
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
          .set({ emailVerifiedAt: new Date(clock()) })
          .where(eq(users.id, req.user.id));
      },
    );
    return { ok: true };
  });
}
