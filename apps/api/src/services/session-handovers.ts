import { conflict, HttpError } from '../errors';

/**
 * A phone filming for a computer's timelapse makes the video itself (owner, 2026-11-05: "the
 * phone should have the finished product and the computer should tell the user to check the
 * phone"). The computer records the screen; when the session is over it hands its screen
 * stills to the phone through here, in parts, and the phone lays them over its own camera's.
 *
 * Through the API rather than the two devices' own link, because that link doesn't get through
 * on every network ("still does not connect properly"), and "it should finish and send to
 * eachother when the session is over". Held in memory, a few at a time and not for long: the
 * phone takes it within seconds of the end, and the computer keeps its stills until it has.
 */

/**
 * - `expected`: the computer is recording its screen while a phone films; nothing sent yet.
 * - `sending`: the computer is sending it, part by part.
 * - `ready`: all here, for the phone to take.
 * - `nothing`: the computer has no screen to send.
 * - `taken`: the phone has it; the bytes are gone from here.
 */
export type HandoverState = 'expected' | 'sending' | 'ready' | 'nothing' | 'taken';

export interface HandoverView {
  state: HandoverState;
  /** How many parts it comes in and its whole size, once it is being sent. */
  parts?: number;
  bytes?: number;
  /**
   * While expected: when the computer last said it was recording its screen (ms, the API's
   * clock). Long before the session ended, the computer has gone (closed, asleep), and the phone
   * doesn't hold its video for it.
   */
  seen?: number;
}

/** Long enough for a phone that was asleep when the session ended. */
export const HANDOVER_TTL_MS = 2 * 3600_000;
/** The most one hand-over may be; the computer thins its stills until it fits. */
export const HANDOVER_MAX_BYTES = 64 * 1024 * 1024;
/** Each part, so no one request runs long on a slow connection. */
export const HANDOVER_PART_BYTES = 2 * 1024 * 1024;
export const HANDOVER_MAX_PARTS = Math.ceil(HANDOVER_MAX_BYTES / HANDOVER_PART_BYTES);
/** Everything held at once, for everyone; past this a new one waits until there is room. */
export const HANDOVERS_TOTAL_BYTES = 160 * 1024 * 1024;
/** Records kept (most of them only a state); past this the oldest go. */
const MAX_KEPT = 2000;

interface Handover {
  state: HandoverState;
  /** The size the computer said, held for it from the start. */
  bytes: number;
  parts: Array<Buffer | null>;
  at: number;
}

export class SessionHandovers {
  private kept = new Map<string, Handover>();

  constructor(private now: () => number = Date.now) {}

  /** What the phone or the computer sees. */
  view(key: string): HandoverView | null {
    this.prune();
    const h = this.kept.get(key);
    if (!h) return null;
    if (h.state === 'sending' || h.state === 'ready')
      return { state: h.state, parts: h.parts.length, bytes: h.bytes };
    return h.state === 'expected' ? { state: h.state, seen: h.at } : { state: h.state };
  }

  /**
   * A phone films while the computer records its screen: the phone waits for it at the end. Said
   * on each of the computer's turns, so when it was last there is known too.
   */
  expect(key: string): void {
    this.prune();
    const h = this.kept.get(key);
    if (!h || h.state === 'expected')
      this.set(key, { state: 'expected', bytes: 0, parts: [], at: 0 });
  }

  /** The computer starts sending; anything it sent before is replaced. */
  start(key: string, bytes: number, parts: number): void {
    this.prune();
    if (bytes < 1 || bytes > HANDOVER_MAX_BYTES) throw new HttpError(413, 'Too big to send.');
    if (parts < 1 || parts > HANDOVER_MAX_PARTS || parts * HANDOVER_PART_BYTES < bytes)
      throw new HttpError(400, 'Parts do not add up.');
    this.kept.delete(key);
    if (this.held() + bytes > HANDOVERS_TOTAL_BYTES)
      throw new HttpError(503, 'Busy. Trying again shortly.');
    this.set(key, {
      state: 'sending',
      bytes,
      parts: Array.from({ length: parts }, () => null),
      at: 0,
    });
  }

  put(key: string, part: number, data: Buffer): void {
    const h = this.kept.get(key);
    if (!h || h.state !== 'sending') throw conflict('Not being sent.');
    if (!Number.isInteger(part) || part < 0 || part >= h.parts.length)
      throw new HttpError(400, 'No such part.');
    if (data.length > HANDOVER_PART_BYTES) throw new HttpError(413, 'Part too big.');
    const others = h.parts.reduce((n, p, i) => n + (i === part || !p ? 0 : p.length), 0);
    if (others + data.length > h.bytes) throw new HttpError(400, 'More than was said.');
    h.parts[part] = data;
    this.touch(key, h);
  }

  /** Every part is in: the phone can take it. */
  finish(key: string): HandoverView {
    const h = this.kept.get(key);
    if (!h || (h.state !== 'sending' && h.state !== 'ready')) throw conflict('Not being sent.');
    const got = h.parts.reduce((n, p) => n + (p?.length ?? 0), 0);
    if (h.parts.some((p) => !p) || got !== h.bytes) throw conflict('Parts are missing.');
    h.state = 'ready';
    this.touch(key, h);
    return this.view(key)!;
  }

  /** The computer has no screen to send. */
  nothing(key: string): void {
    this.prune();
    const h = this.kept.get(key);
    if (h?.state === 'ready' || h?.state === 'taken') return;
    this.set(key, { state: 'nothing', bytes: 0, parts: [], at: 0 });
  }

  part(key: string, part: number): Buffer {
    this.prune();
    const h = this.kept.get(key);
    if (!h || h.state !== 'ready') throw conflict('Not ready.');
    const data = h.parts[part];
    if (!data) throw new HttpError(400, 'No such part.');
    return data;
  }

  /** The phone has it: the bytes go, and the computer sees it was taken. */
  take(key: string): void {
    const h = this.kept.get(key);
    if (!h || (h.state !== 'ready' && h.state !== 'taken')) throw conflict('Not ready.');
    this.set(key, { state: 'taken', bytes: 0, parts: [], at: 0 });
  }

  /** Bytes held for hand-overs still being sent or not yet taken. */
  private held(): number {
    let n = 0;
    for (const h of this.kept.values())
      if (h.state === 'sending' || h.state === 'ready') n += h.bytes;
    return n;
  }

  private set(key: string, h: Handover) {
    this.kept.delete(key);
    h.at = this.now();
    this.kept.set(key, h);
    while (this.kept.size > MAX_KEPT) {
      const oldest = this.kept.keys().next().value;
      if (oldest === undefined) break;
      this.kept.delete(oldest);
    }
  }

  /** Changed: it moves to the newest end, so the oldest are swept first. */
  private touch(key: string, h: Handover) {
    this.set(key, h);
  }

  private prune() {
    const t = this.now();
    for (const [key, h] of this.kept) {
      if (t - h.at < HANDOVER_TTL_MS) break;
      this.kept.delete(key);
    }
  }
}
