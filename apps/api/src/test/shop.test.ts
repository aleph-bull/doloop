import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../db/schema';
import { advanceClock, createTestApp, USER_A, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-09-21T14:00:00.000Z');
  await t.api({ method: 'GET', url: '/api/me' }); // create the user
});
afterAll(() => t.close());

describe('shop', () => {
  it('lists costs, inventory, cosmetics, and badges', async () => {
    const res = await t.api({ method: 'GET', url: '/api/shop' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.freeze).toEqual({ cost: 150, held: 0, max: 2 });
    expect(body.breakDay.cost).toBe(300);
    expect(body.badges.length).toBeGreaterThan(10);
    expect(body.accents.find((a: { id: string }) => a.id === 'violet').unlocked).toBe(false);
  });

  it('refuses purchases without XP', async () => {
    const res = await t.api({ method: 'POST', url: '/api/shop/freeze' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/150 XP/);
  });

  it('buys freezes and break days with escalating monthly cost', async () => {
    await t.db.update(users).set({ xp: 2000, level: 6 }).where(eq(users.id, USER_A.id));
    let res = await t.api({ method: 'POST', url: '/api/shop/freeze' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ xp: 1850, streak: { freezesHeld: 1 } });
    await t.api({ method: 'POST', url: '/api/shop/freeze' });
    res = await t.api({ method: 'POST', url: '/api/shop/freeze' });
    expect(res.statusCode).toBe(400); // max 2 held

    res = await t.api({ method: 'POST', url: '/api/shop/break-day' });
    expect(res.json()).toMatchObject({ xp: 1400, nextCost: 450, streak: { breakDaysHeld: 1 } });
    res = await t.api({ method: 'POST', url: '/api/shop/break-day' });
    expect(res.json()).toMatchObject({ xp: 950, nextCost: 675 });
    res = await t.api({ method: 'POST', url: '/api/shop/break-day' });
    expect(res.statusCode).toBe(400); // max 2 held
    const shop = await t.api({ method: 'GET', url: '/api/shop' });
    expect(shop.json().breakDay.boughtThisMonth).toBe(2);
  });

  it('applies a break day only 24h ahead and it counts as a rest day', async () => {
    let res = await t.api({
      method: 'POST',
      url: '/api/shop/break-day/apply',
      payload: { date: '2026-09-21' },
    });
    expect(res.statusCode).toBe(400);
    res = await t.api({
      method: 'POST',
      url: '/api/shop/break-day/apply',
      payload: { date: '2026-09-23' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().breakDays).toEqual(['2026-09-23']);
    expect(res.json().streak.breakDaysHeld).toBe(1);
    const rest = await t.api({ method: 'GET', url: '/api/rest-days' });
    expect(rest.json().policy.breakDays).toEqual(['2026-09-23']);
  });

  it('sells backgrounds and enforces level gates on theme settings', async () => {
    let res = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { theme: { accent: 'violet' } },
    });
    expect(res.statusCode).toBe(400);
    res = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { theme: { accent: 'amber' } },
    });
    expect(res.statusCode).toBe(200); // level 6 >= 5
    res = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { theme: { backgroundId: 'prism' } },
    });
    expect(res.statusCode).toBe(400);
    res = await t.api({ method: 'POST', url: '/api/shop/background', payload: { id: 'prism' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().purchasedBackgrounds).toEqual(['prism']);
    expect(res.json().xp).toBe(550);
    res = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { theme: { backgroundId: 'prism' } },
    });
    expect(res.statusCode).toBe(200);
    res = await t.api({ method: 'POST', url: '/api/shop/background', payload: { id: 'prism' } });
    expect(res.statusCode).toBe(400); // already owned
    res = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { theme: { accent: 'custom:200,60,50' } },
    });
    expect(res.statusCode).toBe(200);
  });

  it('unlocks badges at session end and lists them', async () => {
    const node = (
      await t.api({ method: 'POST', url: '/api/nodes', payload: { title: 'T' } })
    ).json().node;
    const s = (
      await t.api({
        method: 'POST',
        url: '/api/sessions',
        payload: { nodeId: node.id, mode: 'unlimited' },
      })
    ).json().active.session.id;
    advanceClock(t, 20);
    const end = await t.api({
      method: 'POST',
      url: `/api/sessions/${s}/end`,
      payload: { review: { distracted: 'no' } },
    });
    expect(end.json().summary.badges).toEqual(['first-session', 'first-review']);
    const list = await t.api({ method: 'GET', url: '/api/achievements' });
    expect(list.json().achievements.map((a: { key: string }) => a.key)).toEqual([
      'first-session',
      'first-review',
    ]);
    expect(list.json().fresh).toEqual([]);
    const session = await t.api({ method: 'GET', url: `/api/sessions/${s}` });
    expect(session.json().session.badgesAwarded).toEqual(['first-session', 'first-review']);
  });
});
