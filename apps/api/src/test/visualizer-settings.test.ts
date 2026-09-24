import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHsVerifier, signDevToken } from '../auth/verify';
import { createPgliteDb } from '../db/client';
import { buildServer } from '../server';
import { TEST_SECRET, USER_A } from './helpers';

let app: Awaited<ReturnType<typeof buildServer>>;
let closeDb: () => Promise<void>;
let token: string;

const api = (opts: InjectOptions) =>
  app.inject({
    ...opts,
    headers: { authorization: `Bearer ${token}`, 'x-timezone': 'America/Toronto' },
  });

beforeAll(async () => {
  const created = await createPgliteDb();
  closeDb = created.close;
  app = await buildServer({ db: created.db, verifier: createHsVerifier(TEST_SECRET) });
  await app.ready();
  token = await signDevToken(TEST_SECRET, USER_A);
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('settings: visualizer', () => {
  it('accepts the visualizer fields and rejects a bad colour', async () => {
    const ok = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: {
        visualizer: { enabled: true, promptDismissed: true, intensity: 0.8, colorMode: 'gradient' },
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().settings.visualizer).toEqual({
      enabled: true,
      promptDismissed: true,
      intensity: 0.8,
      opacity: 0.85,
      colorMode: 'gradient',
      color: '#6366f1',
      mist: true,
      ribbons: true,
      shockwave: true,
      rings: false,
      bars: false,
      waveform: false,
      mistHeight: 0.3,
      mistDrift: 0.5,
      mistOpacity: 1,
      waveCount: 4,
      waveformPosition: 0.18,
      barCount: 48,
      barHeight: 0.22,
      barGap: 0.35,
      barGlow: 0.7,
      barReflection: true,
      barSymmetric: false,
    });
    const bad = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { visualizer: { color: 'blue' } },
    });
    expect(bad.statusCode).toBe(400);
    const tooMany = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { visualizer: { barCount: 500 } },
    });
    expect(tooMany.statusCode).toBe(400);
  });
});
