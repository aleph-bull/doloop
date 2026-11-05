/**
 * A phone filming for a computer's timelapse: the two browsers talk to each other directly
 * (WebRTC), and these are the few notes they pass through the API to find each other, the
 * phone's offer and the computer's answer. Kept in memory, like the sign-in limits: they
 * matter for a few seconds, and a restart only means the phone offers again.
 */

export type CameraLinkRole = 'host' | 'camera';
/** The kind of device recording: a computer takes a phone's camera; either hands its stills over. */
export type CameraLinkDevice = 'phone' | 'computer';

/** What one side leaves for the other. */
export interface CameraLinkMessage {
  id: number;
  /** The phone's attempt this belongs to; a new attempt replaces the last. */
  link: string;
  kind: 'offer' | 'answer' | 'bye';
  sdp?: string;
}

export interface CameraLinkExchange {
  /** Messages for the other side. */
  send?: Array<Omit<CameraLinkMessage, 'id'>>;
  /** The highest id already read: those are dropped and not sent again. */
  after?: number;
  /** The computer stops recording: it is no longer there to film for. */
  leave?: boolean;
  /** The host's kind of device. Portals from before 2026-11-04 don't say. */
  device?: CameraLinkDevice;
}

export interface CameraLinkState {
  /** A device is recording this session: a computer can take the phone's camera. */
  host: boolean;
  /** Which kind it is, when it said; absent from a host that didn't. */
  hostDevice?: CameraLinkDevice;
  /** The session has ended. */
  ended?: boolean;
  messages: CameraLinkMessage[];
}

/** A computer that hasn't asked for this long has gone (closed, asleep, offline). */
export const CAMERA_HOST_TTL_MS = 12_000;
/** A pairing nobody has touched for this long is forgotten. */
const ROOM_TTL_MS = 120_000;
/** Notes waiting for one side; past this the oldest go. */
const INBOX_MAX = 8;

interface Room {
  hostSeenAt: number | null;
  hostDevice: CameraLinkDevice | null;
  touchedAt: number;
  inbox: Record<CameraLinkRole, CameraLinkMessage[]>;
}

export class CameraLinks {
  private rooms = new Map<string, Room>();
  private lastPrune = 0;
  // Ids carry on from the wall clock, so after a restart they still only go up and a side
  // holding an old `after` doesn't skip new notes.
  private seq = Date.now();

  constructor(private now: () => number = Date.now) {}

  /** One side's turn: leave its notes, pick up the other's, and (the computer) say it's there. */
  exchange(key: string, role: CameraLinkRole, ex: CameraLinkExchange): CameraLinkState {
    const t = this.now();
    this.prune(t);
    let room = this.rooms.get(key);
    if (!room) {
      room = { hostSeenAt: null, hostDevice: null, touchedAt: t, inbox: { host: [], camera: [] } };
      this.rooms.set(key, room);
    }
    room.touchedAt = t;
    if (role === 'host') {
      room.hostSeenAt = ex.leave ? null : t;
      room.hostDevice = ex.leave ? null : (ex.device ?? null);
    }
    const other: CameraLinkRole = role === 'host' ? 'camera' : 'host';
    for (const m of ex.send ?? []) {
      const box = room.inbox[other];
      box.push({ ...m, id: ++this.seq });
      if (box.length > INBOX_MAX) box.splice(0, box.length - INBOX_MAX);
    }
    const after = ex.after ?? 0;
    room.inbox[role] = room.inbox[role].filter((m) => m.id > after);
    const host = room.hostSeenAt !== null && t - room.hostSeenAt < CAMERA_HOST_TTL_MS;
    return {
      host,
      ...(host && room.hostDevice ? { hostDevice: room.hostDevice } : {}),
      messages: [...room.inbox[role]],
    };
  }

  /** The session ended: nothing left to pair. */
  close(key: string): void {
    this.rooms.delete(key);
  }

  private prune(t: number) {
    if (t - this.lastPrune < ROOM_TTL_MS) return;
    this.lastPrune = t;
    for (const [key, room] of this.rooms)
      if (t - room.touchedAt > ROOM_TTL_MS) this.rooms.delete(key);
  }
}
