import { badgeXp } from '@komogon/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { achievements, users } from '../db/schema';
import { backPayBadges } from '../services/achievements';
import { createTestApp, USER_A, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-09-21T14:00:00.000Z');
  await t.api({ method: 'GET', url: '/api/me' }); // create the user
});
afterAll(() => t.close());

const xpOf = async () => (await t.db.query.users.findFirst({ where: eq(users.id, USER_A.id) }))!;

describe('back-paying badges', () => {
  it('pays badges earned before badges paid XP, once', async () => {
    const me = await xpOf();
    // Badges unlocked the old way: a row, but no XP and no ledger line.
    await t.db.insert(achievements).values([
      { userId: me.id, key: 'streak-7', unlockedAt: new Date(t.clock.now) },
      { userId: me.id, key: 'hours-10', unlockedAt: new Date(t.clock.now) },
    ]);
    expect(await backPayBadges(t.db, t.clock.now)).toBe(2);
    const after = await xpOf();
    expect(after.xp - me.xp).toBe(badgeXp('streak-7') + badgeXp('hours-10'));
    // Run again: nothing more is owed.
    expect(await backPayBadges(t.db, t.clock.now)).toBe(0);
    expect((await xpOf()).xp).toBe(after.xp);
  });
});
