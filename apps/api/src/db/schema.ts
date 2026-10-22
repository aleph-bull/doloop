import type {
  NodeTemplate,
  PomodoroSnapshot,
  RestDayChange,
  SessionReview,
  SleepGap,
  StreakState,
  TimerState,
  UserSettings,
  Vacation,
} from '@komogon/core';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
  isTestAccount: boolean('is_test_account').notNull().default(false),
  emailVerifiedAt: ts('email_verified_at'),
  authVersion: integer('auth_version').notNull().default(0),
  /** Suspended by an admin: every request is refused until they lift it. */
  bannedAt: ts('banned_at'),
});

/**
 * Addresses an admin has blocked: no sign-up, no sign-in. Kept apart from accounts so a
 * deleted account's email can stay blocked. Stored lowercased.
 */
export const blockedEmails = pgTable('blocked_emails', {
  email: text('email').primaryKey(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const emailCodes = pgTable(
  'email_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    purpose: text('purpose', {
      enum: ['signup', 'account', 'organization', 'password-reset'],
    }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    payload: jsonb('payload')
      .$type<{ passwordHash?: string; timezone?: string | null; claimExisting?: boolean }>()
      .notNull()
      .default({}),
    attempts: integer('attempts').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
  },
  (t) => [index('email_codes_recipient_idx').on(t.email, t.purpose)],
);

export const emailRateLimits = pgTable('email_rate_limits', {
  key: text('key').primaryKey(),
  hits: integer('hits').notNull(),
  expiresAt: ts('expires_at').notNull(),
});

/**
 * From an earlier Social that was replaced by profiles (2026-10-21). Unused; kept so the
 * merge drops nothing. Drop it in a later migration once the alpha data is not needed.
 */
export const socialProfiles = pgTable('social_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull().default(''),
  organizationName: text('organization_name').notNull().default(''),
  organizationEmail: text('organization_email').unique(),
  organizationDomain: text('organization_domain'),
  organizationVerifiedAt: ts('organization_verified_at'),
  visible: boolean('visible').notNull().default(false),
});

/**
 * Email-and-password accounts the API signs in itself (when Supabase is not used). One row per
 * user; the password is stored only as a scrypt hash. Deleting the user deletes this too.
 */
export const passwordAccounts = pgTable('password_accounts', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Lower-cased, so sign-in ignores case. */
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
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
    gradeMode: text('grade_mode', { enum: ['off', 'overall', 'components'] }),
    gradeOverall: real('grade_overall'),
    gradeCredits: real('grade_credits'),
    /** Defaults for the items added under this node; null when none are set. */
    childDefaults: jsonb('child_defaults').$type<NodeTemplate | null>(),
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
    /**
     * The task studied. Null for a routine session, and for a free session started with
     * nothing picked; at most one of the two is set.
     */
    nodeId: uuid('node_id').references(() => nodes.id, { onDelete: 'cascade' }),
    routineId: uuid('routine_id').references(() => routines.id, { onDelete: 'cascade' }),
    /** A routine session's occurrence (local date): the one ticked off if it gets done. */
    routineDate: text('routine_date'),
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
    /** When the computer slept during the session, and whether the user kept studying. */
    sleeps: jsonb('sleeps').$type<SleepGap[]>().notNull().default([]),
    /** Full timer state machine; derived columns above are synced from it. */
    timer: jsonb('timer').$type<TimerState>().notNull(),
    phraseId: text('phrase_id'),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [
    index('sessions_user_started_idx').on(t.userId, t.startedAt),
    index('sessions_node_idx').on(t.nodeId),
    index('sessions_routine_idx').on(t.routineId),
    check('sessions_one_subject', sql`(node_id IS NULL) OR (routine_id IS NULL)`),
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
    /**
     * 'app' is study time the user scheduled here (and the only kind pushed out to
     * Google). 'google' is an imported commitment: context to plan around, never a study
     * plan. 'session' is a block of study that actually happened.
     */
    source: text('source', { enum: ['app', 'google', 'outlook', 'ics', 'session'] })
      .notNull()
      .default('app'),
    /** Title for imported commitments, so the grid can show what the time is taken by. */
    title: text('title'),
    /** Set on 'session' blocks: the session that was logged. */
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
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
      enum: ['session', 'freeze', 'break-day', 'background', 'reward', 'routine', 'badge'],
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

/** Small per-user binary assets: the custom background image and the profile picture. */
export const userAssets = pgTable(
  'user_assets',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['background', 'avatar'] }).notNull(),
    mime: text('mime').notNull(),
    data: text('data').notNull(), // base64
    bytes: integer('bytes').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind] })],
);

