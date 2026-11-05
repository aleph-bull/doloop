import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { TimelapseDevice } from '@komogon/core';
import { api, type ActiveSession, type CameraLinkMessage, type EndSummary } from './api';
import { keys } from './queries';
import { sendStills, STILLS_CHANNEL, takeStills, type MirrorSource } from './still-sync';
import type { StillsMirror } from './still-sync';
import type { Still } from './timelapse';

/**
 * A phone and a computer on the same session, linked. The device recording a timelapse is the
 * host; the other kind of device open on the same session links to it (WebRTC), and:
 *
 * - the host's stills are copied to it as they are taken (lib/still-sync.ts), so either can
 *   make and save the video (owner, 2026-11-04);
 * - a phone linked to a recording computer can film for it: the computer records the phone's
 *   picture exactly as it would its own webcam's, beside the screen;
 * - whichever ends the session tells the other, with the summary, so both show the ending
 *   screen.
 *
 * The API only passes the phone's offer and the computer's answer between them
 * (routes/camera-link.ts); the picture and the stills never go through it, and nothing is
 * uploaded. Only a phone and a computer link: two tabs, two computers or two phones never do.
 *
 * The handshake is one offer and one answer, each sent once every address is known (no
 * trickling), because the two sides only meet by asking the API every second or so.
 * Addresses come from the network itself and a public STUN server; there is no relay, so a
 * network that keeps its devices apart (some schools and offices) won't link.
 *
 * Once linked, the two keep the session the same (owner, 2026-11-03: "first make sure both
 * ends are on the same state, then get the time"). Whichever end hears of a change first (its
 * own pause, a refresh) hands the session to the other over the link, and the newer one wins
 * (`relayActive`). A phone linked to a computer then reads the computer's clock
 * (`ping`/`pong`) and runs its timer on it, so both show the same second. The phone follows:
 * the computer keeps the session's sounds and Jack mode's machine, see `follow` in
 * session-controller.
 *
 * The link lasts from when the two find each other until either leaves the session's ending
 * screen, so the last stills still get across after the session is over. The phone's camera
 * goes down it only while the phone films (and while the computer is taking stills); "Stop
 * filming" keeps the link.
 *
 * Nothing rests on the link (owner, 2026-11-04: "when i ended it didnt save any of the
 * video"): a phone filming for the computer keeps its own stills too, and goes on filming when
 * the computer goes, and a session ended on the other device is told by the API as well.
 */

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
];
/** How often a recording device says it's there and picks up offers. */
const HOST_POLL_MS = 2500;
/** How often the other device looks for one recording its session. */
const WATCH_MS = 3000;
/** How often it asks while it waits for the answer. */
const PAIR_MS = 800;
/** How often a linked device checks the other is still there. */
const LINKED_MS = 5000;
/** After a failed ask (offline, or an API without this): try again later. */
const ERROR_MS = 15_000;
/** An offer with no answer by now is made again. */
const ANSWER_WAIT_MS = 10_000;
/** Cut off this long: start over with a new offer. */
const LOST_WAIT_MS = 6000;
/** The first look for a host gives up waiting after this; the device carries on alone. */
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
  | { t: 'camera'; on: boolean }
  | { t: 'bye' }
  | { t: 'active'; data: ActiveData }
  | { t: 'ended'; summary: EndSummary }
  | { t: 'ping'; a: number }
  | { t: 'pong'; a: number; b: number };

type Outgoing = Omit<CameraLinkMessage, 'id'>;

export const cameraLinkSupported = (): boolean => typeof RTCPeerConnection !== 'undefined';

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Each try is `<page>_<try>`. Portals from before 2026-11-04 sent one plain id, linked only to
 * film, and never said whether the camera was on: a host takes their camera as before.
 */
const PAGE_ID = cameraLinkSupported() ? randomId() : '';
const newLinkId = () => `${PAGE_ID}_${randomId()}`;
const saysCamera = (link: string) => link.includes('_');

