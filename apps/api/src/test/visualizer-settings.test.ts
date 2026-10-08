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
      preset: 'bass',
      customSensitivity: 0.5,
      customDrop: 0.5,
      customSmoothing: 0.5,
      customMemory: 0.4,
      customBassLow: 20,
      customBassHigh: 140,
      barPosition: 0.92,
      barWidth: 0.9,
      waveTop: true,
      waveBottom: true,
      waveformMirror: true,
      ringCount: 3,
      burst: false,
      burstRadius: 0.2,
      burstReach: 0.15,
      burstSpikes: 96,
      burstBlob: true,
      burstRays: true,
      speed: 1,
      fadeWhenSilent: false,
      barOpacity: 1,
      burstShowSpikes: true,
      burstSpikeOpacity: 1,
    });
    const preset = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { visualizer: { preset: 'custom', customBassHigh: 300, customDrop: 0.2 } },
    });
    expect(preset.statusCode).toBe(200);
    expect(preset.json().settings.visualizer).toMatchObject({
      preset: 'custom',
      customBassHigh: 300,
      customDrop: 0.2,
    });
    const badPreset = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { visualizer: { preset: 'loud' } },
    });
    expect(badPreset.statusCode).toBe(400);
    const badHz = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { visualizer: { customBassHigh: 5000 } },
    });
    expect(badHz.statusCode).toBe(400);
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

describe('settings: timelapse', () => {
  it('defaults to asking, saves a choice, and rejects a frame rate past 60', async () => {
    const me = await api({ method: 'GET', url: '/api/me' });
    expect(me.json().user.settings.timelapse).toMatchObject({ record: 'ask', lengthMode: 'auto' });
    const ok = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { timelapse: { record: 'never', lengthMode: 'speed', speed: 600, fps: 24 } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().settings.timelapse).toMatchObject({
      record: 'never',
      lengthMode: 'speed',
      speed: 600,
      fps: 24,
      showTimer: true,
    });
    const bad = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { timelapse: { fps: 120 } },
    });
    expect(bad.statusCode).toBe(400);
  });
});
