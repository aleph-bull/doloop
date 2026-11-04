import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, type ActiveSession, type CameraLinkMessage } from './api';
import { keys } from './queries';

/**
 * A phone filming for a computer's timelapse. The computer recording a session is the host;
 * a phone open on the same session can stream its camera straight to it (WebRTC), and the
 * computer records that picture exactly as it would its own webcam's, beside the screen. The
 * API only passes the phone's offer and the computer's answer between them
 * (routes/camera-link.ts); the picture never goes through it, and nothing is uploaded.
 *
 * The handshake is one offer and one answer, each sent once every address is known (no
 * trickling), because the two sides only meet by asking the API every second or so.
 * Addresses come from the network itself and a public STUN server; there is no relay, so a
 * network that keeps its devices apart (some schools and offices) won't link.
 *
 * Once linked, the two keep the session the same (owner, 2026-11-03: "first make sure both
 * ends are on the same state, then get the time"). Whichever end hears of a change first (its
 * own pause, a refresh) hands the session to the other over the link, and the newer one wins
 * (`relayActive`). The phone then reads the computer's clock (`ping`/`pong`) and runs its
 * timer on it, so both show the same second. The phone only follows: the computer owns the
 * session (its sounds, Jack mode's machine, its end), see `follow` in session-controller.
 */

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
];
/** How often a recording computer says it's there and picks up offers. */
const HOST_POLL_MS = 2500;
/** How often a phone looks for a computer recording its session. */
const WATCH_MS = 3000;
/** How often a phone asks while it waits for the computer's answer. */
const PAIR_MS = 800;
/** How often a linked phone checks the computer is still there. */
const LINKED_MS = 5000;
/** After a failed ask (offline, or an API without this): try again later. */
const ERROR_MS = 15_000;
/** An offer with no answer by now is made again. */
const ANSWER_WAIT_MS = 10_000;
/** Cut off this long: start over with a new offer. */
const LOST_WAIT_MS = 6000;
/** The first look for a computer gives up waiting after this; the phone carries on alone. */
const CHECK_WAIT_MS = 2500;
/** The most the phone's camera may send. Plenty for sharp stills over Wi-Fi. */
const MAX_BITRATE = 4_000_000;
/** How often a linked phone reads the computer's clock again. */
const CLOCK_MS = 10_000;
/** Clock readings kept; the one with the quickest round trip is the truest. */
const CLOCK_SAMPLES = 6;
/** A session bigger than this isn't sent over the link (a refresh brings it instead). */
const MAX_NOTE_CHARS = 60_000;

/** The running session as the API last told one end: `now` is the API's time of that answer. */
type ActiveData = { now: string; active: ActiveSession | null };

/** What the two say to each other once linked. */
type Note =
  | { t: 'state'; filming: boolean }
  | { t: 'bye' }
  | { t: 'active'; data: ActiveData }
  | { t: 'ping'; a: number }
  | { t: 'pong'; a: number; b: number };

type Outgoing = Omit<CameraLinkMessage, 'id'>;

export const cameraLinkSupported = (): boolean => typeof RTCPeerConnection !== 'undefined';

function newLinkId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function readNote(data: unknown): Note | null {
  if (typeof data !== 'string') return null;
  try {
    const note = JSON.parse(data) as Partial<Note> & Record<string, unknown>;
    if (note.t === 'bye') return { t: 'bye' };
    if (note.t === 'state') return { t: 'state', filming: !!note.filming };
    if (note.t === 'ping' && typeof note.a === 'number') return { t: 'ping', a: note.a };
    if (note.t === 'pong' && typeof note.a === 'number' && typeof note.b === 'number')
      return { t: 'pong', a: note.a, b: note.b };
    if (note.t === 'active') {
      const d = note.data as Partial<ActiveData> | undefined;
      if (d && typeof d.now === 'string' && d.active !== undefined)
        return { t: 'active', data: { now: d.now, active: d.active } };
    }
  } catch {
    /* not one of ours */
  }
  return null;
}

