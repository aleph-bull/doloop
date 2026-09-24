import type { FastifyInstance } from 'fastify';
import { pickQuote, quoteSlot, toLocalDate } from '@komogon/core';
import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { quotesSeen } from '../db/schema';
import { settingsOf } from '../services/users';

export function quoteRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  /**
   * This six-hour slot's quote or research tip for this user, recorded so it stays put
   * until `nextAt`, when the next one is due.
   */
  app.get('/api/quote', async (req) => {
    const settings = settingsOf(req.user);
    const now = clock();
    const today = toLocalDate(now, req.user.timezone);
    const slot = quoteSlot(now, req.user.timezone);
    const nextAt = slot.endsAt.toISOString();
    if (settings.quote.mode === 'off') return { date: today, nextAt, pick: null };
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - 40 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const seen = await db.query.quotesSeen.findMany({
      where: and(eq(quotesSeen.userId, req.user.id), gte(quotesSeen.date, since)),
    });
    const pick = pickQuote(req.user.id, slot.key, settings.quote.mode, seen);
    if (pick && !seen.some((s) => s.date === slot.key)) {
      await db
        .insert(quotesSeen)
        .values({ userId: req.user.id, date: slot.key, quoteId: pick.item.id })
        .onConflictDoNothing();
    }
    return { date: today, nextAt, pick };
  });
}
