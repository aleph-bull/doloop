import type { FastifyInstance } from 'fastify';
import { pickQuote, toLocalDate } from '@komodoit/core';
import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { quotesSeen } from '../db/schema';
import { settingsOf } from '../services/users';

export function quoteRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  /** Today's quote or research tip for this user, recorded so it stays stable all day. */
  app.get('/api/quote', async (req) => {
    const settings = settingsOf(req.user);
    const today = toLocalDate(clock(), req.user.timezone);
    if (settings.quote.mode === 'off') return { date: today, pick: null };
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - 40 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const seen = await db.query.quotesSeen.findMany({
      where: and(eq(quotesSeen.userId, req.user.id), gte(quotesSeen.date, since)),
    });
    const pick = pickQuote(req.user.id, today, settings.quote.mode, seen);
    if (pick && !seen.some((s) => s.date === today)) {
      await db
        .insert(quotesSeen)
        .values({ userId: req.user.id, date: today, quoteId: pick.item.id })
        .onConflictDoNothing();
    }
    return { date: today, pick };
  });
}
