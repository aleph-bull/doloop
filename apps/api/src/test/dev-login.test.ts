import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createHsVerifier } from '../auth/verify';
import { createPgliteDb, type Db } from '../db/client';
import { users } from '../db/schema';
import { buildServer } from '../server';
import { DEV_PASSWORD_HASH } from '../services/dev-accounts';
import { checkPassword, hashPassword } from '../services/passwords';

const SECRET = 'dev-login-test-secret';
// A stand-in: the real dev password is never written into the (public) repository.
const DEV_PW = 'test-dev-password';

describe('the dev password', () => {
  it('is kept as an scrypt hash only', async () => {
    expect(DEV_PASSWORD_HASH.startsWith('scrypt$')).toBe(true);
    expect(await checkPassword('', DEV_PASSWORD_HASH)).toBe(false);
  });
});

describe("I'm a dev", () => {
  let app: FastifyInstance;
  let db: Db;
  let close: () => Promise<void>;
  const clock = { now: new Date().toISOString() };

  beforeAll(async () => {
    ({ db, close } = await createPgliteDb());
    app = await buildServer({
      db,
      verifier: createHsVerifier(SECRET),
      passwordAuth: { secret: SECRET, limits: null },
      adminEmails: ['boss@example.com'],
      devLogin: { passwordHash: await hashPassword(DEV_PW), limits: null },
      clock: () => clock.now,
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  const devSignIn = (kind?: 'fresh' | 'jerry', password = DEV_PW) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/dev',
      payload: { password, kind },
      headers: { 'x-timezone': 'America/Toronto' },
    });
  const as = (token: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      payload,
      headers: { authorization: `Bearer ${token}`, 'x-timezone': 'America/Toronto' },
    });
  const get = async (token: string, url: string) => {
    const res = await as(token, 'GET', url);
    expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
    return res.json();
  };
  const realAccount = async (email: string, name: string) => {
    const token = (
      await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { email, password: 'hunter22' },
      })
    ).json().token as string;
    await as(token, 'PATCH', '/api/me', { onboarded: true });
    await as(token, 'PATCH', '/api/me/settings', { profile: { name } });
    return token;
  };

  it('says the button can show', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/dev' })).json()).toEqual({
      enabled: true,
    });
  });

  it('refuses the wrong password', async () => {
    const res = await devSignIn('fresh', 'nope');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("That isn't the dev password.");
  });

  let fresh: { token: string; id: string };
  it('makes a fresh account with the default settings', async () => {
    const res = await devSignIn();
    expect(res.statusCode).toBe(200);
    expect(res.json().email).toMatch(/^dev-[0-9a-f]{6}@dev\.komodon\.invalid$/);
    const me = await get(res.json().token, '/api/me');
    expect(me.onboarded).toBe(false);
    expect(me.user.devAccount).toBe(true);
    expect(me.user.timezone).toBe('America/Toronto');
    expect(me.user.settings.features.social).toBe(true);
    expect(me.user.settings.nav.style).toBe('sidebar');
    fresh = { token: res.json().token, id: me.user.id };

    const again = await get((await devSignIn('fresh')).json().token, '/api/me');
    expect(again.user.id).not.toBe(fresh.id);
  });

  it('turns dev accounts away from email and admin', async () => {
    for (const [method, url] of [
      ['POST', '/api/me/university'],
      ['GET', '/api/admin/accounts'],
    ] as const) {
      const res = await as(fresh.token, method, url, method === 'POST' ? {} : undefined);
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error).toBe("Dev accounts can't use this.");
    }
  });

  let jerry: { token: string; id: string };
  let realId: string;
  let real: string;
  it('makes Jerry, a long-time user with friends', async () => {
    real = await realAccount('real@example.com', 'Devvo');
    realId = (await get(real, '/api/me')).user.id;
    // A real person with a session, so they would be on any board they could reach.
    await as(real, 'POST', '/api/sessions', { mode: 'unlimited' });

    const started = Date.now();
    const res = await devSignIn('jerry');
    expect(res.statusCode, res.body).toBe(200);
    expect(Date.now() - started).toBeLessThan(20_000);
    const token = res.json().token;
    const me = await get(token, '/api/me');
    jerry = { token, id: me.user.id };
    expect(me.onboarded).toBe(true);
    expect(me.user.settings.profile.name).toBe('Jerry');
    expect(me.user.xp).toBeGreaterThan(5000);
    expect(me.user.streak.current).toBeGreaterThanOrEqual(5);
    expect(me.user.streak.longest).toBeGreaterThanOrEqual(17);
    // Months of history, back to the day he joined.
    expect(Date.parse(me.user.createdAt)).toBeLessThan(Date.now() - 100 * 86_400_000);

    const nodes = (await get(token, '/api/nodes')).nodes as Array<{ title: string; kind: string }>;
    expect(nodes.filter((n) => n.kind === 'course').map((n) => n.title)).toEqual([
      'STATS203',
      'ECO220',
      'CSC148',
    ]);
    expect((await get(token, '/api/tags')).tags).toHaveLength(3);

    const friends = await get(token, '/api/social/friends');
    const name = (id: string) => friends.people[id].name;
    expect(friends.friends.map((f: { userId: string }) => name(f.userId)).sort()).toEqual([
      'Leo',
      'Noah',
      'Priya',
    ]);
    const feed = await get(token, '/api/social/feed');
    expect(feed.posts.length).toBeGreaterThanOrEqual(6);
    expect((await get(token, '/api/social/groups')).groups[0].name).toBe('Study group');
    const jams = await get(token, '/api/social/jams');
    const titles = (list: Array<{ title: string }>) => list.map((j) => j.title);
    expect(titles(jams.active)).toEqual(['Midterm push']);
    expect(titles(jams.open)).toEqual(['Library day']);
    expect(titles(jams.ended)).toEqual(['Reading week']);
    expect((await get(token, '/api/social/nudges')).nudges).toHaveLength(1);
    expect((await get(token, '/api/social/live')).live.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps worlds apart: real people, Jerry, and a second Jerry', async () => {
    // Jerry's board and search know only his world; the real person knows none of it.
    const board = await get(jerry.token, '/api/leaderboard?scope=global');
    const boardIds = (board.rows ?? board.entries ?? board.board).map(
      (r: { userId: string }) => r.userId,
    );
    expect(boardIds).toContain(jerry.id);
    expect(boardIds).not.toContain(realId);
    const realBoard = await get(real, '/api/leaderboard?scope=global');
    expect(JSON.stringify(realBoard)).not.toContain(jerry.id);
    expect((await get(jerry.token, '/api/social/people?q=Devv')).results).toHaveLength(0);
    expect((await get(real, '/api/social/people?q=Noah')).results).toHaveLength(0);
    expect((await get(real, '/api/social/feed')).posts).toHaveLength(0);
    expect((await as(real, 'GET', `/api/profiles/${jerry.id}`)).statusCode).toBe(404);
    expect((await as(jerry.token, 'GET', `/api/profiles/${realId}`)).statusCode).toBe(404);
    expect(
      (await as(jerry.token, 'POST', '/api/social/friends/requests', { userId: realId }))
        .statusCode,
    ).toBe(404);

    // A jam code from Jerry's world doesn't work outside it.
    const jam = (await get(jerry.token, '/api/social/jams')).active[0];
    expect((await as(real, 'POST', '/api/social/jams/join', { code: jam.code })).statusCode).toBe(
      404,
    );

    // A second Jerry has his own Noah, and neither Jerry sees the other's feed.
    const other = (await devSignIn('jerry')).json().token;
    const theirFeed = await get(other, '/api/social/feed');
    const ourFeed = await get(jerry.token, '/api/social/feed');
    const ids = (f: { posts: Array<{ id: string }> }) => f.posts.map((p) => p.id);
    expect(ids(theirFeed).some((id) => ids(ourFeed).includes(id))).toBe(false);
    // And the fresh dev account sees no one at all.
    expect((await get(fresh.token, '/api/social/feed')).posts).toHaveLength(0);
  });

  it('stays out of the admin list', async () => {
    const boss = await realAccount('boss@example.com', 'Boss');
    const accounts = (await get(boss, '/api/admin/accounts')).accounts as Array<{
      email: string;
    }>;
    expect(accounts.some((a) => a.email.endsWith('dev.komodon.invalid'))).toBe(false);
    expect(accounts.some((a) => a.email === 'real@example.com')).toBe(true);
  });

  it('is deleted a day later with its whole world, and its sign-in stops working', async () => {
    clock.now = new Date(Date.now() + 25 * 3600_000).toISOString();
    await devSignIn();
    const res = await as(jerry.token, 'GET', '/api/me');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('That dev account has expired. Sign in again.');
    const left = await db.select({ id: users.id }).from(users).where(eq(users.devAccount, true));
    // Only the one just made is left.
    expect(left).toHaveLength(1);
  });
});