/** Say something down an open channel; a closed one drops it. */
function say(c: RTCDataChannel | null, note: Note) {
  if (c?.readyState !== 'open') return;
  const text = JSON.stringify(note);
  if (text.length <= MAX_NOTE_CHARS) c.send(text);
}

const stampOf = (d: ActiveData) => Date.parse(d.now) || 0;
const isActiveKey = (key: readonly unknown[]) =>
  key.length === keys.active.length && key.every((k, i) => k === keys.active[i]);

/**
 * Keeps the running session the same on both ends of a link. What this end knows is sent on
 * opening and whenever it changes (an event sent from here, a refresh); what the other end
 * sends is taken when it is newer. The API's own time on each answer orders them, so the two
 * clocks never have to agree for this. A session that ended is always taken.
 */
function relayActive(qc: QueryClient, channel: RTCDataChannel) {
  let newest = 0;
  const offer = (d: ActiveData | undefined) => {
    if (!d || stampOf(d) <= newest) return;
    newest = stampOf(d);
    say(channel, { t: 'active', data: d });
  };
  const stop = qc.getQueryCache().subscribe((e) => {
    if (e.type === 'updated' && isActiveKey(e.query.queryKey))
      offer(e.query.state.data as ActiveData | undefined);
  });
  offer(qc.getQueryData<ActiveData>(keys.active));
  return {
    take: (d: ActiveData) => {
      if (d.active && stampOf(d) <= newest) return;
      newest = Math.max(newest, stampOf(d));
      qc.setQueryData(keys.active, d);
    },
    stop,
  };
}

