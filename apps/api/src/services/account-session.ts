import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { signDevToken } from '../auth/verify';
import { assertMayEnter } from './moderation';

/** A signed-in session's token. Every way of signing in ends here, so bans are checked here. */
export async function accountSession(
  db: Db,
  secret: string,
  identity: { id: string; email: string },
) {
  await assertMayEnter(db, identity);
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
