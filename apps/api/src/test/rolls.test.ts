import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users, xpTransactions } from '../db/schema';
import { createTestApp, USER_A, USER_B, type TestApp } from './helpers';

let t: TestApp;
/** The next ticket a roll draws: 2^(t - 1) lands on tier t. */
let ticket = 1;
const tierTicket = (tier: number) => 2 ** (tier - 1);

beforeAll(async () => {
  t = await createTestApp('2026-10-25T14:00:00.000Z', { rollTicket: () => ticket });
  for (const token of [t.tokenA, t.tokenB]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
});
afterAll(() => t.close());

const roll = async (tier: number) => {
  ticket = tierTicket(tier);
  return t.api({ method: 'POST', url: '/api/rolls' });
};

describe('rolls', () => {
  it('refuses a roll without 10 XP', async () => {
    const res = await roll(1);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/XP/);
  });

  it('spends 10 XP a roll and keeps the rarest', async () => {
    await t.db.update(users).set({ xp: 100 }).where(eq(users.id, USER_A.id));
    let res = await roll(3);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tier: 3, newBest: true, best: 3, count: 1, xp: 90 });
    res = await roll(1);
    expect(res.json()).toMatchObject({ tier: 1, newBest: false, best: 3, count: 2, xp: 80 });
    const ledger = await t.db.query.xpTransactions.findMany({
      where: and(eq(xpTransactions.userId, USER_A.id), eq(xpTransactions.kind, 'roll')),
    });
    expect(ledger.map((l) => [l.delta, l.ref]).sort()).toEqual([
      [-10, '1'],
      [-10, '3'],
    ]);
  });

  it('counts each rarity on the shop', async () => {
    const shop = (await t.api({ method: 'GET', url: '/api/shop' })).json();
    expect(shop.rolls).toMatchObject({ cost: 10, count: 2, best: 3 });
    expect(shop.rolls.counts.slice(0, 4)).toEqual([1, 0, 1, 0]);
    expect(shop.rolls.counts).toHaveLength(13);
  });

  it('colours the name from 1 in 256, unless turned off', async () => {
    const res = await roll(8);
    expect(res.json()).toMatchObject({ tier: 8, newBest: true, fresh: [] });
    let profile = (
      await t.api({ method: 'GET', url: `/api/profiles/${USER_A.id}`, token: t.tokenB })
    ).json();
    expect(profile.profile).toMatchObject({ rollBest: 8, nameTier: 8 });
    expect(profile.stats.rolls.count).toBe(3);

    await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { social: { rollColour: false } },
    });
    profile = (
      await t.api({ method: 'GET', url: `/api/profiles/${USER_A.id}`, token: t.tokenB })
    ).json();
    expect(profile.profile).toMatchObject({ rollBest: 8, nameTier: null });
    await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { social: { rollColour: true } },
    });
  });

  it('gives a badge for a rarity past 1 in 256, once', async () => {
    const before = (await t.api({ method: 'GET', url: '/api/shop' })).json().xp;
    let res = await roll(9);
    expect(res.json()).toMatchObject({ tier: 9, newBest: true, fresh: ['roll-512'] });
    // 10 for the roll, 150 back for the badge.
    expect(res.json().xp).toBe(before - 10 + 150);
    res = await roll(9);
    expect(res.json()).toMatchObject({ tier: 9, newBest: false, fresh: [] });
  });

  it("shows nothing of it on someone who hasn't rolled", async () => {
    const profile = (await t.api({ method: 'GET', url: `/api/profiles/${USER_B.id}` })).json();
    expect(profile.profile).toMatchObject({ rollBest: 0, nameTier: null });
    expect(profile.stats.rolls).toBeNull();
  });
});
