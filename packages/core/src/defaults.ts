import type { PomodoroConfig, UserSettings } from './types';

/**
 * Input bounds for the pomodoro interval lengths — sanity limits only, shared by the
 * settings form and the API schema so the two agree.
 *
 * Durations are freely editable, including while a session is running: a session snapshots
 * its config in `pomodoroConfigSnapshot` at the start, so changing the setting never moves
 * the running timer's contract under it. It takes effect on the next session.
 */
export const POMODORO_LIMITS: Record<
  'workMin' | 'shortBreakMin' | 'longBreakMin' | 'cyclesBeforeLong',
  { min: number; max: number }
> = {
  workMin: { min: 1, max: 180 },
  shortBreakMin: { min: 1, max: 60 },
  longBreakMin: { min: 1, max: 120 },
  cyclesBeforeLong: { min: 1, max: 12 },
};

/** The four interval-length fields, in the order the settings form shows them. */
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
    backgroundId: 'graphite',
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
