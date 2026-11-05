import type { TimelapseDevice, TimelapseOrientation } from '@komogon/core';
import { useEffect, useState } from 'react';
import type { EndSummary } from './api';
import type { RecorderPace, Still } from './timelapse';

/**
 * A recording's stills, kept in this browser (IndexedDB) as they are taken, so a refresh, a
 * browser that closes or a computer that shuts down mid-session doesn't lose the timelapse.
 * The focus screen takes them back when it opens again: while their session is still running
 * the recording carries on, and after it the ending screen comes back with them. Nothing
 * leaves the browser. The copy is thrown away once the ending screen has been gone through
 * (owner, 2026-11-04), and also when the video is saved or the stills are thrown away, on
 * sign-out, and after a week.
 *
 * One recording is kept at a time, by one focus tab: the one holding the lock.
 */

const DB_NAME = 'komogon-timelapse';
const STILLS = 'stills';
const META = 'meta';
const META_KEY = 'recording';
const LOCK = 'komogon-timelapse-keep';
const KEEP_MS = 7 * 24 * 3600_000;
/** After a write fails (the disk full, say), how long before trying again from scratch. */
const RETRY_MS = 30_000;

/** A session a recording went through, as it ended. */
export interface CoveredSession {
  id: string;
  startedAt: string;
  endedAt: string;
  workSeconds: number;
  breakSeconds: number;
  /** What it was on, "Course · Task", as a post names it. */
  subject: string | null;
}

/** What the focus screen needs, beside the stills, to pick a recording up again. */
export interface KeptRecording {
  userId: string;
  /** The session the recording is on in, while it runs; null on the ending screen. */
  sessionId: string | null;
  /** The ending screen showing the stills, once the session is over; null while it runs. */
  summary: EndSummary | null;
  /** Sessions it went through that had ended, oldest first, and what they add to the clocks. */
  covered: CoveredSession[];
  offset: { work: number; breaks: number };
  /** The camera was on. */
  recording: boolean;
  /** A phone was filming for the computer (lib/camera-link.ts), keeping its own stills too. */
  films?: boolean;
  /** The screen was being recorded this session. */
  screen: boolean;
  /** A phone's video: which way it goes. */
  orientation: TimelapseOrientation | null;
  pace: RecorderPace;
  /**
   * A copy of the other device's recording (lib/still-sync.ts): the kind of device that took
   * it, whose preset makes the video. Absent for stills taken here.
   */
  source?: TimelapseDevice;
}

export interface Kept {
  meta: KeptRecording & { id: string; updatedAt: number };
  stills: Still[];
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('No local storage'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STILLS);
      req.result.createObjectStore(META);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Deleted elsewhere (sign-out in another tab): open afresh next time.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Could not open local storage'));
    req.onblocked = () => reject(new Error('Local storage is busy'));
  });
  opening.catch(() => {
    opening = null;
  });
  return opening;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Local storage failed'));
    tx.onabort = () => reject(tx.error ?? new Error('This browser would not keep the stills'));
  });
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Forget whatever is kept: sign-out, or clearing this device. */
export async function dropKeptTimelapse(): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction([STILLS, META], 'readwrite');
    tx.objectStore(STILLS).clear();
    tx.objectStore(META).clear();
    await done(tx);
  } catch {
    /* nothing kept, or storage off */
  }
}

/** The kept recording's details without its stills, or null when there is none for this person. */
export async function keptRecordingInfo(
  userId: string,
): Promise<(KeptRecording & { id: string; updatedAt: number }) | null> {
  try {
    const db = await open();
    const tx = db.transaction(META, 'readonly');
    const req = tx.objectStore(META).get(META_KEY);
    await done(tx);
    const meta = req.result as Kept['meta'] | undefined;
    if (!meta || meta.userId !== userId || Date.now() - meta.updatedAt > KEEP_MS) return null;
    return meta;
  } catch {
    return null;
  }
}