/**
 * One row per account: the university email a code was sent to, and whether it came
 * back. `settings.profile.university` is written only from a verified row.
 */
export const universityVerifications = pgTable(
  'university_verifications',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    universityId: text('university_id').notNull(),
    /** Lower-cased. */
    email: text('email').notNull(),
    /** sha256 of the code; emptied once it is used. */
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    verifiedAt: ts('verified_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  // One address verifies one account: a second confirm of the same address fails here too.
  (t) => [
    uniqueIndex('university_verifications_email_idx')
      .on(t.email)
      .where(sql`verified_at IS NOT NULL`),
  ],
);

/**
 * A post on Social: a note, a session shared as progress, a timelapse, or any of those
 * together. Visible to everyone signed in, on the feed and on the author's profile.
 */
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Empty when the post is only a session or a video. */
    body: text('body').notNull(),
    /** The session shared, when the post is about one. */
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    /** What the session showed when it was shared, kept so the post reads the same later. */
    minutes: integer('minutes'),
    subject: text('subject'),
    /** The attached video's type and size; the bytes are in `post_media`. */
    mediaMime: text('media_mime'),
    mediaBytes: integer('media_bytes'),
    /** A small JPEG data URL shown before the video loads. */
    poster: text('poster'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('posts_user_created_idx').on(t.userId, t.createdAt),
    index('posts_created_idx').on(t.createdAt),
  ],
);

/** The video behind a post, kept apart from the post so listing the feed never reads it. */
export const postMedia = pgTable('post_media', {
  postId: uuid('post_id')
    .primaryKey()
    .references(() => posts.id, { onDelete: 'cascade' }),
  mime: text('mime').notNull(),
  data: text('data').notNull(), // base64
  bytes: integer('bytes').notNull(),
});

export const postLikes = pgTable(
  'post_likes',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

export const postComments = pgTable(
  'post_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('post_comments_post_idx').on(t.postId, t.createdAt)],
);

/**
 * A friend request and, once accepted, the friendship. One row per pair, whichever way
 * it was asked; declining deletes the row, so the same person can be asked again later.
 */
export const friendships = pgTable(
  'friendships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addresseeId: uuid('addressee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'accepted'] })
      .notNull()
      .default('pending'),
    createdAt: ts('created_at').notNull().defaultNow(),
    respondedAt: ts('responded_at'),
  },
  (t) => [
    uniqueIndex('friendships_pair_idx').on(t.requesterId, t.addresseeId),
    index('friendships_addressee_idx').on(t.addresseeId),
    check('friendships_not_self', sql`requester_id <> addressee_id`),
  ],
);

/**
 * A jam: a small game friends enter for a day or a week. Focused minutes from the moment
 * each person joins count; the most at the end wins. Anyone with the code can join.
 */
export const jams = pgTable(
  'jams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hostId: uuid('host_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Six letters and digits, for joining from outside the friend list. */
    code: text('code').notNull().unique(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    /** Set when the host ends it early. */
    endedAt: ts('ended_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('jams_ends_idx').on(t.endsAt)],
);

/** A study group: friends who keep each other company week after week. Anyone with the code joins. */
export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  hostId: uuid('host_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index('group_members_user_idx').on(t.userId),
  ],
);

/** A nudge to study, friend to friend, at most one every two hours per pair. Shown on the dashboard. */
export const nudges = pgTable(
  'nudges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromId: uuid('from_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toId: uuid('to_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The group it was sent from, when it was. */
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'set null' }),
    at: ts('at').notNull().defaultNow(),
    seenAt: ts('seen_at'),
  },
  (t) => [index('nudges_to_idx').on(t.toId, t.at), index('nudges_pair_idx').on(t.fromId, t.toId)],
);

