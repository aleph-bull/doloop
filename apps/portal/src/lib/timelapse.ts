import {
  aspectRatio,
  deflickerGains,
  LIVE_CLIP_FPS,
  LIVE_CLIP_MAX_SECONDS,
  LIVE_CLIP_TOTAL_SECONDS,
  phoneAspectRatio,
  startIntervalMs,
  stillCap,
  thinIfFull,
  timelapseBitrate,
  timelapseClock,
  timelapseOutputSize,
  type CameraSize,
  type LiveMark,
  type TimelapseAspect,
  type TimelapseLayout,
  type TimelapseOptions,
  type TimelapseOrientation,
  type TimelapsePlan,
} from '@komogon/core';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  composeFrame,
  logoReady,
  rectLuma,
  sourceSize,
  type DrawnRects,
  type WatermarkTone,
} from './timelapse-compose';

/**
 * The timelapse: stills from the camera, and from a shared screen when asked, taken while
 * the user focuses, kept in this tab's memory, and made into a video on request. Nothing
 * is uploaded; closing the tab discards the stills.
 */

/** One moment of the recording: the camera's still, the screen's, or both. */
export interface Still {
  /** The camera's still, or null when the camera is not recorded. */
  blob: Blob | null;
  /** The shared screen's still, or null when no screen was being shared. */
  screen: Blob | null;
  /** Average brightness, 0..1, for the deflicker. */
  luma: number;
  /** Focused seconds of the session when it was taken, for the clock drawn into the video. */
  workSeconds: number;
  /** How far into a break it was taken, or null for a still taken during focus. */
  breakSeconds: number | null;
  /** The session's running time, focus and breaks together, when it was taken. */
  totalSeconds: number;
  /** When it was taken (epoch ms), for the time of day drawn into the video. */
  takenAt: number;
  /** What was being worked on, for the task name drawn into the video. */
  title: string | null;
  /**
   * The camera's still is taller than it is wide: a phone held upright. The first still of
   * a video decides its shape (a phone's upright or sideways layout).
   */
  portrait?: boolean;
  /**
   * The live clip this still is a frame of (numbered from 1 in a recording), filmed at full
   * speed and played at real speed; absent for an ordinary still.
   */
  clip?: number;
}

/** A still is a frame of a live clip. */
export const isClipStill = (s: Still): boolean => s.clip !== undefined;

/** Which of these stills are live clip frames, and when each was taken, for the plan. */
export const liveMarks = (stills: readonly Still[]): LiveMark[] =>
  stills.map((s) => (s.clip !== undefined ? { clip: s.clip, at: s.takenAt } : null));

/** Where the session stood when a still was taken. */
export type StillStamp = Pick<Still, 'workSeconds' | 'breakSeconds' | 'totalSeconds' | 'title'>;

/**
 * The camera. 'ended' means it stopped on its own after it was on: on a phone, the screen
 * locked or another app took the camera.
 */
export type RecorderStatus =
  'off' | 'starting' | 'on' | 'ended' | 'denied' | 'unavailable' | 'error';

/** Which camera: the one facing the person, or the one on the back. */
export type CameraFacing = 'user' | 'environment';
/**
 * The screen share. 'needs-click' means the browser wants a click before it shows its
 * picker (a session that started recording on its own); 'ended' means it was stopped from
 * the browser's sharing bar.
 */
export type ScreenStatus = RecorderStatus | 'needs-click' | 'ended';

/** Width camera stills are kept at: sharp enough for the video, small enough to hold 2400. */
const STILL_WIDTH = 960;
const STILL_QUALITY = 0.82;
/** A live clip keeps every frame, so each is saved a little lighter. */
const CLIP_QUALITY = 0.75;
/** Clip frames being saved at once; past this, frames are skipped until saving catches up. */
const CLIP_MAX_SAVING = 45;
/** Screen stills are kept wider, so text on them stays readable. */
const SCREEN_WIDTH = 1280;
const SCREEN_QUALITY = 0.8;
const STILL_BYTES_KEY = 'komogon.timelapse.stillBytes';
const SCREEN_BYTES_KEY = 'komogon.timelapse.screenBytes';
const CAMERA_RATIO_KEY = 'komogon.timelapse.cameraRatio';
const CAMERA_WIDTH_KEY = 'komogon.timelapse.cameraWidth';
const CAMERA_HEIGHT_KEY = 'komogon.timelapse.cameraHeight';
const SCREEN_RATIO_KEY = 'komogon.timelapse.screenRatio';
const FACING_KEY = 'komogon.timelapse.facing';
/** A screen still before any has been measured: a 1280 px wide JPEG of a busy desktop. */
export const DEFAULT_SCREEN_BYTES = 160_000;

