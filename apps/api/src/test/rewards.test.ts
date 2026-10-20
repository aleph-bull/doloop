import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../db/schema';
import { createTestApp, USER_A, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-09-21T14:00:00.000Z');
  await t.api({ method: 'GET', url: '/api/me' }); // create the user
});
afterAll(() => t.close());

const setXp = (xp: number) => t.db.update(users).set({ xp }).where(eq(users.id, USER_A.id));

const create = (payload: Record<string, unknown>) =>
  t.api({ method: 'POST', url: '/api/rewards', payload });

describe('custom rewards', () => {
  it('starts empty and advertises the price floor', async () => {
    const res = await t.api({ method: 'GET', url: '/api/rewards' });
    expect(res.statusCode).toBe(200);
    expect(res.json().rewards).toEqual([]);
    expect(res.json().limits.minCostXp).toBe(150);
  });

  it('creates a reward', async () => {
    const res = await create({
      name: '  Doomscroll for an hour  ',
      emoji: '📱',
      costXp: 200,
      note: 'guilt-free',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().reward).toMatchObject({
      name: 'Doomscroll for an hour',
      emoji: '📱',
      costXp: 200,
      note: 'guilt-free',
      redeemedCount: 0,
    });
  });

  it('refuses a price under the floor', async () => {
    const res = await create({ name: 'Too cheap', costXp: 149 });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a blank name', async () => {
    expect((await create({ name: '   ', costXp: 500 })).statusCode).toBe(400);
  });

  it('will not redeem without the XP', async () => {
    await setXp(50);
    const id = (await t.api({ method: 'GET', url: '/api/rewards' })).json().rewards[0].id;
    const res = await t.api({ method: 'POST', url: `/api/rewards/${id}/redeem` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/150 XP short/);
  });

  it('redeems, spends the XP, and records the redemption', async () => {
    await setXp(500);
    const id = (await t.api({ method: 'GET', url: '/api/rewards' })).json().rewards[0].id;
    const res = await t.api({ method: 'POST', url: `/api/rewards/${id}/redeem` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ xp: 300, spent: 200 });
    expect(res.json().reward.redeemedCount).toBe(1);

    const me = await t.api({ method: 'GET', url: '/api/me' });
    expect(me.json().user.xp).toBe(300);

    const list = await t.api({ method: 'GET', url: '/api/rewards' });
    expect(list.json().history[0]).toMatchObject({
      name: 'Doomscroll for an hour',
      costXp: 200,
    });
  });

  it('unlocks the reward badge', async () => {
    const res = await t.api({ method: 'GET', url: '/api/achievements' });
    expect(res.json().achievements.map((a: { key: string }) => a.key)).toContain('first-reward');
  });

  it('honours a cooldown, then lets the reward through once it lifts', async () => {
    await setXp(5000);
    const made = await create({ name: 'Weekly treat', costXp: 300, cooldownDays: 7 });
    const id = made.json().reward.id;
    expect((await t.api({ method: 'POST', url: `/api/rewards/${id}/redeem` })).statusCode).toBe(
      200,
    );

    const again = await t.api({ method: 'POST', url: `/api/rewards/${id}/redeem` });
    expect(again.statusCode).toBe(400);
    expect(again.json().error).toMatch(/cooldown until 2026-09-28/);

    t.clock.now = '2026-09-28T14:00:00.000Z';
    expect((await t.api({ method: 'POST', url: `/api/rewards/${id}/redeem` })).statusCode).toBe(
      200,
    );
    t.clock.now = '2026-09-21T14:00:00.000Z';
  });

  it('edits and archives a reward', async () => {
    const id = (await create({ name: 'Editable', costXp: 200 })).json().reward.id;
    let res = await t.api({
      method: 'PATCH',
      url: `/api/rewards/${id}`,
      payload: { costXp: 400, name: 'Renamed' },
    });
    expect(res.json().reward).toMatchObject({ costXp: 400, name: 'Renamed' });

    res = await t.api({ method: 'PATCH', url: `/api/rewards/${id}`, payload: { archived: true } });
    expect(res.json().reward.archived).toBe(true);

    const visible = (await t.api({ method: 'GET', url: '/api/rewards' })).json().rewards;
    expect(visible.some((r: { id: string }) => r.id === id)).toBe(false);
    const all = (await t.api({ method: 'GET', url: '/api/rewards?archived=true' })).json().rewards;
    expect(all.some((r: { id: string }) => r.id === id)).toBe(true);

    // An archived reward cannot be redeemed.
    expect((await t.api({ method: 'POST', url: `/api/rewards/${id}/redeem` })).statusCode).toBe(
      400,
    );
  });

  it('refuses a patch that would drop below the floor', async () => {
    const id = (await create({ name: 'Floor test', costXp: 500 })).json().reward.id;
    const res = await t.api({
      method: 'PATCH',
      url: `/api/rewards/${id}`,
      payload: { costXp: 10 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('deletes a reward but keeps its redemption history', async () => {
    await setXp(5000);
    const id = (await create({ name: 'Ephemeral', costXp: 200 })).json().reward.id;
    await t.api({ method: 'POST', url: `/api/rewards/${id}/redeem` });
    expect((await t.api({ method: 'DELETE', url: `/api/rewards/${id}` })).statusCode).toBe(204);
    const history = (await t.api({ method: 'GET', url: '/api/rewards' })).json().history;
    expect(history.some((h: { name: string }) => h.name === 'Deleted reward')).toBe(true);
  });

  it("will not touch another user's reward", async () => {
    const id = (await create({ name: 'Mine', costXp: 200 })).json().reward.id;
    const res = await t.api({
      method: 'POST',
      url: `/api/rewards/${id}/redeem`,
      token: t.tokenB,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('the reward minimum', () => {
  it('is the user’s to set, once a day, and prices are held to it', async () => {
    const set = (minCostXp: number) =>
      t.api({ method: 'PATCH', url: '/api/me/settings', payload: { rewards: { minCostXp } } });
    expect((await set(300)).statusCode).toBe(200);
    const res = await t.api({ method: 'GET', url: '/api/rewards' });
    expect(res.json().limits.minCostXp).toBe(300);
    const cheap = await create({ name: 'Under the new floor', costXp: 200 });
    expect(cheap.statusCode).toBe(400);
    expect(cheap.json().error).toContain('300 XP');
    // Held for a day once changed.
    expect((await set(100)).statusCode).toBe(400);
  });
});
