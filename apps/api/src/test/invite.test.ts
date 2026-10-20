import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { isInvited } from '../auth/plugin';
import { createHsVerifier, signDevToken } from '../auth/verify';
import { createPgliteDb, type Db } from '../db/client';
import { users } from '../db/schema';
import { buildServer } from '../server';
import { TEST_SECRET } from './helpers';

describe('isInvited', () => {
  it('lets everyone in when the list is empty', () => {
    expect(isInvited('anyone@example.com', [])).toBe(true);
    expect(isInvited(null, undefined)).toBe(true);
  });

  it('matches whole addresses and @domains, ignoring case', () => {
    const list = ['Friend@Example.com', '@school.edu'];
    expect(isInvited('friend@example.com', list)).toBe(true);
    expect(isInvited('someone@SCHOOL.edu', list)).toBe(true);
    expect(isInvited('stranger@example.com', list)).toBe(false);
    expect(isInvited('friend@example.com.evil.io', list)).toBe(false);
    expect(isInvited(null, list)).toBe(false);
  });
});

describe('invite-only API', () => {
  let app: FastifyInstance;
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createPgliteDb());
    app = await buildServer({
      db,
      verifier: createHsVerifier(TEST_SECRET),
      allowedEmails: ['invited@example.com'],
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  const me = async (user: { id: string; email: string }) =>
    app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${await signDevToken(TEST_SECRET, user)}` },
    });

  it('lets an invited account in', async () => {
    const res = await me({
      id: '33333333-3333-4333-8333-333333333333',
      email: 'invited@example.com',
    });
    expect(res.statusCode).toBe(200);
  });

  it('turns others away without creating an account', async () => {
    const res = await me({
      id: '44444444-4444-4444-8444-444444444444',
      email: 'stranger@example.com',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'invite_only' });
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, '44444444-4444-4444-8444-444444444444'));
    expect(rows).toHaveLength(0);
  });

  it('keeps health public', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  });
});
