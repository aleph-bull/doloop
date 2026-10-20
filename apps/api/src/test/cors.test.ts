import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHsVerifier } from '../auth/verify';
import { createPgliteDb } from '../db/client';
import { buildServer } from '../server';

const PORTAL = 'https://komogon.app';

describe('CORS for a portal on another address', () => {
  let app: FastifyInstance;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const db = await createPgliteDb();
    close = db.close;
    app = await buildServer({
      db: db.db,
      verifier: createHsVerifier('cors-test'),
      corsOrigins: [PORTAL],
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  it.each(['PATCH', 'DELETE', 'PUT'])('allows %s from the portal', async (method) => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/me/settings',
      headers: {
        origin: PORTAL,
        'access-control-request-method': method,
        'access-control-request-headers': 'authorization,content-type,x-timezone',
      },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(PORTAL);
    expect(String(res.headers['access-control-allow-methods'])).toContain(method);
  });
});
