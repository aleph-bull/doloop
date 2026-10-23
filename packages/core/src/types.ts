/**
 * Shared domain types. Times on the wire are ISO-8601 strings in UTC.
 * Clients render in the user's timezone (stored on the user).
 */

import type { TimelapseAspect, TimelapseLayout } from './timelapse-layout';

export type ISODateTime = string; // e.g. "2026-09-20T15:04:05.000Z"
export type ISODate = string; // e.g. "2026-09-20" (calendar day in the user's timezone)

export type NodeKind = 'course' | 'assessment' | 'task' | 'other';
export type SessionMode = 'pomodoro' | 'unlimited' | 'scheduled';
/**
 * Where a calendar block came from.
 * - 'app': study time the user scheduled in Komodon. The only kind pushed to Google.
 * - 'google': an imported commitment - a lecture, a shift, a dentist. Shown so the user
 *   can plan around it; never treated as study time and never used to tell them to study.
 * - 'outlook', 'ics': the same as 'google', from Outlook or from a calendar added by link.
 * - 'session': study that actually happened, logged after the timer ended.
 */
export type PlannedBlockSource = 'app' | 'google' | 'outlook' | 'ics' | 'session';
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
  /** Jack mode: a die after each work interval changes the break. Off unless turned on. */
  jackMode: boolean;
}

export type ReviewMode = 'quick' | 'full' | 'off';
export type ReducedMotion = 'system' | 'on' | 'off';
export type QuoteMode = 'quotes' | 'research-tips' | 'both' | 'off';
export type ThemeMode = 'system' | 'light' | 'dark' | 'recommended';
export type PanelStyle = 'opaque' | 'glass' | 'custom' | 'matte';
/** A faint pattern over a plain background (a solid colour or a gradient). */
export type BackgroundTexture = 'none' | 'grain' | 'dots' | 'grid';
/** 'accent' follows the app accent, 'custom' is one chosen colour, 'gradient' sweeps from the accent. */
export type VisualizerColorMode = 'accent' | 'custom' | 'gradient';
export const CUSTOM_BACKGROUND_UPLOAD = 'upload';

/**
 * How the visualizer listens. Each preset is a different analysis: what counts as a beat,
 * how loud a drop has to be, how quickly the light settles. 'custom' reads the sliders.
 */
export type VisualizerPreset = 'bass' | 'balanced' | 'mellow' | 'custom';

