import {
  deflickerGains,
  startIntervalMs,
  stillCap,
  thinIfFull,
  timelapseClock,
  type TimelapseOptions,
  type TimelapsePlan,
} from '@komogon/core';
import { LOGO_PATH, LOGO_VIEWBOX } from '@komogon/ui';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
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
  /** How far into a break it was taken, or null for a still taken during focus. */
  breakSeconds: number | null;
  /** The session's running time, focus and breaks together, when it was taken. */
  totalSeconds: number;
}

/** Where the session stood when a still was taken. */
export type StillStamp = Pick<Still, 'workSeconds' | 'breakSeconds' | 'totalSeconds'>;

export type RecorderStatus = 'off' | 'starting' | 'on' | 'denied' | 'unavailable' | 'error';

/** Width stills are kept at: sharp enough for a 1080p-ish video, small enough to hold 2400. */
const STILL_WIDTH = 960;
const STILL_QUALITY = 0.82;
const STILL_BYTES_KEY = 'komogon.timelapse.stillBytes';

/**
 * The average size of a still from this webcam, measured while recording and kept in this
 * browser, so the size estimates follow the real camera. Null until something was measured.
 */
export function measuredStillBytes(): number | null {
  try {
    const n = Number(localStorage.getItem(STILL_BYTES_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function rememberStillBytes(bytes: number) {
  try {
    const prev = measuredStillBytes();
    // A slow running average: one odd frame (a hand over the lens) barely moves it.
    const next = prev === null ? bytes : prev * 0.95 + bytes * 0.05;
    localStorage.setItem(STILL_BYTES_KEY, String(Math.round(next)));
  } catch {
    /* storage off: the default size is used */
  }
}

/** Free space the browser says it may still use, in bytes, or null when it won't say. */
export async function freeStorageBytes(): Promise<number | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || est.quota === undefined) return null;
    return Math.max(0, est.quota - (est.usage ?? 0));
  } catch {
    return null;
  }
}

export const cameraSupported = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/**
 * Put exposure and white balance back on auto. Locking them looked steadier on paper, but on
 * many Windows webcams the browser reports a stale or minimum exposure while auto is on, so a
 * lock at that value turned the picture almost black, and some drivers keep a manual setting
 * after the camera closes. Auto plus the deflicker is the safe pair.
 */
async function restoreAutoExposure(track: MediaStreamTrack): Promise<void> {
  const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
  const modes = (k: string) => (Array.isArray(caps[k]) ? (caps[k] as string[]) : []);
  const advanced: Record<string, unknown> = {};
  if (modes('exposureMode').includes('continuous')) advanced.exposureMode = 'continuous';
  if (modes('whiteBalanceMode').includes('continuous')) advanced.whiteBalanceMode = 'continuous';
  if (Object.keys(advanced).length === 0) return;
  try {
    await track.applyConstraints({ advanced: [advanced as MediaTrackConstraintSet] });
  } catch {
    /* a driver that refuses keeps whatever it had; the deflicker still evens it out */
  }
}

/** Average brightness of a frame, read from a tiny copy of it. */
function lumaOf(ctx: CanvasRenderingContext2D, source: CanvasImageSource): number {
  ctx.drawImage(source, 0, 0, 16, 9);
  const d = ctx.getImageData(0, 0, 16, 9).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4)
    sum += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
  return sum / (d.length / 4) / 255;
}

