import { fontChoiceOf } from './fonts';
import { UOFT_GRADE_SCALE } from './grades';
import { defaultTimelapseLayout, normalizeTimelapseLayout } from './timelapse-layout';
import {
  defaultPhoneTimelapse,
  defaultStoryLayout,
  noteTextOf,
  normalizePhoneTimelapse,
  TIMELAPSE_FORMATS,
} from './timelapse-presets';
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
  profile: { name: null, university: null, bio: null },
  pomodoro: {
    workMin: 25,
    shortBreakMin: 5,
    longBreakMin: 15,
    cyclesBeforeLong: 4,
    autoStartBreaks: true,
    autoStartWork: true,
    showTimerByDefault: true,
    jackMode: false,
  },
  review: { mode: 'quick', openSocial: true },
  streak: { minMinutes: 15, dayStartHour: 4, dayStartChangedAt: null, daysPerWeek: 1 },
  goals: { weeklyMinutes: 300 },
  rewards: { minCostXp: 150, minCostChangedAt: null },
  pace: { maxComfortableMinutesPerDay: 240 },
  sounds: {
    enabled: true,
    volume: 0.5,
    workStart: 'slow-ding',
    breakStart: 'slow-ding',
    sessionEnd: 'slow-ding',
  },
  effects: { confetti: true, badgeToasts: true, phrases: true, reducedMotion: 'system' },
  quote: { mode: 'quotes', appTips: true },
  theme: {
    // Dark until someone picks otherwise; never the device's setting by default (owner,
    // 2026-10-23: a phone set to light turned the app light without them choosing it).
    mode: 'dark',
    accent: 'sky',
    backgroundId: 'cotton-candy',
    customBackgroundUrl: null,
    customBackgroundId: null,
    panel: 'glass',
    panelColor: '#151827',
    panelAlpha: 0.92,
    glassColor: null,
    glassAlpha: null,
    // The owner's pick on 2026-10-22: a light frost that leaves the card's colour in charge.
    glassBlur: 11,
    glassSaturate: 100,
    backgroundBlur: 0,
    backgroundBrightness: 0,
    texture: 'none',
    fontText: 'default',
    fontHeading: 'default',
    fontTimer: 'default',
    extensionBackground: 'same',
    savedAccents: [],
  },
  blocking: { enabled: false, domains: [] },
  calendar: {
    googleConnected: false,
    studyCalendarId: null,
    syncPlannedBlocks: true,
    readBusyTimes: true,
    logSessions: true,
  },
  routines: { missedClearedThrough: null },
  grading: { scale: UOFT_GRADE_SCALE, goalGpa: null, targetPercent: null },
  visualizer: {
    enabled: false,
    onMinimalist: false,
    promptDismissed: false,
    intensity: 0.6,
    opacity: 0.5,
    colorMode: 'custom',
    color: '#ffd1e3',
    mist: true,
    ribbons: false,
    shockwave: true,
    rings: false,
    bars: false,
    waveform: false,
    mistHeight: 0.3,
    mistDrift: 0.5,
    mistOpacity: 1,
    waveCount: 4,
    waveformPosition: 0.18,
    barCount: 48,
    barHeight: 0.22,
    barGap: 0.35,
    barGlow: 0.7,
    barReflection: true,
    barSymmetric: false,
    preset: 'bass',
    customSensitivity: 0.5,
    customDrop: 0.5,
    customSmoothing: 0.5,
    customMemory: 0.4,
    customBassLow: 20,
    customBassHigh: 140,
    barPosition: 0.92,
    barWidth: 0.9,
    waveTop: true,
    waveBottom: true,
    waveformMirror: true,
    ringCount: 3,
    burst: false,
    burstRadius: 0.2,
    burstReach: 0.15,
    burstSpikes: 96,
    burstBlob: true,
    burstRays: true,
    speed: 1,
    fadeWhenSilent: false,
    barOpacity: 1,
    burstShowSpikes: true,
    burstSpikeOpacity: 1,
  },
  features: { routines: true, plans: true, grades: false, calendar: true, social: true },
  social: {
    posts: 'everyone',
    stats: true,
    leaderboard: 'global',
    requests: true,
    live: true,
    schoolActivity: false,
  },
  rolls: { name: 'auto', profile: true },
  notifications: { nudges: true, kudos: true, comments: true, mentions: true },
  dashboard: { focusOnly: false },
  nav: { style: 'sidebar' },
  focusScreen: { openOnStart: 'ask' },
  timelapse: {
    record: 'ask',
    lengthMode: 'auto',
    lengthSeconds: 30,
    speed: 300,
    fps: 30,
    showTimer: true,
    showClockTime: true,
    smooth: true,
    deflicker: true,
    recordBreaks: false,
    breakClock: 'break',
    // The camera's own shape, measured once it is seen.
    aspect: 'camera',
    resolution: 100,
    dim: 0.5,
    layout: defaultTimelapseLayout(16 / 9),
    noteText: '',
    format: 'normal',
    storyLayout: defaultStoryLayout(),
  },
  // Upright and sideways, each in the camera's shape held that way.
  timelapsePhone: defaultPhoneTimelapse(),
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

  // Idle detection is gone; a row saved while it existed still carries its group.
  delete out.idle;
  // The leaderboard choice was a yes or no for a day; those rows read as the two ends.
  const social = out.social as { leaderboard: unknown };
  if (social.leaderboard === true) social.leaderboard = 'global';
  else if (social.leaderboard === false) social.leaderboard = 'off';
  // The name colour was an on/off switch under Social for an afternoon (2026-10-25): off
  // there is a plain name now, unless a name has been picked since.
  const oldColour = (social as { rollColour?: unknown }).rollColour;
  delete (social as { rollColour?: unknown }).rollColour;
  const rollName = (partial.rolls as { name?: unknown } | undefined)?.name;
  if (oldColour === false && rollName === undefined) (out.rolls as { name: string }).name = 'off';

  const settings = out as unknown as UserSettings;
  settings.dismissed = asList<string>(settings.dismissed, []);
  settings.blocking.domains = asList<string>(settings.blocking.domains, []);
  settings.grading.scale = asList(settings.grading.scale, DEFAULT_SETTINGS.grading.scale);
  // A free font taken out of the list since: back to the default.
  settings.theme.fontText = fontChoiceOf(settings.theme.fontText);
  settings.theme.fontHeading = fontChoiceOf(settings.theme.fontHeading);
  settings.theme.fontTimer = fontChoiceOf(settings.theme.fontTimer);
  // A row saved before the layout existed: its two clock switches decide those pieces.
  const tl = settings.timelapse;
  const savedLayout = (partial.timelapse as { layout?: unknown } | undefined)?.layout;
  const seed = defaultTimelapseLayout(16 / 9);
  if (savedLayout === undefined) {
    seed.elapsed.visible = tl.showTimer !== false;
    seed.clock.visible = tl.showClockTime !== false;
  }
  tl.layout = normalizeTimelapseLayout(savedLayout, seed);
  tl.storyLayout = normalizeTimelapseLayout(
    (partial.timelapse as { storyLayout?: unknown } | undefined)?.storyLayout,
    defaultStoryLayout(),
  );
  if (!TIMELAPSE_FORMATS.includes(tl.format)) tl.format = 'normal';
  tl.noteText = noteTextOf(partial.timelapse as Record<string, unknown> | undefined);
  delete (tl as { endText?: unknown }).endText;
  settings.timelapsePhone = normalizePhoneTimelapse(
    settings.timelapsePhone,
    partial.timelapsePhone as Record<string, unknown> | undefined,
  );
  delete (settings.timelapsePhone as { endText?: unknown }).endText;
  return settings;
}