/** Wait until every address is in the description, or long enough. */
function gathered(pc: RTCPeerConnection, ms = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      window.clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = window.setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/** Keep the picture sharp rather than smooth: stills want detail, not frames. */
async function tuneSender(sender: RTCRtpSender | null) {
  if (!sender) return;
  try {
    const p = sender.getParameters();
    if (!p.encodings?.length) p.encodings = [{}];
    p.encodings[0]!.maxBitrate = MAX_BITRATE;
    (p as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
      'maintain-resolution';
    await sender.setParameters(p);
  } catch {
    /* a browser that won't take these sends at its own rate */
  }
}

/** Close a connection a moment later, so a last "bye" on it still gets out. */
function closeSoon(pc: RTCPeerConnection | null) {
  if (pc) window.setTimeout(() => pc.close(), 300);
}

/**
 * Asks the API one at a time: a call wanted while one is out runs straight after it.
 * `run` returns how long to wait before the next ask.
 */
function asker(run: () => Promise<number>) {
  let timer = 0;
  let busy = false;
  let again = false;
  let stopped = false;
  const ask = async () => {
    if (stopped) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    window.clearTimeout(timer);
    const wait = await run();
    busy = false;
    if (stopped) return;
    if (again) {
      again = false;
      void ask();
    } else timer = window.setTimeout(() => void ask(), wait);
  };
  return {
    ask: () => void ask(),
    stop: () => {
      stopped = true;
      window.clearTimeout(timer);
    },
  };
}

/* ---------- the computer ---------- */

/**
 * The computer's side: while it records `sessionId`, it says so, answers a phone's offer and
 * hands back the phone's camera once it is connected (null otherwise, and again if the phone
 * goes). `filming` is passed on so the phone can say whether stills are being taken.
 */
export function useCameraHost(sessionId: string | null, filming: boolean): MediaStream | null {
  const qc = useQueryClient();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const filmingRef = useRef(filming);
  useEffect(() => {
    filmingRef.current = filming;
    say(channel.current, { t: 'state', filming });
  }, [filming]);

  useEffect(() => {
    if (!sessionId || !cameraLinkSupported()) return;
    let stopped = false;
    let after = 0;
    let pc: RTCPeerConnection | null = null;
    let link: string | null = null;
    let relay: ReturnType<typeof relayActive> | null = null;
    const outbox: Outgoing[] = [];

    const drop = () => {
      relay?.stop();
      relay = null;
      channel.current = null;
      closeSoon(pc);
      pc = null;
      link = null;
      setStream(null);
    };

    const answer = async (id: string, sdp: string) => {
      // A new offer replaces whatever was there: the phone reloaded, or tried again.
      drop();
      const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pc = conn;
      link = id;
      let incoming: MediaStream | null = null;
      conn.ontrack = (e) => {
        incoming = e.streams[0] ?? new MediaStream([e.track]);
        if (conn === pc && conn.connectionState === 'connected') setStream(incoming);
      };
      conn.ondatachannel = (e) => {
        if (conn !== pc) return;
        const c = e.channel;
        channel.current = c;
        c.onopen = () => {
          if (conn !== pc) return;
          say(c, { t: 'state', filming: filmingRef.current });
          relay?.stop();
          relay = relayActive(qc, c);
        };
        c.onmessage = (m) => {
          const note = readNote(m.data);
          if (conn !== pc || !note) return;
          if (note.t === 'bye') drop();
          else if (note.t === 'active') relay?.take(note.data);
          // The phone reads this computer's clock to run its timer on the same second.
          else if (note.t === 'ping') say(c, { t: 'pong', a: note.a, b: Date.now() });
        };
      };
      conn.onconnectionstatechange = () => {
        if (conn !== pc) return;
        // Only a connected phone takes over from the webcam; a short cut-off keeps it (its
        // picture just pauses), and a failed or closed link gives the webcam back.
        if (conn.connectionState === 'connected' && incoming) setStream(incoming);
        else if (conn.connectionState === 'failed' || conn.connectionState === 'closed') drop();
      };
      try {
        await conn.setRemoteDescription({ type: 'offer', sdp });
        await conn.setLocalDescription(await conn.createAnswer());
        await gathered(conn);
      } catch {
        if (conn === pc) drop();
        return;
      }
      if (conn !== pc || stopped || !conn.localDescription) return;
      outbox.push({ link: id, kind: 'answer', sdp: conn.localDescription.sdp });
      polls.ask();
    };

    const polls = asker(async () => {
      const send = outbox.splice(0);
      try {
        const res = await api.cameraLink({ sessionId, role: 'host', after, send });
        if (stopped) return HOST_POLL_MS;
        for (const m of res.messages) {
          after = Math.max(after, m.id);
          if (m.kind === 'offer' && m.sdp) void answer(m.link, m.sdp);
          else if (m.kind === 'bye' && m.link === link) drop();
        }
        return HOST_POLL_MS;
      } catch {
        return ERROR_MS;
      }
    });
    polls.ask();

    return () => {
      stopped = true;
      polls.stop();
      const c = channel.current;
      // The session as it stands now (ended, if that is why), so the phone isn't left behind.
      const last = qc.getQueryData<ActiveData>(keys.active);
      if (last) say(c, { t: 'active', data: last });
      say(c, { t: 'bye' });
      const was = link;
      drop();
      void api
        .cameraLink({
          sessionId,
          role: 'host',
          leave: true,
          send: was ? [{ link: was, kind: 'bye' }] : [],
        })
        .catch(() => undefined);
    };
  }, [sessionId, qc]);

  return stream;
}

/* ---------- the phone ---------- */

/** How the phone's link to the computer stands while it films for it. */
export type CameraLinkStatus = 'connecting' | 'on' | 'lost';

export interface CameraSender {
  /** The first look for a computer is done (or gave up), so the phone can decide what to ask. */
  checked: boolean;
  /** A computer is recording this session. */
  host: boolean;
  status: CameraLinkStatus;
  /** The computer is taking stills right now: focus, not a break or a pause. */
  filming: boolean;
  /**
   * How far the computer's clock is ahead of this phone's, in ms, read over the link while it
   * films; 0 until read. The phone runs the session's timer on it.
   */
  clockOffsetMs: number;
}

export interface CameraSenderArgs {
  sessionId: string | null;
  /** Look for a computer recording the session. */
  watch: boolean;
  /** Film for it. */
  film: boolean;
  /** This phone's camera, while it is on. */
  stream: MediaStream | null;
  /** The computer stopped recording (or went) while this phone filmed for it. */
  onHostGone: () => void;
}

/** The phone's side: finds a computer recording the session and, when asked, films for it. */
export function useCameraSender({
  sessionId,
  watch,
  film,
  stream,
  onHostGone,
}: CameraSenderArgs): CameraSender {
  const qc = useQueryClient();
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const [hostFor, setHostFor] = useState<string | null>(null);
  const [status, setStatus] = useState<CameraLinkStatus>('connecting');
  const [filming, setFilming] = useState(false);
  const [clockOffsetMs, setClockOffset] = useState(0);
  const streamRef = useRef(stream);
  const senderRef = useRef<RTCRtpSender | null>(null);
  const goneRef = useRef(onHostGone);
  useEffect(() => {
    goneRef.current = onHostGone;
  });

  // The picture goes down the link only while the computer is taking stills. On a break, a
  // pause or Jack mode's lever the camera stays on for the phone's own screen, but nothing is
  // encoded or sent (owner, 2026-11-04: a phone joining on a break, filming while the computer
  // wasn't, froze and the video had none of it); it is back the moment focus is. A new camera
  // (swapped, or started again after the screen locked) goes down the same link.
  const [linkedAt, setLinkedAt] = useState(0);
  useEffect(() => {
    streamRef.current = stream;
    const sender = senderRef.current;
    if (!sender) return;
    const track = filming ? (stream?.getVideoTracks()[0] ?? null) : null;
    if (sender.track === track) return;
    if (track) track.contentHint = 'detail';
    void sender.replaceTrack(track).catch(() => undefined);
  }, [stream, filming, linkedAt]);

  const looking = !!sessionId && (watch || film) && cameraLinkSupported();
  useEffect(() => {
    if (!looking || !sessionId) return;
    let stopped = false;
    let after = 0;
    let pc: RTCPeerConnection | null = null;
    let channel: RTCDataChannel | null = null;
    let link: string | null = null;
    let connected = false;
    let sentAt = 0;
    let lostAt = 0;
    /** Asks in a row with no computer there while not connected. */
    let missing = 0;
    let relay: ReturnType<typeof relayActive> | null = null;
    let clockTimer = 0;
    /** Readings of the computer's clock: the round trip, and how far ahead it was. */
    const readings: Array<{ trip: number; ahead: number }> = [];
    const outbox: Outgoing[] = [];
    const giveUp = window.setTimeout(() => setCheckedFor(sessionId), CHECK_WAIT_MS);

    const readClock = () => say(channel, { t: 'ping', a: Date.now() });
    const tookReading = (a: number, b: number) => {
      const back = Date.now();
      // Halfway through the round trip is when the computer read its clock.
      readings.push({ trip: back - a, ahead: b - (a + back) / 2 });
      if (readings.length > CLOCK_SAMPLES) readings.shift();
      const best = readings.reduce((x, y) => (y.trip < x.trip ? y : x));
      const ahead = Math.round(best.ahead);
      // Small wobbles are left alone, so the clock never jitters by a second.
      setClockOffset((was) => (Math.abs(was - ahead) < 150 ? was : ahead));
    };

    const close = (sayBye: boolean) => {
      if (sayBye && link) {
        say(channel, { t: 'bye' });
        outbox.push({ link, kind: 'bye' });
      }
      relay?.stop();
      relay = null;
      window.clearInterval(clockTimer);
      closeSoon(pc);
      pc = null;
      channel = null;
      senderRef.current = null;
      link = null;
      connected = false;
      lostAt = 0;
    };
    const gone = () => {
      close(false);
      goneRef.current();
    };

    const offer = async () => {
      close(false);
      const s = streamRef.current;
      const track = s?.getVideoTracks()[0];
      // The camera is still starting: the next ask tries again.
      if (!s || !track) return;
      const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const id = newLinkId();
      pc = conn;
      link = id;
      sentAt = Date.now();
      track.contentHint = 'detail';
      senderRef.current = conn.addTrack(track, s);
      const c = conn.createDataChannel('link');
      channel = c;
      c.onopen = () => {
        if (conn !== pc) return;
        // The same session on both ends first, then the computer's time.
        relay?.stop();
        relay = relayActive(qc, c);
        readClock();
        window.clearInterval(clockTimer);
        clockTimer = window.setInterval(readClock, CLOCK_MS);
      };
      c.onmessage = (m) => {
        const note = readNote(m.data);
        if (conn !== pc || !note) return;
        if (note.t === 'state') setFilming(note.filming);
        else if (note.t === 'active') relay?.take(note.data);
        else if (note.t === 'pong') tookReading(note.a, note.b);
        else if (note.t === 'bye') gone();
      };
      conn.onconnectionstatechange = () => {
        if (conn !== pc) return;
        const state = conn.connectionState;
        if (state === 'connected') {
          connected = true;
          lostAt = 0;
          setStatus('on');
          void tuneSender(senderRef.current);
          // A new link: send the picture or hold it, as the computer is filming or not.
          setLinkedAt(Date.now());
        } else if (state === 'disconnected' || state === 'failed') {
          // Failed starts over at the next ask; a cut-off gets a few seconds to come back.
          lostAt = state === 'failed' ? Date.now() - LOST_WAIT_MS : Date.now();
          setStatus('lost');
          if (state === 'failed') polls.ask();
        }
      };
      setStatus('connecting');
      setFilming(false);
      try {
        await conn.setLocalDescription(await conn.createOffer());
        await gathered(conn);
      } catch {
        if (conn === pc) close(false);
        return;
      }
      if (conn !== pc || stopped || !conn.localDescription) return;
      outbox.push({ link: id, kind: 'offer', sdp: conn.localDescription.sdp });
      sentAt = Date.now();
      polls.ask();
    };

    const hostGone = () => {
      gone();
      return WATCH_MS;
    };

    const polls = asker(async () => {
      const send = outbox.splice(0);
      try {
        const res = await api.cameraLink({ sessionId, role: 'camera', after, send });
        if (stopped) return WATCH_MS;
        window.clearTimeout(giveUp);
        setHostFor(res.host ? sessionId : null);
        setCheckedFor(sessionId);
        for (const m of res.messages) {
          after = Math.max(after, m.id);
          if (m.link !== link) continue;
          if (m.kind === 'bye') return hostGone();
          if (m.kind === 'answer' && m.sdp && pc?.signalingState === 'have-local-offer')
            await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }).catch(() => undefined);
        }
        if (!film) return WATCH_MS;
        // Linked, the connection itself says the computer is there; otherwise the API does.
        missing = res.host || connected ? 0 : missing + 1;
        if (missing >= 2) return hostGone();
        const stale =
          !pc ||
          (!connected && lostAt === 0 && Date.now() - sentAt > ANSWER_WAIT_MS) ||
          (lostAt > 0 && Date.now() - lostAt >= LOST_WAIT_MS);
        if (res.host && stale) void offer();
        return connected ? LINKED_MS : PAIR_MS;
      } catch {
        setCheckedFor(sessionId);
        return film ? PAIR_MS * 4 : ERROR_MS;
      }
    });
    polls.ask();
    if (film) void offer();

    return () => {
      stopped = true;
      window.clearTimeout(giveUp);
      polls.stop();
      const had = !!link;
      close(film);
      setClockOffset(0);
      if (had)
        void api.cameraLink({ sessionId, role: 'camera', send: outbox }).catch(() => undefined);
    };
  }, [looking, sessionId, film, qc]);

  return {
    checked: !looking || checkedFor === sessionId,
    host: hostFor !== null && hostFor === sessionId,
    status,
    filming,
    clockOffsetMs: film ? clockOffsetMs : 0,
  };
}
