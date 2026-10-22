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

  it('saves a shape and a layout, and keeps the other pieces when one is moved', async () => {
    const me = await api({ method: 'GET', url: '/api/me' });
    const layout = me.json().user.settings.timelapse.layout;
    expect(layout.camera.visible).toBe(true);
    expect(layout.screen.visible).toBe(false);
    const moved = {
      ...layout,
      screen: { ...layout.screen, visible: true },
      title: { x: 0.1, y: 0.1, w: 0.5, h: 0.08, visible: true },
    };
    const ok = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { timelapse: { aspect: '9:16', layout: moved } },
    });
    expect(ok.statusCode).toBe(200);
    const saved = ok.json().settings.timelapse;
    expect(saved.aspect).toBe('9:16');
    expect(saved.layout.title).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.08, visible: true });
    expect(saved.layout.screen.visible).toBe(true);
    expect(saved.layout.clock).toEqual(layout.clock);
    const badShape = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { timelapse: { aspect: '21:9' } },
    });
    expect(badShape.statusCode).toBe(400);
    const offFrame = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { timelapse: { layout: { title: { ...moved.title, x: 1.4 } } } },
    });
    expect(offFrame.statusCode).toBe(400);
  });

  it('keeps a line of text for the video on each preset, trimmed, and empty by default', async () => {
    const me = await api({ method: 'GET', url: '/api/me' });
    expect(me.json().user.settings.timelapse.noteText).toBe('');
    expect(me.json().user.settings.timelapsePhone.noteText).toBe('');
    expect(me.json().user.settings.timelapse.layout.note.visible).toBe(true);
    const ok = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: {
        timelapse: { noteText: '  studying for 222 ' },
        timelapsePhone: { noteText: 'Up early' },
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().settings.timelapse.noteText).toBe('studying for 222');
    expect(ok.json().settings.timelapsePhone.noteText).toBe('Up early');
    const long = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { timelapse: { noteText: 'x'.repeat(101) } },
    });
    expect(long.statusCode).toBe(400);
    // An older portal still sending the end card's words is taken, not refused.
    const old = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { timelapsePhone: { endText: 'Done' } },
    });
    expect(old.statusCode).toBe(200);
    await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { timelapse: { noteText: '' }, timelapsePhone: { noteText: '' } },
    });
  });

  it('dims each preset by its own amount, no further than 90%', async () => {
    const me = await api({ method: 'GET', url: '/api/me' });
    expect(me.json().user.settings.timelapse.dim).toBe(0.5);
    expect(me.json().user.settings.timelapsePhone.dim).toBe(0.7);
    const ok = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { timelapse: { dim: 0 }, timelapsePhone: { dim: 0.85 } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().settings.timelapse.dim).toBe(0);
    expect(ok.json().settings.timelapsePhone.dim).toBe(0.85);
    const tooDark = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { timelapsePhone: { dim: 1 } },
    });
    expect(tooDark.statusCode).toBe(400);
  });

  it('keeps a phone preset of its own, with a shape for each way the phone is held', async () => {
    const me = await api({ method: 'GET', url: '/api/me' });
    const phone = me.json().user.settings.timelapsePhone;
    expect(phone).toMatchObject({ aspect: 'camera', sidewaysAspect: 'camera', fps: 30 });
    const ok = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: {
        timelapsePhone: {
          fps: 20,
          recordBreaks: true,
          sidewaysAspect: '4:3',
          // A screen can't be placed on a phone's layout; it comes back out.
          layout: { ...phone.layout, screen: { ...phone.layout.screen, visible: true } },
        },
      },
    });
    expect(ok.statusCode).toBe(200);
    const saved = ok.json().settings;
    expect(saved.timelapsePhone).toMatchObject({
      fps: 20,
      recordBreaks: true,
      sidewaysAspect: '4:3',
    });
    expect(saved.timelapsePhone.layout.screen.visible).toBe(false);
    // The computer's preset is untouched by the phone's.
    expect(saved.timelapse.fps).toBe(me.json().user.settings.timelapse.fps);
    // An upright phone video is never wide, nor a sideways one tall.
    for (const bad of [{ aspect: '16:9' }, { sidewaysAspect: '9:16' }, { aspect: 'screen' }]) {
      const res = await api({
        method: 'PATCH',
        url: '/api/me/settings',
        payload: { timelapsePhone: bad },
      });
      expect(res.statusCode).toBe(400);
    }
  });
});
