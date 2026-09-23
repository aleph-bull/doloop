/**
 * Shared domain types. Times on the wire are ISO-8601 strings in UTC.
 * Clients render in the user's timezone (stored on the user).
 */

export type ISODateTime = string; // e.g. "2026-09-20T15:04:05.000Z"
export type ISODate = string; // e.g. "2026-09-20" (calendar day in the user's timezone)

export type NodeKind = 'course' | 'assessment' | 'task' | 'other';
export type SessionMode = 'pomodoro' | 'unlimited' | 'scheduled';
/**
 * Where a calendar block came from.
 * - 'app': study time the user scheduled in Doloop. The only kind pushed to Google.
 * - 'google': an imported commitment - a lecture, a shift, a dentist. Shown so the user
 *   can plan around it; never treated as study time and never used to tell them to study.
 * - 'session': study that actually happened, logged after the timer ended.
 */
export type PlannedBlockSource = 'app' | 'google' | 'session';
export type Distracted = 'no' | 'a-little' | 'a-lot';
export type PaceStatus = 'done' | 'overdue' | 'critical' | 'behind' | 'on-track' | 'no-estimate';

/** Unit used for "activities completed" in a full review. */
export type CountUnit = 'problems' | 'pages' | 'cards' | 'custom';

/**
 * How a course's grade is arrived at: one final mark, weighted components, or not at all.
 * 'off' hides the course from the Grades page and leaves it out of the average - a
 * pass/fail elective or an audit has no mark worth tracking.
 */
export type GradeMode = 'off' | 'overall' | 'components';

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
/** 'accent' follows the app accent, 'custom' is one chosen colour, 'gradient' sweeps from the accent. */
export type VisualizerColorMode = 'accent' | 'custom' | 'gradient';
export const CUSTOM_BACKGROUND_UPLOAD = 'upload';

export interface UserSettings {
  profile: {
    /** What the greeting calls you. Asked at onboarding, editable in settings. */
    name: string | null;
  };
  pomodoro: PomodoroConfig;
  review: { mode: ReviewMode };
  idle: { enabled: boolean; thresholdMin: number };
  streak: { minMinutes: number };
  pace: { maxComfortableMinutesPerDay: number };
  sounds: {
    enabled: boolean;
    /** Master level, 0..1. */
    volume: number;
    /** Preset id per moment; SILENT_SOUND_ID mutes just that one. */
    workStart: string;
    breakStart: string;
    sessionEnd: string;
  };
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
  blocking: { enabled: boolean; domains: string[] };
  calendar: {
    googleConnected: boolean;
    studyCalendarId: string | null;
    /** Push study blocks you plan here out to the connected calendar. */
    syncPlannedBlocks: boolean;
    readBusyTimes: boolean;
    /** Record each finished session on the calendar as the block of study it was. */
    logSessions: boolean;
  };
  grading: {
    /** Percentage bands, highest first. Defaults to the U of T scale. */
    scale: GradeBand[];
    /** Shown against your running GPA when set. */
    goalGpa: number | null;
  };
  /** The focus screen's audio-reactive visualizer. Audio capture itself is per visit. */
  visualizer: {
    enabled: boolean;
    /**
     * "Never ask again": the focus screen stops offering to share audio on its own. The
     * feature stays available from Settings and the focus screen's own controls.
     */
    promptDismissed: boolean;
    /** Visual amplitude, glow and responsiveness, 0..1. Does not change the analysis. */
    intensity: number;
    colorMode: VisualizerColorMode;
    /** Hex colour for 'custom'. */
    color: string;
  };
  /**
   * Keys of one-off prompts and hints the user has closed. Server-side so a dismissal
   * holds across devices and reinstalls - closing a prompt means never again, not
   * "until this browser forgets".
   */
  dismissed: string[];
}

/** One row of a grading scale: everything from `minPercent` up to the next band. */
export interface GradeBand {
  /** Inclusive lower bound, 0-100. */
  minPercent: number;
  letter: string;
  /** Grade points on the user's scale (4.0 by default). */
  points: number;
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
  /** Courses only: one final mark, or weighted components. Null until grades are used. */
  gradeMode: GradeMode | null;
  /** The final mark in percent, used when `gradeMode` is 'overall'. */
  gradeOverall: number | null;
  /** Credit weight for the GPA average, e.g. 0.5 for a half course. */
  gradeCredits: number | null;
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
  /** The task studied. Null for a routine session: exactly one of the two is set. */
  nodeId: string | null;
  /** The routine done under the timer, for a routine session. */
  routineId: string | null;
  /** The routine occurrence the session was for; it is what gets ticked off. */
  routineDate: ISODate | null;
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
  /**
   * What an imported commitment is called, or the routine a routine session was for.
   * Null for task blocks, which use the node.
   */
  title: string | null;
  /** The session a 'session' block records. */
  sessionId: string | null;
  googleEventId: string | null;
  cancelled: boolean;
}

/** True when a block is study time - planned or actually done - rather than a commitment. */
export function isStudyBlock(block: Pick<PlannedBlock, 'source'>): boolean {
  return block.source === 'app' || block.source === 'session';
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

/**
 * A user-defined thing to count daily - pages read, problems drilled, kilometres run.
 * Each one renders as its own contribution grid next to the focus grid.
 */
export interface Tracker {
  id: string;
  userId: string;
  title: string;
  /** Plural noun for one unit, e.g. "pages". Used in the widget and its tooltips. */
  unitLabel: string;
  /**
   * A day's target. When set, the colour ramp is fixed fractions of it, so a good day
   * always looks the same; when null the ramp uses quartiles of your own logged days.
   */
  dailyGoal: number | null;
  color: string | null;
  sortOrder: number;
  archived: boolean;
  createdAt: ISODateTime;
}

/** One logged amount on one day. At most one row per tracker per day; logging again adds to it. */
export interface TrackerEntry {
  id: string;
  userId: string;
  trackerId: string;
  date: ISODate;
  amount: number;
  note: string | null;
  updatedAt: ISODateTime;
}

/** One weighted piece of a course's grade: a midterm, a problem set, participation. */
export interface GradeComponent {
  id: string;
  userId: string;
  nodeId: string;
  title: string;
  /** Share of the final grade, in percent. */
  weight: number;
  /** Percent earned, or null while it is still ungraded. */
  score: number | null;
  sortOrder: number;
}
