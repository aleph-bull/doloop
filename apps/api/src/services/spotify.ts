/**
 * Spotify Web API boundary. The connection service only talks to this interface, so tests
 * use an in-memory fake and production uses the REST implementation below.
 */

export interface SpotifyTokens {
  accessToken: string;
  /** Spotify only sends a refresh token on the first exchange, and sometimes on refresh. */
  refreshToken: string | null;
  expiresAt: number; // epoch ms
}

export interface SpotifyProfile {
  id: string;
  displayName: string | null;
  /** 'premium', 'free', 'open' ... Playback control needs premium. */
  product: string | null;
}

/** What the player is doing right now. Null item: connected, but nothing is playing. */
export interface SpotifyPlayback {
  isPlaying: boolean;
  progressMs: number | null;
  item: {
    title: string;
    /** Artists for a track; the show for a podcast episode. */
    artist: string;
    album: string | null;
    artworkUrl: string | null;
    durationMs: number;
    url: string | null;
    kind: 'track' | 'episode';
  } | null;
}

export type PlayerAction = 'play' | 'pause' | 'next' | 'previous';

/** The user pulled Doloop's access, or the refresh token stopped working. */
export class SpotifyRevokedError extends Error {
  constructor() {
    super('Spotify access was revoked. Reconnect in settings.');
  }
}

/** The account cannot do that: control needs Premium, or there is no active device. */
export class SpotifyPlayerError extends Error {
  constructor(
    message: string,
    public readonly reason: 'premium-required' | 'no-device' | 'restricted',
  ) {
    super(message);
  }
}

export interface SpotifyClient {
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<SpotifyTokens>;
  refreshAccessToken(refreshToken: string): Promise<SpotifyTokens>;
  profile(accessToken: string): Promise<SpotifyProfile>;
  currentlyPlaying(accessToken: string): Promise<SpotifyPlayback>;
  control(accessToken: string, action: PlayerAction): Promise<void>;
}

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Read what is playing, plus control it. Nothing about the library or listening history. */
const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
];

interface RawImage {
  url: string;
  width?: number | null;
}
interface RawPlaying {
  is_playing?: boolean;
  progress_ms?: number | null;
  currently_playing_type?: string;
  item?: {
    type?: string;
    name?: string;
    duration_ms?: number;
    artists?: Array<{ name: string }>;
    album?: { name?: string; images?: RawImage[] };
    show?: { name?: string };
    images?: RawImage[];
    external_urls?: { spotify?: string };
  } | null;
}

/** The smallest artwork that is still at least 120px, since the card shows it small. */
function pickArtwork(images: RawImage[] | undefined): string | null {
  if (!images || images.length === 0) return null;
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((i) => (i.width ?? 0) >= 120) ?? sorted[sorted.length - 1])?.url ?? null;
}

export function toPlayback(raw: RawPlaying | null): SpotifyPlayback {
  const item = raw?.item;
  const title = item?.name;
  if (!raw || !item || !title) {
    return { isPlaying: false, progressMs: null, item: null };
  }
  const episode = item.type === 'episode' || raw.currently_playing_type === 'episode';
  return {
    isPlaying: raw.is_playing ?? false,
    progressMs: raw.progress_ms ?? null,
    item: {
      title,
      artist: episode
        ? (item.show?.name ?? '')
        : (item.artists ?? []).map((a) => a.name).join(', '),
      album: episode ? null : (item.album?.name ?? null),
      artworkUrl: pickArtwork(episode ? item.images : item.album?.images),
      durationMs: item.duration_ms ?? 0,
      url: item.external_urls?.spotify ?? null,
      kind: episode ? 'episode' : 'track',
    },
  };
}

/** REST implementation. Only used when SPOTIFY_CLIENT_ID/SECRET are configured. */
export function createSpotifyClient(cfg: SpotifyConfig): SpotifyClient {
  const API = 'https://api.spotify.com/v1';
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');

  async function token(params: Record<string, string>): Promise<SpotifyTokens> {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params),
    });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !data.access_token) {
      if (data.error === 'invalid_grant') throw new SpotifyRevokedError();
      throw new Error(`Spotify token error: ${data.error ?? res.status}`);
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
  }

  async function call<T>(
    accessToken: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T | null }> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) throw new SpotifyRevokedError();
    if (res.status === 204) return { status: 204, data: null };
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : null;
    if (!res.ok) {
      const reason = (data as { error?: { reason?: string; message?: string } } | null)?.error;
      if (res.status === 403 && reason?.reason === 'PREMIUM_REQUIRED')
        throw new SpotifyPlayerError('Playback control needs Spotify Premium.', 'premium-required');
      if (res.status === 404)
        throw new SpotifyPlayerError(
          'No active Spotify device. Start playback first.',
          'no-device',
        );
      if (res.status === 403)
        throw new SpotifyPlayerError(reason?.message ?? 'Spotify refused that.', 'restricted');
      throw new Error(`Spotify API ${method} ${path} failed: ${res.status} ${text}`);
    }
    return { status: res.status, data };
  }

  return {
    authUrl(state) {
      const q = new URLSearchParams({
        client_id: cfg.clientId,
        response_type: 'code',
        redirect_uri: cfg.redirectUri,
        scope: SCOPES.join(' '),
        state,
      });
      return `https://accounts.spotify.com/authorize?${q}`;
    },
    exchangeCode: (code) =>
      token({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri }),
    refreshAccessToken: (refreshToken) =>
      token({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    async profile(at) {
      const { data } = await call<{ id: string; display_name?: string; product?: string }>(
        at,
        'GET',
        '/me',
      );
      return {
        id: data?.id ?? '',
        displayName: data?.display_name ?? null,
        product: data?.product ?? null,
      };
    },
    async currentlyPlaying(at) {
      const { data } = await call<RawPlaying>(
        at,
        'GET',
        '/me/player/currently-playing?additional_types=track,episode',
      );
      return toPlayback(data);
    },
    async control(at, action) {
      switch (action) {
        case 'play':
          await call(at, 'PUT', '/me/player/play');
          return;
        case 'pause':
          await call(at, 'PUT', '/me/player/pause');
          return;
        case 'next':
          await call(at, 'POST', '/me/player/next');
          return;
        case 'previous':
          await call(at, 'POST', '/me/player/previous');
          return;
      }
    },
  };
}
