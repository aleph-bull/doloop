import type { TimelapseDevice, TimelapseOrientation } from '@komogon/core';
import type { RecorderPace, Still } from './timelapse';
import type { CoveredSession } from './timelapse-keep';

/**
 * A recording on one device copied to the other while the two are linked (lib/camera-link.ts),
 * so either can make and save the video (owner, 2026-11-04: "make sure file transfer of the
 * screen recording or the phone recording can go onto either devices"). The device recording
 * sends its stills down a data channel of their own as they are taken; the other keeps the
 * same set, thinned with it. Straight between the two, like the camera's picture: nothing
 * goes through the API or anywhere else.
 *
 * Each still goes once. The side taking them says first which it already holds (from an
 * earlier link, or kept through a refresh), and the sender sends the rest, oldest first, then
 * each new one as it comes. When the sender's set loses stills (thinned, or started over), it
 * sends the whole list and the copy keeps only those.
 */

/** What the other device needs beside the stills to make the same video. */
export interface MirrorInfo {
  /** The kind of device that took them: its preset makes the video. */
  device: TimelapseDevice;
  /** A phone's video: which way it goes. */
  orientation: TimelapseOrientation | null;
  /** Sessions the recording went through that have ended, oldest first. */
  covered: CoveredSession[];
  /** What those sessions add to each still's clocks. */
  offset: { work: number; breaks: number };
  pace: RecorderPace;
}

/** What the sender reads each time it looks: the stills now, and what goes with them. */
export interface MirrorSource {
  stills: Still[];
  info: MirrorInfo;
}

/** The copy as it stands: the stills held, what goes with them, and how many are still to come. */
export interface StillsMirror {
  stills: Still[];
  info: MirrorInfo;
  missing: number;
}

export const STILLS_CHANNEL = 'stills';

/** Small enough for every browser's data channel. */
const CHUNK = 16 * 1024;
/** Sending waits once this much is queued, until it is down to the low mark. */
const HIGH_WATER = 1024 * 1024;
const LOW_WATER = 256 * 1024;
/** How often the sender looks for new stills once the copy has caught up. */
const LOOK_MS = 400;
/** How long the sender waits to hear what the other side holds before sending everything. */
const HAVE_WAIT_MS = 2000;
/** The copy hands its stills on at most this often while they pour in. */
const FLUSH_MS = 250;

type StillMeta = Omit<Still, 'blob' | 'screen'>;

type Head =
  | { t: 'have'; keys: number[] }
  | { t: 'info'; info: MirrorInfo; keys: number[] }
  | { t: 'still'; key: number; sizes: [number, number]; meta: StillMeta };

/** A still is known by when it was taken: one every 33 ms at the most, in a live clip. */
const keyOf = (s: Still) => s.takenAt;

/** Keys go as the gap from the one before, which is a lot shorter written out. */
function pack(keys: number[]): number[] {
  return keys.map((k, i) => (i === 0 ? k : k - keys[i - 1]!));
}
function unpack(packed: number[]): number[] {
  const keys: number[] = [];
  for (const [i, d] of packed.entries()) keys.push(i === 0 ? d : keys[i - 1]! + d);
  return keys;
}

const isNumbers = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n));