export interface UserSettings {
  profile: {
    /** What the greeting calls you. Asked at onboarding, editable in settings. */
    name: string | null;
    /**
     * An Ontario university's id (see ONTARIO_UNIVERSITIES), shown on the profile. Only the
     * API writes it, after a code sent to an address on that university's domain comes back.
     */
    university: string | null;
    /** A line or two about you, on the profile. */
    bio: string | null;
  };
  pomodoro: PomodoroConfig;
  review: { mode: ReviewMode };
  streak: {
    minMinutes: number;
    /**
     * The hour (0-8) a new streak day begins, so a 1am session still counts for the night
     * before. Only the streak uses it; the calendar and analytics keep midnight.
     */
    dayStartHour: number;
    /** When dayStartHour last changed, set by the server; it may change once a day. */
    dayStartChangedAt: ISODateTime | null;
    /** Streak days a Monday-to-Sunday week needs to count toward the weekly streak (1-7). */
    daysPerWeek: number;
  };
  /** What the dashboard ring and the Analytics week measure against. */
  goals: { weeklyMinutes: number };
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
  /** `appTips`: about 1 in 5 cards shows a tip about the app instead of a quote. */
  quote: { mode: QuoteMode; appTips: boolean };
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
    /** The glass's colour (Appearance › Advanced). Null keeps the theme's own. */
    glassColor: string | null;
    /** How much of the glass's colour covers the background, 0.3..0.95. Null keeps the theme's. */
    glassAlpha: number | null;
    /** The glass's blur in px, 0..40. */
    glassBlur: number;
    /** How much the glass deepens the colours behind it, 100..200 (%). */
    glassSaturate: number;
    /** Pattern over a plain background; photos and uploads never show it. */
    texture: BackgroundTexture;
    /** Extension popup background: 'same' as the portal, 'upload', or a preset id. */
    extensionBackground: string;
    /** The user's own accent colours ('custom:h,s,l'), kept beside the built-in ones. */
    savedAccents: string[];
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
  rewards: {
    /** The least a reward bought with XP may cost. */
    minCostXp: number;
    /** When minCostXp last changed, set by the server; it may change once a day. */
    minCostChangedAt: ISODateTime | null;
  };
  routines: {
    /** "Clear missed": outstanding days on or before this date drop off the due list. */
    missedClearedThrough: ISODate | null;
  };
  grading: {
    /** Percentage bands, highest first. Defaults to the U of T scale. */
    scale: GradeBand[];
    /** Shown against your running GPA when set. */
    goalGpa: number | null;
    /** The mark aimed for in each course, as a percentage; null when none is set. */
    targetPercent: number | null;
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
    /** How strongly the light shows over the background, 0..1. */
    opacity: number;
    colorMode: VisualizerColorMode;
    /** Hex colour for 'custom'. */
    color: string;
    /**
     * The layers: a cloud of mist along the bottom, waves across the top and bottom, the
     * ring that rolls out from the clock on a drop, circles around the clock, neon bars
     * along the bottom, and a mirrored line across the screen.
     */
    mist: boolean;
    ribbons: boolean;
    shockwave: boolean;
    rings: boolean;
    bars: boolean;
    waveform: boolean;
    /** How far up the screen the mist reaches, 0..1, and how fast it drifts, 0..1. */
    mistHeight: number;
    mistDrift: number;
    /** How strongly the mist shows, 0..1, on top of the visualizer's own opacity. */
    mistOpacity: number;
    /** How many waves cross the lower band; the upper band carries about half as many. */
    waveCount: number;
    /** Where the line's axis sits, as a fraction of the height from the top, 0..1. */
    waveformPosition: number;
    /** How many bars, and the tallest one as a fraction of the screen height. */
    barCount: number;
    barHeight: number;
    /** The share of each bar's slot left empty, 0..1, and how much bloom, 0..1. */
    barGap: number;
    barGlow: number;
    /** A faint reflection under the bars, and bass in the middle mirrored outward. */
    barReflection: boolean;
    barSymmetric: boolean;
    /** How it listens: tuned for bass-heavy music, for calm music, for anything, or by hand. */
    preset: VisualizerPreset;
    /**
     * The custom preset's sliders, all 0..1 except the band edges in Hz. Sensitivity is how
     * small a jump counts as a beat; drop is how big one has to be for the ring; smoothing
     * is how slowly the light settles; memory is how many seconds of the recent past a
     * beat is judged against.
     */
    customSensitivity: number;
    customDrop: number;
    customSmoothing: number;
    customMemory: number;
    customBassLow: number;
    customBassHigh: number;
    /** Where the bars stand, as a fraction of the height from the top, and how much of the width they span. */
    barPosition: number;
    barWidth: number;
    /** Which wave bands are drawn: across the top, across the bottom. */
    waveTop: boolean;
    waveBottom: boolean;
    /** The line's reflection under its axis. */
    waveformMirror: boolean;
    /** How many circles sit around the clock. */
    ringCount: number;
    /**
     * The burst: a ring of spectrum spikes around the clock with glowing shapes behind it.
     * Radius and reach are fractions of the shorter side of the screen.
     */
    burst: boolean;
    burstRadius: number;
    burstReach: number;
    burstSpikes: number;
    burstBlob: boolean;
    burstRays: boolean;
    /** Speed of the drifting parts, 1 being as designed, and whether the light fades in silence. */
    speed: number;
    fadeWhenSilent: boolean;
    /** How strongly the bars show, 0..1, on top of the visualizer's opacity. */
    barOpacity: number;
    /** Whether the burst draws its spikes at all, and how strongly, 0..1. */
    burstShowSpikes: boolean;
    burstSpikeOpacity: number;
  };
  /**
   * Keys of one-off prompts and hints the user has closed. Server-side so a dismissal
   * holds across devices and reinstalls - closing a prompt means never again, not
   * "until this browser forgets".
   */
  dashboard: {
    /** Keep dashboard content focused on starting a session; navigation stays available. */
    focusOnly: boolean;
  };
  /** Optional pages. Turning one off takes it out of the nav; its data is kept. */
  features: {
    routines: boolean;
    plans: boolean;
    grades: boolean;
    calendar: boolean;
    /** The Social page: your profile, and other people's. */
    social: boolean;
  };
  /** What of yours other people get to see on Social. The API enforces each of these. */
  social: {
    /** Who sees your posts: everyone signed in, or your friends only. */
    posts: 'everyone' | 'friends';
    /** Your study totals, the days grid and strongest days on your profile. */
    stats: boolean;
    /**
     * Which leaderboards count you: the global one and your friends' ('global'), only
     * your friends' ('friends'), or none ('off').
     */
    leaderboard: 'global' | 'friends' | 'off';
    /** Take friend requests. */
    requests: boolean;
    /** Friends can see when you are in a session, for how long, and on what. */
    live: boolean;
  };
  /** Where the pages sit on a computer: a bar along the top, or a sidebar down the left. */
  nav: { style: 'top' | 'sidebar' };
  /** The focus screen tab. */
  focusScreen: {
    /** Open the focus screen when a session starts: ask each time, always, or never. */
    openOnStart: FocusOpenMode;
  };
  /**
   * The camera timelapse recorded on the focus screen, and the computer's preset. Frames
   * never leave this device.
   */
  timelapse: TimelapsePreset & {
    /** When a session starts on the focus screen: ask whether to record, always record, or never (and stop asking). Shared by both presets. */
    record: FocusOpenMode;
    /** Draw the time studied in the corner of the video. */
    showTimer: boolean;
    /** Draw the time of day each moment was filmed, in the account's timezone ("2:14 PM EST"). */
    showClockTime: boolean;
  };
  /**
   * The phone's preset, used when the timelapse records on a phone (the camera screen).
   * `aspect` and `layout` are for a video started with the phone upright; a video started
   * sideways uses `sidewaysAspect` and `sidewaysLayout`. Phones never record a screen.
   */
  timelapsePhone: TimelapsePreset & {
    sidewaysAspect: TimelapseAspect;
    sidewaysLayout: TimelapseLayout;
  };
  dismissed: string[];
}

