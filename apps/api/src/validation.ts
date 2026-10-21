import {
  BASS_HZ_LIMITS,
  CUSTOM_ACCENT,
  CUSTOM_BACKGROUND_UPLOAD,
  POMODORO_LIMITS,
  REWARDS,
  SOUND_PRESETS,
  STREAK_DAY_START,
} from '@komogon/core';
import { z } from 'zod';

export const isoDateTime = z.iso.datetime({ offset: true });
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const uuid = z.uuid();

export const nodeKind = z.enum(['course', 'assessment', 'task', 'other']);
export const countUnit = z.enum(['problems', 'pages', 'cards', 'custom']);

/** Defaults for the items under a node. Every field optional: only what is set is a default. */
export const nodeTemplateSchema = z
  .object({
    kind: nodeKind.nullable().default(null),
    estimatedMinutes: z.number().int().min(0).max(100_000).nullable().default(null),
    dueTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/, 'HH:MM')
      .nullable()
      .default(null),
    countUnit: countUnit.nullable().default(null),
    countUnitLabel: z.string().max(40).nullable().default(null),
    color: z.string().max(32).nullable().default(null),
  })
  .strict();

/**
 * The editable fields of a node, with no defaults on them. `kind` picks up its default in
 * `createNodeSchema` only: a default here would survive `.partial()` and make every patch
 * that leaves `kind` out silently rewrite the node to a task.
 */
const nodeFields = z.object({
  parentId: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(200),
  kind: nodeKind,
  estimatedMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  dueAt: isoDateTime.nullable().optional(),
  sortOrder: z.number().optional(),
  color: z.string().max(32).nullable().optional(),
  countUnit: countUnit.nullable().optional(),
  countUnitLabel: z.string().max(40).nullable().optional(),
  /** Courses only: how the grade is arrived at, and the mark when it is a single number. */
  gradeMode: z.enum(['off', 'overall', 'components']).nullable().optional(),
  gradeOverall: z.number().min(0).max(1000).nullable().optional(),
  gradeCredits: z.number().min(0).max(100).nullable().optional(),
  /** The template for items added under this node; null clears it. */
  childDefaults: nodeTemplateSchema.nullable().optional(),
});

export const createNodeSchema = nodeFields.extend({ kind: nodeKind.default('task') });

export const updateNodeSchema = nodeFields
  .partial()
  .extend({
    completedAt: isoDateTime.nullable().optional(),
    archived: z.boolean().optional(),
    outcomeRating: z.number().int().min(1).max(5).nullable().optional(),
  })
  .strict();

export const sessionMode = z.enum(['pomodoro', 'unlimited', 'scheduled']);

export const startSessionSchema = z
  .object({
    /** A task session... */
    nodeId: uuid.optional(),
    /** ...or a routine session, for the occurrence on routineDate (default: today). */
    routineId: uuid.optional(),
    routineDate: isoDate.optional(),
    /** ...or neither: a free session, just the timer. */
    mode: sessionMode,
    plannedEndAt: isoDateTime.nullable().optional(),
    showTimer: z.boolean().optional(),
  })
  .refine((v) => v.nodeId === undefined || v.routineId === undefined, {
    message: 'Start a session for a task or a routine, not both',
  });

export const timerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
  z.object({ type: z.literal('skip-break') }),
  z.object({ type: z.literal('extend'), plannedEndAt: isoDateTime }),
  z.object({ type: z.literal('set-timer-visibility'), showTimer: z.boolean() }),
]);

