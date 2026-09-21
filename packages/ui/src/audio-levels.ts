/**
 * System audio capture for the ambient glow.
 *
 * The microphone is deliberately not used: the glow should follow whatever the computer is
 * playing. The only way a web page can hear that is `getDisplayMedia` with audio, which is
 * a screen-share prompt — the user picks a tab or the whole screen and ticks "share audio".
 * So this can fail in several ordinary ways, and every one of them is a state the caller
 * renders rather than an error it throws.
 */

import { advanceLevels, BAND_COUNT, isSilent, type SpectrumLevels } from '@doloop/core';

/** The shape the capture produces; the motion that consumes it lives in core. */
export type AudioLevels = SpectrumLevels;
export { advanceLevels, BAND_COUNT, isSilent };

export type AudioSourceState =
  | 'idle'
  | 'requesting'
  | 'listening'
  /** The browser cannot capture system audio at all. */
  | 'unsupported'
  /** The user dismissed the prompt, or the page is not allowed to ask. */
  | 'denied'
  /** Sharing started but carried no audio track — usually "share audio" was left unticked. */
  | 'no-audio';

export interface AudioSource {
  state: AudioSourceState;
  /** Reads the current levels; returns null when nothing is being captured. */
  read: () => AudioLevels | null;
  stop: () => void;
}

interface DisplayMediaCapable {
  getDisplayMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

export function canCaptureSystemAudio(): boolean {
  if (typeof navigator === 'undefined') return false;
  const md = navigator.mediaDevices as (MediaDevices & DisplayMediaCapable) | undefined;
  return typeof md?.getDisplayMedia === 'function' && typeof window.AudioContext === 'function';
}

/**
 * Ask for system audio and start analysing it. Must be called from a user gesture.
 *
 * `onStateChange` fires when the user stops sharing from the browser's own banner, which
 * is not something the page can intercept.
 */
export async function captureSystemAudio(
  onStateChange?: (state: AudioSourceState) => void,
): Promise<AudioSource> {
  const fail = (state: AudioSourceState): AudioSource => ({
    state,
    read: () => null,
    stop: () => {},
  });

  if (!canCaptureSystemAudio()) return fail('unsupported');

  let stream: MediaStream;
  try {
    // Chrome requires video to be requested even when only the audio is wanted.
    stream = await (
      navigator.mediaDevices as MediaDevices & Required<DisplayMediaCapable>
    ).getDisplayMedia({ video: true, audio: true });
  } catch {
    return fail('denied');
  }

  // The picture is never used; dropping it immediately avoids encoding a screen capture.
  for (const track of stream.getVideoTracks()) track.stop();

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    for (const track of stream.getTracks()) track.stop();
    return fail('no-audio');
  }

  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  // The visualizer does its own attack/decay, so keep the node's own smoothing light.
  analyser.smoothingTimeConstant = 0.6;
  const sourceNode = ctx.createMediaStreamSource(stream);
  sourceNode.connect(analyser);
  // Deliberately not connected to the destination: this must not echo the audio back.

  const spectrum = new Uint8Array(analyser.frequencyBinCount);
  const bands = new Float32Array(BAND_COUNT);

  let stopped = false;
  const source: AudioSource = {
    state: 'listening',
    read() {
      if (stopped) return null;
      analyser.getByteFrequencyData(spectrum);
      // Logarithmic band edges: linear bins put almost everything in the bottom band.
      const maxBin = Math.floor(spectrum.length * 0.7);
      let total = 0;
      for (let i = 0; i < BAND_COUNT; i++) {
        const from = Math.floor(maxBin ** (i / BAND_COUNT));
        const to = Math.max(from + 1, Math.floor(maxBin ** ((i + 1) / BAND_COUNT)));
        let peak = 0;
        for (let bin = from; bin < to && bin < spectrum.length; bin++) {
          peak = Math.max(peak, spectrum[bin]! / 255);
        }
        bands[i] = peak;
        total += peak;
      }
      return { bands, level: total / BAND_COUNT };
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const track of stream.getTracks()) track.stop();
      void ctx.close().catch(() => {});
    },
  };

  audioTracks[0]!.addEventListener('ended', () => {
    source.stop();
    onStateChange?.('idle');
  });

  return source;
}