/** True while a focus tab is keeping a recording (it holds the lock). */
export async function keepingElsewhere(): Promise<boolean> {
  try {
    const q = await navigator.locks?.query();
    return !!q?.held?.some((l) => l.name === LOCK);
  } catch {
    return false;
  }
}

/**
 * Mirrors the recorder's stills into IndexedDB. Each still is written once, under a number
 * given the first time it is seen; stills thinned away are deleted. Writes go one after
 * another, so they land in the order they were asked for.
 */
export class TimelapseKeeper {
  private keys = new WeakMap<Still, number>();
  private kept = new Set<number>();
  private next = 0;
  private lastMeta = '';
  private id = newId();
  /** The store holds nothing, as far as this keeper knows. */
  private empty = false;
  /** Clear the store before the next write (after a failed one). */
  private reset = false;
  private failedAt = 0;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private unlock: (() => void) | null = null;

  /** False when a write failed lately: the stills are in this tab's memory only. */
  get safe(): boolean {
    return this.failedAt === 0;
  }

  /**
   * Hold the lock for as long as this keeper lives. False when another focus tab has it.
   * Asked twice, a moment apart, since a tab reloading (or React mounting twice in
   * development) lets go of it a moment after the new one asks.
   */
  async claim(): Promise<boolean> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks) return true;
    const once = () =>
      new Promise<boolean>((resolve) => {
        locks
          .request(LOCK, { ifAvailable: true }, (lock) => {
            if (!lock || this.closed) {
              resolve(false);
              return;
            }
            resolve(true);
            return new Promise<void>((r) => {
              this.unlock = r;
            });
          })
          .catch(() => resolve(false));
      });
    if (await once()) return true;
    await new Promise((r) => window.setTimeout(r, 400));
    return !this.closed && once();
  }

  /** Let go of the lock; nothing more is written. */
  close() {
    this.closed = true;
    this.unlock?.();
    this.unlock = null;
  }

  /** What was kept for this person, or null. Stale or someone else's is dropped. */
  async load(userId: string): Promise<Kept | null> {
    const db = await open();
    const tx = db.transaction([STILLS, META], 'readonly');
    const metaReq = tx.objectStore(META).get(META_KEY);
    const keysReq = tx.objectStore(STILLS).getAllKeys();
    const stillsReq = tx.objectStore(STILLS).getAll();
    await done(tx);
    const meta = metaReq.result as Kept['meta'] | undefined;
    const keys = keysReq.result as number[];
    const stills = stillsReq.result as Still[];
    if (
      !meta ||
      meta.userId !== userId ||
      Date.now() - meta.updatedAt > KEEP_MS ||
      stills.length === 0 ||
      keys.length !== stills.length
    ) {
      if (meta || stills.length) this.drop(true);
      else this.empty = true;
      return null;
    }
    // Known already, so carrying on writes only what is new.
    stills.forEach((s, i) => this.keys.set(s, keys[i]!));
    this.kept = new Set(keys);
    this.next = keys.reduce((n, k) => Math.max(n, k + 1), 0);
    this.id = meta.id;
    this.lastMeta = metaKey(meta);
    return { meta, stills };
  }

  /** Bring the copy in line with the recorder's stills now. */
  sync(stills: readonly Still[], recording: KeptRecording) {
    if (this.closed) return;
    if (stills.length === 0) return this.drop();
    if (this.failedAt && Date.now() - this.failedAt < RETRY_MS) return;
    const puts: Array<[number, Still]> = [];
    const now = new Set<number>();
    for (const s of stills) {
      let k = this.keys.get(s);
      if (k === undefined) {
        k = this.next++;
        this.keys.set(s, k);
        puts.push([k, s]);
      }
      now.add(k);
    }
    const dels = [...this.kept].filter((k) => !now.has(k));
    const meta = { ...recording, id: this.id };
    const mk = metaKey(meta);
    if (puts.length === 0 && dels.length === 0 && mk === this.lastMeta && !this.reset) return;
    this.kept = now;
    this.lastMeta = mk;
    this.empty = false;
    const reset = this.reset;
    this.reset = false;
    this.write((db) => {
      const tx = db.transaction([STILLS, META], 'readwrite');
      const store = tx.objectStore(STILLS);
      if (reset) store.clear();
      for (const k of dels) store.delete(k);
      for (const [k, s] of puts) store.put(s, k);
      tx.objectStore(META).put({ ...meta, updatedAt: Date.now() }, META_KEY);
      return done(tx);
    });
  }

  /** Nothing to keep: the video was saved, or the stills thrown away. */
  drop(force = false) {
    if (this.closed || (this.empty && !force)) return;
    this.empty = true;
    this.keys = new WeakMap();
    this.kept = new Set();
    this.lastMeta = '';
    this.reset = false;
    this.failedAt = 0;
    // The next recording is a new one.
    this.id = newId();
    this.write((db) => {
      const tx = db.transaction([STILLS, META], 'readwrite');
      tx.objectStore(STILLS).clear();
      tx.objectStore(META).clear();
      return done(tx);
    });
  }

  private write(work: (db: IDBDatabase) => Promise<void>) {
    this.queue = this.queue
      .then(open)
      .then(work)
      .then(
        () => {
          this.failedAt = 0;
        },
        () => {
          // Start over next time: clear the store and write every still again.
          this.failedAt = Date.now();
          this.keys = new WeakMap();
          this.kept = new Set();
          this.lastMeta = '';
          this.reset = true;
        },
      );
  }
}

