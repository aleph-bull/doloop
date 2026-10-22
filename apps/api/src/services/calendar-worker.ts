import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client';
import { calendarFeeds, googleCalendar, outlookCalendar, users } from '../db/schema';
import { FEED_REFRESH_MS, syncFeed, type FeedDeps } from './calendar-feeds';
import { syncGoogle, type CalendarDeps } from './calendar-sync';
import { syncCalendarImport, type OutlookDeps } from './calendar-import';

/** Runs on the API, so imports continue while the portal is closed. */
export function registerCalendarWorker(
  app: FastifyInstance,
  db: Db,
  deps: { google: CalendarDeps | null; outlook: OutlookDeps | null },
  clock: () => string,
  feeds?: FeedDeps,
) {
  let running: Promise<void> | null = null;
  let stopped = false;
  const sync = async () => {
    for (const provider of ['google', 'outlook'] as const) {
      if (stopped || !deps[provider]) continue;
      const table = provider === 'google' ? googleCalendar : outlookCalendar;
      const connections = await db.select().from(table);
      for (const connection of connections) {
        if (stopped) return;
        if (
          connection.revokedAt ||
          (connection.lastSyncAt &&
            Date.parse(clock()) - connection.lastSyncAt.getTime() < 15 * 60_000)
        )
          continue;
        try {
          const user = await db.query.users.findFirst({ where: eq(users.id, connection.userId) });
          if (!user) continue;
          if (provider === 'google') {
            const result = await syncGoogle(db, deps.google!, user, clock());
            if (result.status !== 'ok') continue;
          }
          await syncCalendarImport(db, user, provider, deps, clock());
        } catch (err) {
          app.log.error({ err, provider }, 'Calendar background sync failed');
        }
      }
    }
    if (!feeds) return;
    // Calendars added by link. A failed read is saved on the feed and waits its turn too.
    for (const feed of await db.select().from(calendarFeeds)) {
      if (stopped) return;
      if (feed.checkedAt && Date.parse(clock()) - feed.checkedAt.getTime() < FEED_REFRESH_MS)
        continue;
      try {
        const user = await db.query.users.findFirst({ where: eq(users.id, feed.userId) });
        if (user) await syncFeed(db, user, feed, feeds, clock());
      } catch (err) {
        app.log.error({ err, feed: feed.id }, 'Calendar feed refresh failed');
      }
    }
  };
  const tick = () => {
    if (running || stopped) return;
    running = sync()
      .catch((err: unknown) => app.log.error(err, 'Calendar worker failed'))
      .finally(() => {
        running = null;
      });
  };
  const interval = setInterval(tick, 60_000);
  interval.unref();
  app.addHook('onReady', async () => {
    tick();
  });
  app.addHook('onClose', async () => {
    stopped = true;
    clearInterval(interval);
    await running;
  });
}
