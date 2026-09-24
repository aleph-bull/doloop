import type { FastifyInstance } from 'fastify';
import {
  ACCENT_PRESETS,
  applyBreakDay,
  BACKGROUNDS,
  BADGES,
  breakDayCost,
  purchaseBackground,
  purchaseBreakDay,
  purchaseFreeze,
  SHOP,
  toLocalDate,
  unlockedAccents,
} from '@komogon/core';
import { and, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { users, xpTransactions } from '../db/schema';
import { badRequest } from '../errors';
import { listAchievements, unlockNewBadges } from '../services/achievements';
import { dt } from '../services/sessions-mapper';
import { getPolicy, savePolicy, syncStreak } from '../services/users';
import { isoDate } from '../validation';

async function breakDaysBoughtThisMonth(
  db: Db,
  userId: string,
  now: string,
  tz: string,
): Promise<number> {
  const month = toLocalDate(now, tz).slice(0, 7);
  // Month start in UTC is a safe lower bound; filter precisely by local month below.
  const since = new Date(`${month}-01T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 1);
  const rows = await db.query.xpTransactions.findMany({
    where: and(
      eq(xpTransactions.userId, userId),
      eq(xpTransactions.kind, 'break-day'),
      gte(xpTransactions.at, since),
    ),
  });
  return rows.filter((r) => toLocalDate(r.at.toISOString(), tz).slice(0, 7) === month).length;
}

export function shopRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  /** Everything the shop and achievements page need in one call. */
  app.get('/api/shop', async (req) => {
    const now = clock();
    const streak = await syncStreak(db, req.user, now);
    await unlockNewBadges(db, req.user, now);
    const bought = await breakDaysBoughtThisMonth(db, req.user.id, now, req.user.timezone);
    return {
      xp: req.user.xp,
      level: req.user.level,
      streak: streak.streak,
      freeze: { cost: SHOP.FREEZE_COST, held: streak.streak.freezesHeld, max: SHOP.MAX_FREEZES },
      breakDay: {
        cost: breakDayCost(bought),
        held: streak.streak.breakDaysHeld,
        max: SHOP.MAX_BREAK_DAYS,
        boughtThisMonth: bought,
        minLeadHours: SHOP.BREAK_DAY_MIN_LEAD_HOURS,
      },
      backgrounds: BACKGROUNDS.map((b) => ({
        ...b,
        owned:
          b.costXp === null
            ? b.minLevel <= req.user.level
            : req.user.purchasedBackgrounds.includes(b.id),
      })),
      accents: ACCENT_PRESETS.map((a) => ({
        ...a,
        unlocked: unlockedAccents(req.user.level).some((u) => u.id === a.id),
      })),
      badges: BADGES,
      achievements: await listAchievements(db, req.user.id),
    };
  });

  app.post('/api/shop/freeze', async (req) => {
    const now = clock();
    const r = purchaseFreeze({ xp: req.user.xp, streak: req.user.streak });
    if (!r.ok) throw badRequest(r.reason);
    await db
      .update(users)
      .set({ xp: r.value.xp, streak: r.value.streak })
      .where(eq(users.id, req.user.id));
    await db.insert(xpTransactions).values({
      userId: req.user.id,
      at: dt(now),
      delta: -SHOP.FREEZE_COST,
      kind: 'freeze',
      ref: null,
    });
    return { xp: r.value.xp, streak: r.value.streak };
  });

  app.post('/api/shop/break-day', async (req) => {
    const now = clock();
    const bought = await breakDaysBoughtThisMonth(db, req.user.id, now, req.user.timezone);
    const cost = breakDayCost(bought);
    const r = purchaseBreakDay({ xp: req.user.xp, streak: req.user.streak }, bought);
    if (!r.ok) throw badRequest(r.reason);
    await db
      .update(users)
      .set({ xp: r.value.xp, streak: r.value.streak })
      .where(eq(users.id, req.user.id));
    await db
      .insert(xpTransactions)
      .values({ userId: req.user.id, at: dt(now), delta: -cost, kind: 'break-day', ref: null });
    return { xp: r.value.xp, streak: r.value.streak, nextCost: breakDayCost(bought + 1) };
  });

  /** Spend a held break day on a date at least 24 h ahead. */
  app.post('/api/shop/break-day/apply', async (req) => {
    const { date } = z.object({ date: isoDate }).parse(req.body);
    const now = clock();
    const policy = await getPolicy(db, req.user.id);
    const r = applyBreakDay({
      policy,
      streak: req.user.streak,
      date,
      now,
      timezone: req.user.timezone,
    });
    if (!r.ok) throw badRequest(r.reason);
    await savePolicy(db, r.value.policy);
    await db.update(users).set({ streak: r.value.streak }).where(eq(users.id, req.user.id));
    return { streak: r.value.streak, breakDays: r.value.policy.breakDays };
  });

  app.post('/api/shop/background', async (req) => {
    const { id } = z.object({ id: z.string().max(32) }).parse(req.body);
    const now = clock();
    const r = purchaseBackground(req.user.xp, id, req.user.purchasedBackgrounds);
    if (!r.ok) throw badRequest(r.reason);
    const cost = req.user.xp - r.value.xp;
    await db
      .update(users)
      .set({ xp: r.value.xp, purchasedBackgrounds: r.value.purchasedIds })
      .where(eq(users.id, req.user.id));
    await db
      .insert(xpTransactions)
      .values({ userId: req.user.id, at: dt(now), delta: -cost, kind: 'background', ref: id });
    return { xp: r.value.xp, purchasedBackgrounds: r.value.purchasedIds };
  });

  app.get('/api/achievements', async (req) => {
    const now = clock();
    await syncStreak(db, req.user, now);
    const fresh = await unlockNewBadges(db, req.user, now);
    return { badges: BADGES, achievements: await listAchievements(db, req.user.id), fresh };
  });
}
