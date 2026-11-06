import { api, apiBaseUrl, authHeaders, type HandoverInfo } from './api';
import type { Still } from './timelapse';

/**
 * A phone filming for the computer makes the video (owner, 2026-11-05: "the phone should have
 * the finished product and the computer should tell the user to check the phone"). The
 * computer records its screen; once the session is over it packs its screen stills small and
 * sends them through the API (routes/handover.ts), and the phone lays them over its own
 * camera's stills, each beside the screen still taken nearest to it. Through the API, never the
 * two devices' own link, which doesn't get through on every network ("it should finish and send
 * to eachother when the session is over").
 *
 * The computer's own camera stills go too, for a stretch the phone didn't film (the computer
 * recording before the phone joined, or after it stopped), so nothing filmed is lost.
 */

/** Wide enough to read a screen in the video's screen box. */
const SCREEN_WIDTH = 960;
const CAMERA_WIDTH = 640;
const QUALITY = 0.7;
/** About what one video needs; the computer holds up to twice this. */
const MAX_STILLS = 700;
/** The computer's camera fills a stretch the phone has no still of, at least this long. */
const GAP_MS = 60_000;
/** A screen still lies beside a phone still at most this far apart, however sparse they are. */
const MAX_REACH_MS = 120_000;
const MIN_REACH_MS = 5000;
/** "KGH1". */
const MAGIC = 0x4b474831;
const TRIES = 4;
/** Shrunk at once: decoding and encoding run off the page, a few side by side. */
const BATCH = 6;

/** One still in the pack: its stamps, and the sizes of its pictures (0 for none). */
interface Entry {
  at: number;
  ws: number;
  bs: number | null;
  ts: number;
  ti: string | null;
  l: number;
  p?: boolean;
  c: number;
  s: number;
}

interface Header {
  v: 1;
  /** How far the API's clock was ahead of the computer's when it packed. */
  offsetMs: number;
  stills: Entry[];
}

/** What the computer sent: its stills, on its own clock, and how far the API's was ahead. */
export interface ScreenPack {
  offsetMs: number;
  stills: Still[];
}

async function shrink(blob: Blob, width: number): Promise<Blob> {
  try {
    const img = await createImageBitmap(blob);
    const w = Math.min(width, img.width);
    const h = Math.max(1, Math.round((img.height * w) / img.width));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
    img.close();
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', QUALITY));
    return out && out.size < blob.size ? out : blob;
  } catch {
    return blob;
  }
}

/** Evenly spread picks of at most `max`, the first and last kept. */
function spread<T>(list: readonly T[], max: number): T[] {
  if (list.length <= max) return [...list];
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(list[Math.round((i * (list.length - 1)) / (max - 1))]!);
  return out;
}

interface Shrunk {
  still: Still;
  camera: Blob | null;
  screen: Blob | null;
}

/**
 * The computer's stills, small, in one file: a little header of stamps and sizes, then the
 * pictures in order. Thinned until it fits `maxBytes`. Null when there is nothing to give.
 */
