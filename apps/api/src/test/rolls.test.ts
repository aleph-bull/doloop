import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rollHoldings, users, xpTransactions } from '../db/schema';
import { createTestApp, USER_A, USER_B, type TestApp } from './helpers';

let t: TestApp;
/** The rarities the next rolls draw, in order; 1/2 once they run out. */
let queue: number[] = [];
/** 2^(t - 1) lands on tier t. */
const ticketFor = (tier: number) => 2 ** (tier - 1);

beforeAll(async () => {
  t = await createTestApp('2026-10-25T14:00:00.000Z', {
    rollTicket: () => ticketFor(queue.shift() ?? 1),
  });
  for (const token of [t.tokenA, t.tokenB]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
});
afterAll(() => t.close());

const roll = async (...tiers: number[]) => {
  queue = [...tiers];
  return t.api({ method: 'POST', url: '/api/rolls' });
};
const profileOfA = async () =>
  (await t.api({ method: 'GET', url: `/api/profiles/${USER_A.id}`, token: t.tokenB })).json();
const setRolls = (rolls: Record<string, unknown>) =>
  t.api({ method: 'PATCH', url: '/api/me/settings', payload: { rolls } });

describe('rolls', () => {
  it('refuses a roll without 10 XP', async () => {
    const res = await roll(1);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/XP/);
  });

  it('spends 10 XP a roll, pays back a tenth of the denominator, and keeps the rarest', async () => {
    await t.db.update(users).set({ xp: 100 }).where(eq(users.id, USER_A.id));
    let res = await roll(3);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      tiers: [3],
      tier: 3,
      newBest: true,
      best: 3,
      count: 1,
      // 1/8 pays back 1 XP.
      won: 1,
      xp: 91,
    });
    res = await roll(1);
    expect(res.json()).toMatchObject({
      tier: 1,
      newBest: false,
      best: 3,
      count: 2,
      won: 0,
      xp: 81,
    });
    const ledger = await t.db.query.xpTransactions.findMany({
      where: and(eq(xpTransactions.userId, USER_A.id), eq(xpTransactions.kind, 'roll')),
    });
    expect(ledger.map((l) => [l.delta, l.ref]).sort()).toEqual([
      [-10, '1'],
      [-9, '3'],
    ]);
  });

  it('counts each rarity on the shop', async () => {
    const shop = (await t.api({ method: 'GET', url: '/api/shop' })).json();
    expect(shop.rolls).toMatchObject({ cost: 10, count: 2, best: 3 });
    expect(shop.rolls.counts.slice(0, 4)).toEqual([1, 0, 1, 0]);
    expect(shop.rolls.counts).toHaveLength(15);
  });

  it('styles the name by the rarest from 1/256, or the one picked', async () => {
    const res = await roll(8);
    // 1/32 or rarer is a badge of its own; 1/64 or rarer in the first ten rolls another.
    expect(res.json()).toMatchObject({
      tier: 8,
      newBest: true,
      fresh: ['roll-rare', 'roll-beginner'],
    });
    let profile = await profileOfA();
    expect(profile.profile).toMatchObject({ rollBest: 8, nameTier: 8 });
    expect(profile.rolls).toMatchObject({ best: 8, count: 3 });
    expect(profile.rolls.badges.map((b: { key: string }) => b.key)).toEqual([
      'roll-beginner',
      'roll-rare',
    ]);

    await setRolls({ name: 'off' });
    expect((await profileOfA()).profile.nameTier).toBeNull();
    await setRolls({ name: 8 });
    expect((await profileOfA()).profile.nameTier).toBe(8);
    // Rarer than anything rolled yet: back to the rarest.
    await setRolls({ name: 12 });
    expect((await profileOfA()).profile.nameTier).toBe(8);
    // Only Sapphire (1/256) and up can be worn.
    expect((await setRolls({ name: 5 })).statusCode).toBe(400);
    await setRolls({ name: 'auto' });
    profile = await profileOfA();
    expect(profile.profile.nameTier).toBe(8);
  });

  it('keeps them off the profile when asked, the name style aside', async () => {
    await setRolls({ profile: false });
    const profile = await profileOfA();
    expect(profile.profile).toMatchObject({ rollBest: 0, nameTier: 8 });
    expect(profile.rolls).toBeNull();
    await setRolls({ profile: true });
  });

  it('gives a badge for a rarity past 1/256, and for gambling feats, once', async () => {
    const before = (await t.api({ method: 'GET', url: '/api/shop' })).json().xp;
    let res = await roll(9);
    // Two of 1/16 or rarer in a row (1/256 then 1/512) is Double take.
    expect(res.json()).toMatchObject({
      tier: 9,
      newBest: true,
      fresh: ['roll-double', 'roll-512'],
    });
    // 10 for the roll, 51 back for 1/512, 75 and 150 for the badges.
    expect(res.json().xp).toBe(before - 10 + 51 + 75 + 150);
    res = await roll(9);
    expect(res.json()).toMatchObject({ tier: 9, newBest: false, fresh: [] });
    // RNG Rolls badges stay off Top badges: they have their own card.
    const profile = await profileOfA();
    expect(profile.badges.some((b: { key: string }) => b.key.startsWith('roll'))).toBe(false);
    expect(profile.rolls.badges.map((b: { key: string }) => b.key)).toEqual([
      'roll-512',
      'roll-beginner',
      'roll-double',
      'roll-rare',
    ]);
  });

  it('rolls ten at once for 100 XP, landing on the rarest', async () => {
    await t.db.update(users).set({ xp: 100 }).where(eq(users.id, USER_A.id));
    queue = [1, 2, 1, 6, 1, 1, 3, 1, 2, 1];
    const res = await t.api({ method: 'POST', url: '/api/rolls', payload: { count: 10 } });
    expect(res.statusCode).toBe(200);
    // Ten more makes fifteen: Pocket change, paid back on top.
    expect(res.json()).toMatchObject({
      tiers: [1, 2, 1, 6, 1, 1, 3, 1, 2, 1],
      tier: 6,
      newBest: false,
      count: 15,
      // 1/64 pays 6 and 1/8 pays 1; Pocket change 25.
      won: 7,
      xp: 7 + 25,
      fresh: ['rolls-10'],
    });
    const shop = (await t.api({ method: 'GET', url: '/api/shop' })).json();
    expect(shop.rolls.counts.slice(0, 6)).toEqual([7, 2, 2, 0, 0, 1]);
    const again = await t.api({ method: 'POST', url: '/api/rolls', payload: { count: 10 } });
    expect(again.statusCode).toBe(400);
    const odd = await t.api({ method: 'POST', url: '/api/rolls', payload: { count: 7 } });
    expect(odd.statusCode).toBe(400);
  });

  it("shows nothing of it on someone who hasn't rolled", async () => {
    const profile = (await t.api({ method: 'GET', url: `/api/profiles/${USER_B.id}` })).json();
    expect(profile.profile).toMatchObject({ rollBest: 0, nameTier: null });
    expect(profile.rolls).toBeNull();
  });
});

