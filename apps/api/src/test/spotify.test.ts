import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHsVerifier, signDevToken } from '../auth/verify';
import { createPgliteDb } from '../db/client';
import { buildServer } from '../server';
import {
  SpotifyPlayerError,
  SpotifyRevokedError,
  toPlayback,
  type PlayerAction,
  type SpotifyClient,
  type SpotifyPlayback,
} from '../services/spotify';
import { TEST_SECRET, USER_A } from './helpers';

/** In-memory Spotify: one account, a scripted "now playing", and switches for every failure. */
class FakeSpotify implements SpotifyClient {
  calls: string[] = [];
  revoked = false;
  /** Every access token minted so far is valid until it appears here. */
  deadTokens = new Set<string>();
  playback: SpotifyPlayback = { isPlaying: false, progressMs: null, item: null };
  product = 'premium';
  controlError: SpotifyPlayerError | null = null;
  seq = 0;

  authUrl(state: string) {
    return `https://accounts.spotify.com/authorize?state=${state}`;
  }
  async exchangeCode(code: string) {
    this.calls.push(`exchange:${code}`);
    return {
      accessToken: `at-${++this.seq}`,
      refreshToken: `rt-${code}`,
      expiresAt: Date.now() + 3600_000,
    };
  }
  async refreshAccessToken(refreshToken: string) {
    this.calls.push(`refresh:${refreshToken}`);
    if (this.revoked) throw new SpotifyRevokedError();
    return {
      accessToken: `at-${++this.seq}`,
      refreshToken: null,
      expiresAt: Date.now() + 3600_000,
    };
  }
  async profile(at: string) {
    this.calls.push(`profile:${at}`);
    return { id: 'zach', displayName: 'Zach', product: this.product };
  }
  async currentlyPlaying(at: string) {
    this.calls.push(`playing:${at}`);
    if (this.deadTokens.has(at) || this.revoked) throw new SpotifyRevokedError();
    return this.playback;
  }
  async control(at: string, action: PlayerAction) {
    this.calls.push(`control:${action}`);
    if (this.controlError) throw this.controlError;
  }
}

const KEY = '0'.repeat(64);

let app: Awaited<ReturnType<typeof buildServer>>;
let closeDb: () => Promise<void>;
let fake: FakeSpotify;
let token: string;

const api = (opts: InjectOptions) =>
  app.inject({
    ...opts,
    headers: { authorization: `Bearer ${token}`, 'x-timezone': 'America/Toronto' },
  });

/** Runs the consent flow end to end and returns where the callback sent the browser. */
async function connect(returnTo?: 'focus' | 'settings'): Promise<string> {
  const started = await api({
    method: 'POST',
    url: '/api/spotify/connect',
    payload: returnTo ? { returnTo } : undefined,
  });
  expect(started.statusCode).toBe(200);
  const state = new URL(started.json().url).searchParams.get('state')!;
  const cb = await app.inject({
    method: 'GET',
    url: `/api/spotify/callback?code=abc&state=${encodeURIComponent(state)}`,
  });
  expect(cb.statusCode).toBe(302);
  return cb.headers.location as string;
}

