import { useEffect, useRef, useState } from 'react';
import { isPhone } from './device';

/**
 * The focus screen is its own browser tab. Starting a session anywhere opens it; starting
 * another while it is open brings it forward instead of opening a second one.
 *
 * Two mechanisms:
 *  - A named window (`window.open(name)`) reuses the tab this page opened and can bring
 *    it forward. It cannot see a tab opened by the extension or typed in by hand.
 *  - A BroadcastChannel reaches every same-origin tab: the focus tab announces itself so
 *    the dashboard can hand it the alert sounds, and hears when a session starts.
 */

export const FOCUS_PATH = '/focus';
const WINDOW_NAME = 'komogon-focus';
const CHANNEL = 'komogon-focus';
/** A tab that has not been heard from in this long is treated as closed. */
const PRESENCE_TIMEOUT_MS = 6_000;
const HEARTBEAT_MS = 2_000;

type Message = { type: 'ping' } | { type: 'here' } | { type: 'heartbeat' } | { type: 'closing' };

function channel(): BroadcastChannel | null {
  try {
    return new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}

export type OpenFocusResult =
  /** A new tab was opened. */
  | 'opened'
  /** A focus tab this page had opened was brought forward. */
  | 'focused'
  /** The browser blocked the popup. */
  | 'blocked'
  /**
   * A phone: nothing was opened, and the caller goes to FOCUS_PATH in this tab. A second tab
   * on a phone is a second Safari tab (or, in the installed app, a browser sheet over it).
   */
  | 'here';

/**
 * Open the focus screen, or bring forward the one this page opened earlier. Synchronous on
 * purpose: it has to run on the click itself, since browsers only let a click open a tab.
 *
 * `window.open('', name)` returns the existing window of that name without navigating it,
 * or a fresh blank one; the blank one is then sent to the focus screen.
 */
export function openFocusTab(): OpenFocusResult {
  if (isPhone()) return 'here';
  let handle: Window | null;
  try {
    handle = window.open('', WINDOW_NAME);
  } catch {
    handle = null;
  }
  if (!handle) {
    // Some embedded browsers refuse a blank window but allow one with a URL.
    try {
      handle = window.open(FOCUS_PATH, WINDOW_NAME);
    } catch {
      handle = null;
    }
    if (!handle) return 'blocked';
    handle.focus();
    return 'opened';
  }
  let existing: boolean;
  try {
    existing = handle.location.href !== 'about:blank';
  } catch {
    existing = false;
  }
  if (!existing) handle.location.href = FOCUS_PATH;
  handle.focus();
  return existing ? 'focused' : 'opened';
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
      if (e.data?.type === 'ping') {
        say({ type: 'here' });
        wakeRef.current?.();
      }
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