export async function packScreens(
  stills: readonly Still[],
  offsetMs: number,
  maxBytes: number,
  onProgress?: (fraction: number) => void,
): Promise<Blob | null> {
  // Live clips stay out: the phone's own are the video's.
  const usable = stills.filter((s) => s.clip === undefined && (s.screen || s.blob));
  if (!usable.some((s) => s.screen)) return null;
  const picked = spread(usable, MAX_STILLS);
  let shrunk: Shrunk[] = [];
  for (let i = 0; i < picked.length; i += BATCH) {
    const batch = picked.slice(i, i + BATCH);
    shrunk.push(
      ...(await Promise.all(
        batch.map(async (still) => ({
          still,
          camera: still.blob ? await shrink(still.blob, CAMERA_WIDTH) : null,
          screen: still.screen ? await shrink(still.screen, SCREEN_WIDTH) : null,
        })),
      )),
    );
    onProgress?.(Math.min(1, (i + batch.length) / picked.length));
  }
  const size = (list: Shrunk[]) =>
    list.reduce((n, x) => n + (x.camera?.size ?? 0) + (x.screen?.size ?? 0) + 160, 64);
  while (size(shrunk) > maxBytes && shrunk.length > 2)
    shrunk = shrunk.filter((_, i) => i % 2 === 0);

  const header: Header = {
    v: 1,
    offsetMs: Math.round(offsetMs),
    stills: shrunk.map(({ still: s, camera, screen }) => ({
      at: s.takenAt,
      ws: s.workSeconds,
      bs: s.breakSeconds,
      ts: s.totalSeconds,
      ti: s.title,
      l: Math.round(s.luma * 1000) / 1000,
      ...(s.portrait !== undefined ? { p: s.portrait } : {}),
      c: camera?.size ?? 0,
      s: screen?.size ?? 0,
    })),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const head = new DataView(new ArrayBuffer(8));
  head.setUint32(0, MAGIC);
  head.setUint32(4, json.length);
  const body: BlobPart[] = [head.buffer, json];
  for (const x of shrunk) {
    if (x.camera) body.push(x.camera);
    if (x.screen) body.push(x.screen);
  }
  return new Blob(body, { type: 'application/octet-stream' });
}

/** The computer's stills back out of the file it sent. */
export async function unpackScreens(data: Blob): Promise<ScreenPack> {
  const head = new DataView(await data.slice(0, 8).arrayBuffer());
  if (head.byteLength < 8 || head.getUint32(0) !== MAGIC) throw new Error('Not a hand-over');
  const length = head.getUint32(4);
  const header = JSON.parse(await data.slice(8, 8 + length).text()) as Header;
  let at = 8 + length;
  const take = (bytes: number) => {
    if (!bytes) return null;
    const blob = data.slice(at, at + bytes, 'image/jpeg');
    at += bytes;
    return blob;
  };
  const stills = header.stills.map((e): Still => {
    const blob = take(e.c);
    const screen = take(e.s);
    return {
      blob,
      screen,
      luma: e.l,
      workSeconds: e.ws,
      breakSeconds: e.bs,
      totalSeconds: e.ts,
      takenAt: e.at,
      title: e.ti,
      ...(e.p !== undefined ? { portrait: e.p } : {}),
    };
  });
  return { offsetMs: header.offsetMs, stills };
}

/** Index of the time in sorted `times` nearest to `t`, or -1 for none. */
function nearestIndex(times: readonly number[], t: number): number {
  if (times.length === 0) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(times[lo - 1]! - t) <= Math.abs(times[lo]! - t)) return lo - 1;
  return lo;
}

/**
 * This phone's stills with the computer's screen on them: each takes the screen still nearest
 * to it in time (both put on the API's clock), when one is near enough. Live clips keep the
 * whole frame for the camera, as they always do. Where the phone has no still for a minute or
 * more and the computer filmed with its own camera, those stills of the computer's go in.
 */
export function mergeScreens(
  own: readonly Still[],
  ownOffsetMs: number,
  pack: ScreenPack,
): Still[] {
  const onApi = (s: Still, offset: number) => s.takenAt + offset;
  const screens = pack.stills
    .filter((s) => s.screen)
    .map((s) => ({ t: onApi(s, pack.offsetMs), screen: s.screen! }))
    .sort((a, b) => a.t - b.t);
  const screenTimes = screens.map((s) => s.t);
  // How far apart the computer's screen stills are: the nearest can be about that far off.
  const gaps = screenTimes
    .slice(1)
    .map((t, i) => t - screenTimes[i]!)
    .sort((a, b) => a - b);
  const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 0;
  const reach = Math.min(MAX_REACH_MS, Math.max(MIN_REACH_MS, typical * 2));

  const mine = own.map((s) => {
    if (s.clip !== undefined || s.screen) return s;
    const t = onApi(s, ownOffsetMs);
    const i = nearestIndex(screenTimes, t);
    return i >= 0 && Math.abs(screenTimes[i]! - t) <= reach
      ? { ...s, screen: screens[i]!.screen }
      : s;
  });

  const ownTimes = own.map((s) => onApi(s, ownOffsetMs)).sort((a, b) => a - b);
  const fill = pack.stills
    .filter((s) => {
      if (!s.blob) return false;
      const i = nearestIndex(ownTimes, onApi(s, pack.offsetMs));
      return i < 0 || Math.abs(ownTimes[i]! - onApi(s, pack.offsetMs)) >= GAP_MS;
    })
    // Onto this phone's clock, like its own.
    .map((s) => ({ ...s, takenAt: Math.round(onApi(s, pack.offsetMs) - ownOffsetMs) }));
  if (fill.length === 0) return mine;
  return [...mine, ...fill].sort((a, b) => a.takenAt - b.takenAt);
}