beforeAll(async () => {
  const created = await createPgliteDb();
  closeDb = created.close;
  fake = new FakeSpotify();
  app = await buildServer({
    db: created.db,
    verifier: createHsVerifier(TEST_SECRET),
    clock: () => '2026-09-22T14:00:00.000Z',
    spotify: {
      deps: { spotify: fake, encryptionKey: KEY },
      stateSecret: 'state-secret',
      portalUrl: 'http://portal.test',
    },
  });
  await app.ready();
  token = await signDevToken(TEST_SECRET, USER_A);
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('spotify', () => {
  it('starts not connected, with nothing playing and no controls', async () => {
    const status = (await api({ method: 'GET', url: '/api/spotify/status' })).json();
    expect(status).toEqual({ available: true, connected: false });
    const np = (await api({ method: 'GET', url: '/api/spotify/now-playing' })).json();
    expect(np.status).toBe('not-connected');
    const ctl = await api({
      method: 'POST',
      url: '/api/spotify/player',
      payload: { action: 'pause' },
    });
    expect(ctl.statusCode).toBe(409);
    expect(ctl.json().status).toBe('not-connected');
  });

  it('rejects a forged or missing state on the callback', async () => {
    const forged = await app.inject({
      method: 'GET',
      url: '/api/spotify/callback?code=x&state=a.b.c',
    });
    expect(forged.headers.location).toBe('http://portal.test/focus?spotify=invalid');
    const none = await app.inject({ method: 'GET', url: '/api/spotify/callback?code=x' });
    expect(none.headers.location).toBe('http://portal.test/focus?spotify=invalid');
  });

  it('sends a denied consent back without connecting', async () => {
    const started = (await api({ method: 'POST', url: '/api/spotify/connect' })).json();
    const state = new URL(started.url).searchParams.get('state')!;
    const cb = await app.inject({
      method: 'GET',
      url: `/api/spotify/callback?error=access_denied&state=${encodeURIComponent(state)}`,
    });
    expect(cb.headers.location).toBe('http://portal.test/focus?spotify=denied');
    expect((await api({ method: 'GET', url: '/api/spotify/status' })).json().connected).toBe(false);
  });

  it('connects, returns to where it was started from, and reports the account', async () => {
    expect(await connect('settings')).toBe('http://portal.test/settings?spotify=connected#focus');
    const status = (await api({ method: 'GET', url: '/api/spotify/status' })).json();
    expect(status).toMatchObject({
      available: true,
      connected: true,
      revoked: false,
      displayName: 'Zach',
      canControl: true,
    });
    expect(fake.calls).toContain('exchange:abc');
  });

  it('reports nothing playing, then the track, using the cached access token', async () => {
    fake.calls = [];
    let np = (await api({ method: 'GET', url: '/api/spotify/now-playing' })).json();
    expect(np).toMatchObject({ status: 'ok', isPlaying: false, item: null });

    fake.playback = {
      isPlaying: true,
      progressMs: 61_000,
      item: {
        title: 'Midnight City',
        artist: 'M83',
        album: "Hurry Up, We're Dreaming",
        artworkUrl: 'https://i.scdn.co/image/x',
        durationMs: 244_000,
        url: 'https://open.spotify.com/track/x',
        kind: 'track',
      },
    };
    np = (await api({ method: 'GET', url: '/api/spotify/now-playing' })).json();
    expect(np.status).toBe('ok');
    expect(np.isPlaying).toBe(true);
    expect(np.item.title).toBe('Midnight City');
    expect(np.item.artist).toBe('M83');
    expect(np.fetchedAt).toBe('2026-09-22T14:00:00.000Z');
    // Two polls, no refresh: the token from the exchange is still fresh.
    expect(fake.calls.filter((c) => c.startsWith('refresh:'))).toEqual([]);
  });

  it('retries once with a fresh token when the cached one has died early', async () => {
    fake.calls = [];
    fake.deadTokens.add('at-1');
    const np = (await api({ method: 'GET', url: '/api/spotify/now-playing' })).json();
    expect(np.status).toBe('ok');
    expect(np.item.title).toBe('Midnight City');
    expect(fake.calls).toEqual(['playing:at-1', 'refresh:rt-abc', 'playing:at-2']);
  });

  it('controls the player and passes Spotify refusals through as a conflict', async () => {
    fake.calls = [];
    const ok = await api({
      method: 'POST',
      url: '/api/spotify/player',
      payload: { action: 'next' },
    });
    expect(ok.statusCode).toBe(200);
    expect(fake.calls).toContain('control:next');

    fake.controlError = new SpotifyPlayerError('No active Spotify device.', 'no-device');
    const refused = await api({
      method: 'POST',
      url: '/api/spotify/player',
      payload: { action: 'play' },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().reason).toBe('no-device');
    fake.controlError = null;

    const bad = await api({
      method: 'POST',
      url: '/api/spotify/player',
      payload: { action: 'louder' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('marks the connection revoked when the refresh token stops working', async () => {
    fake.revoked = true;
    fake.deadTokens.add('at-2');
    const np = (await api({ method: 'GET', url: '/api/spotify/now-playing' })).json();
    expect(np.status).toBe('revoked');
    const status = (await api({ method: 'GET', url: '/api/spotify/status' })).json();
    expect(status.connected).toBe(true);
    expect(status.revoked).toBe(true);
    // Reconnecting clears it.
    fake.revoked = false;
    expect(await connect()).toBe('http://portal.test/focus?spotify=connected');
    expect((await api({ method: 'GET', url: '/api/spotify/status' })).json().revoked).toBe(false);
  });

  it('disconnects', async () => {
    const res = await api({ method: 'DELETE', url: '/api/spotify' });
    expect(res.statusCode).toBe(204);
    expect((await api({ method: 'GET', url: '/api/spotify/status' })).json()).toEqual({
      available: true,
      connected: false,
    });
  });
});

describe('toPlayback', () => {
  it('maps a track and an episode, picking small-but-legible artwork', () => {
    const track = toPlayback({
      is_playing: true,
      progress_ms: 10,
      item: {
        type: 'track',
        name: 'Song',
        duration_ms: 1000,
        artists: [{ name: 'A' }, { name: 'B' }],
        album: {
          name: 'Album',
          images: [
            { url: 'big', width: 640 },
            { url: 'small', width: 64 },
            { url: 'mid', width: 300 },
          ],
        },
        external_urls: { spotify: 'https://open.spotify.com/track/1' },
      },
    });
    expect(track.item).toEqual({
      title: 'Song',
      artist: 'A, B',
      album: 'Album',
      artworkUrl: 'mid',
      durationMs: 1000,
      url: 'https://open.spotify.com/track/1',
      kind: 'track',
    });
    const episode = toPlayback({
      is_playing: false,
      currently_playing_type: 'episode',
      item: {
        type: 'episode',
        name: 'Ep 1',
        duration_ms: 5,
        show: { name: 'Show' },
        images: [{ url: 'e' }],
      },
    });
    expect(episode.item).toMatchObject({
      title: 'Ep 1',
      artist: 'Show',
      album: null,
      artworkUrl: 'e',
      kind: 'episode',
    });
    expect(toPlayback(null).item).toBeNull();
    expect(toPlayback({ is_playing: true, item: null }).item).toBeNull();
  });
});

describe('spotify unavailable', () => {
  it('says so without the flow', async () => {
    const created = await createPgliteDb();
    const bare = await buildServer({ db: created.db, verifier: createHsVerifier(TEST_SECRET) });
    await bare.ready();
    const headers = { authorization: `Bearer ${token}` };
    const status = (
      await bare.inject({ method: 'GET', url: '/api/spotify/status', headers })
    ).json();
    expect(status).toEqual({ available: false, connected: false });
    const np = (
      await bare.inject({ method: 'GET', url: '/api/spotify/now-playing', headers })
    ).json();
    expect(np.status).toBe('not-connected');
    const connect = await bare.inject({ method: 'POST', url: '/api/spotify/connect', headers });
    expect(connect.statusCode).toBe(400);
    await bare.close();
    await created.close();
  });
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
    });
    const bad = await api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { visualizer: { color: 'blue' } },
    });
    expect(bad.statusCode).toBe(400);
  });
});
