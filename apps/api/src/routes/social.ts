import type { FastifyInstance } from 'fastify';
import { and, eq, isNotNull, ne, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { socialProfiles, users } from '../db/schema';
import { badRequest, conflict } from '../errors';
import { codeInput, type EmailOptions } from './email-auth';
import {
  issueEmailCode,
  normalEmail,
  redeemEmailCode,
  requestLimits,
} from '../services/email-codes';

const personalDomains = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.ca',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'mail.com',
  'gmx.com',
  'yandex.com',
]);

export function socialRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string,
  opts: EmailOptions,
  admins: string[],
) {
  app.get('/api/social/me', async (req) => {
    const profile = await db.query.socialProfiles.findFirst({
      where: eq(socialProfiles.userId, req.user.id),
    });
    return {
      profile: profile ?? {
        userId: req.user.id,
        displayName: req.user.settings.profile?.name ?? '',
        organizationName: '',
        organizationEmail: null,
        organizationDomain: null,
        organizationVerifiedAt: null,
        visible: false,
      },
      accountEmail: req.user.email,
      emailVerified: !!req.user.emailVerifiedAt,
      mailAvailable: !!opts.mailer,
    };
  });
  app.patch('/api/social/me', async (req) => {
    const body = z
      .object({
        displayName: z.string().trim().min(1).max(60),
        organizationName: z.string().trim().max(100),
        visible: z.boolean(),
      })
      .strict()
      .parse(req.body);
    const current = await db.query.socialProfiles.findFirst({
      where: eq(socialProfiles.userId, req.user.id),
    });
    if (body.visible && (!current?.organizationVerifiedAt || !current.organizationDomain))
      throw badRequest('Verify your organization email before sharing your profile.');
    const [profile] = await db
      .insert(socialProfiles)
      .values({ userId: req.user.id, ...body })
      .onConflictDoUpdate({ target: socialProfiles.userId, set: body })
      .returning();
    await db
      .update(users)
      .set({
        settings: {
          ...req.user.settings,
          profile: { ...req.user.settings.profile, name: body.displayName },
        },
      })
      .where(eq(users.id, req.user.id));
    return { profile };
  });
  app.post('/api/social/organization/request-code', async (req) => {
    const { email } = z.object({ email: z.string().trim().email().max(320) }).parse(req.body);
    const normalized = normalEmail(email),
      domain = normalized.split('@')[1]!;
    if (personalDomains.has(domain))
      throw badRequest(
        'Use a school or organization email address. Your sign-in email can stay the same.',
      );
    await requestLimits(db, opts.secret, normalized, req.ip, clock());
    return issueEmailCode(
      db,
      opts.mailer,
      opts.secret,
      { email: normalized, purpose: 'organization', userId: req.user.id },
      clock(),
    );
  });
  app.post('/api/social/organization/verify', async (req) => {
    const body = codeInput.parse(req.body);
    const profile = await redeemEmailCode(
      db,
      opts.secret,
      body.challengeId,
      body.code,
      'organization',
      req.user.id,
      clock(),
      async (tx, row) => {
        const claimed = await tx.query.socialProfiles.findFirst({
          where: and(
            eq(socialProfiles.organizationEmail, row.email),
            ne(socialProfiles.userId, req.user.id),
          ),
        });
        if (claimed)
          throw conflict('This organization email is already linked to another account.');
        const values = {
          organizationEmail: row.email,
          organizationDomain: row.email.split('@')[1]!,
          organizationVerifiedAt: new Date(clock()),
          visible: false,
        };
        const [saved] = await tx
          .insert(socialProfiles)
          .values({ userId: req.user.id, ...values })
          .onConflictDoUpdate({ target: socialProfiles.userId, set: values })
          .returning();
        return saved;
      },
    );
    return { profile };
  });
  app.delete('/api/social/organization', async (req) => {
    await db
      .update(socialProfiles)
      .set({
        organizationEmail: null,
        organizationDomain: null,
        organizationVerifiedAt: null,
        visible: false,
      })
      .where(eq(socialProfiles.userId, req.user.id));
    return { ok: true };
  });
  app.get('/api/social/people', async (req) => {
    const viewer = await db.query.socialProfiles.findFirst({
      where: eq(socialProfiles.userId, req.user.id),
    });
    if (!viewer?.organizationVerifiedAt || !viewer.organizationDomain) return { people: [] };
    const people = await db
      .select({
        id: socialProfiles.userId,
        displayName: socialProfiles.displayName,
        organizationName: socialProfiles.organizationName,
        organizationDomain: socialProfiles.organizationDomain,
      })
      .from(socialProfiles)
      .innerJoin(users, eq(socialProfiles.userId, users.id))
      .where(
        and(
          eq(socialProfiles.organizationDomain, viewer.organizationDomain),
          eq(socialProfiles.visible, true),
          isNotNull(socialProfiles.organizationVerifiedAt),
          ne(socialProfiles.userId, req.user.id),
          eq(users.isTestAccount, false),
          ...(admins.length
            ? [
                notInArray(
                  sql`lower(${users.email})`,
                  admins.map((email) => email.toLowerCase()),
                ),
              ]
            : []),
        ),
      )
      .orderBy(socialProfiles.displayName)
      .limit(30);
    return { people };
  });
}
