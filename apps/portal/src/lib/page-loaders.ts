/**
 * The pages that load on demand, keyed by where they live. `App.tsx` makes its lazy routes
 * from these, and the nav warms them up: once the browser is idle after sign-in, and again
 * the moment a finger or pointer lands on a tab. A navigation is a React transition, so a
 * page still downloading keeps the old one on screen; with its code already here, a tap
 * moves straight on.
 */
export const loadTasks = () => import('../pages/Tasks');
export const loadGrades = () => import('../pages/Grades');
export const loadRoutines = () => import('../pages/Routines');
export const loadPlans = () => import('../pages/Plans');
export const loadPlan = () => import('../pages/Plan');
export const loadCalendar = () => import('../pages/Calendar');
export const loadAnalytics = () => import('../pages/Analytics');
export const loadAchievements = () => import('../pages/Achievements');
export const loadSettings = () => import('../pages/Settings');
export const loadProfile = () => import('../pages/Profile');
export const loadSocial = () => import('../pages/Social');
export const loadFocus = () => import('../pages/Focus');

const byPath: Record<string, () => Promise<unknown>> = {
  '/tasks': loadTasks,
  '/grades': loadGrades,
  '/routines': loadRoutines,
  '/plans': loadPlans,
  '/calendar': loadCalendar,
  '/analytics': loadAnalytics,
  '/achievements': loadAchievements,
  '/settings': loadSettings,
  '/profile': loadProfile,
  '/social': loadSocial,
  '/focus': loadFocus,
};

/** Start loading the page at `path` (a module import is only ever fetched once). */
export function preloadPage(path: string): void {
  const top = `/${path.split(/[/?#]/)[1] ?? ''}`;
  void byPath[top]?.().catch(() => undefined);
}

/**
 * Load the nav's pages in the background, one at a time while the browser is idle, so
 * nothing competes with the page being looked at. Skipped when the browser asks to save data;
 * a tap still loads its own page on the way.
 */
export function preloadPages(paths: string[]): () => void {
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    ?.saveData;
  if (saveData) return () => undefined;
  let cancelled = false;
  let handle = 0;
  const idle =
    window.requestIdleCallback?.bind(window) ??
    ((cb: () => void) => window.setTimeout(cb, 200) as unknown as number);
  const cancelIdle = window.cancelIdleCallback?.bind(window) ?? window.clearTimeout;
  const queue = [...paths];
  const next = () => {
    const path = queue.shift();
    if (cancelled || !path) return;
    const top = `/${path.split(/[/?#]/)[1] ?? ''}`;
    const load = byPath[top];
    if (!load) return next();
    void load()
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) handle = idle(next);
      });
  };
  // Give the first page a moment to settle before anything else is fetched.
  const start = window.setTimeout(() => (handle = idle(next)), 1500);
  return () => {
    cancelled = true;
    window.clearTimeout(start);
    cancelIdle(handle);
  };
}
