import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { spotifyConnections } from '../db/schema';
import { decrypt, encrypt } from './crypto';
import { dt } from './sessions-mapper';
import {
  SpotifyRevokedError,
  type PlayerAction,
  type SpotifyClient,
  type SpotifyPlayback,
} from './spotify';

export interface SpotifyDeps {
  spotify: SpotifyClient;
  encryptionKey: string;
}

export type SpotifyStatus =
  | { connected: false }
  | {
      connected: true;
      revoked: boolean;
      displayName: string | null;
      /** True when the account can be controlled (Premium); false otherwise or unknown. */
      canControl: boolean;
      connectedAt: string;
    };

export async function spotifyStatus(db: Db, userId: string): Promise<SpotifyStatus> {
  const row = await db.query.spotifyConnections.findFirst({
    where: eq(spotifyConnections.userId, userId),
  });
  if (!row) return { connected: false };
  return {
    connected: true,
    revoked: row.revokedAt !== null,
    displayName: row.displayName,
    canControl: row.product === 'premium',
    connectedAt: row.connectedAt.toISOString(),
  };
}

/** Store the tokens after the consent callback, along with who the account is. */
export async function completeSpotifyConnection(
  db: Db,
  deps: SpotifyDeps,
  userId: string,
  code: string,
  now: string,
): Promise<void> {
  const tokens = await deps.spotify.exchangeCode(code);
  if (!tokens.refreshToken) throw new Error('Spotify did not return a refresh token.');
  const profile = await deps.spotify.profile(tokens.accessToken);
  const values = {
    refreshTokenEnc: encrypt(tokens.refreshToken, deps.encryptionKey),
    accessTokenEnc: encrypt(tokens.accessToken, deps.encryptionKey),
    accessExpiresAt: new Date(tokens.expiresAt),
    displayName: profile.displayName,
    product: profile.product,
    revokedAt: null,
    connectedAt: dt(now),
  };
  await db
    .insert(spotifyConnections)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: spotifyConnections.userId, set: values });
}

export async function disconnectSpotify(db: Db, userId: string): Promise<void> {
  await db.delete(spotifyConnections).where(eq(spotifyConnections.userId, userId));
}

/** Refresh when the cached token has under a minute left; the player is polled every few seconds. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * A usable access token, refreshed and re-cached when the stored one is about to expire.
 * Null when there is no connection or it was revoked, which the caller reports as a state.
 */
async function accessTokenFor(db: Db, deps: SpotifyDeps, userId: string): Promise<string | null> {
  const row = await db.query.spotifyConnections.findFirst({
    where: eq(spotifyConnections.userId, userId),
  });
  if (!row || row.revokedAt) return null;
  if (row.accessTokenEnc && row.accessExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
    return decrypt(row.accessTokenEnc, deps.encryptionKey);
  }
  try {
    const t = await deps.spotify.refreshAccessToken(
      decrypt(row.refreshTokenEnc, deps.encryptionKey),
    );
    await db
      .update(spotifyConnections)
      .set({
        accessTokenEnc: encrypt(t.accessToken, deps.encryptionKey),
        accessExpiresAt: new Date(t.expiresAt),
        // A rotated refresh token replaces the old one; otherwise the old one stays valid.
        ...(t.refreshToken ? { refreshTokenEnc: encrypt(t.refreshToken, deps.encryptionKey) } : {}),
      })
      .where(eq(spotifyConnections.userId, userId));
    return t.accessToken;
  } catch (err) {
    if (err instanceof SpotifyRevokedError) {
      await markRevoked(db, userId);
      return null;
    }
    throw err;
  }
}

async function markRevoked(db: Db, userId: string): Promise<void> {
  await db
    .update(spotifyConnections)
    .set({ revokedAt: new Date(), accessTokenEnc: null })
    .where(eq(spotifyConnections.userId, userId));
}

export type NowPlayingResult =
  { status: 'not-connected' } | { status: 'revoked' } | ({ status: 'ok' } & SpotifyPlayback);

/**
 * What the user is listening to. An access token that turns out to be dead mid-request
 * is retried once with a fresh one; a refresh that fails marks the connection revoked.
 */
export async function nowPlaying(
  db: Db,
  deps: SpotifyDeps,
  userId: string,
): Promise<NowPlayingResult> {
  const status = await spotifyStatus(db, userId);
  if (!status.connected) return { status: 'not-connected' };
  if (status.revoked) return { status: 'revoked' };
  const token = await accessTokenFor(db, deps, userId);
  if (!token) return { status: 'revoked' };
  try {
    return { status: 'ok', ...(await deps.spotify.currentlyPlaying(token)) };
  } catch (err) {
    if (!(err instanceof SpotifyRevokedError)) throw err;
    // The cached token may simply have expired early; force a refresh and try once more.
    await db
      .update(spotifyConnections)
      .set({ accessTokenEnc: null })
      .where(eq(spotifyConnections.userId, userId));
    const fresh = await accessTokenFor(db, deps, userId);
    if (!fresh) return { status: 'revoked' };
    try {
      return { status: 'ok', ...(await deps.spotify.currentlyPlaying(fresh)) };
    } catch (again) {
      if (again instanceof SpotifyRevokedError) {
        await markRevoked(db, userId);
        return { status: 'revoked' };
      }
      throw again;
    }
  }
}

/** Play, pause or skip. Errors are the client's typed ones; the route turns them into replies. */
export async function controlPlayer(
  db: Db,
  deps: SpotifyDeps,
  userId: string,
  action: PlayerAction,
): Promise<'ok' | 'not-connected' | 'revoked'> {
  const status = await spotifyStatus(db, userId);
  if (!status.connected) return 'not-connected';
  const token = await accessTokenFor(db, deps, userId);
  if (!token) return 'revoked';
  await deps.spotify.control(token, action);
  return 'ok';
}