/** The meta as compared between writes: everything but when it was written. */
function metaKey(meta: KeptRecording & { id: string; updatedAt?: number }): string {
  return JSON.stringify({ ...meta, updatedAt: 0 });
}

export interface TimelapseKeep {
  /** Done looking; until then nothing should be asked or recorded over what might come back. */
  settled: boolean;
  /** The recording kept from before, or null. */
  found: Kept | null;
  /** The keeper, or null when this tab doesn't keep one (another focus tab does, or no storage). */
  keeper: TimelapseKeeper | null;
}

/**
 * Run in the app's pages: a recording kept mid-session whose session has since stopped, with
 * no focus screen keeping it, is thrown away (the browser closed mid-session, then the
 * session was stopped from here, so no ending screen showed it). One kept on an ending screen
 * waits for the focus screen. `running` is the running session's id, null for none,
 * undefined until known.
 */
export function useDropFinishedTimelapse(
  userId: string | undefined,
  running: string | null | undefined,
) {
  useEffect(() => {
    if (!userId || running === undefined) return;
    let off = false;
    void (async () => {
      const info = await keptRecordingInfo(userId);
      if (off || !info?.sessionId || info.sessionId === running) return;
      if ((await keepingElsewhere()) || off) return;
      await dropKeptTimelapse();
    })();
    return () => {
      off = true;
    };
  }, [userId, running]);
}

/** How long the focus screen waits for the kept copy before going on without it. */
const LOOK_MS = 2500;

/**
 * Run in the focus screen: takes the lock, reads what was kept, and hands over the keeper
 * that mirrors the stills from then on.
 */
export function useTimelapseKeep(userId: string | undefined): TimelapseKeep {
  const [state, setState] = useState<TimelapseKeep & { for: string | null }>({
    for: null,
    settled: false,
    found: null,
    keeper: null,
  });
  useEffect(() => {
    if (!userId) return;
    const keeper = new TimelapseKeeper();
    let off = false;
    const settle = (found: Kept | null, k: TimelapseKeeper | null) => {
      if (off) return;
      off = true;
      window.clearTimeout(giveUp);
      setState({ for: userId, settled: true, found, keeper: k });
    };
    const giveUp = window.setTimeout(() => {
      keeper.close();
      settle(null, null);
    }, LOOK_MS);
    void (async () => {
      if (!(await keeper.claim())) return settle(null, null);
      if (off) return;
      const found = await keeper.load(userId).catch(() => null);
      settle(found, keeper);
    })();
    return () => {
      off = true;
      window.clearTimeout(giveUp);
      keeper.close();
    };
  }, [userId]);
  return state.for === userId ? state : { settled: false, found: null, keeper: null };
}