export const reviewSchema = z.object({
  skipped: z.boolean().default(false),
  prepared: z.number().int().min(1).max(5).nullable().optional(),
  distracted: z.enum(['no', 'a-little', 'a-lot']).nullable().optional(),
  completedCount: z.number().int().min(0).max(100_000).nullable().optional(),
  correctCount: z.number().int().min(0).max(100_000).nullable().optional(),
  mood: z.number().int().min(1).max(5).nullable().optional(),
  effort: z.number().int().min(1).max(5).nullable().optional(),
  extraMinutesAdded: z.number().int().min(0).max(100_000).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export const endSessionSchema = z.object({
  review: reviewSchema.nullable().optional(),
  markComplete: z.boolean().optional(),
  /**
   * End the session at this earlier moment instead of now: "I stopped when the computer
   * fell asleep". The time after it comes off focus and breaks at the session's own mix.
   */
  endAt: isoDateTime.optional(),
});

/** Delete focused time from the end of a finished session. */
export const trimSessionSchema = z.object({
  removeFocusMinutes: z.number().int().min(1).max(100_000),
});

/** A sleep the portal noticed: the last tick before it and the first after. */
export const sleepSchema = z.object({ from: isoDateTime, to: isoDateTime });

/** "I kept studying" for the sleep that began at `from`. */
export const keptStudyingSchema = z.object({ from: isoDateTime });

export const plannedBlockSchema = z.object({
  nodeId: uuid.nullable().optional(),
  startAt: isoDateTime,
  endAt: isoDateTime,
});

export const weeklyRestDaysSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).max(7),
});

export const vacationSchema = z.object({
  from: isoDate,
  to: isoDate,
  label: z.string().max(80).default(''),
});

/** Only a preset that actually exists; an unknown id would play nothing. */
const soundPresetId = z.enum(SOUND_PRESETS.map((p) => p.id) as [string, ...string[]]);

const minutes = (k: keyof typeof POMODORO_LIMITS) =>
  z.number().int().min(POMODORO_LIMITS[k].min).max(POMODORO_LIMITS[k].max);

const pomodoro = z.object({
  workMin: minutes('workMin'),
  shortBreakMin: minutes('shortBreakMin'),
  longBreakMin: minutes('longBreakMin'),
  cyclesBeforeLong: minutes('cyclesBeforeLong'),
  autoStartBreaks: z.boolean(),
  autoStartWork: z.boolean(),
  showTimerByDefault: z.boolean(),
});

export const gradeBand = z.object({
  minPercent: z.number().min(0).max(100),
  letter: z.string().trim().min(1).max(8),
  points: z.number().min(0).max(10),
});