function readNumber(key: string): number | null {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeNumber(key: string, n: number) {
  try {
    localStorage.setItem(key, String(n));
  } catch {
    /* storage off: the default is used */
  }
}

/**
 * The average size of a still from this webcam, measured while recording and kept in this
 * browser, so the size estimates follow the real camera. Null until something was measured.
 */
export function measuredStillBytes(): number | null {
  return readNumber(STILL_BYTES_KEY);
}

/** The same for screen stills. */
export function measuredScreenBytes(): number | null {
  return readNumber(SCREEN_BYTES_KEY);
}

function rememberBytes(key: string, bytes: number) {
  const prev = readNumber(key);
  // A slow running average: one odd frame (a hand over the lens) barely moves it.
  writeNumber(key, Math.round(prev === null ? bytes : prev * 0.95 + bytes * 0.05));
}

/** The camera's width over height, once it has been seen in this browser. */
export function knownCameraRatio(): number | null {
  return readNumber(CAMERA_RATIO_KEY);
}

/** The size the camera records at, once it has been seen in this browser. */
export function knownCameraSize(): CameraSize | null {
  const w = readNumber(CAMERA_WIDTH_KEY);
  const h = readNumber(CAMERA_HEIGHT_KEY);
  return w && h ? { w, h } : null;
}

/** Keep the camera's shape and size, for the layout and for how small the video can go. */
export function rememberCamera(w: number, h: number) {
  if (!(w > 0 && h > 0)) return;
  writeNumber(CAMERA_RATIO_KEY, Math.round((w / h) * 10_000) / 10_000);
  writeNumber(CAMERA_WIDTH_KEY, w);
  writeNumber(CAMERA_HEIGHT_KEY, h);
}

/**
 * The screen's width over height: what was last shared in this browser, or else the
 * monitor's own shape, which the browser tells without asking.
 */
export function knownScreenRatio(): number {
  const shared = readNumber(SCREEN_RATIO_KEY);
  if (shared) return shared;
  if (typeof window !== 'undefined' && window.screen?.width && window.screen.height)
    return window.screen.width / window.screen.height;
  return 16 / 9;
}

function rememberScreenRatio(w: number, h: number) {
  if (w > 0 && h > 0) writeNumber(SCREEN_RATIO_KEY, Math.round((w / h) * 10_000) / 10_000);
}

/** The camera last chosen in this browser; the front one until the person swaps. */
export function knownFacing(): CameraFacing {
  try {
    return localStorage.getItem(FACING_KEY) === 'environment' ? 'environment' : 'user';
  } catch {
    return 'user';
  }
}

export function rememberFacing(facing: CameraFacing) {
  try {
    localStorage.setItem(FACING_KEY, facing);
  } catch {
    /* storage off: the front camera next time */
  }
}

/** Whether this device has a second camera to swap to. Cameras are listed without asking. */
export async function hasTwoCameras(): Promise<boolean> {
  try {
    const devices = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
    return devices.filter((d) => d.kind === 'videoinput').length >= 2;
  } catch {
    return false;
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

export const screenSupported = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

/** What the timelapse records: the camera, the screen, or both. */
export interface TimelapseSources {
  camera: boolean;
  screen: boolean;
}

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

/** A hidden, muted player for a live stream, which stills are drawn from. */
function streamPlayer(stream: MediaStream): HTMLVideoElement {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  return video;
}

/** One frame of a player as a JPEG, no wider than `maxWidth`. */
async function snapshot(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  maxWidth: number,
  quality: number,
): Promise<Blob | null> {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  canvas.width = Math.min(maxWidth, w);
  canvas.height = Math.round((canvas.width * h) / w);
  // Kept the way others see it, so notes and book pages read the right way round; only
  // the little live preview is a mirror.
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
}

export interface TimelapseRecorderArgs {
  /** Recording while true. */
  recording: boolean;
  /** Stills are taken only while true: during focus, not breaks or a pause. */
  capturing: boolean;
  /** What to record. */
  sources: TimelapseSources;
  options: TimelapseOptions;
  /** Where the session stands right now: focused time, break time, running time, task. */
  stamp: () => StillStamp;
  /** Which camera to film with; the front one when absent. Changing it swaps the camera. */
  facing?: CameraFacing;
  /**
   * A phone's camera streamed here (lib/camera-link.ts): filmed in place of this device's
   * own while it is there, which comes back when it goes.
   */
  remote?: MediaStream | null;
  /**
   * False keeps the camera on without taking stills: a phone filming for a computer, which
   * takes them itself.
   */
  keepStills?: boolean;
}

export interface TimelapseRecorder {
  /** The camera. */
  status: RecorderStatus;
  /** The screen share. */
  screenStatus: ScreenStatus;
  /** True while at least one source is giving pictures. */
  live: boolean;
  /** How many stills are held. */
  count: number;
  /** The live camera, for a small preview, while recording. */
  stream: MediaStream | null;
  /** The camera filming is a phone's, streamed here. */
  remote: boolean;
  /**
   * The camera is on but sending no pictures for now (a phone's page hidden, or the camera
   * borrowed by another app). No stills are taken until it comes back.
   */
  cameraMuted: boolean;
  /** Start the camera again after it stopped on its own. */
  restartCamera: () => void;
  /** Ask for the screen again; call it from a click, which the browser's picker needs. */
  requestScreen: () => void;
  /** The stills taken so far, oldest first. */
  stills: () => Still[];
  /** Focused seconds the stills cover, first to last. */
  spanSeconds: () => number;
  /** Throw the stills away. */
  clear: () => void;
  /** The live clip filming now: seconds into it, and how long it may run. */
  clip: { seconds: number; maxSeconds: number } | null;
  /** A live clip can start now: the camera is giving pictures during focus, with room left. */
  canClip: boolean;
  /** This recording's live clips are used up. */
  clipsFull: boolean;
  /** Start a live clip, or stop the one filming. */
  toggleClip: () => void;
}

export function useTimelapseRecorder({
  recording,
  capturing,
  sources,
  options,
  stamp,
  facing = 'user',
  remote = null,
  keepStills = true,
}: TimelapseRecorderArgs): TimelapseRecorder {
  const [status, setStatus] = useState<RecorderStatus>('off');
  const [screenStatus, setScreenStatus] = useState<ScreenStatus>('off');
  const [count, setCount] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraMuted, setCameraMuted] = useState(false);
  // Bumped to start the camera again after it stopped on its own.
  const [cameraTry, setCameraTry] = useState(0);
  const stillsRef = useRef<Still[]>([]);
  const intervalRef = useRef(startIntervalMs(options));
  const cameraVideo = useRef<HTMLVideoElement | null>(null);
  const screenVideo = useRef<HTMLVideoElement | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const screenAsking = useRef(false);
  // The live clip filming now, read by both loops the moment it changes; the state redraws.
  const clipRef = useRef<{ id: number; startedAt: number; limitMs: number } | null>(null);
  const clipsMade = useRef(0);
  /** Seconds of live clip held, against the room a recording has for them. */
  const clipUsed = useRef(0);
  /** Clip frames still being saved; the paced stills wait for them, so the order holds. */
  const clipSaving = useRef(0);
  /** Bumped each time the stills are thrown away, so frames still saving are dropped too. */
  const clears = useRef(0);
  /** How long the clip filming now may run, in seconds; null when none is. */
  const [clipMax, setClipMax] = useState<number | null>(null);
  const clipOn = clipMax !== null;
  const [clipSeconds, setClipSeconds] = useState(0);
  const [clipsFull, setClipsFull] = useState(false);
  const wantCamera = recording && sources.camera;
  const wantScreen = recording && sources.screen;
  // The loop reads the latest of these without restarting.
  const live = useRef({
    capturing,
    options,
    stamp,
    wantCamera,
    wantScreen,
    status,
    screenStatus,
    cameraMuted,
  });
  useEffect(() => {
    live.current = {
      capturing,
      options,
      stamp,
      wantCamera,
      wantScreen,
      status,
      screenStatus,
      cameraMuted,
    };
  });

  // A change of mode before anything is captured starts at that mode's pace.
  useEffect(() => {
    if (stillsRef.current.length === 0) intervalRef.current = startIntervalMs(options);
  }, [options]);

  /* ----- the camera ----- */
  useEffect(() => {
    if (!wantCamera || !remote) return;
    // A phone filming for this computer: its picture takes the webcam's place while it lasts.
    // The stills wait for its first frame like any camera's (`readyState`).
    let cancelled = false;
    const video = streamPlayer(remote);
    void video.play().catch(() => undefined);
    const track = remote.getVideoTracks()[0];
    const onMute = () => !cancelled && setCameraMuted(true);
    const onUnmute = () => !cancelled && setCameraMuted(false);
    track?.addEventListener('mute', onMute);
    track?.addEventListener('unmute', onUnmute);
    cameraVideo.current = video;
    setStream(remote);
    setCameraMuted(!!track?.muted);
    setStatus('on');
    return () => {
      cancelled = true;
      track?.removeEventListener('mute', onMute);
      track?.removeEventListener('unmute', onUnmute);
      // The tracks belong to the link, not to this page to stop.
      video.srcObject = null;
      if (cameraVideo.current === video) cameraVideo.current = null;
      setStream(null);
      setCameraMuted(false);
      setStatus('off');
    };
  }, [wantCamera, remote]);

  useEffect(() => {
    if (!wantCamera || remote) return;
    if (!cameraSupported()) {
      setStatus('unavailable');
      return;
    }
    let cancelled = false;
    let media: MediaStream | null = null;
    setStatus('starting');
    setCameraMuted(false);
    navigator.mediaDevices
      .getUserMedia({
        // Ideal, not exact: a laptop with one camera still films when the back is asked for.
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: facing } },
        audio: false,
      })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        media = s;
        const video = streamPlayer(s);
        await video.play().catch(() => undefined);
        if (cancelled) return;
        cameraVideo.current = video;
        rememberCamera(video.videoWidth, video.videoHeight);
        setStream(s);
        setStatus('on');
        const track = s.getVideoTracks()[0];
        if (track) {
          void restoreAutoExposure(track);
          // A phone stops or mutes the camera when the screen locks or the page is hidden.
          // Without these the recording would go quiet and nobody would know.
          track.addEventListener('ended', () => {
            if (cancelled) return;
            setStream(null);
            setStatus('ended');
          });
          track.addEventListener('mute', () => !cancelled && setCameraMuted(true));
          track.addEventListener('unmute', () => !cancelled && setCameraMuted(false));
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : '';
        setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
      });
    return () => {
      cancelled = true;
      media?.getTracks().forEach((t) => t.stop());
      if (cameraVideo.current) cameraVideo.current.srcObject = null;
      cameraVideo.current = null;
      setStream(null);
      setCameraMuted(false);
      setStatus((s) => (s === 'on' || s === 'starting' || s === 'ended' ? 'off' : s));
    };
  }, [wantCamera, facing, cameraTry, remote]);

  const restartCamera = useCallback(() => setCameraTry((n) => n + 1), []);

  /* ----- the screen ----- */
  const releaseScreen = useCallback(() => {
    screenStream.current?.getTracks().forEach((t) => t.stop());
    screenStream.current = null;
    if (screenVideo.current) screenVideo.current.srcObject = null;
    screenVideo.current = null;
  }, []);

  const requestScreen = useCallback(() => {
    if (screenStream.current || screenAsking.current) return;
    if (!screenSupported()) {
      setScreenStatus('unavailable');
      return;
    }
    // The picker only opens from a click. A session that began recording on its own has
    // none, so it waits for one rather than failing.
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
      .userActivation;
    if (activation && !activation.isActive) {
      setScreenStatus('needs-click');
      return;
    }
    screenAsking.current = true;
    setScreenStatus('starting');
    navigator.mediaDevices
      .getDisplayMedia({
        video: { frameRate: { ideal: 5, max: 15 } },
        audio: false,
        // Recording this tab would only film the focus screen filming itself.
        selfBrowserSurface: 'exclude',
        monitorTypeSurfaces: 'include',
      } as DisplayMediaStreamOptions)
      .then(async (s) => {
        if (!live.current.wantScreen) {
          s.getTracks().forEach((t) => t.stop());
          setScreenStatus('off');
          return;
        }
        screenStream.current = s;
        const video = streamPlayer(s);
        await video.play().catch(() => undefined);
        screenVideo.current = video;
        rememberScreenRatio(video.videoWidth, video.videoHeight);
        setScreenStatus('on');
        s.getVideoTracks()[0]?.addEventListener('ended', () => {
          // Stopped from the browser's own sharing bar.
          releaseScreen();
          setScreenStatus('ended');
        });
      })
      .catch((err: unknown) => {
        const name = err instanceof DOMException ? err.name : '';
        setScreenStatus(
          name === 'NotAllowedError'
            ? 'denied'
            : name === 'InvalidStateError'
              ? 'needs-click'
              : name === 'NotSupportedError'
                ? 'unavailable'
                : 'error',
        );
      })
      .finally(() => {
        screenAsking.current = false;
      });
  }, [releaseScreen]);

  useEffect(() => {
    if (!wantScreen) return;
    requestScreen();
    return () => {
      releaseScreen();
      setScreenStatus('off');
    };
  }, [wantScreen, requestScreen, releaseScreen]);

  /* ----- taking stills ----- */
  useEffect(() => {
    if (!recording || !keepStills) return;
    let cancelled = false;
    let timer = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const tiny = document.createElement('canvas');
    tiny.width = 16;
    tiny.height = 9;
    const tinyCtx = tiny.getContext('2d', { willReadFrequently: true });

    const take = async () => {
      const {
        capturing,
        options,
        stamp,
        wantCamera,
        wantScreen,
        status,
        screenStatus,
        cameraMuted,
      } = live.current;
      // A live clip takes every frame while it runs; the paced stills pick up after it.
      if (!capturing || !ctx || !tinyCtx || clipRef.current || clipSaving.current > 0) return;
      // While a wanted source is still opening, wait for it, so the first stills have both.
      if ((wantCamera && status === 'starting') || (wantScreen && screenStatus === 'starting'))
        return;
      const cam = cameraVideo.current;
      const scr = screenVideo.current;
      // A muted camera hands over its last picture, or black: no stills until it is back.
      const camReady = !!cam && cam.readyState >= 2 && status === 'on' && !cameraMuted;
      const scrReady = !!scr && scr.readyState >= 2;
      if (!camReady && !scrReady) return;
      const blob = camReady ? await snapshot(canvas, ctx, cam!, STILL_WIDTH, STILL_QUALITY) : null;
      const portrait = !!blob && canvas.height > canvas.width;
      const luma = camReady ? lumaOf(tinyCtx, canvas) : 0.5;
      const screen = scrReady
        ? await snapshot(canvas, ctx, scr!, SCREEN_WIDTH, SCREEN_QUALITY)
        : null;
      // A clip that started while this still was saving goes on without it.
      if (cancelled || clipRef.current || clipSaving.current > 0 || (!blob && !screen)) return;
      if (blob) rememberBytes(STILL_BYTES_KEY, blob.size);
      if (screen) rememberBytes(SCREEN_BYTES_KEY, screen.size);
      const next = [
        ...stillsRef.current,
        { blob, screen, luma, portrait, ...stamp(), takenAt: Date.now() },
      ];
      const thinned = thinIfFull(next, stillCap(options), isClipStill);
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
    void loop();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [recording, keepStills]);

  /* ----- live clips ----- */
  const stopClip = useCallback(() => {
    const c = clipRef.current;
    if (!c) return;
    clipRef.current = null;
    clipUsed.current += Math.min(c.limitMs, Date.now() - c.startedAt) / 1000;
    setClipsFull(clipUsed.current > LIVE_CLIP_TOTAL_SECONDS - 1);
    setClipMax(null);
  }, []);

  const toggleClip = useCallback(() => {
    if (clipRef.current) return stopClip();
    const { capturing, wantCamera, status, cameraMuted } = live.current;
    const room = LIVE_CLIP_TOTAL_SECONDS - clipUsed.current;
    if (!capturing || !wantCamera || status !== 'on' || cameraMuted || room < 1) return;
    const seconds = Math.floor(Math.min(LIVE_CLIP_MAX_SECONDS, room));
    clipRef.current = { id: ++clipsMade.current, startedAt: Date.now(), limitMs: seconds * 1000 };
    setClipSeconds(0);
    setClipMax(seconds);
  }, [stopClip]);

  // A clip films focus only, like the stills: a break, a pause or the end of recording stops it.
  useEffect(() => {
    if (!recording || !capturing) stopClip();
  }, [recording, capturing, stopClip]);

  // While a clip runs, every frame the camera gives (up to LIVE_CLIP_FPS) is kept, stamped
  // with the moment it was drawn, so the video can play it back at exactly real speed.
  // Frames are drawn on time and saved alongside one another: a JPEG can take a while to
  // come back (about a second, in a page the browser thinks nobody is looking at), and
  // waiting for each before drawing the next would film a clip at a frame a second.
  useEffect(() => {
    const clip = clipRef.current;
    if (!clipOn || !clip) return;
    let stopped = false;
    let timer = 0;
    let shown = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const tiny = document.createElement('canvas');
    tiny.width = 16;
    tiny.height = 9;
    const tinyCtx = tiny.getContext('2d', { willReadFrequently: true });
    const frameMs = 1000 / LIVE_CLIP_FPS;
    const keptSince = clears.current;
    // Frames wait here, in the order they were drawn, until their JPEGs are back.
    const queue: Array<{ still: Still | null | undefined }> = [];
    const flush = () => {
      while (queue.length > 0 && queue[0]!.still !== undefined) {
        const { still } = queue.shift()!;
        // Thrown away meanwhile: the frame goes with the rest.
        if (still && clears.current === keptSince)
          stillsRef.current = [...stillsRef.current, still];
      }
      clipSaving.current = queue.length;
      if (stopped && queue.length === 0) setCount(stillsRef.current.length);
    };

    const grab = () => {
      const { stamp, status, cameraMuted } = live.current;
      const cam = cameraVideo.current;
      if (!ctx || !tinyCtx || !cam || cam.readyState < 2 || status !== 'on' || cameraMuted) return;
      // Too far behind: this frame is skipped, and the plan holds the one before.
      if (queue.length >= CLIP_MAX_SAVING) return;
      const takenAt = Date.now();
      const at = stamp();
      // The picture is copied as it is drawn, so the canvas is free again straight away.
      const saving = snapshot(canvas, ctx, cam, STILL_WIDTH, CLIP_QUALITY);
      const luma = lumaOf(tinyCtx, canvas);
      const portrait = canvas.height > canvas.width;
      const slot: { still: Still | null | undefined } = { still: undefined };
      queue.push(slot);
      clipSaving.current = queue.length;
      void saving.then((blob) => {
        // No screen in a clip: the camera has the whole frame for whatever is being shown.
        slot.still = blob
          ? { blob, screen: null, luma, portrait, clip: clip.id, ...at, takenAt }
          : null;
        flush();
      });
    };

    const tick = () => {
      if (Date.now() - clip.startedAt >= clip.limitMs) return stopClip();
      const started = performance.now();
      grab();
      // The count and the clip's clock redraw once a second, not on every frame.
      const seconds = Math.floor((Date.now() - clip.startedAt) / 1000);
      if (seconds !== shown) {
        shown = seconds;
        setClipSeconds(seconds);
        setCount(stillsRef.current.length);
      }
      timer = window.setTimeout(tick, Math.max(0, frameMs - (performance.now() - started)));
    };
    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      flush();
    };
  }, [clipOn, stopClip]);

  const stills = useCallback(() => stillsRef.current, []);
  const spanSeconds = useCallback(() => {
    const s = stillsRef.current;
    if (s.length < 2) return 0;
    // With breaks in the stills, the video covers the whole session, not just its focus.
    const key = s.some((x) => x.breakSeconds !== null) ? 'totalSeconds' : 'workSeconds';
    return s[s.length - 1]![key] - s[0]![key];
  }, []);
  const clear = useCallback(() => {
    stopClip();
    clears.current += 1;
    stillsRef.current = [];
    intervalRef.current = startIntervalMs(live.current.options);
    clipUsed.current = 0;
    setClipsFull(false);
    setCount(0);
  }, [stopClip]);

  return {
    status,
    screenStatus,
    live: (status === 'on' && !cameraMuted) || screenStatus === 'on',
    count,
    stream,
    remote: !!remote && status === 'on',
    cameraMuted,
    restartCamera,
    requestScreen,
    stills,
    spanSeconds,
    clear,
    clip: clipMax !== null ? { seconds: clipSeconds, maxSeconds: clipMax } : null,
    canClip:
      !clipOn &&
      !clipsFull &&
      recording &&
      keepStills &&
      capturing &&
      sources.camera &&
      status === 'on' &&
      !cameraMuted,
    clipsFull,
    toggleClip,
  };
}

