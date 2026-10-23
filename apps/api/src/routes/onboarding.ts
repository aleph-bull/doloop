import {
  isOntarioUniversityId,
  NOT_IN_UNIVERSITY,
  ONBOARDING_APPS,
  ONBOARDING_CALENDARS,
  ONBOARDING_LOOKS,
  ONBOARDING_USES,
  type OnboardingAnswers,
} from '@komogon/core';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { onboardingAnswers, users } from '../db/schema';
import { forbidden } from '../errors';
import { isAdmin } from '../services/admin';

/** The ids of one of the answer lists, as a zod enum. */
function oneOf<T extends ReadonlyArray<{ id: string }>>(list: T) {
  return z.enum(list.map((o) => o.id) as [T[number]['id'], ...Array<T[number]['id']>]);
}

const sectionEnd = z.enum(['done', 'skipped']);

/** Some answers; `null` is a skipped question. Lists are trimmed of repeats. */
export const onboardingPatchSchema = z
  .object({
    name: z.literal(true),
    look: z
      .object({ id: oneOf(ONBOARDING_LOOKS), dark: z.boolean() })
      .strict()
      .nullable(),
    university: z
      .string()
      .max(40)
      .refine((id) => id === NOT_IN_UNIVERSITY || isOntarioUniversityId(id), 'Unknown university')
      .nullable(),
    uses: z.array(oneOf(ONBOARDING_USES)).max(ONBOARDING_USES.length).nullable(),
    apps: z.array(oneOf(ONBOARDING_APPS)).max(ONBOARDING_APPS.length).nullable(),
    calendar: z.enum(['added', 'no']).nullable(),
    calendarFrom: oneOf(ONBOARDING_CALENDARS).nullable(),
    sections: z
      .object({ questions: sectionEnd, tour: sectionEnd, timelapse: sectionEnd })
      .partial()
      .strict(),
    addTasks: z.boolean(),
  })
  .partial()
  .strict();

/** The answers so far with a patch laid over them; sections merge one by one. */
export function mergeAnswers(stored: OnboardingAnswers, patch: OnboardingAnswers) {
  const next: OnboardingAnswers = { ...stored, ...patch };
  if (patch.sections) next.sections = { ...stored.sections, ...patch.sections };
  if (next.uses) next.uses = [...new Set(next.uses)];
  if (next.apps) next.apps = [...new Set(next.apps)];
  return next;
}

export function onboardingRoutes(
  app: FastifyInstance,
  db: Db,
  admins: string[],
  clock: () => string,
) {
  const load = async (userId: string): Promise<OnboardingAnswers> =>
    (await db.query.onboardingAnswers.findFirst({ where: eq(onboardingAnswers.userId, userId) }))
      ?.answers ?? {};

  app.get('/api/me/onboarding', async (req) => ({ answers: await load(req.user.id) }));

  app.patch('/api/me/onboarding', async (req) => {
    const patch = onboardingPatchSchema.parse(req.body);
    const answers = mergeAnswers(await load(req.user.id), patch);
    const now = new Date(clock());
    await db
      .insert(onboardingAnswers)
      .values({ userId: req.user.id, answers, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: onboardingAnswers.userId, set: { answers, updatedAt: now } });
    return { answers };
  });

  /** Everyone's answers, newest first, for whoever runs Komodon. Dev accounts are left out. */
  app.get('/api/admin/onboarding', async (req) => {
    if (!isAdmin(req.user.email, admins)) throw forbidden('Admins only');
    const rows = await db
      .select({
        userId: onboardingAnswers.userId,
        email: users.email,
        devAccount: users.devAccount,
        answers: onboardingAnswers.answers,
        updatedAt: onboardingAnswers.updatedAt,
      })
      .from(onboardingAnswers)
      .innerJoin(users, eq(users.id, onboardingAnswers.userId))
      .orderBy(desc(onboardingAnswers.updatedAt));
    return {
      answers: rows
        .filter((r) => !r.devAccount)
        .map((r) => ({
          userId: r.userId,
          email: r.email,
          answers: r.answers,
          updatedAt: r.updatedAt.toISOString(),
        })),
    };
  });
}