export const settingsSchema = z
  .object({
    profile: z
      .object({
        name: z.string().trim().max(60).nullable(),
        // `university` is set only by the verification routes (routes/university.ts);
        // strict, so sending it is an error rather than silently dropped.
        bio: z.string().trim().max(280).nullable(),
      })
      .partial()
      .strict(),
    pomodoro: pomodoro.partial(),
    review: z.object({ mode: z.enum(['quick', 'full', 'off']) }).partial(),
    // dayStartChangedAt is the server's to set; a client can only ask for a new hour.
    streak: z
      .object({
        minMinutes: z.number().int().min(1).max(240),
        dayStartHour: z
          .number()
          .int()
          .min(STREAK_DAY_START.MIN_HOUR)
          .max(STREAK_DAY_START.MAX_HOUR),
      })
      .partial(),
    goals: z.object({ weeklyMinutes: z.number().int().min(30).max(10_080) }).partial(),
    // minCostChangedAt is the server's to set, like the streak's day start.
    rewards: z
      .object({
        minCostXp: z
          .number()
          .int()
          .min(REWARDS.LOWEST_MIN_COST_XP)
          .max(REWARDS.HIGHEST_MIN_COST_XP),
      })
      .partial(),
    pace: z.object({ maxComfortableMinutesPerDay: z.number().int().min(15).max(1440) }).partial(),
    sounds: z
      .object({
        enabled: z.boolean(),
        volume: z.number().min(0).max(1),
        workStart: soundPresetId,
        breakStart: soundPresetId,
        sessionEnd: soundPresetId,
      })
      .partial(),
    effects: z
      .object({
        confetti: z.boolean(),
        badgeToasts: z.boolean(),
        phrases: z.boolean(),
        reducedMotion: z.enum(['system', 'on', 'off']),
      })
      .partial(),
    quote: z
      .object({ mode: z.enum(['quotes', 'research-tips', 'both', 'off']), appTips: z.boolean() })
      .partial(),
    theme: z
      .object({
        mode: z.enum(['system', 'light', 'dark', 'recommended']),
        accent: z.string().max(32),
        backgroundId: z.string().max(32),
        // Only the uploaded image (or none). Remote URLs are deliberately not accepted.
        customBackgroundUrl: z.literal(CUSTOM_BACKGROUND_UPLOAD).nullable(),
        panel: z.enum(['opaque', 'glass', 'custom', 'matte']),
        panelColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        panelAlpha: z.number().min(0.2).max(1),
        extensionBackground: z.string().max(32),
        // A hard ceiling only; the route refuses growing past MAX_SAVED_ACCENTS, so a list saved
        // under an older, higher limit can still be trimmed or reordered.
        savedAccents: z.array(z.string().regex(CUSTOM_ACCENT)).max(16),
      })
      .partial(),
    blocking: z
      .object({
        enabled: z.boolean(),
        domains: z.array(z.string().trim().min(1).max(253)).max(200),
      })
      .partial(),
    calendar: z
      .object({
        syncPlannedBlocks: z.boolean(),
        readBusyTimes: z.boolean(),
        logSessions: z.boolean(),
      })
      .partial(),
    routines: z.object({ missedClearedThrough: isoDate.nullable() }).partial(),
    grading: z
      .object({
        scale: z.array(gradeBand).min(1).max(40),
        goalGpa: z.number().min(0).max(10).nullable(),
        targetPercent: z.number().min(0).max(200).nullable(),
      })
      .partial(),
    visualizer: z
      .object({
        enabled: z.boolean(),
        promptDismissed: z.boolean(),
        intensity: z.number().min(0).max(1),
        opacity: z.number().min(0).max(1),
        colorMode: z.enum(['accent', 'custom', 'gradient']),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        mist: z.boolean(),
        ribbons: z.boolean(),
        shockwave: z.boolean(),
        rings: z.boolean(),
        bars: z.boolean(),
        waveform: z.boolean(),
        mistHeight: z.number().min(0.05).max(1),
        mistDrift: z.number().min(0).max(1),
        mistOpacity: z.number().min(0).max(1),
        waveCount: z.number().int().min(1).max(12),
        waveformPosition: z.number().min(0).max(1),
        barCount: z.number().int().min(4).max(128),
        barHeight: z.number().min(0.05).max(1),
        barGap: z.number().min(0).max(0.9),
        barGlow: z.number().min(0).max(1),
        barReflection: z.boolean(),
        barSymmetric: z.boolean(),
        preset: z.enum(['bass', 'balanced', 'mellow', 'custom']),
        customSensitivity: z.number().min(0).max(1),
        customDrop: z.number().min(0).max(1),
        customSmoothing: z.number().min(0).max(1),
        customMemory: z.number().min(0).max(1),
        customBassLow: z.number().min(BASS_HZ_LIMITS.min).max(BASS_HZ_LIMITS.max),
        customBassHigh: z.number().min(BASS_HZ_LIMITS.min).max(BASS_HZ_LIMITS.max),
        barPosition: z.number().min(0.1).max(1),
        barWidth: z.number().min(0.2).max(1),
        waveTop: z.boolean(),
        waveBottom: z.boolean(),
        waveformMirror: z.boolean(),
        ringCount: z.number().int().min(1).max(6),
        burst: z.boolean(),
        burstRadius: z.number().min(0.1).max(0.5),
        burstReach: z.number().min(0.02).max(0.6),
        burstSpikes: z.number().int().min(16).max(192),
        burstBlob: z.boolean(),
        burstRays: z.boolean(),
        speed: z.number().min(0.25).max(2),
        fadeWhenSilent: z.boolean(),
        barOpacity: z.number().min(0).max(1),
        burstShowSpikes: z.boolean(),
        burstSpikeOpacity: z.number().min(0).max(1),
      })
      .partial(),
    dashboard: z.object({ focusOnly: z.boolean() }).partial(),
    features: z
      .object({
        routines: z.boolean(),
        plans: z.boolean(),
        grades: z.boolean(),
        calendar: z.boolean(),
        social: z.boolean(),
      })
      .partial(),
    nav: z.object({ style: z.enum(['top', 'sidebar']) }).partial(),
    focusScreen: z.object({ openOnStart: z.enum(['ask', 'always', 'never']) }).partial(),
    timelapse: z
      .object({
        record: z.enum(['ask', 'always', 'never']),
        lengthMode: z.enum(['auto', 'length', 'speed']),
        lengthSeconds: z.number().int().min(5).max(600),
        speed: z.number().int().min(10).max(10_000),
        fps: z.number().int().min(1).max(60),
        showTimer: z.boolean(),
        showClockTime: z.boolean(),
        smooth: z.boolean(),
        deflicker: z.boolean(),
        recordBreaks: z.boolean(),
        breakClock: z.enum(['break', 'running']),
      })
      .partial(),
    dismissed: z.array(z.string().trim().min(1).max(64)).max(200),
  })
  .partial()
  .strict();

