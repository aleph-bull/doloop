import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a media query matches, kept up to date. Read synchronously on the first render, so
 * a layout that depends on it is right from the first frame rather than corrected after.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia?.(query);
      mq?.addEventListener('change', onChange);
      return () => mq?.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}

/**
 * Phone-width screens, where a dialog with a form becomes a screen of its own. The same
 * width the design system's sheets switch at (packages/ui styles.css, `.modal`).
 */
export const NARROW_QUERY = '(max-width: 560px)';

/**
 * A phone either way up, for the nav: phone-width, or a touch screen too short for the
 * computer's layout (a phone held sideways is wider than 768px, and the sidebar would run off
 * its bottom). Phones get the top bar and the bottom bar, never the sidebar. index.css uses the
 * same query for the phone's top bar.
 */
export const PHONE_QUERY = '(max-width: 767px), (pointer: coarse) and (max-height: 599px)';
