import type { PomodoroConfig, UserSettings } from './types';

/**
 * Bounds on the pomodoro interval lengths the user may choose.
 *
 * Durations are editable, but only between sessions: the server rejects a change while a
 * session is running so the running timer's contract cannot move under it. The lower bound
 * on `workMin` also keeps the "no XP before the first work interval" rule meaningful — a
 * one-minute work interval would clear that gate for free.
 */
export const POMODORO_LIMITS: Record<
  'workMin' | 'shortBreakMin' | 'longBreakMin' | 'cyclesBeforeLong',
  { min: number; max: number }
> = {
  workMin: { min: 10, max: 90 },
  shortBreakMin: { min: 1, max: 30 },
  longBreakMin: { min: 5, max: 60 },
  cyclesBeforeLong: { min: 2, max: 8 },
};

/** The pomodoro fields that are locked while a session is running. */
export const POMODORO_DURATION_KEYS = [
  'workMin',
  'shortBreakMin',
  'longBreakMin',
  'cyclesBeforeLong',
] as const satisfies ReadonlyArray<keyof PomodoroConfig>;

/** Default settings for a new user (spec §9). Theme defaults to dark per kickoff decision. */
export const DEFAULT_SETTINGS: UserSettings = {
  pomodoro: {
    workMin: 25,
    shortBreakMin: 5,
    longBreakMin: 15,
    cyclesBeforeLong: 4,
    autoStartBreaks: true,
    autoStartWork: false,
    showTimerByDefault: true,
  },
  review: { mode: 'quick' },
  idle: { enabled: true, thresholdMin: 10 },
  streak: { minMinutes: 15 },
  pace: { maxComfortableMinutesPerDay: 240 },
  sounds: { enabled: true, endOfInterval: true, endOfBlock: true, volume: 0.5 },
  effects: { confetti: true, badgeToasts: true, phrases: true, reducedMotion: 'system' },
  quote: { mode: 'quotes' },
  theme: {
    mode: 'system',
    accent: 'indigo',
    backgroundId: 'aurora',
    customBackgroundUrl: null,
    panel: 'opaque',
    panelColor: '#151827',
    panelAlpha: 0.92,
    extensionBackground: 'same',
  },
  blocking: { enabled: false, domains: [] },
  calendar: {
    googleConnected: false,
    studyCalendarId: null,
    syncPlannedBlocks: true,
    readBusyTimes: true,
  },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Merge a partial settings object over the defaults. One level of nesting is enough for §9. */
export function withDefaults(partial: DeepPartial<UserSettings> | null | undefined): UserSettings {
  const out = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  if (!partial) return out as unknown as UserSettings;
  for (const [key, value] of Object.entries(partial)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = { ...(out[key] as object), ...(value as object) };
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as unknown as UserSettings;
}
