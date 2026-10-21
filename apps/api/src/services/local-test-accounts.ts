import type { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { passwordAccounts, users } from '../db/schema';
import { forbidden } from '../errors';
import { hashPassword, signUp } from './passwords';
import { deleteUser, updateProfile } from './users';

/** Fixed credentials belong only to explicitly enabled, isolated localhost sandboxes. */
export const LOCAL_TEST_ACCOUNTS = [
  { role: 'onboarding', email: 'onboarding@komodon.test', password: 'Onboarding123!' },
  { role: 'admin', email: 'admin@komodon.test', password: 'Admin123!' },
] as const;

export const isLocalTestEmail = (email: string | null | undefined) =>
  LOCAL_TEST_ACCOUNTS.some((account) => account.email === email?.trim().toLowerCase());

const loopback = (host: string) =>
  ['localhost', '127.0.0.1', '::1', '[::1]', '::ffff:127.0.0.1'].includes(host);

export function requireLocalTestRequest(req: FastifyRequest, enabled: boolean) {
  let localOrigin = true;
  try {
    if (req.headers.origin) localOrigin = loopback(new URL(req.headers.origin).hostname);
  } catch {
    localOrigin = false;
  }
  if (!enabled || !loopback(req.ip) || !loopback(req.hostname) || !localOrigin)
    throw forbidden('Test accounts are available only in the localhost sandbox.');
}

export function allowLocalTestAccounts(config: {
  enabled: boolean;
  host: string;
  databaseUrl?: string;
  dataDir: string;
  production: boolean;
}) {
  if (!config.enabled) return false;
  if (
    config.production ||
    !loopback(config.host) ||
    config.databaseUrl ||
    !/[\\/]\.pglite-sandbox[^\\/]*$/.test(config.dataDir)
  ) {
    throw new Error(
      'Local test accounts require a loopback host and an isolated .pglite-sandbox data directory outside production.',
    );
  }
  return true;
}

export async function seedLocalTestAccounts(db: Db, now: string, onboardingOnly = false) {
  for (const account of LOCAL_TEST_ACCOUNTS) {
    if (onboardingOnly && account.role !== 'onboarding') continue;
    const existing = await db.query.passwordAccounts.findFirst({
      where: eq(passwordAccounts.email, account.email),
    });
    const identity = existing
      ? { id: existing.userId }
      : await signUp(db, account.email, account.password, 'America/Toronto');
    await db.update(users).set({ isTestAccount: true }).where(eq(users.id, identity.id));
    if (existing)
      await db
        .update(passwordAccounts)
        .set({ passwordHash: await hashPassword(account.password) })
        .where(eq(passwordAccounts.userId, identity.id));
    if (account.role === 'admin') {
      const row = await db.query.users.findFirst({ where: eq(users.id, identity.id) });
      const ready = await updateProfile(db, row!, { onboarded: true }, now);
      await db
        .update(users)
        .set({
          settings: {
            ...ready.settings,
            dashboard: { focusOnly: false },
            profile: { name: 'Local admin' },
          },
        })
        .where(eq(users.id, identity.id));
    }
  }
}

export async function resetLocalOnboarding(db: Db, now: string) {
  const account = LOCAL_TEST_ACCOUNTS[0];
  const existing = await db.query.passwordAccounts.findFirst({
    where: eq(passwordAccounts.email, account.email),
  });
  if (existing) await deleteUser(db, existing.userId);
  await seedLocalTestAccounts(db, now, true);
}
