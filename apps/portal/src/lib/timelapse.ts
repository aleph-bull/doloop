import {
  deflickerGains,
  startIntervalMs,
  stillCap,
  thinIfFull,
  timelapseClock,
  type TimelapseOptions,
  type TimelapsePlan,
} from '@komogon/core';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The camera timelapse: stills taken while the user focuses, kept in this tab's memory, and
 * made into a video on request. Nothing is uploaded; closing the tab discards the stills.
 */

/** One still from the camera. */
export interface Still {
  blob: Blob;
  /** Average brightness, 0..1, for the deflicker. */
  luma: number;
  /** Focused seconds of the session when it was taken, for the clock drawn into the video. */
  workSeconds: number;
}

export type RecorderStatus = 'off' | 'starting' | 'on' | 'denied' | 'unavailable' | 'error';

/** Width stills are kept at: sharp enough for a 1080p-ish video, small enough to hold 2400. */
const STILL_WIDTH = 960;
const STILL_QUALITY = 0.82;
/** How long auto exposure gets to settle before it is locked. */
const EXPOSURE_SETTLE_MS = 2500;

export const cameraSupported = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/**
 * Lock exposure and white balance where the camera allows it, once auto has settled, so the
 * light does not pump from still to still. Cameras that cannot lock still get the deflicker.
 */
async function lockExposure(track: MediaStreamTrack): Promise<void> {
  const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
  const settings = track.getSettings() as Record<string, unknown>;
  const advanced: Record<string, unknown> = {};
  const modes = (k: string) => (Array.isArray(caps[k]) ? (caps[k] as string[]) : []);
  if (modes('exposureMode').includes('manual') && typeof settings.exposureTime === 'number') {
    advanced.exposureMode = 'manual';
    advanced.exposureTime = settings.exposureTime;
  }
  if (
    modes('whiteBalanceMode').includes('manual') &&
    typeof settings.colorTemperature === 'number'
  ) {
    advanced.whiteBalanceMode = 'manual';
    advanced.colorTemperature = settings.colorTemperature;
  }
  if (Object.keys(advanced).length === 0) return;
  try {
    await track.applyConstraints({ advanced: [advanced as MediaTrackConstraintSet] });
  } catch {
    /* some drivers advertise a lock they will not take; the deflicker covers them */
  }
}

/** Average brightness of a frame, read from a tiny copy of it. */
function lumaOf(ctx: CanvasRenderingContext2D, source: CanvasImageSource): number {
  ctx.drawImage(source, 0, 0, 16, 9);
  const d = ctx.getImageData(0, 0, 16, 9).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
  return sum / (d.length / 4) / 255;
}

export interface TimelapseRecorderArgs {
  /** Camera on while true. */
  recording: boolean;
  /** Stills are taken only while true: during focus, not breaks or a pause. */
  capturing: boolean;
  options: TimelapseOptions;
  /** The session's focused seconds right now. */
  workSeconds: () => number;
}

export interface TimelapseRecorder {
  status: RecorderStatus;
  /** How many stills are held. */
  count: number;
  /** The live camera, for a small preview, while recording. */
  stream: MediaStream | null;
  /** The stills taken so far, oldest first. */
  stills: () => Still[];
  /** Focused seconds the stills cover, first to last. */
  spanSeconds: () => number;
  /** Throw the stills away. */
  clear: () => void;
}

export function useTimelapseRecorder({
  recording,
  capturing,
  options,
  workSeconds,
}: TimelapseRecorderArgs): TimelapseRecorder {
  const [status, setStatus] = useState<RecorderStatus>('off');
  const [count, setCount] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const stillsRef = useRef<Still[]>([]);
  const intervalRef = useRef(startIntervalMs(options));
  // The loop reads the latest of these without restarting.
  const live = useRef({ capturing, options, workSeconds });
  useEffect(() => {
    live.current = { capturing, options, workSeconds };
  });

  // A change of mode before anything is captured starts at that mode's pace.
  useEffect(() => {
    if (stillsRef.current.length === 0) intervalRef.current = startIntervalMs(options);
  }, [options]);

  useEffect(() => {
    if (!recording) return;
    if (!cameraSupported()) {
      setStatus('unavailable');
      return;
    }
    let cancelled = false;
    let timer = 0;
    let media: MediaStream | null = null;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const tiny = document.createElement('canvas');
    tiny.width = 16;
    tiny.height = 9;
    const tinyCtx = tiny.getContext('2d', { willReadFrequently: true });

    const take = async () => {
      const { capturing, options, workSeconds } = live.current;
      if (!capturing || video.readyState < 2 || !ctx || !tinyCtx) return;
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      canvas.width = Math.min(STILL_WIDTH, w);
      canvas.height = Math.round((canvas.width * h) / w);
      // Kept the way others see it, so notes and book pages read the right way round; only
      // the little live preview is a mirror.
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const luma = lumaOf(tinyCtx, canvas);
      const blob = await new Promise<Blob | null>((r) =>
        canvas.toBlob(r, 'image/jpeg', STILL_QUALITY),
      );
      if (!blob || cancelled) return;
      const next = [...stillsRef.current, { blob, luma, workSeconds: workSeconds() }];
      const thinned = thinIfFull(next, stillCap(options));
      if (thinned) intervalRef.current *= 2;
      stillsRef.current = thinned ?? next;
      setCount(stillsRef.current.length);
    };

    const loop = async () => {
      const started = performance.now();
      await take();
      if (cancelled) return;
      // Timed from this still, so the spacing stays even however long the encode took.
      const wait = Math.max(0, intervalRef.current - (performance.now() - started));
      timer = window.setTimeout(() => void loop(), wait);
    };

    setStatus('starting');
    navigator.mediaDevices
      .getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        media = s;
        video.srcObject = s;
        await video.play().catch(() => undefined);
        setStream(s);
        setStatus('on');
        const track = s.getVideoTracks()[0];
        if (track) window.setTimeout(() => void lockExposure(track), EXPOSURE_SETTLE_MS);
        void loop();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : '';
        setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      media?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      setStream(null);
      setStatus((s) => (s === 'on' || s === 'starting' ? 'off' : s));
    };
  }, [recording]);

  const stills = useCallback(() => stillsRef.current, []);
  const spanSeconds = useCallback(() => {
    const s = stillsRef.current;
    return s.length < 2 ? 0 : s[s.length - 1]!.workSeconds - s[0]!.workSeconds;
  }, []);
  const clear = useCallback(() => {
    stillsRef.current = [];
    intervalRef.current = startIntervalMs(live.current.options);
    setCount(0);
  }, []);

  return { status, count, stream, stills, spanSeconds, clear };
}

