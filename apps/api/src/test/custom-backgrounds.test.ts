import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { userAssets, users, xpTransactions } from '../db/schema';
import { advanceClock, createTestApp, USER_A, type TestApp } from './helpers';

// The pictures stay in the browser: the API only sees an id and a fingerprint.
const hash = (n: number) => createHash('sha256').update(`picture ${n}`).digest('hex');

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-10-25T14:00:00.000Z');
  await t.api({ method: 'GET', url: '/api/me' }); // create the user
});
afterAll(() => t.close());

const list = async () => (await t.api({ method: 'GET', url: '/api/me/backgrounds' })).json();
const me = async () => (await t.api({ method: 'GET', url: '/api/me' })).json();
const add = (n: number, cost: number, id: string = randomUUID()) =>
  t.api({ method: 'POST', url: '/api/me/backgrounds', payload: { id, hash: hash(n), cost } });
const xpOf = async () => (await t.db.query.users.findFirst({ where: eq(users.id, USER_A.id) }))!.xp;

describe('uploaded backgrounds', () => {
  const first = randomUUID();
  let second = '';

  it('records the first one for free and puts it on', async () => {
    expect(await list()).toEqual({ backgrounds: [], cost: 0 });
    const res = await add(1, 0, first);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ background: { id: first, hash: hash(1) }, xp: 0, cost: 50 });
    expect((await me()).user.settings.theme).toMatchObject({
      customBackgroundUrl: 'upload',
      customBackgroundId: first,
    });
    expect((await list()).cost).toBe(50);
  });

  it('charges 50 XP for the next, only at the price the person saw', async () => {
    // Sent as free, the API answers with the real price instead of charging it.
    let res = await add(2, 0);
    expect(res.statusCode).toBe(409);
    expect(res.json().details).toEqual({ cost: 50 });
    res = await add(2, 50);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Another background is 50 XP.');
    expect((await list()).backgrounds).toHaveLength(1);

    await t.db.update(users).set({ xp: 120, level: 3 }).where(eq(users.id, USER_A.id));
    advanceClock(t, 1);
    res = await add(2, 50);
    expect(res.statusCode).toBe(200);
    second = res.json().background.id;
    expect(res.json()).toMatchObject({ xp: 70, cost: 50 });
    expect(await xpOf()).toBe(70);
    // Spending XP never takes a level away.
    expect((await t.db.query.users.findFirst({ where: eq(users.id, USER_A.id) }))!.level).toBe(3);
    const spent = await t.db.query.xpTransactions.findMany({
      where: and(eq(xpTransactions.userId, USER_A.id), eq(xpTransactions.kind, 'background')),
    });
    expect(spent.map((s) => [s.delta, s.ref])).toEqual([[-50, `upload:${second}`]]);
    expect((await me()).user.settings.theme.customBackgroundId).toBe(second);
    expect((await list()).backgrounds.map((b: { id: string }) => b.id)).toEqual([second, first]);
  });

  it('puts the same picture back on for free instead of adding it twice', async () => {
    const res = await add(1, 50);
    expect(res.statusCode).toBe(200);
    expect(res.json().background.id).toBe(first);
    expect(await xpOf()).toBe(70);
    expect((await list()).backgrounds).toHaveLength(2);
    expect((await me()).user.settings.theme.customBackgroundId).toBe(first);
  });

  it('switches between them in settings, and only to your own', async () => {
    let res = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { theme: { customBackgroundUrl: 'upload', customBackgroundId: second } },
    });
    expect(res.statusCode).toBe(200);
    res = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { theme: { customBackgroundId: '33333333-3333-4333-8333-333333333333' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('takes a deleted one off the screen, and with none left the next is free again', async () => {
    let res = await t.api({ method: 'DELETE', url: `/api/me/backgrounds/${second}` });
    expect(res.statusCode).toBe(204);
    expect((await me()).user.settings.theme).toMatchObject({
      customBackgroundUrl: null,
      customBackgroundId: null,
    });
    expect((await list()).cost).toBe(50);
    res = await t.api({ method: 'DELETE', url: `/api/me/backgrounds/${first}` });
    expect(res.statusCode).toBe(204);
    expect(await list()).toEqual({ backgrounds: [], cost: 0 });
    // No XP comes back.
    expect(await xpOf()).toBe(70);
    res = await t.api({ method: 'DELETE', url: `/api/me/backgrounds/${first}` });
    expect(res.statusCode).toBe(404);
  });

  it('moves a background the API kept from before into the browser, then drops its copy', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('old upload').toString('base64')}`;
    let res = await t.api({ method: 'PUT', url: '/api/me/background', payload: { dataUrl } });
    expect(res.statusCode).toBe(200);
    expect((await me()).backgroundUpdatedAt).not.toBeNull();
    // Nothing is deleted before the portal says it filed the picture.
    expect((await t.api({ method: 'POST', url: '/api/me/backgrounds/adopted' })).statusCode).toBe(
      400,
    );
    const id = randomUUID();
    res = await t.api({ method: 'POST', url: '/api/me/backgrounds/adopt', payload: { id } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      background: {
        id,
        hash: createHash('sha256').update(dataUrl).digest('hex'),
        createdAt: expect.any(String),
      },
      dataUrl,
    });
    // Asked again (an answer lost on the way), it is the same one, not a second.
    res = await t.api({
      method: 'POST',
      url: '/api/me/backgrounds/adopt',
      payload: { id: randomUUID() },
    });
    expect(res.json().background.id).toBe(id);
    expect((await me()).user.settings.theme).toMatchObject({
      customBackgroundUrl: 'upload',
      customBackgroundId: id,
    });
    // It was theirs already: free, and the next is the paid one.
    expect(await list()).toMatchObject({ cost: 50 });
    expect(await xpOf()).toBe(70);

    res = await t.api({ method: 'POST', url: '/api/me/backgrounds/adopted' });
    expect(res.statusCode).toBe(204);
    const left = await t.db.query.userAssets.findFirst({
      where: and(eq(userAssets.userId, USER_A.id), eq(userAssets.kind, 'background')),
    });
    expect(left).toBeUndefined();
    expect((await me()).backgroundUpdatedAt).toBeNull();
    expect((await me()).user.settings.theme.customBackgroundId).toBe(id);
  });
});