/** How one device's timelapse comes out: the computer's or the phone's. */
export interface TimelapsePreset {
  /** How long the video comes out: auto (about 20-40 s, like a phone), a set length, or a speed. */
  lengthMode: TimelapseLengthMode;
  /** The set length, in seconds, for lengthMode 'length'. */
  lengthSeconds: number;
  /** How many times faster than real time, for lengthMode 'speed'. */
  speed: number;
  /** Frames per second of the video, as asked; the frames captured may support fewer. */
  fps: number;
  /** Blend the stills behind each frame together, for a softer motion. */
  smooth: boolean;
  /** Even out the brightness between stills, so the video does not flicker. */
  deflicker: boolean;
  /** Keep taking stills during breaks, not only during focus. */
  recordBreaks: boolean;
  /**
   * With breaks recorded, what the corner clock shows during one: the break's own time
   * ('break'), or the session's running time, counting on through it ('running').
   */
  breakClock: 'break' | 'running';
  /** The video's shape; 'camera' follows the camera's own. */
  aspect: TimelapseAspect;
  /**
   * How big the video is made, in percent of the full size (1280 px on its long side). It
   * is never made smaller than its shape allows (`clampTimelapseResolution`).
   */
  resolution: number;
  /**
   * How far the focus screen darkens while it records and nobody is touching it, 0 (not at
   * all) to 0.9. A black layer over the page, not the display's own brightness, which a web
   * page can't change; never in the video.
   */
  dim: number;
  /**
   * Where each piece sits in the video and whether it is shown. The camera's and the
   * screen's visibility also decide what is recorded. Replaces showTimer and
   * showClockTime, which only seed it for a row saved before it existed.
   */
  layout: TimelapseLayout;
  /**
   * The person's own line of text, on the video the whole way through like the clocks
   * (the layout's `note` piece places it). Empty leaves it out.
   */
  noteText: string;
}