function readNote(data: unknown): Note | null {
  if (typeof data !== 'string') return null;
  try {
    const note = JSON.parse(data) as Partial<Note> & Record<string, unknown>;
    if (note.t === 'bye') return { t: 'bye' };
    if (note.t === 'state') return { t: 'state', filming: !!note.filming };
    if (note.t === 'camera') return { t: 'camera', on: !!note.on };
    if (note.t === 'ping' && typeof note.a === 'number') return { t: 'ping', a: note.a };
    if (note.t === 'pong' && typeof note.a === 'number' && typeof note.b === 'number')
      return { t: 'pong', a: note.a, b: note.b };
    if (note.t === 'active') {
      const d = note.data as Partial<ActiveData> | undefined;
      if (d && typeof d.now === 'string' && d.active !== undefined)
        return { t: 'active', data: { now: d.now, active: d.active } };
    }
    if (note.t === 'ended') {
      const s = note.summary as Partial<EndSummary> | undefined;
      if (s && typeof s === 'object' && s.session && typeof s.session.id === 'string')
        return { t: 'ended', summary: s as EndSummary };
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
  if (!sender?.track) return;
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

/** What both ends are given to do beyond the link itself. */
interface LinkHandlers {
  /** The other device ended the session: its summary, for the ending screen here. */
  onEnded: (summary: EndSummary) => void;
}

/** Tell the other device the session was ended here. */
export type SayEnded = (summary: EndSummary) => void;

/* ---------- the device recording ---------- */

export interface CameraHostArgs extends LinkHandlers {
  /** The session whose recording this device holds; null when it holds none to hand over. */
  sessionId: string | null;
  /** Stills are being taken right now: focus, not a break or a pause. Passed on to the phone. */
  filming: boolean;
  device: TimelapseDevice;
  /** The stills to copy to the other device, and what goes with them; null while there are none. */
  mirror: () => MirrorSource | null;
}

export interface CameraHost {
  /** A phone's camera, streamed here while it films for this computer. */
  camera: MediaStream | null;
  sayEnded: SayEnded;
}

/**
 * The recording device's side: while it holds a recording of `sessionId`, it says so, answers
 * the other device's offer, copies its stills over and, on a computer, hands back a phone's
 * camera while the phone films (null otherwise, and again if the phone stops or goes).
 */
export function useCameraHost({
  sessionId,
  filming,
  device,
  mirror,
  onEnded,
}: CameraHostArgs): CameraHost {
  const qc = useQueryClient();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const filmingRef = useRef(filming);
  const mirrorRef = useRef(mirror);
  const endedRef = useRef(onEnded);
  useEffect(() => {
    mirrorRef.current = mirror;
    endedRef.current = onEnded;
  });
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
    let stills: ReturnType<typeof sendStills> | null = null;
    const outbox: Outgoing[] = [];

    const drop = () => {
      relay?.stop();
      relay = null;
      stills?.stop();
      stills = null;
      channel.current = null;
      closeSoon(pc);
      pc = null;
      link = null;
      setStream(null);
    };

    const answer = async (id: string, sdp: string) => {
      // A new offer replaces whatever was there: the other device reloaded, or tried again.
      drop();
      const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pc = conn;
      link = id;
      let incoming: MediaStream | null = null;
      // A phone from before said nothing and only linked to film; a phone now says.
      let cameraOn = !saysCamera(id);
      const show = () => {
        if (conn !== pc) return;
        setStream(conn.connectionState === 'connected' && cameraOn ? incoming : null);
      };
      conn.ontrack = (e) => {
        incoming = e.streams[0] ?? new MediaStream([e.track]);
        show();
      };
      conn.ondatachannel = (e) => {
        if (conn !== pc) return;
        const c = e.channel;
        if (c.label === STILLS_CHANNEL) {
          const start = () => {
            if (conn !== pc) return;
            stills?.stop();
            stills = sendStills(c, () => mirrorRef.current());
          };
          if (c.readyState === 'open') start();
          else c.addEventListener('open', start, { once: true });
          return;
        }
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
          else if (note.t === 'ended') endedRef.current(note.summary);
          else if (note.t === 'camera') {
            cameraOn = note.on;
            show();
          }
          // The phone reads this computer's clock to run its timer on the same second.
          else if (note.t === 'ping') say(c, { t: 'pong', a: note.a, b: Date.now() });
        };
      };
      conn.onconnectionstatechange = () => {
        if (conn !== pc) return;
        // Only a connected phone takes over from the webcam; a short cut-off keeps it (its
        // picture just pauses), and a failed or closed link gives the webcam back.
        if (conn.connectionState === 'connected') show();
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
        const res = await api.cameraLink({ sessionId, role: 'host', after, send, device });
        if (stopped) return HOST_POLL_MS;
        // Ended on the other device: the ending screen here at once, not at the next look.
        if (res.ended) void qc.invalidateQueries({ queryKey: keys.active });
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
      // The session as it stands now (ended, if that is why), so the other isn't left behind.
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
  }, [sessionId, device, qc]);

  return {
    camera: stream,
    sayEnded: (summary) => say(channel.current, { t: 'ended', summary }),
  };
}

/* ---------- the other device ---------- */

/** How the phone's link to the computer stands while it films for it. */
export type CameraLinkStatus = 'connecting' | 'on' | 'lost';

export interface CameraSender {
  /** The first look for a host is done (or gave up), so this device can decide what to ask. */
  checked: boolean;
  /** A device is recording this session. */
  host: boolean;
  /** Which kind it is; null when it didn't say (a portal from before). */
  hostDevice: TimelapseDevice | null;
  /** The two are linked now. */
  linked: boolean;
  status: CameraLinkStatus;
  /** The computer is taking stills right now: focus, not a break or a pause. */
  filming: boolean;
  /**
   * How far the computer's clock is ahead of this phone's, in ms, read over the link; 0 until
   * read. The phone runs the session's timer on it.
   */
  clockOffsetMs: number;
  sayEnded: SayEnded;
}

export interface CameraSenderArgs extends LinkHandlers {
  /** The session to look for a recording of; null to stop looking (and leave the link). */
  sessionId: string | null;
  device: TimelapseDevice;
  /** Film for the computer: this phone's camera goes down the link. */
  film: boolean;
  /** This phone's camera, while it is on. */
  stream: MediaStream | null;
  /** The stills already held from this recording, so only the rest come. */
  have: () => Still[];
  /**
   * Take a copy of the other device's stills: false while this device keeps its own (it is
   * filming, or holds a recording of its own not yet made into a video).
   */
  wantCopy: boolean;
  /** The copy of the recording grew. */
  onStills: (mirror: StillsMirror) => void;
  /** The recording device stopped (or went) while linked. */
  onHostGone: () => void;
}

/**
 * The other device's side: finds the device recording the session, links to it when it is the
 * other kind (a phone to a computer, a computer to a phone), takes a copy of its stills and,
 * on a phone, films for a computer when asked.
 */
export function useCameraSender({
  sessionId,
  device,
  film,
  stream,
  have,
  wantCopy,
  onStills,
  onHostGone,
  onEnded,
}: CameraSenderArgs): CameraSender {
  const qc = useQueryClient();
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const [hostFor, setHostFor] = useState<{ id: string; device: TimelapseDevice | null } | null>(
    null,
  );
  const [linked, setLinked] = useState(false);
  const [status, setStatus] = useState<CameraLinkStatus>('connecting');
  const [filming, setFilming] = useState(false);
  const [clockOffsetMs, setClockOffset] = useState(0);
  const streamRef = useRef(stream);
  const senderRef = useRef<RTCRtpSender | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const filmRef = useRef(film);
  const kick = useRef<() => void>(() => undefined);
  /** The link is up now, read by the effects outside the one that keeps it. */
  const connectedRef = useRef(false);
  /** The camera came on while not linked: offer again, with the camera in it, at once. */
  const freshRef = useRef(false);
  const copyRef = useRef<ReturnType<typeof takeStills> | null>(null);
  const wantCopyRef = useRef(wantCopy);
  const handlers = useRef({ have, onStills, onHostGone, onEnded });
  useEffect(() => {
    handlers.current = { have, onStills, onHostGone, onEnded };
  });
  useEffect(() => {
    wantCopyRef.current = wantCopy;
    copyRef.current?.ask(wantCopy, handlers.current.have());
  }, [wantCopy]);

  // The picture goes down the link only while this phone films and the computer is taking
  // stills. On a break, a pause or Jack mode's lever the camera stays on for the phone's own
  // screen, but nothing is encoded or sent (owner, 2026-11-04: a phone joining on a break,
  // filming while the computer wasn't, froze and the video had none of it); it is back the
  // moment focus is. A new camera (swapped, or started again after the screen locked) goes
  // down the same link. The computer is told whether the phone films, so it gives its webcam
  // back the moment it stops.
  const [linkedAt, setLinkedAt] = useState(0);
  useEffect(() => {
    streamRef.current = stream;
    filmRef.current = film;
    say(channelRef.current, { t: 'camera', on: film });
    // A link made before the camera was on may never get through (a phone hides its own
    // address until the camera is allowed), so the camera coming on offers again with it in.
    if (film && stream && !connectedRef.current) freshRef.current = true;
    // Asked to film (or to stop) between turns: look again now rather than at the next one.
    kick.current();
    const sender = senderRef.current;
    if (!sender) return;
    const track = film && filming ? (stream?.getVideoTracks()[0] ?? null) : null;
    if (sender.track === track) return;
    if (track) track.contentHint = 'detail';
    void sender
      .replaceTrack(track)
      .then(() => tuneSender(sender))
      .catch(() => undefined);
  }, [stream, film, filming, linkedAt]);

  const looking = !!sessionId && cameraLinkSupported();
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
    /** Asks in a row with no host there while not connected. */
    let missing = 0;
    /** The host's kind of device, as it last said while it was there. */
    let hostKind: TimelapseDevice | null = null;
    let relay: ReturnType<typeof relayActive> | null = null;
    let stills: ReturnType<typeof takeStills> | null = null;
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
      stills?.stop();
      stills = null;
      window.clearInterval(clockTimer);
      closeSoon(pc);
      pc = null;
      channel = null;
      channelRef.current = null;
      senderRef.current = null;
      copyRef.current = null;
      link = null;
      connected = false;
      connectedRef.current = false;
      lostAt = 0;
      setLinked(false);
    };
    const gone = () => {
      close(false);
      handlers.current.onHostGone();
    };

    const offer = async () => {
      close(false);
      freshRef.current = false;
      const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const id = newLinkId();
      pc = conn;
      link = id;
      sentAt = Date.now();
      // A phone keeps a place for its camera from the start, so it can film (and stop) later
      // on the same link; the picture goes in once it films.
      if (device === 'phone') {
        const s = streamRef.current;
        const track = filmRef.current ? (s?.getVideoTracks()[0] ?? null) : null;
        if (track) {
          track.contentHint = 'detail';
          senderRef.current = conn.addTrack(track, s!);
        } else senderRef.current = conn.addTransceiver('video', { direction: 'sendonly' }).sender;
      }
      const c = conn.createDataChannel('link');
      channel = c;
      // Only a host that says its kind knows the stills' channel: one from before 2026-11-04
      // would take it for the link's and talk down the wrong one.
      if (hostKind !== null) {
        const copy = conn.createDataChannel(STILLS_CHANNEL);
        stills = takeStills(
          copy,
          handlers.current.have(),
          (m) => {
            if (conn === pc) handlers.current.onStills(m);
          },
          { want: wantCopyRef.current, small: device === 'phone' },
        );
        copyRef.current = stills;
      }
      c.onopen = () => {
        if (conn !== pc) return;
        channelRef.current = c;
        setLinked(true);
        say(c, { t: 'camera', on: filmRef.current });
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
        else if (note.t === 'ended') handlers.current.onEnded(note.summary);
        else if (note.t === 'pong') tookReading(note.a, note.b);
        else if (note.t === 'bye') gone();
      };
      conn.onconnectionstatechange = () => {
        if (conn !== pc) return;
        const state = conn.connectionState;
        if (state === 'connected') {
          connected = true;
          connectedRef.current = true;
          lostAt = 0;
          setStatus('on');
          void tuneSender(senderRef.current);
          // A new link: send the picture or hold it, as the computer is filming or not.
          setLinkedAt(Date.now());
        } else if (state === 'disconnected' || state === 'failed') {
          // Failed starts over at the next ask; a cut-off gets a few seconds to come back.
          connectedRef.current = false;
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
        if (res.ended) void qc.invalidateQueries({ queryKey: keys.active });
        window.clearTimeout(giveUp);
        const hostDevice = res.hostDevice ?? null;
        setHostFor(res.host ? { id: sessionId, device: hostDevice } : null);
        setCheckedFor(sessionId);
        for (const m of res.messages) {
          after = Math.max(after, m.id);
          if (m.link !== link) continue;
          if (m.kind === 'bye') return hostGone();
          if (m.kind === 'answer' && m.sdp && pc?.signalingState === 'have-local-offer')
            await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }).catch(() => undefined);
        }
        // The other kind of device links for the stills; a host that doesn't say its kind
        // (a portal from before) only takes a phone's camera, so only filming links to it,
        // and the link goes when the filming stops, as it did then. Once the session is over
        // the API stops answering for the host, and the link carries on as it was.
        if (res.host) hostKind = hostDevice;
        const wants = filmRef.current || (hostKind !== null && hostKind !== device);
        if (pc && !wants) {
          close(true);
          return WATCH_MS;
        }
        if (!pc && !wants) return WATCH_MS;
        // Linked, the connection itself says the host is there; otherwise the API does. Gone
        // is said once, for a link there was; then this waits for the host to come back.
        missing = res.host || connected ? 0 : missing + 1;
        if (missing >= 2 && pc) return hostGone();
        const stale =
          !pc ||
          (!connected && freshRef.current) ||
          (!connected && lostAt === 0 && Date.now() - sentAt > ANSWER_WAIT_MS) ||
          (lostAt > 0 && Date.now() - lostAt >= LOST_WAIT_MS);
        if (res.host && wants && stale) void offer();
        return connected ? LINKED_MS : PAIR_MS;
      } catch {
        setCheckedFor(sessionId);
        return pc ? PAIR_MS * 4 : ERROR_MS;
      }
    });
    kick.current = () => polls.ask();
    polls.ask();

    return () => {
      stopped = true;
      kick.current = () => undefined;
      window.clearTimeout(giveUp);
      polls.stop();
      const had = !!link;
      close(true);
      setClockOffset(0);
      if (had)
        void api.cameraLink({ sessionId, role: 'camera', send: outbox }).catch(() => undefined);
    };
  }, [looking, sessionId, device, qc]);

  const host = hostFor !== null && hostFor.id === sessionId;
  return {
    checked: !looking || checkedFor === sessionId,
    host,
    hostDevice: host ? hostFor.device : null,
    linked,
    status,
    filming,
    clockOffsetMs: linked ? clockOffsetMs : 0,
    sayEnded: (summary) => say(channelRef.current, { t: 'ended', summary }),
  };
}
