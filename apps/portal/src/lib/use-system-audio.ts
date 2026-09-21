import {
  canCaptureSystemAudio,
  captureSystemAudio,
  type AudioLevels,
  type AudioSource,
  type AudioSourceState,
} from '@doloop/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface SystemAudio {
  state: AudioSourceState;
  /** Reads the live spectrum; null whenever nothing is being captured. */
  read: () => AudioLevels | null;
  /** Starts capture. Must be called from a user gesture. */
  request: () => Promise<void>;
  stop: () => void;
  /** True when asking is worth offering. */
  canAsk: boolean;
  /** One short line explaining the current state, or null when there is nothing to say. */
  hint: string | null;
}

const HINTS: Partial<Record<AudioSourceState, string>> = {
  unsupported: 'This browser cannot capture system audio.',
  denied: 'Audio sharing was dismissed. The glow is idling.',
  'no-audio': 'That share had no audio — tick "share audio" and try again.',
};

/**
 * System audio for the ambient glow.
 *
 * Capture cannot start on its own: browsers only expose system audio through a screen-share
 * prompt, which needs a user gesture. So the glow idles until it is asked for, and every
 * way the request can fall short is a hint rather than an error.
 */
export function useSystemAudio(enabled: boolean): SystemAudio {
  const [state, setState] = useState<AudioSourceState>('idle');
  const sourceRef = useRef<AudioSource | null>(null);

  const stop = useCallback(() => {
    sourceRef.current?.stop();
    sourceRef.current = null;
    setState('idle');
  }, []);

  const request = useCallback(async () => {
    if (!canCaptureSystemAudio()) return setState('unsupported');
    sourceRef.current?.stop();
    sourceRef.current = null;
    setState('requesting');
    // The user can stop sharing from the browser's own banner, which lands here.
    const source = await captureSystemAudio(() => {
      sourceRef.current = null;
      setState('idle');
    });
    sourceRef.current = source.state === 'listening' ? source : null;
    setState(source.state);
  }, []);

  // Releasing the capture on unmount also removes the browser's sharing indicator.
  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  const read = useCallback(() => sourceRef.current?.read() ?? null, []);

  return {
    state,
    read,
    request,
    stop,
    canAsk: enabled && state !== 'unsupported' && state !== 'requesting',
    hint: HINTS[state] ?? null,
  };
}