function readHead(data: unknown): Head | null {
  if (typeof data !== 'string') return null;
  try {
    const h = JSON.parse(data) as Record<string, unknown>;
    if (h.t === 'have' && isNumbers(h.keys)) return { t: 'have', keys: unpack(h.keys) };
    if (h.t === 'info' && isNumbers(h.keys) && h.info && typeof h.info === 'object') {
      const info = h.info as MirrorInfo;
      if (info.device !== 'phone' && info.device !== 'computer') return null;
      return {
        t: 'info',
        keys: unpack(h.keys),
        info: {
          device: info.device,
          orientation:
            info.orientation === 'upright' || info.orientation === 'sideways'
              ? info.orientation
              : null,
          covered: Array.isArray(info.covered) ? info.covered : [],
          offset: {
            work: Number(info.offset?.work) || 0,
            breaks: Number(info.offset?.breaks) || 0,
          },
          pace: {
            intervalMs: Number(info.pace?.intervalMs) || 0,
            clipSeconds: Number(info.pace?.clipSeconds) || 0,
          },
        },
      };
    }
    if (
      h.t === 'still' &&
      typeof h.key === 'number' &&
      isNumbers(h.sizes) &&
      h.sizes.length === 2 &&
      h.meta &&
      typeof h.meta === 'object'
    )
      return {
        t: 'still',
        key: h.key,
        sizes: [Math.max(0, h.sizes[0]!), Math.max(0, h.sizes[1]!)],
        meta: { ...(h.meta as StillMeta), takenAt: h.key },
      };
  } catch {
    /* not one of ours */
  }
  return null;
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/**
 * The device recording: sends its stills down `channel` as `read` gives them, until stopped or
 * the channel closes. `read` answers null while there is nothing to send.
 */
export function sendStills(channel: RTCDataChannel, read: () => MirrorSource | null) {
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = LOW_WATER;
  let stopped = false;
  /** What the other side holds, once it has said. */
  let theirs: Set<number> | null = null;
  let sentInfo = '';
  const open = () => !stopped && channel.readyState === 'open';

  channel.addEventListener('message', (e) => {
    const head = readHead(e.data);
    if (head?.t === 'have') theirs = new Set(head.keys);
  });

  const drained = () =>
    new Promise<void>((resolve) => {
      if (channel.bufferedAmount <= LOW_WATER || !open()) return resolve();
      const done = () => {
        channel.removeEventListener('bufferedamountlow', done);
        channel.removeEventListener('close', done);
        resolve();
      };
      channel.addEventListener('bufferedamountlow', done);
      channel.addEventListener('close', done);
    });

  const sendStill = async (s: Still) => {
    const camera = s.blob ? await s.blob.arrayBuffer() : null;
    const screen = s.screen ? await s.screen.arrayBuffer() : null;
    if (!open()) throw new Error('closed');
    const { blob: _blob, screen: _screen, ...meta } = s;
    channel.send(
      JSON.stringify({
        t: 'still',
        key: keyOf(s),
        sizes: [camera?.byteLength ?? 0, screen?.byteLength ?? 0],
        meta,
      }),
    );
    for (const buf of [camera, screen]) {
      if (!buf) continue;
      for (let at = 0; at < buf.byteLength; at += CHUNK) {
        if (channel.bufferedAmount > HIGH_WATER) await drained();
        if (!open()) throw new Error('closed');
        channel.send(buf.slice(at, at + CHUNK));
      }
    }
  };

  const run = async () => {
    const since = Date.now();
    while (open()) {
      if (!theirs) {
        if (Date.now() - since < HAVE_WAIT_MS) {
          await sleep(100);
          continue;
        }
        theirs = new Set();
      }
      const held: Set<number> = theirs;
      const src = read();
      if (!src || src.stills.length === 0) {
        await sleep(LOOK_MS);
        continue;
      }
      const keys = src.stills.map(keyOf);
      const now = new Set(keys);
      let lost = false;
      for (const k of held)
        if (!now.has(k)) {
          held.delete(k);
          lost = true;
        }
      const info = JSON.stringify(src.info);
      // The first time, after a thinning, or when what goes with them changed.
      if (lost || info !== sentInfo) {
        channel.send(JSON.stringify({ t: 'info', info: src.info, keys: pack(keys) }));
        sentInfo = info;
      }
      const next = src.stills.find((s) => !held.has(keyOf(s)));
      if (!next) {
        await sleep(LOOK_MS);
        continue;
      }
      await sendStill(next);
      held.add(keyOf(next));
    }
  };
  void run().catch(() => undefined);

  return {
    stop: () => {
      stopped = true;
    },
  };
}

/**
 * The other device: takes the stills that come down `channel`, starting from those it already
 * holds (`have`), and hands the whole copy to `onChange` as it grows.
 */
export function takeStills(
  channel: RTCDataChannel,
  have: Still[],
  onChange: (mirror: StillsMirror) => void,
) {
  channel.binaryType = 'arraybuffer';
  const held = new Map<number, Still>(have.map((s) => [keyOf(s), s]));
  let order: number[] = have.map(keyOf);
  let listed = new Set(order);
  let info: MirrorInfo | null = null;
  let incoming: {
    key: number;
    meta: StillMeta;
    sizes: [number, number];
    parts: ArrayBuffer[];
    got: number;
  } | null = null;
  let timer = 0;
  let stopped = false;

  const flush = () => {
    timer = 0;
    if (!info || stopped) return;
    const stills: Still[] = [];
    for (const k of order) {
      const s = held.get(k);
      if (s) stills.push(s);
    }
    onChange({ stills, info, missing: order.length - stills.length });
  };
  const changed = () => {
    if (!timer) timer = window.setTimeout(flush, FLUSH_MS);
  };

  const finish = () => {
    const c = incoming;
    if (!c) return;
    incoming = null;
    const all = new Blob(c.parts);
    const [a, b] = c.sizes;
    held.set(c.key, {
      ...c.meta,
      blob: a > 0 ? all.slice(0, a, 'image/jpeg') : null,
      screen: b > 0 ? all.slice(a, a + b, 'image/jpeg') : null,
    });
    // A new still comes after the last list; a listed one already has its place.
    if (!listed.has(c.key)) {
      order.push(c.key);
      listed.add(c.key);
    }
    changed();
  };

  const onMessage = (e: MessageEvent) => {
    if (typeof e.data !== 'string') {
      if (!incoming || !(e.data instanceof ArrayBuffer)) return;
      incoming.parts.push(e.data);
      incoming.got += e.data.byteLength;
      if (incoming.got >= incoming.sizes[0] + incoming.sizes[1]) finish();
      return;
    }
    const head = readHead(e.data);
    if (!head) return;
    if (head.t === 'info') {
      info = head.info;
      order = head.keys;
      listed = new Set(order);
      for (const k of [...held.keys()]) if (!listed.has(k)) held.delete(k);
      changed();
    } else if (head.t === 'still') {
      incoming = { key: head.key, meta: head.meta, sizes: head.sizes, parts: [], got: 0 };
      if (head.sizes[0] + head.sizes[1] === 0) finish();
    }
  };
  channel.addEventListener('message', onMessage);

  const sayHave = () => {
    if (channel.readyState === 'open')
      channel.send(JSON.stringify({ t: 'have', keys: pack([...held.keys()]) }));
  };
  if (channel.readyState === 'open') sayHave();
  else channel.addEventListener('open', sayHave, { once: true });

  return {
    stop: () => {
      stopped = true;
      window.clearTimeout(timer);
      channel.removeEventListener('message', onMessage);
    },
  };
}