/* ---------- making the video ---------- */

export interface TimelapseLook {
  showTimer: boolean;
  smooth: boolean;
  deflicker: boolean;
}

const MIME_CHOICES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1.42E01F',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export const videoSupported = (): boolean =>
  typeof MediaRecorder !== 'undefined' &&
  typeof HTMLCanvasElement !== 'undefined' &&
  'captureStream' in HTMLCanvasElement.prototype;

function pickMime(): string {
  return MIME_CHOICES.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, Math.max(0, ms)));

/** The studied-time clock in the bottom corner: a soft pill, sized to the video. */
function drawClock(ctx: CanvasRenderingContext2D, w: number, h: number, seconds: number) {
  const size = Math.round(h * 0.055);
  const pad = Math.round(size * 0.55);
  const text = timelapseClock(seconds);
  ctx.save();
  ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
  const tw = ctx.measureText(text).width;
  const x = Math.round(h * 0.04);
  const y = h - Math.round(h * 0.04) - size - pad;
  ctx.fillStyle = 'rgba(10, 12, 24, 0.55)';
  ctx.beginPath();
  ctx.roundRect(x, y, tw + pad * 2, size + pad, (size + pad) / 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + pad, y + (size + pad) / 2 + 1);
  ctx.restore();
  void w;
}

/**
 * Play the stills onto a canvas at the plan's frame rate and record it. The recorder takes
 * frames in real time, so a 30 s video takes about 30 s to make, and the tab has to stay
 * open for it.
 */
export async function renderTimelapse(
  stills: Still[],
  plan: TimelapsePlan,
  look: TimelapseLook,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; mime: string }> {
  if (stills.length === 0 || plan.frames.length === 0) throw new Error('Nothing to make yet');
  const first = await createImageBitmap(stills[0]!.blob);
  const w = first.width;
  const h = first.height;
  first.close();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the video');
  const gains = look.deflicker ? deflickerGains(stills.map((s) => s.luma)) : null;

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  const mime = pickMime();
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const done = new Promise<void>((r) => (recorder.onstop = () => r()));

  // Decoded stills, kept only while a frame still needs them.
  const cache = new Map<number, ImageBitmap>();
  const bitmap = async (i: number) => {
    let b = cache.get(i);
    if (!b) {
      b = await createImageBitmap(stills[i]!.blob);
      cache.set(i, b);
    }
    return b;
  };

  const frameMs = 1000 / plan.fps;
  recorder.start();
  const t0 = performance.now();
  let previous: number | null = null;
  try {
    for (let j = 0; j < plan.frames.length; j++) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      const [from, to] = plan.frames[j]!;
      for (const k of cache.keys()) {
        if (k < from - 1) {
          cache.get(k)!.close();
          cache.delete(k);
        }
      }
      let gain = 1;
      if (gains) {
        let g = 0;
        for (let i = from; i < to; i++) g += gains[i]!;
        gain = g / (to - from);
      }
      ctx.filter = gain === 1 ? 'none' : `brightness(${gain.toFixed(3)})`;
      ctx.globalAlpha = 1;
      if (look.smooth && to - from > 1) {
        // Several stills behind this frame: average them, like a long shutter.
        for (let i = from, n = 1; i < to; i++, n++) {
          ctx.globalAlpha = 1 / n;
          ctx.drawImage(await bitmap(i), 0, 0, w, h);
        }
      } else if (look.smooth && previous !== null && previous !== from) {
        // One still per frame: a little of the last one under it softens the steps.
        ctx.drawImage(await bitmap(previous), 0, 0, w, h);
        ctx.globalAlpha = 0.7;
        ctx.drawImage(await bitmap(from), 0, 0, w, h);
      } else {
        ctx.drawImage(await bitmap(from), 0, 0, w, h);
      }
      ctx.globalAlpha = 1;
      ctx.filter = 'none';
      if (look.showTimer) drawClock(ctx, w, h, stills[to - 1]!.workSeconds);
      previous = to - 1;
      track?.requestFrame();
      onProgress((j + 1) / plan.frames.length);
      await sleep(t0 + (j + 1) * frameMs - performance.now());
    }
  } finally {
    for (const b of cache.values()) b.close();
    cache.clear();
    if (recorder.state !== 'inactive') recorder.stop();
    await done;
    stream.getTracks().forEach((t) => t.stop());
  }
  return { blob: new Blob(chunks, { type: mime.split(';')[0] }), mime };
}

/** A file name for the download, by the day it was made. */
export function timelapseFileName(mime: string, now = new Date()): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `komogon-timelapse-${day}.${mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
}
