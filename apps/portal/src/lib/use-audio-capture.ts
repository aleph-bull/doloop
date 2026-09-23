import {
  canCaptureAudio,
  captureDisplayAudio,
  type AudioCapture,
  type AudioCaptureFailure,
} from '@komodoit/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

export type AudioCaptureState = 'idle' | 'requesting' | 'listening' | AudioCaptureFailure;

export interface AudioCaptureHandle {
  state: AudioCaptureState;
  /** The live capture for the visualizer to read each frame; null unless listening. */
  getCapture: () => AudioCapture | null;
  /** Start capture. Must be called from a user gesture. Resolves with the resulting state. */
  request: () => Promise<AudioCaptureState>;
  stop: () => void;
  supported: boolean;
  /** One short line explaining a state worth explaining, or null. */
  hint: string | null;
}

const HINTS: Partial<Record<AudioCaptureState, string>> = {
  unsupported: 'This browser cannot share audio, so the visualizer will idle.',
  denied: 'Nothing was shared. The visualizer is idling.',
  'no-audio': 'That share had no audio. Tick "share audio" and try again.',
};

/**
 * Display audio for the visualizer. Browsers will not remember the share between visits,
 * and capture can only start from a click, so the state starts idle every time and every
 * way the request can fall short is a hint rather than an error.
 */
export function useAudioCapture(): AudioCaptureHandle {
  const [state, setState] = useState<AudioCaptureState>('idle');
  const captureRef = useRef<AudioCapture | null>(null);

  const stop = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    setState('idle');
  }, []);

  const request = useCallback(async (): Promise<AudioCaptureState> => {
    if (!canCaptureAudio()) {
      setState('unsupported');
      return 'unsupported';
    }
    captureRef.current?.stop();
    captureRef.current = null;
    setState('requesting');
    const result = await captureDisplayAudio(() => {
      // Stopped from the browser's own sharing banner.
      captureRef.current = null;
      setState('idle');
    });
    if (result.ok) {
      captureRef.current = result.capture;
      setState('listening');
      return 'listening';
    }
    setState(result.reason);
    return result.reason;
  }, []);

  // Leaving the screen releases the stream, which also removes the browser's sharing indicator.
  useEffect(() => stop, [stop]);

  const getCapture = useCallback(() => captureRef.current, []);

  return {
    state,
    getCapture,
    request,
    stop,
    supported: canCaptureAudio(),
    hint: HINTS[state] ?? null,
  };
}
