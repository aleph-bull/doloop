import { useEffect } from 'react';

/**
 * A phone: a touch screen whose short side is phone-sized. Tablets and touch laptops count
 * as computers, so they keep the focus screen and the computer's timelapse preset. Read once;
 * turning the phone doesn't change the answer, since it goes by the screen, not the window.
 */
export function isPhone(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const short = Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0);
  return coarse && short > 0 && short < 600;
}

/** Held upright: taller than wide. Follows the window, which turns with the phone. */
export function isUpright(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia?.('(orientation: portrait)').matches ?? true;
}

/**
 * Keep the screen on while `active`. A phone stops its camera when the screen locks, so
 * the camera screen holds this while it records. The browser lets go of it whenever the page
 * is hidden, so it is asked for again each time the page comes back.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let cancelled = false;
    let lock: WakeLockSentinel | null = null;
    const take = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (cancelled) void next.release();
        else lock = next;
      } catch {
        /* low battery mode or a browser that says no: the screen may still lock */
      }
    };
    const onVisible = () => void take();
    void take();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