export const jamMembers = pgTable(
  'jam_members',
  {
    jamId: uuid('jam_id')
      .notNull()
      .references(() => jams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.jamId, t.userId] }), index('jam_members_user_idx').on(t.userId)],
);

/** User-defined rewards, bought with XP or opened by finishing a task. */
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
    /** 'task' rewards cost no XP: they open once the linked task or test is finished. */
    unlock: text('unlock', { enum: ['xp', 'task'] })
      .notNull()
      .default('xp'),
    unlockNodeId: uuid('unlock_node_id').references(() => nodes.id, { onDelete: 'set null' }),
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

export const outlookCalendar = pgTable('outlook_calendar', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  revokedAt: ts('revoked_at'),
  connectedAt: ts('connected_at').notNull().defaultNow(),
  lastSyncAt: ts('last_sync_at'),
});

/**
 * A calendar added by its link (the .ics address Google, Outlook, iCloud or a school hands
 * out). Its events are imported like a connected calendar's, with provider 'ics' and the
 * feed's id as the calendar id. The link is a secret (it opens the whole calendar), so it is
 * stored encrypted and never sent back to the portal.
 */
export const calendarFeeds = pgTable(
  'calendar_feeds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    urlEnc: text('url_enc').notNull(),
    /** sha256 of the link, so the same calendar isn't added twice. */
    urlHash: text('url_hash').notNull(),
    /** Shown instead of the link: "calendar.google.com". */
    host: text('host').notNull(),
    /** Turn exams and deadlines in it into tasks, as connected calendars do. */
    tasks: boolean('tasks').notNull().default(true),
    events: integer('events').notNull().default(0),
    lastSyncAt: ts('last_sync_at'),
    /** Last time it was read, whether or not that worked; paces the background refresh. */
    checkedAt: ts('checked_at'),
    /** Why the last refresh failed, in words for the settings page; null when it worked. */
    lastError: text('last_error'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('calendar_feeds_user_url_idx').on(t.userId, t.urlHash)],
);

/** Provider identity and the last imported values keep resyncs idempotent and preserve edits. */
export const calendarImports = pgTable(
  'calendar_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['google', 'outlook', 'ics'] }).notNull(),
    calendarId: text('calendar_id').notNull(),
    eventId: text('event_id').notNull(),
    nodeId: uuid('node_id').references(() => nodes.id, { onDelete: 'set null' }),
    blockId: uuid('block_id').references(() => plannedBlocks.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    dueAt: ts('due_at'),
    startAt: ts('start_at').notNull(),
    endAt: ts('end_at').notNull(),
    ownsNode: boolean('owns_node').notNull().default(false),
    cancelled: boolean('cancelled').notNull().default(false),
  },
  (t) => [
    uniqueIndex('calendar_imports_identity_idx').on(t.userId, t.provider, t.calendarId, t.eventId),
  ],
);

/** A user-defined thing to count daily, rendered as its own contribution grid. */
export const trackers = pgTable(
  'trackers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    unitLabel: text('unit_label').notNull(),
    dailyGoal: real('daily_goal'),
    color: text('color'),
    sortOrder: real('sort_order').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('trackers_user_idx').on(t.userId)],
);

/** One day's amount for one tracker. The unique index makes logging idempotent per day. */
export const trackerEntries = pgTable(
  'tracker_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    trackerId: uuid('tracker_id')
      .notNull()
      .references(() => trackers.id, { onDelete: 'cascade' }),
    /** Calendar day in the user's timezone, YYYY-MM-DD. */
    date: text('date').notNull(),
    amount: real('amount').notNull(),
    note: text('note'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('tracker_entries_user_idx').on(t.userId),
    uniqueIndex('tracker_entries_day_idx').on(t.trackerId, t.date),
  ],
);

