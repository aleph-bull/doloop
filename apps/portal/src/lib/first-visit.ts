import { SEEN_STORAGE_KEY, shouldOpenHomepage } from '@komogon/core';

/**
 * A first visit straight onto sign in goes to the homepage instead (the rule and its
 * exceptions are `shouldOpenHomepage` in core). Imported first in main.tsx, so it runs
 * before anything else and main.tsx starts nothing when it leaves: the visit then leaves
 * no storage behind and the next one is judged the same way. Only on komogon.app, unless
 * `VITE_HOMEPAGE_URL` names a homepage (a sandbox trying it out).
 */
const HOMEPAGE_OVERRIDE = import.meta.env.VITE_HOMEPAGE_URL as string | undefined;
const HOMEPAGE = HOMEPAGE_OVERRIDE || 'https://app.komogon.app/';
const APP_HOSTS = ['komogon.app', 'www.komogon.app'];

function decide(): boolean {
  try {
    if (!HOMEPAGE_OVERRIDE && !APP_HOSTS.includes(location.hostname)) return false;
    const storageKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) storageKeys.push(localStorage.key(i) ?? '');
    const installed =
      matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return shouldOpenHomepage({
      path: location.pathname,
      search: location.search,
      hash: location.hash,
      referrer: document.referrer,
      homepage: HOMEPAGE,
      installed,
      storageKeys,
    });
  } catch {
    // Storage blocked: never send anyone away on a guess.
    return false;
  }
}

export const leavingForHomepage = decide();

if (leavingForHomepage) {
  location.replace(HOMEPAGE);
} else {
  try {
    localStorage.setItem(SEEN_STORAGE_KEY, '1');
  } catch {
    // Storage blocked: every visit counts as a first, and none is sent away (see above).
  }
}
