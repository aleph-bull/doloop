import { mobileOs } from './device';

/**
 * Komogon on an iPhone's or iPad's Home Screen, opening like an app. No page can put itself
 * there (iOS has no install prompt for the web), so the app shows Safari's own steps:
 * Settings › Home Screen, and once in a while a question on a phone (`HomeScreenAsk`).
 */

/** Opened from the Home Screen, not in a browser tab. */
export function onHomeScreen(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** An iPhone or iPad in a browser, where Komogon could still go on the Home Screen. */
export function canAddToHomeScreen(): boolean {
  return mobileOs() === 'ios' && !onHomeScreen();
}

/** When the phone last asked, kept in this browser. "Don't ask again" is on the account. */
const ASKED_KEY = 'komogon.homeScreen.askedAt';
/** After "Not now", the question comes back this much later. */
const ASK_AGAIN_MS = 3 * 24 * 60 * 60 * 1000;

export function askDue(now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(ASKED_KEY));
    return !Number.isFinite(at) || now - at >= ASK_AGAIN_MS;
  } catch {
    // Blocked storage: nothing could remember a "Not now", so never ask.
    return false;
  }
}

export function markAsked(now = Date.now()): void {
  try {
    localStorage.setItem(ASKED_KEY, String(now));
  } catch {
    /* blocked storage: askDue already says no */
  }
}
