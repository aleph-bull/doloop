import { useQueryClient } from '@tanstack/react-query';
import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Glass, useToast } from '@komogon/ui';
import { api, ApiError } from '../../lib/api';
import { keys, useNowPlaying, useSpotifyStatus } from '../../lib/queries';

/** Start the consent flow. Leaves this tab; Spotify sends the user back to the focus screen. */
export async function connectSpotify(returnTo: 'focus' | 'settings', onError: (m: string) => void) {
  try {
    const { url } = await api.spotifyConnect(returnTo);
    window.location.href = url;
  } catch (err) {
    onError(err instanceof Error ? err.message : 'Could not start');
  }
}

const RETURN_MESSAGES: Record<string, string> = {
  connected: 'Spotify connected.',
  denied: 'Spotify access was not granted.',
  invalid: 'The Spotify link expired. Try again.',
  failed: 'Connecting to Spotify failed. Try again.',
  unavailable: 'Spotify is not configured on this server.',
};

/** Reads `?spotify=` after the consent flow lands back here, says what happened, and clears it. */
export function useSpotifyReturn() {
  const [params, setParams] = useSearchParams();
  const { toast } = useToast();
  const qc = useQueryClient();
  useEffect(() => {
    const s = params.get('spotify');
    if (!s) return;
    toast(RETURN_MESSAGES[s] ?? s, { tone: s === 'connected' ? 'ok' : undefined });
    params.delete('spotify');
    setParams(params, { replace: true });
    void qc.invalidateQueries({ queryKey: keys.spotify });
    void qc.invalidateQueries({ queryKey: keys.nowPlaying });
  }, [params, setParams, toast, qc]);
}

function fmtMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * What Spotify is playing, small and off to the side. Every state short of playing is a
 * line of text, and none of them touches the timer: a Spotify outage leaves the last
 * answer standing, and a disconnect reduces this to one link.
 */
export function SpotifyNowPlaying() {
  const status = useSpotifyStatus();
  const { toast } = useToast();
  const qc = useQueryClient();
  useSpotifyReturn();

  const s = status.data;
  const live = !!s?.connected && !s.revoked;
  const np = useNowPlaying(live);

  // Progress moves between polls by the clock, so the bar does not step every five seconds.
  const [now, setNow] = useState(() => Date.now());
  const playing = np.data?.status === 'ok' && np.data.isPlaying;
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [playing]);

  const control = async (action: 'play' | 'pause' | 'next' | 'previous') => {
    try {
      await api.spotifyControl(action);
      window.setTimeout(() => void qc.invalidateQueries({ queryKey: keys.nowPlaying }), 500);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { reason?: string; status?: string } | undefined;
        if (body?.status === 'revoked') void qc.invalidateQueries({ queryKey: keys.spotify });
      }
      toast(err instanceof Error ? err.message : 'Spotify did not respond');
    }
  };

  if (!s || !s.available) return null;

  if (!s.connected || s.revoked) {
    return (
      <button
        type="button"
        className="focus-link focus-chrome-item"
        onClick={() => void connectSpotify('focus', toast)}
      >
        <Music size={14} aria-hidden /> {s.connected ? 'Reconnect Spotify' : 'Connect Spotify'}
      </button>
    );
  }

  const data = np.data;
  if (!data) {
    return np.isError ? (
      <span className="focus-hint">Spotify is not answering right now.</span>
    ) : null;
  }
  if (data.status === 'revoked') {
    return (
      <button
        type="button"
        className="focus-link focus-chrome-item"
        onClick={() => void connectSpotify('focus', toast)}
      >
        <Music size={14} aria-hidden /> Reconnect Spotify
      </button>
    );
  }
  if (data.status !== 'ok' || !data.item) {
    return (
      <span className="focus-hint focus-chrome-item">
        <Music size={14} aria-hidden /> Nothing playing on Spotify
      </span>
    );
  }

  const item = data.item;
  const elapsed = data.isPlaying ? now - np.dataUpdatedAt : 0;
  const position = Math.min(item.durationMs, Math.max(0, (data.progressMs ?? 0) + elapsed));
  const fraction = item.durationMs > 0 ? position / item.durationMs : 0;

  return (
    <Glass className="focus-spotify" aria-label="Now playing on Spotify">
      {item.artworkUrl ? (
        <img className="focus-spotify-art" src={item.artworkUrl} alt="" width={52} height={52} />
      ) : (
        <div className="focus-spotify-art focus-spotify-art-empty" aria-hidden>
          <Music size={18} />
        </div>
      )}
      <div className="focus-spotify-main">
        <div className="focus-spotify-title" title={item.title}>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer">
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </div>
        <div className="focus-spotify-artist" title={item.artist}>
          {item.artist}
          {!data.isPlaying && <span className="focus-spotify-state"> · paused</span>}
          {np.isError && <span className="focus-spotify-state"> · last known</span>}
        </div>
        <div className="focus-spotify-bar" aria-hidden>
          <div className="focus-spotify-bar-fill" style={{ width: `${fraction * 100}%` }} />
        </div>
        <span className="sr-only">
          {fmtMs(position)} of {fmtMs(item.durationMs)}
        </span>
      </div>
      {s.canControl && (
        <div className="focus-spotify-controls">
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label="Previous"
            onClick={() => control('previous')}
          >
            <SkipBack size={14} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={data.isPlaying ? 'Pause' : 'Play'}
            onClick={() => control(data.isPlaying ? 'pause' : 'play')}
          >
            {data.isPlaying ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
          </Button>
          <Button variant="ghost" size="sm" icon aria-label="Next" onClick={() => control('next')}>
            <SkipForward size={14} aria-hidden />
          </Button>
        </div>
      )}
    </Glass>
  );
}

/** Spotify in Settings: connect, reconnect, disconnect. The card itself lives on the focus screen. */
export function SpotifySettings() {
  const status = useSpotifyStatus();
  const { toast } = useToast();
  const qc = useQueryClient();
  useSpotifyReturn();
  const s = status.data;

  const description = !s
    ? 'Checking…'
    : !s.available
      ? 'Not configured on this server (see docs/SETUP.md).'
      : !s.connected
        ? 'Show what you are listening to on the focus screen, with play, pause and skip on Premium.'
        : s.revoked
          ? 'Access was revoked. Reconnect to show what is playing again.'
          : `Connected${s.displayName ? ` as ${s.displayName}` : ''}.${s.canControl ? '' : ' Playback control needs Spotify Premium; what is playing still shows.'}`;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="font-medium">Spotify</div>
        <div className="field-hint">{description}</div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {s?.available && (!s.connected || s.revoked) && (
          <Button variant="primary" onClick={() => void connectSpotify('settings', toast)}>
            {s.connected ? 'Reconnect Spotify' : 'Connect Spotify'}
          </Button>
        )}
        {s?.connected && (
          <Button
            variant="ghost"
            onClick={() =>
              api.spotifyDisconnect().then(() => {
                toast('Spotify disconnected');
                void qc.invalidateQueries({ queryKey: keys.spotify });
                void qc.invalidateQueries({ queryKey: keys.nowPlaying });
              })
            }
          >
            Disconnect
          </Button>
        )}
      </div>
    </div>
  );
}
