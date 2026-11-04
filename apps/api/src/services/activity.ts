import { toLocalDate } from '@komogon/core';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { userActiveDays, users, type UserRow } from '../db/schema';

/** How often one account's activity is written, at most. */
export const ACTIVITY_EVERY_MS = 60_000;

/**
 * Notes when each account uses the app, for the admin page (2026-11-03): `last_active_at` on
 * the account, and a row in `user_active_days` for each day it was used, in its own time zone.
 * Called on every signed-in request; writes at most once a minute per account, remembered in
 * memory, so a busy tab costs one small write a minute.
 */
export function activityTracker(db: Db, clock: () => string = () => new Date().toISOString()) {
  const written = new Map<string, number>();
  return async (user: UserRow): Promise<void> => {
    const at = clock();
    const now = Date.parse(at);
    const last = written.get(user.id);
    if (last !== undefined && now - last < ACTIVITY_EVERY_MS) return;
    written.set(user.id, now);
    // Forget accounts that have gone quiet, so the map stays the size of who is around.
    if (written.size > 5000)
      for (const [id, t] of written) if (now - t > ACTIVITY_EVERY_MS) written.delete(id);
    await Promise.all([
      db
        .update(users)
        .set({ lastActiveAt: new Date(at) })
        .where(eq(users.id, user.id)),
      db
        .insert(userActiveDays)
        .values({ userId: user.id, day: toLocalDate(at, user.timezone) })
        .onConflictDoNothing(),
    ]);
    user.lastActiveAt = new Date(at);
  };
}
