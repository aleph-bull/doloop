/**
 * Motion preferences shared by the animated pieces: the app's own setting on <html>
 * (data-motion) wins, and otherwise the OS preference decides.
 */

/** True when the app's motion setting or the OS asks for stillness. */
export function prefersStill(): boolean {
  if (typeof document === 'undefined') return true;
  const m = document.documentElement.dataset.motion;
  if (m === 'off') return true;
  if (m === 'on') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