export interface TimelapseRecorderArgs {
  /** Camera on while true. */
  recording: boolean;
  /** Stills are taken only while true: during focus, not breaks or a pause. */
  capturing: boolean;
  options: TimelapseOptions;
  /** Where the session stands right now: focused time, break time, running time. */
  stamp: () => StillStamp;
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
  stamp,
}: TimelapseRecorderArgs): TimelapseRecorder {
  const [status, setStatus] = useState<RecorderStatus>('off');
  const [count, setCount] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const stillsRef = useRef<Still[]>([]);
  const intervalRef = useRef(startIntervalMs(options));
  // The loop reads the latest of these without restarting.
  const live = useRef({ capturing, options, stamp });
  useEffect(() => {
    live.current = { capturing, options, stamp };
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
      const { capturing, options, stamp } = live.current;
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
      rememberStillBytes(blob.size);
      const next = [...stillsRef.current, { blob, luma, ...stamp() }];
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
        if (track) void restoreAutoExposure(track);
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
    if (s.length < 2) return 0;
    // With breaks in the stills, the video covers the whole session, not just its focus.
    const key = s.some((x) => x.breakSeconds !== null) ? 'totalSeconds' : 'workSeconds';
    return s[s.length - 1]![key] - s[0]![key];
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
  /** During a recorded break: the break's own time, or the session's running time. */
  breakClock?: 'break' | 'running';
}

/** What the corner clock says on a still. */
function clockText(still: Still, look: TimelapseLook): string {
  if (look.breakClock === 'running') {
    const t = timelapseClock(still.totalSeconds);
    return still.breakSeconds !== null ? `${t} · Break` : t;
  }
  if (still.breakSeconds !== null) return `Break ${timelapseClock(still.breakSeconds)}`;
  return timelapseClock(still.workSeconds);
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
function drawClock(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  const size = Math.round(h * 0.055);
  const pad = Math.round(size * 0.55);
  ctx.save();
  ctx.font = `600 ${size}px 'Inter Variable', Inter, system-ui, sans-serif`;
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

/** The watermark's colour: black on a light corner, white on a dark one. */
type WatermarkTone = '#000000' | '#ffffff';

/**
 * Black or white for the watermark, chosen once for the whole video from the 30th frame (or
 * the last, in a shorter one): the brightness of the corner the mark sits in, not the
 * frame's average, since a bright window behind a dark desk would mislead it.
 */
async function watermarkTone(
  stills: Still[],
  plan: TimelapsePlan,
  w: number,
  h: number,
): Promise<WatermarkTone> {
  const frame = plan.frames[Math.min(29, plan.frames.length - 1)];
  const still = frame ? stills[frame[0]] : stills[stills.length - 1];
  if (!still) return '#ffffff';
  try {
    const bmp = await createImageBitmap(still.blob);
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = Math.max(1, Math.round((64 * h) / w));
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return '#ffffff';
    x.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    // The bottom-right third, where the mark goes.
    const sx = Math.floor(c.width * 0.62);
    const sy = Math.floor(c.height * 0.8);
    const d = x.getImageData(sx, sy, c.width - sx, c.height - sy).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4)
      sum += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
    const luma = sum / (d.length / 4) / 255;
    return luma > 0.55 ? '#000000' : '#ffffff';
  } catch {
    return '#ffffff';
  }
}

const LOGO_SHAPE = typeof Path2D !== 'undefined' ? new Path2D(LOGO_PATH) : null;
const [LOGO_X, LOGO_Y, LOGO_SIZE] = LOGO_VIEWBOX.split(' ').map(Number) as [number, number, number];

/**
 * The Komogon watermark in the bottom-right corner: the mark and the wordmark, as in the
 * portal nav, at 30% opacity, in the tone picked for this video.
 */
function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, tone: WatermarkTone) {
  const size = Math.round(h * 0.05);
  const margin = Math.round(h * 0.04);
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = tone;
  ctx.font = `600 ${Math.round(size * 0.78)}px Satoshi, 'Inter Variable', system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const text = 'Komogon';
  const tw = ctx.measureText(text).width;
  const gap = Math.round(size * 0.35);
  const right = w - margin;
  const cy = h - margin - size / 2;
  ctx.fillText(text, right - tw, cy + 1);
  if (LOGO_SHAPE) {
    ctx.translate(right - tw - gap - size, cy - size / 2);
    ctx.scale(size / LOGO_SIZE, size / LOGO_SIZE);
    ctx.translate(-LOGO_X, -LOGO_Y);
    ctx.fill(LOGO_SHAPE, 'evenodd');
  }
  ctx.restore();
}

/** Draws frame `j` of the plan onto the canvas: decoding, blending, deflicker and clock. */
type FrameDrawer = ((j: number) => Promise<void>) & { dispose: () => void };

function frameDrawer(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  stills: Still[],
  plan: TimelapsePlan,
  look: TimelapseLook,
  mark: WatermarkTone,
): FrameDrawer {
  const gains = look.deflicker ? deflickerGains(stills.map((s) => s.luma)) : null;
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
  let previous: number | null = null;
  const draw = async (j: number) => {
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
    if (look.showTimer) drawClock(ctx, w, h, clockText(stills[to - 1]!, look));
    drawWatermark(ctx, w, h, mark);
    previous = to - 1;
  };
  return Object.assign(draw, {
    dispose: () => {
      for (const b of cache.values()) b.close();
      cache.clear();
    },
  });
}

const AVC_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42001f'];

/** An H.264 config this browser can encode at this size, or null to fall back. */
async function pickEncoderConfig(
  w: number,
  h: number,
  fps: number,
): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const codec of AVC_CODECS) {
    const config: VideoEncoderConfig = {
      codec,
      width: w,
      height: h,
      bitrate: 8_000_000,
      framerate: fps,
      avc: { format: 'avc' },
    };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    } catch {
      /* try the next profile */
    }
  }
  return null;
}

/**
 * Turn the stills into a video. Where the browser has WebCodecs, each frame is encoded with
 * its own timestamp, so the video is exactly the planned length however long a frame takes
 * to draw, and it is made faster than real time. Elsewhere the canvas is recorded in real
 * time, which runs long when drawing can't keep up.
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
  // H.264 wants even dimensions.
  const w = first.width - (first.width % 2);
  const h = first.height - (first.height % 2);
  first.close();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the video');
  const mark = await watermarkTone(stills, plan, w, h);
  // The wordmark is in Satoshi; a canvas draws in whatever font is loaded by then.
  await document.fonts?.load('600 24px Satoshi').catch(() => undefined);
  const draw = frameDrawer(ctx, w, h, stills, plan, look, mark);
  try {
    const config = await pickEncoderConfig(w, h, plan.fps);
    if (config) return await encodeFrames(canvas, config, plan, draw, onProgress, signal);
    return await recordFrames(canvas, plan, draw, onProgress, signal);
  } finally {
    draw.dispose();
  }
}

async function encodeFrames(
  canvas: HTMLCanvasElement,
  config: VideoEncoderConfig,
  plan: TimelapsePlan,
  draw: FrameDrawer,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; mime: string }> {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: canvas.width, height: canvas.height, frameRate: plan.fps },
    fastStart: 'in-memory',
  });
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      failure = e;
    },
  });
  encoder.configure(config);
  const frameUs = 1_000_000 / plan.fps;
  // A keyframe every two seconds keeps scrubbing quick.
  const keyEvery = Math.max(1, Math.round(plan.fps * 2));
  try {
    for (let j = 0; j < plan.frames.length; j++) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      if (failure) throw failure;
      await draw(j);
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(j * frameUs),
        duration: Math.round(frameUs),
      });
      encoder.encode(frame, { keyFrame: j % keyEvery === 0 });
      frame.close();
      // Let the encoder catch up rather than queueing hundreds of frames in memory.
      while (encoder.encodeQueueSize > 6) await sleep(4);
      onProgress((j + 1) / plan.frames.length);
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), mime: 'video/mp4' };
}

async function recordFrames(
  canvas: HTMLCanvasElement,
  plan: TimelapsePlan,
  draw: FrameDrawer,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; mime: string }> {
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  const mime = pickMime();
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const done = new Promise<void>((r) => (recorder.onstop = () => r()));
  const frameMs = 1000 / plan.fps;
  recorder.start();
  const t0 = performance.now();
  try {
    for (let j = 0; j < plan.frames.length; j++) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      await draw(j);
      track?.requestFrame();
      onProgress((j + 1) / plan.frames.length);
      await sleep(t0 + (j + 1) * frameMs - performance.now());
    }
  } finally {
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
