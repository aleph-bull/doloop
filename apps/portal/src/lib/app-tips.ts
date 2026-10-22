import { fnv1a, pickIndex, type UserSettings } from '@komogon/core';

/**
 * Small things about the app worth knowing, shown on the dashboard about one quote period in
 * five. Each points at the place it talks about. A tip for a page someone has turned off
 * is never shown.
 */
export interface AppTip {
  id: string;
  text: string;
  /** Where the link goes, and what it says. */
  to: string;
  link: string;
  feature?: keyof UserSettings['features'];
}

export const APP_TIPS: AppTip[] = [
  {
    id: 'rewards',
    text: 'Set your own rewards in Achievements, then spend the XP you earn on them.',
    to: '/achievements',
    link: 'Open Achievements',
  },
  {
    id: 'sounds',
    text: 'Pick the sounds for when work starts, when a break starts and when a session ends.',
    to: '/settings#sounds',
    link: 'Change sounds',
  },
  {
    id: 'plans',
    text: 'Study plans work for anything, not just courses: a language, a test, a skill.',
    to: '/plans',
    link: 'Make a study plan',
    feature: 'plans',
  },
  {
    id: 'visualizer',
    text: 'If the audio visualizer on the focus screen is too distracting, you can make it calmer or turn it off.',
    to: '/settings#focus',
    link: 'Edit the visualizer',
  },
  {
    id: 'rest-days',
    text: 'Your daily plan works around rest days.',
    to: '/settings#rest-days',
    link: 'Set rest days',
  },
  {
    id: 'freezes',
    text: 'A streak freeze from the shop covers one missed day automatically.',
    to: '/achievements',
    link: 'Open the shop',
  },
  {
    id: 'routines',
    text: 'Routines are for the things you do on a schedule, like reading every day or a weekly problem set.',
    to: '/routines',
    link: 'Add a routine',
    feature: 'routines',
  },
  {
    id: 'backgrounds',
    text: 'Some backgrounds unlock as you level up.',
    to: '/settings#theme',
    link: 'Choose a background',
  },
  {
    id: 'past-weeks',
    text: 'Step back through past weeks in Analytics.',
    to: '/analytics',
    link: 'Open Analytics',
  },
  {
    id: 'calendar',
    text: 'Plan study blocks in the Calendar and see whether they cover the hours you need.',
    to: '/calendar',
    link: 'Open the Calendar',
    feature: 'calendar',
  },
];

/* ---------- dismissing ---------- */

/**
 * Tips someone has closed, by the seed they were shown for, so a closed tip stays closed
 * for as long as its quote would have stayed up. Kept in this browser only; it is a
 * preference about a card, not data.
 */
const DISMISSED_KEY = 'komogon.tipsDismissed';
const listeners = new Set<() => void>();

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

let dismissed = readDismissed();

export function isTipDismissed(seed: string): boolean {
  return dismissed.includes(seed);
}

export function dismissTip(seed: string): void {
  // The last few are plenty: a seed only matters while its quote is up.
  dismissed = [...dismissed.filter((s) => s !== seed), seed].slice(-20);
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed));
  } catch {
    // Storage blocked: the tip stays closed until the page reloads.
  }
  for (const l of listeners) l();
}

export function subscribeTips(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How often a quote period also brings a tip: one in this many. */
export const TIP_ONE_IN = 5;

/**
 * The tip for this quote period, or null for none. Seeded by the quote, so the choice
 * holds for as long as that quote stays up.
 */
export function tipFor(seed: string, settings: UserSettings | undefined): AppTip | null {
  if (!settings?.quote.appTips) return null;
  if (fnv1a(`tip?${seed}`) % TIP_ONE_IN !== 0) return null;
  const shown = APP_TIPS.filter((t) => !t.feature || settings.features[t.feature] !== false);
  return shown.length ? shown[pickIndex(`tip:${seed}`, shown.length)]! : null;
}
