/**
 * Shared domain types. Times on the wire are ISO-8601 strings in UTC.
 * Clients render in the user's timezone (stored on the user).
 */

export type ISODateTime = string; // e.g. "2026-09-20T15:04:05.000Z"
export type ISODate = string; // e.g. "2026-09-20" (calendar day in the user's timezone)

export type NodeKind = 'course' | 'assessment' | 'task' | 'other';
export type SessionMode = 'pomodoro' | 'unlimited' | 'scheduled';
export type PlannedBlockSource = 'app' | 'google';
export type Distracted = 'no' | 'a-little' | 'a-lot';
export type PaceStatus = 'done' | 'overdue' | 'critical' | 'behind' | 'on-track' | 'no-estimate';

/** Unit used for "activities completed" in a full review. */
export type CountUnit = 'problems' | 'pages' | 'cards' | 'custom';

export interface PomodoroConfig {
  workMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  cyclesBeforeLong: number;
  autoStartBreaks: boolean;
  autoStartWork: boolean;
  showTimerByDefault: boolean;
}

export type ReviewMode = 'quick' | 'full' | 'off';
export type ReducedMotion = 'system' | 'on' | 'off';
export type QuoteMode = 'quotes' | 'research-tips' | 'both' | 'off';
export type ThemeMode = 'system' | 'light' | 'dark';
export type PanelStyle = 'opaque' | 'glass' | 'custom';
export const CUSTOM_BACKGROUND_UPLOAD = 'upload';

export interface UserSettings {
  pomodoro: PomodoroConfig;
  review: { mode: ReviewMode };
  idle: { enabled: boolean; thresholdMin: number };
  streak: { minMinutes: number };
  pace: { maxComfortableMinutesPerDay: number };
  sounds: { enabled: boolean; endOfInterval: boolean; endOfBlock: boolean; volume: number };
  effects: {
    confetti: boolean;
    badgeToasts: boolean;
    phrases: boolean;
    reducedMotion: ReducedMotion;
  };
  quote: { mode: QuoteMode };
  theme: {
    mode: ThemeMode;
    accent: string;
    backgroundId: string;
    /**
     * The sentinel 'upload' when the image stored via /api/me/background is in use, else null.
     * Remote image URLs are not supported: an uploaded file is the only custom background.
     */
    customBackgroundUrl: typeof CUSTOM_BACKGROUND_UPLOAD | null;
    /** Surface for dense panels (task tree, tables, settings). */
    panel: PanelStyle;
    /** Hex colour for panel 'custom'. */
    panelColor: string;
    /** 0..1 opacity for panel 'custom'. */
    panelAlpha: number;
    /** Extension popup background: 'same' as the portal, 'upload', or a preset id. */
    extensionBackground: string;
  };
  /**
   * The ambient glow on the focus screen. It reacts to system audio, which the browser
   * only exposes through a screen-share prompt, so `enabled` is a preference rather than a
   * guarantee that it is running.
   */
  visualizer: {
    enabled: boolean;
    /** How far the glow rises, 0..1. */
    intensity: number;
    /** Overall transparency of the glow, 0..1. */
    opacity: number;
    /** Hex colour. Editable in Settings and on the focus screen itself. */
    color: string;
  };
  blocking: { enabled: boolean; domains: string[] };
  calendar: {
    googleConnected: boolean;
    studyCalendarId: string | null;
    syncPlannedBlocks: boolean;
    readBusyTimes: boolean;
  };
}

export interface StreakState {
  current: number;
  longest: number;
  /** Last calendar day (user tz) that was counted toward the streak, or null. */
  lastCountedDate: ISODate | null;
  freezesHeld: number;
  breakDaysHeld: number;
}

export interface User {
  id: string;
  email: string;
  timezone: string; // IANA, e.g. "America/Toronto"
  createdAt: ISODateTime;
  settings: UserSettings;
  xp: number;
  level: number;
  streak: StreakState;
}

export interface StudyNode {
  id: string;
  userId: string;
  parentId: string | null;
  title: string;
  kind: NodeKind;
  estimatedMinutes: number | null;
  dueAt: ISODateTime | null;
  completedAt: ISODateTime | null;
  sortOrder: number;
  color: string | null;
  archived: boolean;
  /** Label for countable activities in full review. */
  countUnit: CountUnit | null;
  countUnitLabel: string | null;
  /** Post-assessment "How did it go?" 1-5, asked one day after dueAt. */
  outcomeRating: number | null;
}

export interface SessionReview {
  skipped: boolean;
  prepared: number | null; // 1-5
  distracted: Distracted | null;
  completedCount: number | null;
  correctCount: number | null;
  mood: number | null; // 1-5
  extraMinutesAdded: number | null;
  note: string | null;
}

export type PomodoroSnapshot = Pick<
  PomodoroConfig,
  'workMin' | 'shortBreakMin' | 'longBreakMin' | 'cyclesBeforeLong'
>;

export interface Session {
  id: string;
  userId: string;
  nodeId: string;
  startedAt: ISODateTime;
  endedAt: ISODateTime | null;
  mode: SessionMode;
  plannedEndAt: ISODateTime | null;
  workSeconds: number;
  breakSeconds: number;
  idleSeconds: number;
  pomodoroConfigSnapshot: PomodoroSnapshot | null;
  review: SessionReview | null;
  xpAwarded: number;
  badgesAwarded: string[];
}

export interface PlannedBlock {
  id: string;
  userId: string;
  nodeId: string | null;
  startAt: ISODateTime;
  endAt: ISODateTime;
  source: PlannedBlockSource;
  googleEventId: string | null;
  cancelled: boolean;
}

export interface Vacation {
  from: ISODate;
  to: ISODate;
  label: string;
}

export interface RestDayChange {
  at: ISODateTime;
  what: string;
}

export interface RestDayPolicy {
  userId: string;
  /** 0 = Sunday ... 6 = Saturday */
  weeklyRestDays: number[];
  /** Pending weekly pattern that takes effect from `effectiveFrom` (a Monday). */
  pendingWeeklyRestDays: { days: number[]; effectiveFrom: ISODate } | null;
  vacations: Vacation[];
  /** One-off purchased break days (never retroactive). */
  breakDays: ISODate[];
  changeLog: RestDayChange[];
}

export interface Achievement {
  id: string;
  userId: string;
  key: string;
  unlockedAt: ISODateTime;
}

export interface QuoteSeen {
  userId: string;
  date: ISODate;
  quoteId: string;
}

export interface Quote {
  id: string;
  text: string;
  author: string;
  sourceUrl: string;
  tags: string[];
}

export interface ResearchTip {
  id: string;
  text: string;
  citation: string;
  tags: string[];
}