async function withTries<T>(run: () => Promise<T>): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run();
    } catch (err) {
      if (i >= TRIES) throw err;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

/** The hand-over as it stands, and how far the API's clock is ahead of this device's. */
export async function handoverNow(
  sessionId: string,
): Promise<{ info: HandoverInfo; offsetMs: number }> {
  const sent = Date.now();
  const info = await api.handover(sessionId);
  const back = Date.now();
  // Halfway through the round trip is when the API read its clock.
  return { info, offsetMs: Date.parse(info.now) - (sent + back) / 2 };
}

const partUrl = (sessionId: string, n: number) =>
  `${apiBaseUrl(true)}/api/sessions/${sessionId}/handover/${n}`;

async function putPart(sessionId: string, n: number, part: Blob): Promise<void> {
  const res = await fetch(partUrl(sessionId, n), {
    method: 'PUT',
    headers: { ...(await authHeaders()), 'content-type': 'application/octet-stream' },
    body: part,
  });
  if (!res.ok) throw new Error(`Part ${n} didn't go (${res.status})`);
}

async function getPart(sessionId: string, n: number): Promise<Blob> {
  const res = await fetch(partUrl(sessionId, n), { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Part ${n} didn't come (${res.status})`);
  return res.blob();
}

/**
 * The computer's side: its screen stills to the phone. `nothing` when it has no screen to
 * give, `taken` when the phone already has them.
 */
export async function sendScreens(
  sessionId: string,
  stills: readonly Still[],
  onProgress?: (fraction: number) => void,
): Promise<'sent' | 'nothing' | 'taken'> {
  const { info, offsetMs } = await withTries(() => handoverNow(sessionId));
  const state = info.handover?.state;
  if (state === 'taken') return 'taken';
  if (state === 'ready') return 'sent';
  const pack = await packScreens(stills, offsetMs, info.maxBytes, (f) => onProgress?.(f * 0.4));
  if (!pack) {
    await withTries(() => api.handoverStart(sessionId, { nothing: true }));
    return 'nothing';
  }
  const parts = Math.ceil(pack.size / info.partBytes);
  await withTries(() => api.handoverStart(sessionId, { bytes: pack.size, parts }));
  for (let n = 0; n < parts; n++) {
    const part = pack.slice(n * info.partBytes, (n + 1) * info.partBytes);
    await withTries(() => putPart(sessionId, n, part));
    onProgress?.(0.4 + (0.6 * (n + 1)) / parts);
  }
  await withTries(() => api.handoverDone(sessionId));
  return 'sent';
}

/**
 * The phone's side: what the computer sent, with how far the API's clock is ahead of this
 * phone's. Null while it isn't all there.
 */
export async function takeScreens(
  sessionId: string,
  onProgress?: (fraction: number) => void,
): Promise<{ pack: ScreenPack; offsetMs: number } | null> {
  const { info, offsetMs } = await handoverNow(sessionId);
  const h = info.handover;
  if (h?.state !== 'ready' || !h.parts) return null;
  const parts: Blob[] = [];
  for (let n = 0; n < h.parts; n++) {
    parts.push(await withTries(() => getPart(sessionId, n)));
    onProgress?.((n + 1) / h.parts);
  }
  return { pack: await unpackScreens(new Blob(parts)), offsetMs };
}