export const updateMeSchema = z
  .object({
    timezone: z.string().max(64).optional(),
    onboarded: z.boolean().optional(),
  })
  .strict();

export type SettingsPatch = z.infer<typeof settingsSchema>;

export const trackerSchema = z.object({
  title: z.string().trim().min(1).max(60),
  /** Plural noun for one unit: "pages", "problems", "km". */
  unitLabel: z.string().trim().min(1).max(24),
  dailyGoal: z.number().positive().max(1_000_000).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  sortOrder: z.number().optional(),
});

export const updateTrackerSchema = trackerSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();

export const logTrackerSchema = z
  .object({
    amount: z.number().min(-1_000_000).max(1_000_000),
    /** Defaults to today in the user's timezone. */
    date: isoDate.optional(),
    /** 'set' replaces the day's total, 'add' adds to it. */
    mode: z.enum(['set', 'add']).default('set'),
    note: z.string().max(280).nullable().optional(),
  })
  .strict();

export const componentSchema = z.object({
  nodeId: uuid,
  title: z.string().trim().min(1).max(80),
  /** Percent of the final grade. */
  weight: z.number().min(0).max(100),
  /** Percent earned, null while ungraded. */
  score: z.number().min(0).max(1000).nullable().optional(),
  sortOrder: z.number().optional(),
});

export const updateComponentSchema = componentSchema.omit({ nodeId: true }).partial().strict();

/* ---------- study plans ---------- */

const planTopicFields = z.object({
  title: z.string().trim().min(1).max(200),
  plannedMinutes: z.number().int().min(0).max(100_000),
  resource: z.string().trim().max(500).nullable().optional(),
  practice: z.boolean().optional(),
});

export const createPlanSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    weeklyMinutes: z
      .number()
      .int()
      .min(15)
      .max(7 * 24 * 60),
    targetDate: isoDate.nullable().optional(),
    startedOn: isoDate.optional(),
    method: z.string().trim().max(2000).nullable().optional(),
    masteryTarget: z.number().min(0.5).max(1).optional(),
    color: z.string().max(32).nullable().optional(),
    topics: z.array(planTopicFields).min(1).max(100),
    /** A daily top-up (re-drill misses, read the news), made as a routine on the plan. */
    maintenance: z
      .object({
        title: z.string().trim().min(1).max(200),
        minutes: z.number().int().min(1).max(600),
      })
      .nullable()
      .optional(),
  })
  .strict();

export const updatePlanSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    weeklyMinutes: z
      .number()
      .int()
      .min(15)
      .max(7 * 24 * 60),
    targetDate: isoDate.nullable(),
    method: z.string().trim().max(2000).nullable(),
    masteryTarget: z.number().min(0.5).max(1),
  })
  .partial()
  .strict();

export const createTopicSchema = planTopicFields.strict();

export const updateTopicSchema = planTopicFields
  .partial()
  .extend({ sortOrder: z.number().optional(), done: z.boolean().optional() })
  .strict();

export const drillResult = z.enum(['ok', 'shaky', 'miss']);

export const logDrillSchema = z
  .object({
    ok: z.number().int().min(0).max(1000),
    shaky: z.number().int().min(0).max(1000),
    miss: z.number().int().min(0).max(1000),
    /** Missed or shaky questions by name, queued to come back tomorrow. */
    misses: z.array(z.string().trim().min(1).max(300)).max(200).optional(),
    shakies: z.array(z.string().trim().min(1).max(300)).max(200).optional(),
    sessionId: uuid.nullable().optional(),
  })
  .strict()
  .refine(
    (d) => d.ok + d.shaky + d.miss > 0 || (d.misses?.length ?? 0) + (d.shakies?.length ?? 0) > 0,
    {
      message: 'Log at least one answer',
    },
  );

export const drillItemResultSchema = z.object({ result: drillResult }).strict();
