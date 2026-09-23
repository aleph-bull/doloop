import { useEffect, useRef, useState } from 'react';

/**
 * The focus screen is its own browser tab. Starting a session anywhere opens it; starting
 * another while it is open brings it forward instead of opening a second one.
 *
 * Two mechanisms, because neither alone covers every case:
 *  - A named window (`window.open(url, name)`) reuses a tab this page opened, and lets
 *    it be focused, but cannot see a tab opened by the extension or typed in by hand.
 *  - A BroadcastChannel reaches every same-origin tab, so the focus tab can always be
 *    found, but a tab cannot pull focus to itself without a handle from a user gesture.
 */

export const FOCUS_PATH = '/focus';
const WINDOW_NAME = 'doloop-focus';
const CHANNEL = 'doloop-focus';
/** A tab that has not been heard from in this long is treated as closed. */
const PRESENCE_TIMEOUT_MS = 6_000;
const HEARTBEAT_MS = 2_000;
/** How long the opener waits for an existing tab to answer before opening a new one. */
const PING_WAIT_MS = 180;

type Message =
  | { type: 'ping' }
  | { type: 'here' }
  | { type: 'heartbeat' }
  | { type: 'closing' }
  | { type: 'focus' };

function channel(): BroadcastChannel | null {
  try {
    return new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}

/** Ask the other tabs whether a focus screen is open. Resolves quickly either way. */
function findFocusTab(): Promise<boolean> {
  const ch = channel();
  if (!ch) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = (found: boolean) => {
      if (done) return;
      done = true;
      ch.close();
      resolve(found);
    };
    ch.onmessage = (e: MessageEvent<Message>) => {
      if (e.data?.type === 'here') finish(true);
    };
    ch.postMessage({ type: 'ping' } satisfies Message);
    window.setTimeout(() => finish(false), PING_WAIT_MS);
  });
}

export type OpenFocusResult =
  /** A new tab was opened, or this page's own focus tab was navigated and focused. */
  | 'opened'
  /** An existing focus tab was brought forward. */
  | 'focused'
  /** A focus tab exists but was opened elsewhere (the extension, by hand); it was asked to come forward. */
  | 'elsewhere'
  /** The browser blocked the popup. */
  | 'blocked';

/**
 * Open the focus screen, or bring the one already open forward. Call it on the tail of a
 * user gesture: the browser's transient activation is what lets a tab open at all.
 */
export async function openFocusTab(): Promise<OpenFocusResult> {
  const exists = await findFocusTab();
  if (exists) {
    // A blank URL returns a handle to a familiar named window without navigating it.
    const handle = window.open('', WINDOW_NAME);
    let familiar: boolean;
    try {
      familiar = !!handle && handle.location.href !== 'about:blank';
    } catch {
      familiar = false;
    }
    if (handle && familiar) {
      handle.focus();
      return 'focused';
    }
    // Not ours: close the blank window that was just created and ask the real one to come forward.
    handle?.close();
    const ch = channel();
    ch?.postMessage({ type: 'focus' } satisfies Message);
    ch?.close();
    return 'elsewhere';
  }
  const opened = window.open(FOCUS_PATH, WINDOW_NAME);
  if (!opened) return 'blocked';
  opened.focus();
  return 'opened';
}

/**
 * Run in the focus screen: names the window so the opener can find it again, answers
 * pings, sends a heartbeat, and says goodbye on the way out. `onWake` fires when another
 * tab reaches for this one, which is the moment a session has most likely just started.
 */
export function useFocusTabBeacon(onWake?: () => void): void {
  const wakeRef = useRef(onWake);
  useEffect(() => {
    wakeRef.current = onWake;
  });
  useEffect(() => {
    window.name = WINDOW_NAME;
    const ch = channel();
    if (!ch) return;
    const say = (m: Message) => {
      try {
        ch.postMessage(m);
      } catch {
        /* channel closed */
      }
    };
    ch.onmessage = (e: MessageEvent<Message>) => {
      if (e.data?.type === 'ping') say({ type: 'here' });
      if (e.data?.type === 'ping' || e.data?.type === 'focus') wakeRef.current?.();
      // Best effort: most browsers only honour this when the tab already has focus.
      if (e.data?.type === 'focus') window.focus();
    };
    say({ type: 'here' });
    const beat = window.setInterval(() => say({ type: 'heartbeat' }), HEARTBEAT_MS);
    const bye = () => say({ type: 'closing' });
    window.addEventListener('pagehide', bye);
    return () => {
      window.clearInterval(beat);
      window.removeEventListener('pagehide', bye);
      bye();
      ch.close();
    };
  }, []);
}

/**
 * True while a focus tab is open somewhere in this browser. The dashboard uses it to hand
 * the alert sounds over to that tab rather than playing them twice.
 */
export function useFocusTabPresent(): boolean {
  const [present, setPresent] = useState(false);
  useEffect(() => {
    const ch = channel();
    if (!ch) return;
    let timeout = 0;
    const seen = () => {
      setPresent(true);
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => setPresent(false), PRESENCE_TIMEOUT_MS);
    };
    ch.onmessage = (e: MessageEvent<Message>) => {
      const t = e.data?.type;
      if (t === 'here' || t === 'heartbeat') seen();
      if (t === 'closing') {
        window.clearTimeout(timeout);
        setPresent(false);
      }
    };
    ch.postMessage({ type: 'ping' } satisfies Message);
    return () => {
      window.clearTimeout(timeout);
      ch.close();
    };
  }, []);
  return present;
}