/* ---------- making the video ---------- */

export interface TimelapseLook {
  smooth: boolean;
  deflicker: boolean;
  /** During a recorded break: the break's own time, or the session's running time. */
  breakClock?: 'break' | 'running';
  /** The account's timezone for the time of day; the browser's when absent. */
  timeZone?: string;
  /** The video's shape. */
  aspect: TimelapseAspect;
  /** How big it is made, in percent of full size; full when absent. */
  resolution?: number;
  /** Where each piece goes. */
  layout: TimelapseLayout;
  /** The person's own line of text on every frame; empty or absent leaves it out. */
  noteText?: string;
  /** When the session started and ended (epoch ms), for the start and end pieces. */
  startAt?: number | null;
  endAt?: number | null;
  /**
   * A phone's video: which way it goes. The camera's shape is turned to match, so a still
   * taken the other way round is cropped to the middle.
   */
  orientation?: TimelapseOrientation;
}

/** The video's width over height for a look, from the camera's and the screen's shapes. */
export function lookRatio(
  look: Pick<TimelapseLook, 'aspect' | 'orientation'>,
  cameraRatio: number | null,
  screenRatio: number | null,
): number {
  return look.orientation
    ? phoneAspectRatio(look.aspect, look.orientation, cameraRatio)
    : aspectRatio(look.aspect, cameraRatio, screenRatio);
}

