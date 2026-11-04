/**
 * Someone whose first ever visit lands straight on the sign-in page (from a search, a link
 * or a typed komogon.app) sees the homepage instead, so they find out what Komogon is
 * before being asked for an account (owner, 2026-11-03). Never when they came from the
 * homepage itself (its "Open the app" buttons), when this browser has been here before or
 * is signed in, in the installed app, or on any other address (reset links, invites,
 * sign-in callbacks, shared pages).
 */
export interface FirstVisit {
  /** `location.pathname`. */
  path: string;
  /** `location.search` and `location.hash`: any of either means a link with a purpose. */
  search: string;
  hash: string;
  /** `document.referrer`. */
  referrer: string;
  /** The homepage's address, e.g. https://app.komogon.app/. */
  homepage: string;
  /** Opened as the installed app (display-mode standalone). */
  installed: boolean;
  /** Every localStorage key this browser holds for the app's address. */
  storageKeys: readonly string[];
}

/** Paths that are only ever the sign-in page for someone signed out. */
const SIGN_IN_PATHS = new Set(['/', '/signin']);

/**
 * Keys that mean this browser has used the app: the app's own (`komogon.`, plus the two
 * older names before rename-migration moves them) and Supabase's session (`sb-`).
 */
const SEEN_KEY = /^(komogon|komodoit|doloop)\.|^sb-/;

/** The key the portal writes on every visit that stays, so the next one isn't a first. */
export const SEEN_STORAGE_KEY = 'komogon.seen';

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function shouldOpenHomepage(v: FirstVisit): boolean {
  if (!SIGN_IN_PATHS.has(v.path)) return false;
  if (v.search || v.hash) return false;
  if (v.installed) return false;
  const home = originOf(v.homepage);
  if (!home) return false;
  if (v.referrer && originOf(v.referrer) === home) return false;
  return !v.storageKeys.some((k) => SEEN_KEY.test(k));
}
