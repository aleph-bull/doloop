import { useEffect, useRef, useState } from 'react';
import { api, type CameraLinkMessage } from './api';

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

/** What the two say to each other once linked. */
type Note = { t: 'state'; filming: boolean } | { t: 'bye' };

type Outgoing = Omit<CameraLinkMessage, 'id'>;

export const cameraLinkSupported = (): boolean => typeof RTCPeerConnection !== 'undefined';

function newLinkId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function readNote(data: unknown): Note | null {
  if (typeof data !== 'string') return null;
  try {
    const note = JSON.parse(data) as Partial<Note>;
    if (note.t === 'bye') return { t: 'bye' };
    if (note.t === 'state')
      return { t: 'state', filming: !!(note as { filming?: unknown }).filming };
  } catch {
    /* not one of ours */
  }
  return null;
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
  const [stream, setStream] = useState<MediaStream | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const filmingRef = useRef(filming);
  useEffect(() => {
    filmingRef.current = filming;
    const c = channel.current;
    if (c?.readyState === 'open') c.send(JSON.stringify({ t: 'state', filming }));
  }, [filming]);

  useEffect(() => {
    if (!sessionId || !cameraLinkSupported()) return;
    let stopped = false;
    let after = 0;
    let pc: RTCPeerConnection | null = null;
    let link: string | null = null;
    const outbox: Outgoing[] = [];

    const drop = () => {
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
        c.onopen = () => c.send(JSON.stringify({ t: 'state', filming: filmingRef.current }));
        c.onmessage = (m) => {
          if (conn === pc && readNote(m.data)?.t === 'bye') drop();
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
      if (c?.readyState === 'open') c.send(JSON.stringify({ t: 'bye' }));
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
  }, [sessionId]);

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
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const [hostFor, setHostFor] = useState<string | null>(null);
  const [status, setStatus] = useState<CameraLinkStatus>('connecting');
  const [filming, setFilming] = useState(false);
  const streamRef = useRef(stream);
  const senderRef = useRef<RTCRtpSender | null>(null);
  const goneRef = useRef(onHostGone);
  useEffect(() => {
    goneRef.current = onHostGone;
  });

  // A new camera (swapped, or started again after the screen locked) goes down the same link.
  useEffect(() => {
    streamRef.current = stream;
    const track = stream?.getVideoTracks()[0];
    if (!track || !senderRef.current) return;
    track.contentHint = 'detail';
    void senderRef.current.replaceTrack(track).catch(() => undefined);
  }, [stream]);

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
    const outbox: Outgoing[] = [];
    const giveUp = window.setTimeout(() => setCheckedFor(sessionId), CHECK_WAIT_MS);

    const close = (sayBye: boolean) => {
      if (sayBye && link) {
        if (channel?.readyState === 'open') channel.send(JSON.stringify({ t: 'bye' }));
        outbox.push({ link, kind: 'bye' });
      }
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
      c.onmessage = (m) => {
        const note = readNote(m.data);
        if (conn !== pc || !note) return;
        if (note.t === 'state') setFilming(note.filming);
        else gone();
      };
      conn.onconnectionstatechange = () => {
        if (conn !== pc) return;
        const state = conn.connectionState;
        if (state === 'connected') {
          connected = true;
          lostAt = 0;
          setStatus('on');
          void tuneSender(senderRef.current);
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
      if (had)
        void api.cameraLink({ sessionId, role: 'camera', send: outbox }).catch(() => undefined);
    };
  }, [looking, sessionId, film]);

  return {
    checked: !looking || checkedFor === sessionId,
    host: hostFor !== null && hostFor === sessionId,
    status,
    filming,
  };
}
