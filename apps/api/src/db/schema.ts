import type {
  PomodoroSnapshot,
  RestDayChange,
  SessionReview,
  StreakState,
  TimerState,
  UserSettings,
  Vacation,
} from '@doloop/core';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  /** Same id as the Supabase auth user. */
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  createdAt: ts('created_at').notNull().defaultNow(),
  settings: jsonb('settings').$type<Partial<UserSettings>>().notNull().default({}),
  xp: integer('xp').notNull().default(0),
  level: integer('level').notNull().default(0),
  streak: jsonb('streak')
    .$type<StreakState>()
    .notNull()
    .default({ current: 0, longest: 0, lastCountedDate: null, freezesHeld: 0, breakDaysHeld: 0 }),
  /** Secret for the .ics feed URL. Regenerable. */
  icsToken: text('ics_token').notNull(),
  purchasedBackgrounds: jsonb('purchased_backgrounds').$type<string[]>().notNull().default([]),
  lastPhraseId: text('last_phrase_id'),
  onboardedAt: ts('onboarded_at'),
});

export const nodes = pgTable(
  'nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    title: text('title').notNull(),
    kind: text('kind', { enum: ['course', 'assessment', 'task', 'other'] }).notNull(),
    estimatedMinutes: integer('estimated_minutes'),
    dueAt: ts('due_at'),
    completedAt: ts('completed_at'),
    sortOrder: real('sort_order').notNull().default(0),
    color: text('color'),
    archived: boolean('archived').notNull().default(false),
    countUnit: text('count_unit', { enum: ['problems', 'pages', 'cards', 'custom'] }),
    countUnitLabel: text('count_unit_label'),
    outcomeRating: integer('outcome_rating'),
    outcomeAskedAt: ts('outcome_asked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('nodes_user_idx').on(t.userId), index('nodes_parent_idx').on(t.parentId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    startedAt: ts('started_at').notNull(),
    endedAt: ts('ended_at'),
    mode: text('mode', { enum: ['pomodoro', 'unlimited', 'scheduled'] }).notNull(),
    plannedEndAt: ts('planned_end_at'),
    workSeconds: integer('work_seconds').notNull().default(0),
    breakSeconds: integer('break_seconds').notNull().default(0),
    idleSeconds: integer('idle_seconds').notNull().default(0),
    pomodoroConfigSnapshot: jsonb('pomodoro_config_snapshot').$type<PomodoroSnapshot | null>(),
    review: jsonb('review').$type<SessionReview | null>(),
    xpAwarded: integer('xp_awarded').notNull().default(0),
    badgesAwarded: jsonb('badges_awarded').$type<string[]>().notNull().default([]),
    /** Full timer state machine; derived columns above are synced from it. */
    timer: jsonb('timer').$type<TimerState>().notNull(),
    phraseId: text('phrase_id'),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [
    index('sessions_user_started_idx').on(t.userId, t.startedAt),
    index('sessions_node_idx').on(t.nodeId),
    // One active (un-ended) session per user.
    uniqueIndex('sessions_one_active_idx')
      .on(t.userId)
      .where(sql`ended_at IS NULL`),
  ],
);

export const plannedBlocks = pgTable(
  'planned_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id').references(() => nodes.id, { onDelete: 'set null' }),
    startAt: ts('start_at').notNull(),
    endAt: ts('end_at').notNull(),
    source: text('source', { enum: ['app', 'google'] })
      .notNull()
      .default('app'),
    googleEventId: text('google_event_id'),
    cancelled: boolean('cancelled').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('planned_blocks_user_start_idx').on(t.userId, t.startAt),
    uniqueIndex('planned_blocks_google_idx').on(t.userId, t.googleEventId),
  ],
);

export const restDayPolicies = pgTable('rest_day_policies', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  weeklyRestDays: jsonb('weekly_rest_days').$type<number[]>().notNull().default([]),
  pendingWeeklyRestDays: jsonb('pending_weekly_rest_days').$type<{
    days: number[];
    effectiveFrom: string;
  } | null>(),
  vacations: jsonb('vacations').$type<Vacation[]>().notNull().default([]),
  breakDays: jsonb('break_days').$type<string[]>().notNull().default([]),
  changeLog: jsonb('change_log').$type<RestDayChange[]>().notNull().default([]),
});

export const achievements = pgTable(
  'achievements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    unlockedAt: ts('unlocked_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('achievements_user_key_idx').on(t.userId, t.key)],
);

export const quotesSeen = pgTable(
  'quotes_seen',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    quoteId: text('quote_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })],
);

/** Ledger of XP earned and spent. Break-day pricing counts purchases per month from here. */
export const xpTransactions = pgTable(
  'xp_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    at: ts('at').notNull().defaultNow(),
    delta: integer('delta').notNull(),
    kind: text('kind', {
      enum: ['session', 'freeze', 'break-day', 'background', 'reward', 'routine'],
    }).notNull(),
    ref: text('ref'),
  },
  (t) => [index('xp_tx_user_at_idx').on(t.userId, t.at)],
);