export type FocusOpenMode = 'ask' | 'always' | 'never';
export type TimelapseLengthMode = 'auto' | 'length' | 'speed';

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
  /** The weekly streak. Absent on rows saved before it existed, until the next sync. */
  weeks?: WeekStreakState;
}

/** Weeks in a row with enough streak days (see evaluateWeekStreak). */
export interface WeekStreakState {
  current: number;
  longest: number;
  /** Monday of the last week judged (counted or ended), or null. */
  lastCountedWeek: ISODate | null;
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
  /**
   * A throwaway "I'm a dev" account: kept out of Social, deleted a day after it was made.
   * Optional because the portal's offline cache can hold a user from before it existed.
   */
  devAccount?: boolean;
}

/**
 * A template for the items under a node: the defaults its children's dialog opens with.
 * Set on a course, it shapes every assignment added under it; set on a unit, it shapes
 * that unit's tasks. The nearest ancestor with one wins. Nothing here is applied to the
 * node itself, and a saved child keeps its own values whatever the template later says.
 */
export interface NodeTemplate {
  kind: NodeKind | null;
  estimatedMinutes: number | null;
  /** Local "HH:MM" the due time defaults to, when a due date is picked. */
  dueTime: string | null;
  countUnit: CountUnit | null;
  countUnitLabel: string | null;
  color: string | null;
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
  /** Defaults for new items added under this node. Null when none are set. */
  childDefaults: NodeTemplate | null;
  /**
   * The node's tags (ids into the user's tag list), in the order added. Optional because the
   * portal's offline cache can hold a node from before tags existed.
   */
  tagIds?: string[];
}

export interface SessionReview {
  skipped: boolean;
  prepared: number | null; // 1-5
  distracted: Distracted | null;
  completedCount: number | null;
  correctCount: number | null;
  mood: number | null; // 1-5, no longer asked; kept for older sessions
  /** How hard the session felt, 1 (easy) to 5 (all out), like a workout's effort. */
  effort?: number | null;
  extraMinutesAdded: number | null;
  note: string | null;
}

export type PomodoroSnapshot = Pick<
  PomodoroConfig,
  'workMin' | 'shortBreakMin' | 'longBreakMin' | 'cyclesBeforeLong'
>;

/**
 * A stretch a running session spent with the computer asleep: logged when the app wakes,
 * then answered once. 'kept' means the user says they kept studying; 'stopped' means the
 * session was ended at `from`.
 */
export interface SleepGap {
  from: ISODateTime;
  to: ISODateTime;
  answer: 'kept' | 'stopped' | null;
}

export interface Session {
  id: string;
  userId: string;
  /**
   * The task studied. Null for a routine session, and for a free session started with
   * nothing picked: at most one of the two is set.
   */
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
  /** Times the computer slept while this session ran, and what the user said about each. */
  sleeps: SleepGap[];
  /** Jack mode's dice over the session, when it ran with Jack mode on. */
  jack?: SessionJack | null;
}

/** What Jack mode's dice did over one session. */
export interface SessionJack {
  rolls: number;
  wonSeconds: number;
  lostSeconds: number;
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