/** "2:14 PM EST": the time a still was taken, in the account's timezone. */
export function timeOfDayText(takenAt: number, timeZone?: string, zone = true): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    ...(zone ? { timeZoneName: 'short' } : {}),
  };
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone }).format(takenAt);
  } catch {
    // An unknown zone name: the browser's own zone is the next best thing.
    return new Intl.DateTimeFormat('en-US', opts).format(takenAt);
  }
}

/** What the focus clock says on a still: "Focus 42:17", "Break 3:10". */
export function clockText(
  still: Pick<Still, 'workSeconds' | 'breakSeconds' | 'totalSeconds'>,
  breakClock: TimelapseLook['breakClock'],
): string {
  if (breakClock === 'running') {
    const t = `Elapsed ${timelapseClock(still.totalSeconds)}`;
    return still.breakSeconds !== null ? `${t} · Break` : t;
  }
  if (still.breakSeconds !== null) return `Break ${timelapseClock(still.breakSeconds)}`;
  return `Focus ${timelapseClock(still.workSeconds)}`;
}

/** What every text piece says on a still, as the video draws it. */
export function stillTexts(
  still: Pick<Still, 'workSeconds' | 'breakSeconds' | 'totalSeconds' | 'takenAt' | 'title'>,
  look: Pick<TimelapseLook, 'breakClock' | 'timeZone' | 'noteText' | 'startAt' | 'endAt'>,
) {
  const at = (label: string, ms: number | null | undefined) =>
    ms ? `${label} ${timeOfDayText(ms, look.timeZone, false)}` : null;
  return {
    // Stills kept from before the time was recorded have none to show.
    clock: still.takenAt ? timeOfDayText(still.takenAt, look.timeZone) : null,
    elapsed: clockText(still, look.breakClock),
    total: `Elapsed ${timelapseClock(still.totalSeconds)}`,
    start: at('Start', look.startAt),
    end: at('End', look.endAt),
    title: still.title,
    note: look.noteText?.trim() || null,
  };
}

