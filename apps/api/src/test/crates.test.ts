import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { petsOf } from '@komogon/core';
import { inventoryItems, rollHoldings, users, xpTransactions } from '../db/schema';
import { createTestApp, USER_A, USER_B, type TestApp } from './helpers';

let t: TestApp;
/** The rarities the next rolls draw; 1/2 once they run out. */
let rolls: number[] = [];
/** What the next crates draw: the line of the table, then which pet; 0 once they run out. */
let tickets: number[] = [];
/** 2^(t - 1) lands on tier t. */
const ticketFor = (tier: number) => 2 ** (tier - 1);

beforeAll(async () => {
  t = await createTestApp('2026-10-29T14:00:00.000Z', {
    rollTicket: () => ticketFor(rolls.shift() ?? 1),
    crateTicket: () => tickets.shift() ?? 0,
  });
  for (const token of [t.tokenA, t.tokenB]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
  await t.db.update(users).set({ xp: 1000 });
});
afterAll(() => t.close());

const roll = async (token: string, ...tiers: number[]) => {
  rolls = [...tiers];
  return (
    await t.api({
      method: 'POST',
      url: '/api/rolls',
      token,
      payload: { count: tiers.length === 10 ? 10 : 1 },
    })
  ).json();
};
const inventory = async (token = t.tokenA) =>
  (await t.api({ method: 'GET', url: '/api/inventory', token })).json();
const choose = (ids: string[], choice: 'crate' | 'title', token = t.tokenA) =>
  t.api({ method: 'POST', url: '/api/crates/choose', token, payload: { ids, choice } });
const open = (tier: number, ...draw: number[]) => {
  tickets = [...draw];
  return t.api({ method: 'POST', url: '/api/crates/open', payload: { tier } });
};
/** Add to someone's stack directly. */
const give = (userId: string, kind: 'crate' | 'pet', item: string, count: number) =>
  t.db
    .insert(inventoryItems)
    .values({ userId, kind, item, count })
    .onConflictDoUpdate({
      target: [inventoryItems.userId, inventoryItems.kind, inventoryItems.item],
      set: { count: sql`${inventoryItems.count} + excluded.count` },
    });
const heldOf = async (token = t.tokenA) =>
  (await t.api({ method: 'GET', url: '/api/shop', token })).json().rolls.counts as number[];

describe('crates', () => {
  it('offers a crate for a roll of 1/64 or rarer, and none below', async () => {
    let r = await roll(t.tokenA, 5);
    expect(r.offers).toEqual([]);
    r = await roll(t.tokenA, 6);
    expect(r.offers).toEqual([{ id: expect.any(String), tier: 6 }]);
    // Until it's chosen, the roll is held.
    expect((await heldOf())[5]).toBe(1);
    expect((await inventory()).offers).toEqual(r.offers);
  });

  it('trades the roll for the crate when it is taken', async () => {
    const { offers } = await inventory();
    const res = await choose([offers[0].id], 'crate');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ taken: [6] });
    expect(res.json().held[5]).toBe(0);
    expect(res.json().inventory).toMatchObject({
      crates: [{ tier: 6, count: 1 }],
      pets: [],
      offers: [],
      global: { 'crate:6': 1 },
    });
    // The record stays: it was still landed.
    const shop = (await t.api({ method: 'GET', url: '/api/shop' })).json();
    expect(shop.rolls.best).toBe(6);
  });

  it('keeps the roll when the title is kept', async () => {
    const r = await roll(t.tokenA, 7);
    const res = await choose([r.offers[0].id], 'title');
    expect(res.json()).toMatchObject({ taken: [] });
    expect(res.json().held[6]).toBe(1);
    expect(res.json().inventory.crates).toEqual([{ tier: 6, count: 1 }]);
    expect(res.json().inventory.offers).toEqual([]);
  });

  it("can't choose someone else's offer", async () => {
    const r = await roll(t.tokenB, 6);
    const res = await choose([r.offers[0].id], 'crate');
    expect(res.json().taken).toEqual([]);
    expect((await inventory(t.tokenB)).offers).toHaveLength(1);
    await choose([r.offers[0].id], 'title', t.tokenB);
  });

  it('opens into a pet, the first of its kind new', async () => {
    // Past the 557 tickets of XP, the commons; the second ticket picks the third of them.
    const pet = petsOf('common')[2]!.id;
    const res = await open(6, 557, 2);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ win: { kind: 'pet', pet }, isNew: true });
    expect(res.json().inventory).toMatchObject({
      crates: [],
      pets: [{ id: pet, count: 1 }],
      global: { [`pet:${pet}`]: 1 },
    });
    expect(res.json().inventory.global['crate:6']).toBeUndefined();
  });

  it('refuses a crate they have none of', async () => {
    const res = await open(6, 0, 0);
    expect(res.statusCode).toBe(400);
    expect((await open(5, 0, 0)).statusCode).toBe(400);
  });

  it('pays XP into the balance and lifetime, written in the ledger', async () => {
    await give(USER_A.id, 'crate', '6', 2);
    const before = await t.db.query.users.findFirst({ where: eq(users.id, USER_A.id) });
    const res = await open(6, 0, 0);
    expect(res.json()).toMatchObject({ win: { kind: 'xp', xp: 5 }, xp: before!.xp + 5 });
    const after = await t.db.query.users.findFirst({ where: eq(users.id, USER_A.id) });
    expect(after!.xpEarned).toBe(before!.xpEarned + 5);
    const ledger = await t.db.query.xpTransactions.findMany({
      where: and(eq(xpTransactions.userId, USER_A.id), eq(xpTransactions.kind, 'crate')),
    });
    expect(ledger.map((l) => [l.delta, l.ref])).toEqual([[5, '6']]);
  });

  it('can hold another crate, and a second pet of a kind stacks', async () => {
    // The last ten tickets of a Crystal crate are an Ember crate.
    let res = await open(6, 999, 0);
    expect(res.json()).toMatchObject({ win: { kind: 'crate', tier: 7 }, isNew: false });
    expect(res.json().inventory.crates).toEqual([{ tier: 7, count: 1 }]);
    await give(USER_A.id, 'crate', '6', 1);
    const pet = petsOf('common')[2]!.id;
    res = await open(6, 557, 2);
    expect(res.json()).toMatchObject({ win: { kind: 'pet', pet }, isNew: false });
    expect(res.json().inventory.pets).toEqual([{ id: pet, count: 2 }]);
  });

  it('counts how many exist across everyone', async () => {
    await give(USER_B.id, 'pet', petsOf('common')[2]!.id, 3);
    const inv = await inventory();
    expect(inv.global[`pet:${petsOf('common')[2]!.id}`]).toBe(5);
    expect(inv.global['crate:7']).toBe(1);
  });

  it('offers crates for rarities prestige makes, 1/64 and rarer', async () => {
    await t.db
      .insert(rollHoldings)
      .values({ userId: USER_B.id, tier: 5, held: 5 })
      .onConflictDoUpdate({ target: [rollHoldings.userId, rollHoldings.tier], set: { held: 5 } });
    const res = await t.api({
      method: 'POST',
      url: '/api/rolls/prestige',
      token: t.tokenB,
      payload: { tier: 5 },
    });
    expect(res.json().offers).toEqual([{ id: expect.any(String), tier: 6 }]);
    // Five of 1/16 make a 1/32: no crate.
    await t.db
      .insert(rollHoldings)
      .values({ userId: USER_B.id, tier: 4, held: 5 })
      .onConflictDoUpdate({ target: [rollHoldings.userId, rollHoldings.tier], set: { held: 5 } });
    const low = await t.api({
      method: 'POST',
      url: '/api/rolls/prestige',
      token: t.tokenB,
      payload: { tier: 4 },
    });
    expect(low.json().offers).toEqual([]);
  });

  it('lets an offer go when its roll was prestiged away since', async () => {
    const { offers } = await inventory(t.tokenB);
    await t.db
      .update(rollHoldings)
      .set({ held: 0 })
      .where(and(eq(rollHoldings.userId, USER_B.id), eq(rollHoldings.tier, 6)));
    const res = await choose(
      offers.map((o: { id: string }) => o.id),
      'crate',
      t.tokenB,
    );
    expect(res.json()).toMatchObject({ taken: [] });
    expect(res.json().inventory.offers).toEqual([]);
    expect(res.json().inventory.crates).toEqual([]);
  });
});
