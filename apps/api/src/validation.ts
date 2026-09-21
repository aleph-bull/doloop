import { CUSTOM_BACKGROUND_UPLOAD, POMODORO_LIMITS } from '@doloop/core';
import { z } from 'zod';

export const isoDateTime = z.iso.datetime({ offset: true });
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const uuid = z.uuid();

export const nodeKind = z.enum(['course', 'assessment', 'task', 'other']);
export const countUnit = z.enum(['problems', 'pages', 'cards', 'custom']);

export const createNodeSchema = z.object({
  parentId: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(200),
  kind: nodeKind.default('task'),
  estimatedMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  dueAt: isoDateTime.nullable().optional(),
  sortOrder: z.number().optional(),
  color: z.string().max(32).nullable().optional(),
  countUnit: countUnit.nullable().optional(),
  countUnitLabel: z.string().max(40).nullable().optional(),
});

export const updateNodeSchema = createNodeSchema
  .partial()
  .extend({
    completedAt: isoDateTime.nullable().optional(),
    archived: z.boolean().optional(),
    outcomeRating: z.number().int().min(1).max(5).nullable().optional(),
  })
  .strict();

export const sessionMode = z.enum(['pomodoro', 'unlimited', 'scheduled']);

export const startSessionSchema = z.object({
  nodeId: uuid,
  mode: sessionMode,
  plannedEndAt: isoDateTime.nullable().optional(),
  showTimer: z.boolean().optional(),
});

export const timerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
  z.object({ type: z.literal('skip-break') }),
  z.object({ type: z.literal('idle-start'), idleSince: isoDateTime }),
  z.object({ type: z.literal('idle-answer'), stillStudying: z.boolean() }),
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
  extraMinutesAdded: z.number().int().min(0).max(100_000).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export const endSessionSchema = z.object({
  review: reviewSchema.nullable().optional(),
  markComplete: z.boolean().optional(),
});

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

export const settingsSchema = z
  .object({
    pomodoro: pomodoro.partial(),
    review: z.object({ mode: z.enum(['quick', 'full', 'off']) }).partial(),
    idle: z
      .object({ enabled: z.boolean(), thresholdMin: z.number().int().min(1).max(120) })
      .partial(),
    streak: z.object({ minMinutes: z.number().int().min(1).max(240) }).partial(),
    pace: z.object({ maxComfortableMinutesPerDay: z.number().int().min(15).max(1440) }).partial(),
    sounds: z
      .object({
        enabled: z.boolean(),
        endOfInterval: z.boolean(),
        endOfBlock: z.boolean(),
        volume: z.number().min(0).max(1),
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
    quote: z.object({ mode: z.enum(['quotes', 'research-tips', 'both', 'off']) }).partial(),
    theme: z
      .object({
        mode: z.enum(['system', 'light', 'dark']),
        accent: z.string().max(32),
        backgroundId: z.string().max(32),
        // Only the uploaded image (or none). Remote URLs are deliberately not accepted.
        customBackgroundUrl: z.literal(CUSTOM_BACKGROUND_UPLOAD).nullable(),
        panel: z.enum(['opaque', 'glass', 'custom']),
        panelColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        panelAlpha: z.number().min(0.2).max(1),
        extensionBackground: z.string().max(32),
      })
      .partial(),
    visualizer: z
      .object({
        enabled: z.boolean(),
        intensity: z.number().min(0).max(1),
        opacity: z.number().min(0).max(1),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
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
      })
      .partial(),
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