/** One weighted piece of a course's grade. */
export const gradeComponents = pgTable(
  'grade_components',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    weight: real('weight').notNull(),
    score: real('score'),
    sortOrder: real('sort_order').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('grade_components_user_idx').on(t.userId),
    index('grade_components_node_idx').on(t.nodeId),
  ],
);

/**
 * A study plan: something to learn that is not a course. The plan is a node and its
 * topics are the node's children, so sessions and pace work as they do for courses.
 * This row holds what a course lacks: a weekly budget and how topics are worked.
 */
export const studyPlans = pgTable(
  'study_plans',
  {
    nodeId: uuid('node_id')
      .primaryKey()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    weeklyMinutes: integer('weekly_minutes').notNull(),
    /** Local date the plan began. */
    startedOn: text('started_on').notNull(),
    method: text('method'),
    masteryTarget: real('mastery_target').notNull().default(0.85),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('study_plans_user_idx').on(t.userId)],
);

/** What a plan's topic carries beyond its node: where the material is, and whether it is drilled. */
export const planTopics = pgTable(
  'plan_topics',
  {
    nodeId: uuid('node_id')
      .primaryKey()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => studyPlans.nodeId, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    resource: text('resource'),
    practice: boolean('practice').notNull().default(false),
  },
  (t) => [index('plan_topics_plan_idx').on(t.planId)],
);

/** One drilling pass over a topic: counts of right, shaky and missed. */
export const drillRounds = pgTable(
  'drill_rounds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    /** Local date of the round. */
    date: text('date').notNull(),
    ok: integer('ok').notNull().default(0),
    shaky: integer('shaky').notNull().default(0),
    miss: integer('miss').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('drill_rounds_node_idx').on(t.nodeId), index('drill_rounds_user_idx').on(t.userId)],
);

/** A missed or shaky question, queued to come back (a small Leitner box). */
export const drillItems = pgTable(
  'drill_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    lastResult: text('last_result', { enum: ['ok', 'shaky', 'miss'] }).notNull(),
    dueOn: text('due_on').notNull(),
    box: integer('box').notNull().default(0),
    attempts: integer('attempts').notNull().default(1),
    retired: boolean('retired').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('drill_items_node_idx').on(t.nodeId), index('drill_items_user_idx').on(t.userId)],
);

export const schema = {
  emailCodes,
  emailRateLimits,
  socialProfiles,
  users,
  blockedEmails,
  passwordAccounts,
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
  outlookCalendar,
  calendarImports,
  calendarFeeds,
  streakEvents,
  userAssets,
  posts,
  postMedia,
  postLikes,
  postComments,
  friendships,
  jams,
  jamMembers,
  groups,
  groupMembers,
  nudges,
  universityVerifications,
  customRewards,
  routines,
  routineCompletions,
  trackers,
  trackerEntries,
  gradeComponents,
  studyPlans,
  planTopics,
  drillRounds,
  drillItems,
};

export type UserRow = typeof users.$inferSelect;
export type NodeRow = typeof nodes.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type PlannedBlockRow = typeof plannedBlocks.$inferSelect;
export type RestDayPolicyRow = typeof restDayPolicies.$inferSelect;
export type CustomRewardRow = typeof customRewards.$inferSelect;
export type RoutineRow = typeof routines.$inferSelect;
export type RoutineCompletionRow = typeof routineCompletions.$inferSelect;
export type TrackerRow = typeof trackers.$inferSelect;
export type TrackerEntryRow = typeof trackerEntries.$inferSelect;
export type GradeComponentRow = typeof gradeComponents.$inferSelect;
export type StudyPlanRow = typeof studyPlans.$inferSelect;
export type PlanTopicRow = typeof planTopics.$inferSelect;
export type DrillRoundRow = typeof drillRounds.$inferSelect;
export type DrillItemRow = typeof drillItems.$inferSelect;
