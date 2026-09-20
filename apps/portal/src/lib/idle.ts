import { useEffect, useRef } from 'react';

export interface IdleOptions {
  enabled: boolean;
  thresholdMin: number;
  /** Called once when idleness crosses the threshold, with the instant input stopped. */
  onIdle: (idleSince: string) => void;
}

/**
 * Portal idle detection (spec §4): no input for N minutes, or the tab hidden for N minutes.
 * Input events reset the timer; `visibilitychange` to hidden starts the clock too.
 */
export function useIdleDetection({ enabled, thresholdMin, onIdle }: IdleOptions) {
  const lastInput = useRef(0);
  const fired = useRef(false);
  const onIdleRef = useRef(onIdle);

  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!enabled) return;
    lastInput.current = Date.now();
    fired.current = false;

    const bump = () => {
      lastInput.current = Date.now();
      fired.current = false;
    };
    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
      'wheel',
    ];
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        // Returning to the tab counts as input only if we have not already gone idle.
        if (!fired.current) bump();
      }
    };
    document.addEventListener('visibilitychange', onVis);

    const timer = window.setInterval(() => {
      if (fired.current) return;
      const idleMs = Date.now() - lastInput.current;
      if (idleMs >= thresholdMin * 60_000) {
        fired.current = true;
        onIdleRef.current(new Date(lastInput.current).toISOString());
      }
    }, 5_000);

    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(timer);
    };
  }, [enabled, thresholdMin]);

  /** Call after the user answers the idle prompt so detection can fire again. */
  return () => {
    lastInput.current = Date.now();
    fired.current = false;
  };
}