/** Every change to a node's estimate, for estimate-accuracy analytics. */
export const estimateChanges = pgTable(
  'estimate_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    at: ts('at').notNull().defaultNow(),
    fromMinutes: integer('from_minutes'),
    toMinutes: integer('to_minutes'),
    source: text('source', { enum: ['edit', 'review'] }).notNull(),
  },
  (t) => [index('estimate_changes_node_idx').on(t.nodeId)],
);

export const weeklyReviews = pgTable(
  'weekly_reviews',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    weekStart: text('week_start').notNull(),
    note: text('note'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.weekStart] })],
);

/** Small per-user binary assets (currently only the custom background image). */
export const userAssets = pgTable(
  'user_assets',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['background'] }).notNull(),
    mime: text('mime').notNull(),
    data: text('data').notNull(), // base64
    bytes: integer('bytes').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind] })],
);

/** User-defined rewards bought with XP. Doloop only enforces the price floor. */
export const customRewards = pgTable(
  'custom_rewards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    note: text('note'),
    emoji: text('emoji'),
    costXp: integer('cost_xp').notNull(),
    /** 0 = redeemable whenever it is affordable. */
    cooldownDays: integer('cooldown_days').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
    lastRedeemedAt: ts('last_redeemed_at'),
    redeemedCount: integer('redeemed_count').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('custom_rewards_user_idx').on(t.userId)],
);

/** Recurring tasks: daily/weekly/monthly things that are ticked off rather than timed. */
export const routines = pgTable(
  'routines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id').references(() => nodes.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    note: text('note'),
    estimatedMinutes: integer('estimated_minutes').notNull(),
    freq: text('freq', { enum: ['daily', 'weekly', 'monthly'] }).notNull(),
    interval: integer('interval').notNull().default(1),
    byWeekday: jsonb('by_weekday').$type<number[]>().notNull().default([]),
    byMonthday: jsonb('by_monthday').$type<number[]>().notNull().default([]),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    source: text('source', { enum: ['app', 'ics'] })
      .notNull()
      .default('app'),
    icsUid: text('ics_uid'),
    archived: boolean('archived').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('routines_user_idx').on(t.userId),
    // Re-importing the same calendar updates rather than duplicates.
    uniqueIndex('routines_ics_uid_idx').on(t.userId, t.icsUid),
  ],
);

/** One tick of one occurrence. The unique index is what makes ticking idempotent. */
export const routineCompletions = pgTable(
  'routine_completions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    routineId: uuid('routine_id')
      .notNull()
      .references(() => routines.id, { onDelete: 'cascade' }),
    /** The occurrence date, as a calendar day in the user's timezone. */
    date: text('date').notNull(),
    completedAt: ts('completed_at').notNull().defaultNow(),
    minutes: integer('minutes').notNull(),
    xpAwarded: integer('xp_awarded').notNull().default(0),
  },
  (t) => [
    uniqueIndex('routine_completions_once_idx').on(t.routineId, t.date),
    index('routine_completions_user_date_idx').on(t.userId, t.date),
  ],
);

/** Streak events (counted days are implicit; only freezes and resets are logged). */
export const streakEvents = pgTable(
  'streak_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    type: text('type', { enum: ['freeze-used', 'reset'] }).notNull(),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('streak_events_user_date_type_idx').on(t.userId, t.date, t.type)],
);

export const googleCalendar = pgTable('google_calendar', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  studyCalendarId: text('study_calendar_id'),
  syncToken: text('sync_token'),
  /** Null when the token was revoked; the UI shows "Reconnect". */
  revokedAt: ts('revoked_at'),
  connectedAt: ts('connected_at').notNull().defaultNow(),
  lastSyncAt: ts('last_sync_at'),
});

export const schema = {
  users,
  nodes,
  sessions,
  plannedBlocks,
  restDayPolicies,
  achievements,
  quotesSeen,
  xpTransactions,
  estimateChanges,
  weeklyReviews,
  googleCalendar,
  streakEvents,
  userAssets,
  customRewards,
  routines,
  routineCompletions,
};

export type UserRow = typeof users.$inferSelect;
export type NodeRow = typeof nodes.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type PlannedBlockRow = typeof plannedBlocks.$inferSelect;
export type RestDayPolicyRow = typeof restDayPolicies.$inferSelect;
export type CustomRewardRow = typeof customRewards.$inferSelect;
export type RoutineRow = typeof routines.$inferSelect;
export type RoutineCompletionRow = typeof routineCompletions.$inferSelect;
