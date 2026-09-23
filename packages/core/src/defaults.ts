import { UOFT_GRADE_SCALE } from './grades';
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
  profile: { name: null },
  pomodoro: {
    workMin: 25,
    shortBreakMin: 5,
    longBreakMin: 15,
    cyclesBeforeLong: 4,
    autoStartBreaks: true,
    autoStartWork: true,
    showTimerByDefault: true,
  },
  review: { mode: 'quick' },
  idle: { enabled: true, thresholdMin: 10 },
  streak: { minMinutes: 15 },
  pace: { maxComfortableMinutesPerDay: 240 },
  sounds: {
    enabled: true,
    volume: 0.8,
    workStart: 'notify-2',
    breakStart: 'chime',
    sessionEnd: 'soft-fade',
  },
  effects: { confetti: true, badgeToasts: true, phrases: true, reducedMotion: 'system' },
  quote: { mode: 'quotes' },
  theme: {
    mode: 'system',
    accent: 'indigo',
    backgroundId: 'velvet',
    customBackgroundUrl: null,
    panel: 'glass',
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
    logSessions: true,
  },
  grading: { scale: UOFT_GRADE_SCALE, goalGpa: null },
  visualizer: {
    enabled: false,
    promptDismissed: false,
    intensity: 0.6,
    opacity: 0.85,
    colorMode: 'accent',
    color: '#6366f1',
    ribbons: true,
    rings: true,
    border: true,
  },
  focusScreen: { openOnStart: 'ask' },
  dismissed: [],
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/**
 * Settings are stored as a JSON blob, so a value can come back in a shape the types
 * promise it is not - an older writer, a hand-edited row, a half-migrated record. A list
 * that arrives as {"0": "x"} is read back as ["x"] rather than handed to a caller that
 * will try to call .includes on it.
 */
function asList<T>(value: unknown, fallback: T[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') return Object.values(value as object) as T[];
  return fallback;
}

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

  const settings = out as unknown as UserSettings;
  settings.dismissed = asList<string>(settings.dismissed, []);
  settings.blocking.domains = asList<string>(settings.blocking.domains, []);
  settings.grading.scale = asList(settings.grading.scale, DEFAULT_SETTINGS.grading.scale);
  return settings;
}