describe('dev sign-in limits and switches', () => {
  it('is off unless asked for', async () => {
    const { db, close } = await createPgliteDb();
    const app = await buildServer({
      db,
      verifier: createHsVerifier(SECRET),
      passwordAuth: { secret: SECRET },
    });
    expect((await app.inject({ method: 'GET', url: '/api/auth/dev' })).statusCode).not.toBe(200);
    await app.close();
    await close();
  });

  it('gets past an invite list, and slows down password guessing', async () => {
    const { db, close } = await createPgliteDb();
    const app = await buildServer({
      db,
      verifier: createHsVerifier(SECRET),
      passwordAuth: { secret: SECRET, limits: null },
      allowedEmails: ['only@example.com'],
      devLogin: {
        passwordHash: await hashPassword(DEV_PW),
        limits: {
          wrong: { max: 2, windowMs: 60_000 },
          made: { max: 50, windowMs: 60_000 },
        },
      },
    });
    const post = (password: string) =>
      app.inject({ method: 'POST', url: '/api/auth/dev', payload: { password } });
    const token = (await post(DEV_PW)).json().token;
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect((await post('a')).statusCode).toBe(401);
    expect((await post('b')).statusCode).toBe(401);
    expect((await post(DEV_PW)).statusCode).toBe(429);
    await app.close();
    await close();
  });
});
