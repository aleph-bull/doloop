import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { createHsVerifier, signDevToken } from '../auth/verify';
import { createPgliteDb, type Db } from '../db/client';
import { buildServer, type BuildOptions } from '../server';

export const TEST_SECRET = 'test-secret-do-not-use';
export const USER_A = { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com' };
export const USER_B = { id: '22222222-2222-4222-8222-222222222222', email: 'b@example.com' };

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  /** Mutable clock. Set `now` to time-travel. */
  clock: { now: string };
  tokenA: string;
  tokenB: string;
  api: (opts: InjectOptions & { token?: string; tz?: string }) => Promise<LightMyRequestResponse>;
  close: () => Promise<void>;
}

export async function createTestApp(
  startAt = '2026-09-21T14:00:00.000Z',
  extra: Partial<BuildOptions> = {},
): Promise<TestApp> {
  const { db, close } = await createPgliteDb();
  const clock = { now: startAt };
  const app = await buildServer({
    db,
    verifier: createHsVerifier(TEST_SECRET),
    clock: () => clock.now,
    ...extra,
  });
  await app.ready();
  const tokenA = await signDevToken(TEST_SECRET, USER_A);
  const tokenB = await signDevToken(TEST_SECRET, USER_B);
  const api: TestApp['api'] = ({ token = tokenA, tz = 'America/Toronto', headers, ...rest }) =>
    app.inject({
      ...rest,
      headers: { authorization: `Bearer ${token}`, 'x-timezone': tz, ...(headers as object) },
    });
  return {
    app,
    db,
    clock,
    tokenA,
    tokenB,
    api,
    close: async () => {
      await app.close();
      await close();
    },
  };
}

export function advanceClock(t: TestApp, minutes: number, seconds = 0): string {
  t.clock.now = new Date(Date.parse(t.clock.now) + minutes * 60_000 + seconds * 1000).toISOString();
  return t.clock.now;
}
