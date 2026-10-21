import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { signDevToken } from '../auth/verify';

export async function accountSession(
  db: Db,
  secret: string,
  identity: { id: string; email: string },
) {
  const user = await db.query.users.findFirst({ where: eq(users.id, identity.id) });
  return {
    token: await signDevToken(
      secret,
      { ...identity, authVersion: user?.authVersion ?? 0 },
      30 * 24 * 60 * 60,
    ),
    email: identity.email,
  };
}
