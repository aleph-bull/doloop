/**
 * Achievement announcements. Anything that learns a badge was unlocked (a session ending,
 * a routine ticked) calls `announceAchievements`; the `AchievementToasts` component,
 * mounted once at the root, listens and shows the banner with confetti. An event rather
 * than a context, so callers need no provider and the focus tab works the same way.
 */

export const ACHIEVEMENT_EVENT = 'komogon:achievements';

export function announceAchievements(keys: string[]): void {
  if (keys.length === 0 || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string[]>(ACHIEVEMENT_EVENT, { detail: keys }));
}
