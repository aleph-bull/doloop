/**
 * Audio capture for the focus screen's visualizer.
 *
 * A page cannot hear the computer on its own. The only route to what is playing is
 * `getDisplayMedia` with audio: a screen-share prompt where the user picks a tab, window
 * or screen and ticks "share audio". The video track is stopped the moment it arrives and
 * the audio is analysed but never connected to the output, so nothing echoes. Every
 * ordinary way the request can fall short is a reported reason, not a thrown error.
 */

export interface AudioCapture {
  sampleRate: number;
  fftSize: number;
  frequencyBinCount: number;
  /** Copy the current byte spectrum into `out` (length >= frequencyBinCount). */
  read(out: Uint8Array<ArrayBuffer>): void;
  /** Release the stream and the audio context. Idempotent. */
  stop(): void;
}

export type AudioCaptureFailure =
  /** The browser cannot capture display audio at all. */
  | 'unsupported'
  /** The user dismissed the prompt, or the page is not allowed to ask. */
  | 'denied'
  /** Sharing started but carried no audio; usually "share audio" was left unticked. */
  | 'no-audio';

export type AudioCaptureResult =
  { ok: true; capture: AudioCapture } | { ok: false; reason: AudioCaptureFailure };

interface DisplayMediaCapable {
  getDisplayMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

export function canCaptureAudio(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const md = navigator.mediaDevices as (MediaDevices & DisplayMediaCapable) | undefined;
  return typeof md?.getDisplayMedia === 'function' && typeof window.AudioContext === 'function';
}

/** Bins are sampleRate / fftSize wide: 2048 at 48 kHz is ~23 Hz, fine enough to isolate 20-140 Hz. */
const FFT_SIZE = 2048;

/**
 * Ask for display audio and start analysing it. Must be called from a user gesture.
 * `onEnded` fires when the user stops sharing from the browser's own banner, which the
 * page cannot intercept any other way.
 */
export async function captureDisplayAudio(onEnded: () => void): Promise<AudioCaptureResult> {
  if (!canCaptureAudio()) return { ok: false, reason: 'unsupported' };

  let stream: MediaStream;
  try {
    stream = await (
      navigator.mediaDevices as MediaDevices & Required<DisplayMediaCapable>
    ).getDisplayMedia({
      // Chrome requires video to be requested even when only the audio is wanted.
      video: true,
      audio: true,
      // Keep the shared tab audible to the user; only the analysis needs the stream.
      ...({ suppressLocalAudioPlayback: false, systemAudio: 'include' } as object),
    });
  } catch {
    return { ok: false, reason: 'denied' };
  }

  // The picture is never used; stopping it at once avoids encoding a screen capture.
  for (const track of stream.getVideoTracks()) track.stop();

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    for (const track of stream.getTracks()) track.stop();
    return { ok: false, reason: 'no-audio' };
  }

  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  // The analysis does its own attack and release; the node's smoothing stays light.
  analyser.smoothingTimeConstant = 0.5;
  const source = ctx.createMediaStreamSource(stream);
  source.connect(analyser);
  // Deliberately not connected to the destination: this must not play the audio back.

  let stopped = false;
  const capture: AudioCapture = {
    sampleRate: ctx.sampleRate,
    fftSize: FFT_SIZE,
    frequencyBinCount: analyser.frequencyBinCount,
    read(out) {
      if (!stopped) analyser.getByteFrequencyData(out);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const track of stream.getTracks()) track.stop();
      source.disconnect();
      analyser.disconnect();
      void ctx.close().catch(() => {});
    },
  };

  audioTracks[0]!.addEventListener('ended', () => {
    if (stopped) return;
    capture.stop();
    onEnded();
  });

  // A context created inside a gesture starts running; one that did not is resumed here.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});

  return { ok: true, capture };
}
