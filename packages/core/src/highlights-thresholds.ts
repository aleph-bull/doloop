/** Every threshold for the positive-only weekly highlights (spec §11a), in one place. */
export const HIGHLIGHT_THRESHOLDS = {
  /** hours-up: this week's work must be at least this multiple of last week's. */
  HOURS_UP_RATIO: 1.1,
  /** sessions-up: at least this many more sessions than last week. */
  SESSIONS_UP_DELTA: 2,
  /** throughput-up: completed per minute at least this multiple of the previous session. */
  THROUGHPUT_UP_RATIO: 1.15,
  /** accuracy-up: percentage points higher than the previous session. */
  ACCURACY_UP_POINTS: 5,
  /** accuracy-up: both sessions need at least this many completed. */
  ACCURACY_MIN_COMPLETED: 5,
  /** mood-up: at least this much higher than the previous session on the node. */
  MOOD_UP_DELTA: 1,
  /** focus-streak: consecutive sessions with distracted == 'no'. */
  FOCUS_STREAK_MIN: 3,
  /** distraction-down: share of distracted sessions must drop by this many points. */
  DISTRACTION_DOWN_POINTS: 20,
  /** planned-kept: share of planned blocks that were studied. */
  PLANNED_KEPT_RATIO: 0.7,
  /** streak: minimum current streak to mention. */
  STREAK_MIN: 3,
  /** early-finish: days before the due date. */
  EARLY_FINISH_DAYS: 2,
  /** Number of cards shown before the rest collapse under "More wins". */
  TOP_CARDS: 5,
} as const;

export const HIGHLIGHT_FALLBACK = 'Fresh week. Your first session sets the baseline.';
