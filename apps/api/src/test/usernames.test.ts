import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usernameError } from '@komogon/core';
import { users } from '../db/schema';
import { createTestApp, USER_A, USER_B, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-10-21T14:00:00.000Z');
  for (const token of [t.tokenA, t.tokenB]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
});
afterAll(() => t.close());

const me = async (token?: string) =>
  (await t.api({ method: 'GET', url: '/api/me', token })).json().user as {
    username: string | null;
    usernameChangedAt: string | null;
  };

const setUsername = (username: string, token?: string) =>
  t.api({ method: 'PUT', url: '/api/me/username', token, payload: { username } });

describe('usernames', () => {
  it('gives everyone a random one, unchosen, that stays put', async () => {
    const a = await me();
    const b = await me(t.tokenB);
    expect(usernameError(a.username!)).toBeNull();
    expect(a.username).not.toBe(b.username);
    expect(a.usernameChangedAt).toBeNull();
    expect((await me()).username).toBe(a.username);
  });

  it('lets the picked one change straight away, then holds a chosen one 14 days', async () => {
    const res = await setUsername('@Ada.Lovelace');
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe('ada.lovelace');
    expect(res.json().user.usernameChangedAt).toBe(t.clock.now);

    // The same name again is not a change.
    expect((await setUsername('ada.lovelace')).statusCode).toBe(200);

    const early = await setUsername('ada');
    expect(early.statusCode).toBe(400);
    expect(early.json().error ?? early.json().message).toMatch(/again on Nov 4/);

    t.clock.now = '2026-11-04T14:00:00.000Z';
    expect((await setUsername('ada')).json().user.username).toBe('ada');
  });

  it('takes numbers and _ - ! .', async () => {
    expect((await setUsername('ben_99!', t.tokenB)).statusCode).toBe(200);
    t.clock.now = '2026-11-19T14:00:00.000Z';
  });

  it('refuses one that breaks the rules', async () => {
    for (const bad of ['@ab', 'zoë', 'ada..l', 'ada l', 'ada?', 'ada!!', 'ada.-l']) {
      expect((await setUsername(bad, t.tokenB)).statusCode).toBe(400);
    }
  });

  it('keeps each username to one person', async () => {
    const res = await setUsername('ADA', t.tokenB);
    expect(res.statusCode).toBe(409);
    // A refusal does not use up the change.
    expect((await setUsername('ben', t.tokenB)).statusCode).toBe(200);
  });

  it('shows on profiles and finds people by it', async () => {
    const profile = (await t.api({ method: 'GET', url: `/api/profiles/${USER_B.id}` })).json();
    expect(profile.profile.username).toBe('ben');
    const found = (await t.api({ method: 'GET', url: '/api/social/people?q=%40be' })).json();
    expect(found.results.map((r: { userId: string }) => r.userId)).toEqual([USER_B.id]);
    expect(found.people[USER_B.id].username).toBe('ben');
  });
});

describe('display names', () => {
  const save = (name: string) =>
    t.api({ method: 'PATCH', url: '/api/me/settings', payload: { profile: { name } } });

  it('closes up spaces and keeps letters in any script', async () => {
    const res = await save('  José   María López ');
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.profile.name).toBe('José María López');
  });

  it('refuses every symbol', async () => {
    for (const bad of ["O'Neil", 'Ada!', 'Ada L.', 'María-López', 'ada_l']) {
      expect((await save(bad)).statusCode).toBe(400);
    }
  });
});

describe('migration 0033', () => {
  it('gives every account without one a valid username of its own', async () => {
    const m = await createTestApp('2026-10-22T14:00:00.000Z');
    try {
      await m.api({ method: 'GET', url: '/api/me' });
      const kept = (await m.db.query.users.findFirst({ where: eq(users.id, USER_A.id) }))!.username;
      // Enough accounts that pairs collide (about four thousand pairs).
      await m.db.insert(users).values(
        Array.from({ length: 400 }, (_, i) => ({
          id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          email: `p${i}@example.com`,
          icsToken: `t${i}`,
        })),
      );
      const file = readFileSync(
        join(import.meta.dirname, '../../drizzle/0033_usernames.sql'),
        'utf8',
      );
      const backfill = file.split('--> statement-breakpoint').at(-1)!;
      await m.db.execute(sql.raw(backfill));

      const rows = await m.db.query.users.findMany({ columns: { id: true, username: true } });
      expect(rows).toHaveLength(401);
      const names = rows.map((r) => r.username!);
      expect(names.every((n) => n && usernameError(n) === null)).toBe(true);
      expect(new Set(names).size).toBe(names.length);
      expect(rows.find((r) => r.id === USER_A.id)!.username).toBe(kept);
      expect(names.filter((n) => n.split('.').length === 2).length).toBeGreaterThan(390);
    } finally {
      await m.close();
    }
  });
});