/** "0:07 of 0:30": how far a live clip has run, and how long it may. */
export function clipTime(clip: { seconds: number; maxSeconds: number }): string {
  const short = (s: number) => timelapseClock(s).replace(/^0/, '');
  return `${short(clip.seconds)} of ${short(clip.maxSeconds)}`;
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

/** Draws frame `j` of the plan onto the canvas: decoding, blending, deflicker and layout. */
type FrameDrawer = ((j: number, mark: WatermarkTone | null) => Promise<DrawnRects>) & {
  dispose: () => void;
};

/** A canvas the size of a source's stills, where the stills behind a frame are blended. */
function blendBuffer(
  first: ImageBitmap | null,
  o?: TimelapseOrientation,
): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} | null {
  if (!first) return null;
  // A phone's video goes the way that was picked, even when its first still doesn't.
  const tall = first.height > first.width;
  const turn = !!o && (o === 'upright') !== tall;
  const canvas = document.createElement('canvas');
  canvas.width = turn ? first.height : first.width;
  canvas.height = turn ? first.width : first.height;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

/**
 * A still drawn over the whole buffer. A still the same shape as the buffer just fills it;
 * one the other way round (the phone held the other way from the video) is cropped to the
 * middle rather than squashed, since the video keeps its one shape.
 */
function fillBuffer(b: CanvasRenderingContext2D, bmp: ImageBitmap, bw: number, bh: number) {
  if (Math.abs(bmp.width / bmp.height - bw / bh) < 0.01) {
    b.drawImage(bmp, 0, 0, bw, bh);
    return;
  }
  const scale = Math.max(bw / bmp.width, bh / bmp.height);
  const cw = bw / scale;
  const ch = bh / scale;
  b.drawImage(bmp, (bmp.width - cw) / 2, (bmp.height - ch) / 2, cw, ch, 0, 0, bw, bh);
}

/**
 * The deflicker's gains, worked out over the ordinary stills alone, since a clip's thirty
 * frames a second would swamp the window. A clip's frames take the gain of the still before
 * it, so its light carries on from there.
 */
function clipAwareGains(stills: Still[]): number[] {
  const g = deflickerGains(stills.filter((s) => !isClipStill(s)).map((s) => s.luma));
  let last = g[0] ?? 1;
  let k = 0;
  return stills.map((s) => {
    if (!isClipStill(s)) last = g[k++]!;
    return last;
  });
}

/**
 * Where the progress bar stands on each frame. It fills over the ordinary frames and holds
 * through a live clip, which is a few seconds of a long session.
 */
function frameProgress(plan: TimelapsePlan): (j: number) => number {
  const n = plan.frames.length;
  const byFrame = (j: number) => (n > 1 ? j / (n - 1) : 1);
  const live = plan.live;
  if (!live) return byFrame;
  const ordinary = live.filter((x) => !x).length;
  if (ordinary < 2) return byFrame;
  const at: number[] = [];
  let r = -1;
  for (let j = 0; j < n; j++) {
    if (!live[j]) r++;
    at.push(Math.max(0, r) / (ordinary - 1));
  }
  return (j) => at[j] ?? 1;
}

async function firstBitmap(stills: Still[], key: 'blob' | 'screen') {
  const s = stills.find((x) => x[key]);
  return s ? createImageBitmap(s[key]!) : null;
}

function frameDrawer(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  stills: Still[],
  plan: TimelapsePlan,
  look: TimelapseLook,
  buffers: {
    camera: ReturnType<typeof blendBuffer>;
    screen: ReturnType<typeof blendBuffer>;
  },
): FrameDrawer {
  const gains = look.deflicker ? clipAwareGains(stills) : null;
  const progressAt = frameProgress(plan);
  // Decoded stills, kept only while a frame still needs them.
  const cache = new Map<string, ImageBitmap | null>();
  const bitmap = async (i: number, key: 'blob' | 'screen') => {
    const id = `${key}${i}`;
    if (!cache.has(id)) {
      const b = stills[i]![key];
      cache.set(id, b ? await createImageBitmap(b) : null);
    }
    return cache.get(id) ?? null;
  };
  let previous: number | null = null;
  /** The camera buffer holds a picture, which a moment with none goes on showing. */
  let cameraShown = false;

  /** Blend the stills behind a frame for one source into its buffer; false when it has none. */
  const blend = async (
    buf: NonNullable<ReturnType<typeof blendBuffer>>,
    key: 'blob' | 'screen',
    from: number,
    to: number,
    gain: number,
    live: boolean,
  ): Promise<boolean> => {
    const { ctx: b, canvas } = buf;
    const bw = canvas.width;
    const bh = canvas.height;
    b.filter = gain === 1 ? 'none' : `brightness(${gain.toFixed(3)})`;
    b.globalAlpha = 1;
    let drew = false;
    if (live) {
      // A live clip is real motion already: each frame is just its own still.
      const now = await bitmap(from, key);
      if (now) {
        fillBuffer(b, now, bw, bh);
        drew = true;
      }
    } else if (look.smooth && to - from > 1) {
      // Several stills behind this frame: average them, like a long shutter.
      let n = 0;
      for (let i = from; i < to; i++) {
        const bmp = await bitmap(i, key);
        if (!bmp) continue;
        n++;
        b.globalAlpha = 1 / n;
        fillBuffer(b, bmp, bw, bh);
        drew = true;
      }
    } else {
      const now = await bitmap(from, key);
      const before = previous !== null && previous !== from ? await bitmap(previous, key) : null;
      if (look.smooth && now && before) {
        // One still per frame: a little of the last one under it softens the steps.
        fillBuffer(b, before, bw, bh);
        b.globalAlpha = 0.7;
        fillBuffer(b, now, bw, bh);
        drew = true;
      } else if (now) {
        fillBuffer(b, now, bw, bh);
        drew = true;
      }
    }
    b.globalAlpha = 1;
    b.filter = 'none';
    return drew;
  };

  const draw = async (j: number, mark: WatermarkTone | null) => {
    const [from, to] = plan.frames[j]!;
    for (const k of [...cache.keys()]) {
      if (Number(k.replace(/\D/g, '')) < from - 1) {
        cache.get(k)?.close();
        cache.delete(k);
      }
    }
    let gain = 1;
    if (gains) {
      let g = 0;
      for (let i = from; i < to; i++) g += gains[i]!;
      gain = g / (to - from);
    }
    const live = !!plan.live?.[j];
    // A moment with no camera picture (a phone filming for the computer cut off for a while,
    // a camera paused) holds the last one rather than going dark behind the screen.
    if (buffers.camera && (await blend(buffers.camera, 'blob', from, to, gain, live)))
      cameraShown = true;
    const camera = buffers.camera && cameraShown ? buffers.camera.canvas : null;
    const screen =
      buffers.screen && look.layout.screen.visible
        ? (await blend(buffers.screen, 'screen', from, to, 1, live))
          ? buffers.screen.canvas
          : null
        : null;
    const still = stills[to - 1]!;
    const drawn = composeFrame(
      ctx,
      w,
      h,
      look.layout,
      {
        camera,
        screen,
        ...stillTexts(still, look),
        progress: progressAt(j),
      },
      { mark },
    );
    previous = to - 1;
    return drawn;
  };
  return Object.assign(draw, {
    dispose: () => {
      for (const b of cache.values()) b?.close();
      cache.clear();
    },
  });
}

/**
 * Black or white for the mark, chosen once for the whole video from the 30th frame (or the
 * last, in a shorter one): the brightness of the box the mark sits in, not the frame's
 * average, since a bright window behind a dark desk would mislead it.
 */
async function watermarkTone(
  draw: FrameDrawer,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  plan: TimelapsePlan,
): Promise<WatermarkTone> {
  try {
    const drawn = await draw(Math.min(29, plan.frames.length - 1), null);
    if (!drawn.watermark) return '#ffffff';
    return rectLuma(ctx, w, h, drawn.watermark) > 0.55 ? '#000000' : '#ffffff';
  } catch {
    return '#ffffff';
  }
}

const AVC_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42001f'];

/** An H.264 config this browser can encode at this size and rate, or null to fall back. */
async function pickEncoderConfig(
  w: number,
  h: number,
  fps: number,
  bitrate: number,
): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const codec of AVC_CODECS) {
    const config: VideoEncoderConfig = {
      codec,
      width: w,
      height: h,
      bitrate,
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
 * time, which runs long when drawing can't keep up. Either way it comes out compressed, at
 * the look's resolution (`timelapseOutputSize`, with the camera this browser remembers) and
 * the bitrate for that size (`timelapseBitrate`).
 */
export async function renderTimelapse(
  stills: Still[],
  plan: TimelapsePlan,
  look: TimelapseLook,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; mime: string; w: number; h: number }> {
  if (stills.length === 0 || plan.frames.length === 0) throw new Error('Nothing to make yet');
  await logoReady;
  const firstCamera = await firstBitmap(stills, 'blob');
  const firstScreen = await firstBitmap(stills, 'screen');
  const shapeFrom = firstCamera ?? firstScreen;
  if (!shapeFrom) throw new Error('Nothing to make yet');
  const cameraSize = firstCamera ? sourceSize(firstCamera) : null;
  const screenSize = firstScreen ? sourceSize(firstScreen) : null;
  const ratio = lookRatio(
    look,
    cameraSize ? cameraSize.w / cameraSize.h : null,
    screenSize ? screenSize.w / screenSize.h : knownScreenRatio(),
  );
  const { w, h } = timelapseOutputSize(ratio, look.resolution ?? 100, knownCameraSize());
  const bitrate = timelapseBitrate(w, h, plan.fps);
  const buffers = {
    camera: blendBuffer(firstCamera, look.orientation),
    screen: blendBuffer(firstScreen),
  };
  firstCamera?.close();
  firstScreen?.close();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('This browser cannot draw the video');
  // The wordmark is in Satoshi; a canvas draws in whatever font is loaded by then.
  await document.fonts?.load('600 24px Satoshi').catch(() => undefined);
  const toneDraw = frameDrawer(ctx, w, h, stills, plan, look, buffers);
  const mark = await watermarkTone(toneDraw, ctx, w, h, plan);
  toneDraw.dispose();
  const draw = frameDrawer(ctx, w, h, stills, plan, look, buffers);
  const drawFrame = async (j: number) => {
    await draw(j, mark);
  };
  const count = plan.frames.length;
  try {
    const config = await pickEncoderConfig(w, h, plan.fps, bitrate);
    const made = config
      ? await encodeFrames(canvas, config, plan.fps, count, drawFrame, onProgress, signal)
      : await recordFrames(canvas, plan.fps, bitrate, count, drawFrame, onProgress, signal);
    return { ...made, w, h };
  } finally {
    draw.dispose();
  }
}

async function encodeFrames(
  canvas: HTMLCanvasElement,
  config: VideoEncoderConfig,
  fps: number,
  count: number,
  draw: (j: number) => Promise<void>,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; mime: string }> {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: canvas.width, height: canvas.height, frameRate: fps },
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
  const frameUs = 1_000_000 / fps;
  // A keyframe every two seconds keeps scrubbing quick.
  const keyEvery = Math.max(1, Math.round(fps * 2));
  try {
    for (let j = 0; j < count; j++) {
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
      onProgress((j + 1) / count);
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
  fps: number,
  bitrate: number,
  count: number,
  draw: (j: number) => Promise<void>,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; mime: string }> {
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  const mime = pickMime();
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const done = new Promise<void>((r) => (recorder.onstop = () => r()));
  const frameMs = 1000 / fps;
  recorder.start();
  const t0 = performance.now();
  try {
    for (let j = 0; j < count; j++) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      await draw(j);
      track?.requestFrame();
      onProgress((j + 1) / count);
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
  return `komodon-timelapse-${day}.${mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
}