describe('prestige', () => {
  const heldOfB = async () =>
    (await t.api({ method: 'GET', url: '/api/shop', token: t.tokenB })).json().rolls.counts;
  const prestigeB = (payload: Record<string, unknown>) =>
    t.api({ method: 'POST', url: '/api/rolls/prestige', token: t.tokenB, payload });

  it('turns five of a rarity into one of the next', async () => {
    await t.db.update(users).set({ xp: 1000 }).where(eq(users.id, USER_B.id));
    queue = Array(12).fill(1);
    await t.api({ method: 'POST', url: '/api/rolls', token: t.tokenB, payload: { count: 10 } });
    expect((await heldOfB()).slice(0, 2)).toEqual([10, 0]);
    const res = await prestigeB({ tier: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tier: 2, newBest: true, best: 2 });
    expect(res.json().held.slice(0, 2)).toEqual([5, 1]);
    expect((await heldOfB()).slice(0, 2)).toEqual([5, 1]);
    // Rolls held are not rolls rolled: the count stays ten.
    expect(
      (await t.api({ method: 'GET', url: '/api/shop', token: t.tokenB })).json().rolls.count,
    ).toBe(10);
  });

  it('refuses without five, past the rarest, or with nothing to say', async () => {
    expect((await prestigeB({ tier: 2 })).statusCode).toBe(400);
    expect((await prestigeB({ tier: 15 })).statusCode).toBe(400);
    expect((await prestigeB({})).statusCode).toBe(400);
  });

  it('prestiges everything it can, and a made rarity counts as the rarest', async () => {
    await t.db
      .insert(rollHoldings)
      .values({ userId: USER_B.id, tier: 4, held: 25 })
      .onConflictDoUpdate({ target: [rollHoldings.userId, rollHoldings.tier], set: { held: 25 } });
    const res = await prestigeB({ all: true });
    // 5 commons make 1 more uncommon (2); 25 of 1/16 make 5 of 1/32, which make 1 of 1/64.
    expect(res.json().held.slice(0, 6)).toEqual([0, 2, 0, 0, 0, 1]);
    expect(res.json().made.slice(0, 6)).toEqual([0, 1, 0, 0, 5, 1]);
    expect(res.json()).toMatchObject({ tier: 6, newBest: true, best: 6, fresh: ['roll-rare'] });
    const profile = (await t.api({ method: 'GET', url: `/api/profiles/${USER_B.id}` })).json();
    expect(profile.profile.rollBest).toBe(6);
    expect(profile.rolls.counts.slice(0, 6)).toEqual([0, 2, 0, 0, 0, 1]);
  });
});
