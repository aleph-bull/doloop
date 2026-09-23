import {
  advance,
  applyEvent,
  bucketForSession,
  computePace,
  computeSessionXp,
  isEndedEarly,
  isUnderAssessment,
  buildIndex,
  levelForXp,
  localHour,
  pickPhrase,
  startTimer,
  viewTimer,
  type AdvanceOptions,
  type PaceStatus,
  type Phrase,
  type Session,
  type SessionReview,
  type SessionXpBreakdown,
  type TimerEvent,
  type TimerState,
  type TimerView,
} from '@komodoit/core';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/client';
import {
  estimateChanges,
  nodes,
  routines,
  sessions,
  users,
  xpTransactions,
  type SessionRow,
  type UserRow,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../errors';
import type { endSessionSchema, reviewSchema, startSessionSchema } from '../validation';
import { getNodeRow } from './nodes';
import { routineForSession, tickFromSession } from './routines';
import { loadCompletedSessions, paceContext } from './pace';
import { logSessionBlock, overlapsPlannedBlock } from './planned-blocks';
import { pushBlockCreated, type CalendarDeps } from './calendar-sync';
import { dt, dtn, toNode, toSession } from './sessions-mapper';
import { settingsOf, syncStreak } from './users';
import { unlockNewBadges } from './achievements';

export interface SessionView {
  session: Session;
  timer: TimerState;
  view: TimerView;
  /** What is being studied: the task's title, or the routine's for a routine session. */
  nodeTitle: string;
}

function advanceOptions(
  user: UserRow,
  snapshot: SessionRow['pomodoroConfigSnapshot'],
): AdvanceOptions {
  const s = settingsOf(user);
  return {
    pomodoro: snapshot ?? s.pomodoro,
    autoStartBreaks: s.pomodoro.autoStartBreaks,
    autoStartWork: s.pomodoro.autoStartWork,
  };
}

function derivedColumns(t: TimerState) {
  return {
    workSeconds: t.workSeconds,
    breakSeconds: t.breakSeconds,
    idleSeconds: t.idleSeconds,
    endedAt: dtn(t.endedAt),
    plannedEndAt: dtn(t.plannedEndAt),
  };
}

async function persistTimer(
  db: Db,
  row: SessionRow,
  timer: TimerState,
  now: string,
): Promise<SessionRow> {
  if (timer === row.timer) return row;
  const [updated] = await db
    .update(sessions)
    .set({ timer, ...derivedColumns(timer), lastSeenAt: dt(now) })
    .where(eq(sessions.id, row.id))
    .returning();
  return updated!;
}

export async function getActiveRow(db: Db, userId: string): Promise<SessionRow | undefined> {
  return db.query.sessions.findFirst({
    where: and(eq(sessions.userId, userId), isNull(sessions.endedAt)),
  });
}

async function view(db: Db, user: UserRow, row: SessionRow, now: string): Promise<SessionView> {
  const opts = advanceOptions(user, row.pomodoroConfigSnapshot);
  const advanced = advance(row.timer, now, opts);
  const persisted = await persistTimer(db, row, advanced, now);
  return {
    session: toSession(persisted),
    timer: advanced,
    view: viewTimer(advanced, now),
    nodeTitle: await subjectTitle(db, row),
  };
}

/** Title of what a session is for: its task, or its routine. */
async function subjectTitle(db: Db, row: SessionRow): Promise<string> {
  if (row.nodeId) {
    const node = await db.query.nodes.findFirst({ where: eq(nodes.id, row.nodeId) });
    return node?.title ?? '';
  }
  if (row.routineId) {
    const routine = await db.query.routines.findFirst({ where: eq(routines.id, row.routineId) });
    return routine?.title ?? '';
  }
  return '';
}

export async function getActive(db: Db, user: UserRow, now: string): Promise<SessionView | null> {
  const row = await getActiveRow(db, user.id);
  if (!row) return null;
  const v = await view(db, user, row, now);
  // A scheduled session may have auto-ended while nobody was looking: finalize it.
  if (v.timer.phase === 'ended') {
    await finalize(
      db,
      user,
      { ...row, timer: v.timer, ...derivedColumns(v.timer) },
      { review: null },
      now,
    );
    return null;
  }
  return v;
}

export async function startSession(
  db: Db,
  user: UserRow,
  input: z.infer<typeof startSessionSchema>,
  now: string,
): Promise<SessionView> {
  // A task, or one occurrence of a routine. The schema guarantees exactly one was given.
  let subject: { nodeId: string | null; routineId: string | null; routineDate: string | null };
  let title: string;
  if (input.routineId) {
    const { routine, date } = await routineForSession(
      db,
      user,
      input.routineId,
      input.routineDate,
      now,
    );
    subject = { nodeId: null, routineId: routine.id, routineDate: date };
    title = routine.title;
  } else {
    const node = await getNodeRow(db, user.id, input.nodeId!);
    if (node.archived) throw badRequest('Cannot study an archived node');
    subject = { nodeId: node.id, routineId: null, routineDate: null };
    title = node.title;
  }
  const active = await getActiveRow(db, user.id);
  if (active) {
    // Finalize a stale auto-ended scheduled session, otherwise refuse.
    const v = await view(db, user, active, now);
    if (v.timer.phase !== 'ended') throw conflict('A session is already running');
    await finalize(
      db,
      user,
      { ...active, timer: v.timer, ...derivedColumns(v.timer) },
      { review: null },
      now,
    );
  }
  if (input.mode === 'scheduled' && !input.plannedEndAt)
    throw badRequest('Scheduled sessions need plannedEndAt');
  // A planned end is optional for a pomodoro and required for a scheduled session, but
  // wherever it is given it has to be in the future.
  if (input.plannedEndAt && Date.parse(input.plannedEndAt) <= Date.parse(now))
    throw badRequest('plannedEndAt must be in the future');
  const settings = settingsOf(user);
  const snapshot = {
    workMin: settings.pomodoro.workMin,
    shortBreakMin: settings.pomodoro.shortBreakMin,
    longBreakMin: settings.pomodoro.longBreakMin,
    cyclesBeforeLong: settings.pomodoro.cyclesBeforeLong,
  };
  const timer = startTimer({
    mode: input.mode,
    now,
    pomodoro: snapshot,
    plannedEndAt: input.plannedEndAt ?? null,
    showTimer: input.showTimer ?? settings.pomodoro.showTimerByDefault,
  });
  const [row] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      ...subject,
      startedAt: dt(now),
      mode: input.mode,
      pomodoroConfigSnapshot: input.mode === 'pomodoro' ? snapshot : null,
      timer,
      lastSeenAt: dt(now),
      ...derivedColumns(timer),
    })
    .returning();
  return { session: toSession(row!), timer, view: viewTimer(timer, now), nodeTitle: title };
}

export async function applySessionEvent(
  db: Db,
  user: UserRow,
  id: string,
  event: TimerEvent,
  now: string,
): Promise<SessionView> {
  const row = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, id), eq(sessions.userId, user.id)),
  });
  if (!row) throw notFound('Session not found');
  if (row.endedAt && event.type !== 'set-timer-visibility') throw conflict('Session already ended');
  const opts = advanceOptions(user, row.pomodoroConfigSnapshot);
  const next = applyEvent(row.timer, event, now, opts);
  const persisted = await persistTimer(db, row, next, now);
  if (next.phase === 'ended' && !row.endedAt) {
    // "Still studying? No" ends the session; finalize with no review.
    await finalize(db, user, persisted, { review: null }, now);
  }
  return {
    session: toSession(persisted),
    timer: next,
    view: viewTimer(next, now),
    nodeTitle: await subjectTitle(db, row),
  };
}

export interface EndSummary {
  session: Session;
  xp: SessionXpBreakdown;
  xpTotal: number;
  levelBefore: number;
  levelAfter: number;
  leveledUp: boolean;
  streak: { current: number; longest: number; message: string | null; milestonesReached: number[] };
  statusAfter: PaceStatus;
  nodeCompleted: boolean;
  /** A routine session whose occurrence was ticked off as it ended. */
  routineTicked: boolean;
  phrase: Phrase | null;
  badges: string[];
  confetti: boolean;
  isFirstSessionOnNode: boolean;
  /** True when the session was cancelled early and earned no XP. */
  endedEarly: boolean;
}

export async function endSession(
  db: Db,
  user: UserRow,
  id: string,
  input: z.infer<typeof endSessionSchema>,
  now: string,
  calendar: CalendarDeps | null = null,
): Promise<EndSummary> {
  const row = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, id), eq(sessions.userId, user.id)),
  });
  if (!row) throw notFound('Session not found');
  if (row.endedAt) throw conflict('Session already ended');
  const opts = advanceOptions(user, row.pomodoroConfigSnapshot);
  const ended = applyEvent(row.timer, { type: 'end' }, now, opts);
  const persisted = await persistTimer(db, row, ended, now);
  return finalize(db, user, persisted, input, now, calendar);
}

function normaliseReview(r: z.infer<typeof reviewSchema> | null | undefined): SessionReview | null {
  if (!r) return null;
  if (r.skipped) {
    return {
      skipped: true,
      prepared: null,
      distracted: null,
      completedCount: null,
      correctCount: null,
      mood: null,
      extraMinutesAdded: null,
      note: null,
    };
  }
  return {
    skipped: false,
    prepared: r.prepared ?? null,
    distracted: r.distracted ?? null,
    completedCount: r.completedCount ?? null,
    correctCount: r.correctCount ?? null,
    mood: r.mood ?? null,
    extraMinutesAdded: r.extraMinutesAdded ?? null,
    note: r.note?.trim() ? r.note.trim() : null,
  };
}

/** What finishing a session did to its task. A routine session has no task. */
interface TaskOutcome {
  statusAfter: PaceStatus;
  loggedAfter: number;
  estimatedMinutes: number | null;
  nodeCompleted: boolean;
  isFirstSessionOnNode: boolean;
  isAssessment: boolean;
  /** Earlier "how prepared" ratings on the same task, oldest first, for the phrase. */
  preparedPrev: number[];
}

const NO_TASK: TaskOutcome = {
  statusAfter: 'no-estimate',
  loggedAfter: 0,
  estimatedMinutes: null,
  nodeCompleted: false,
  isFirstSessionOnNode: false,
  isAssessment: false,
  preparedPrev: [],
};

/** The task half of finalize: review side effects, completion, and pace afterwards. */
async function finishTask(
  db: Db,
  user: UserRow,
  row: SessionRow,
  nodeId: string,
  review: SessionReview | null,
  markComplete: boolean,
  now: string,
): Promise<TaskOutcome> {
  let node = await getNodeRow(db, user.id, nodeId);
  if (review && !review.skipped && review.extraMinutesAdded && review.extraMinutesAdded > 0) {
    const from = node.estimatedMinutes;
    const to = (from ?? 0) + review.extraMinutesAdded;
    await db.insert(estimateChanges).values({
      userId: user.id,
      nodeId: node.id,
      at: dt(now),
      fromMinutes: from,
      toMinutes: to,
      source: 'review',
    });
    node = (
      await db
        .update(nodes)
        .set({ estimatedMinutes: to, updatedAt: dt(now) })
        .where(eq(nodes.id, node.id))
        .returning()
    )[0]!;
  }
  const wasCompleted = node.completedAt !== null;
  let nodeCompleted = false;
  if (markComplete && !wasCompleted) {
    node = (
      await db
        .update(nodes)
        .set({ completedAt: dt(now), updatedAt: dt(now) })
        .where(eq(nodes.id, node.id))
        .returning()
    )[0]!;
    nodeCompleted = true;
  }

  // Pace after this session (the session is already persisted as ended).
  const [allNodes, completed, ctx] = await Promise.all([
    db.query.nodes.findMany({ where: and(eq(nodes.userId, user.id), eq(nodes.archived, false)) }),
    loadCompletedSessions(db, user.id),
    paceContext(db, user, now),
  ]);
  const studyNodes = allNodes.map(toNode);
  const index = buildIndex(studyNodes, completed);
  const pace = computePace(studyNodes, completed, ctx);
  const nodePace = pace.get(node.id);
  const sessionsOnNode = completed.filter((s) => s.nodeId === node.id);
  // Completion is the user's call: only the explicit markComplete flag completes a node,
  // never an estimate that has been met.
  return {
    statusAfter: nodePace?.status ?? 'no-estimate',
    loggedAfter: nodePace?.loggedWorkMinutes ?? 0,
    estimatedMinutes: node.estimatedMinutes,
    nodeCompleted,
    isFirstSessionOnNode: sessionsOnNode.length === 1,
    isAssessment: isUnderAssessment(index, node.id),
    preparedPrev: sessionsOnNode
      .filter((s) => s.id !== row.id && s.review && !s.review.skipped && s.review.prepared !== null)
      .map((s) => s.review!.prepared!),
  };
}

/**
 * The end-of-session pipeline: review -> task or routine -> streak -> XP -> phrase.
 * Safe to call once per session; guarded by the caller's endedAt check.
 */
async function finalize(
  db: Db,
  user: UserRow,
  row: SessionRow,
  input: z.infer<typeof endSessionSchema>,
  now: string,
  calendar: CalendarDeps | null = null,
): Promise<EndSummary> {
  const review = normaliseReview(input.review);
  const reviewSubmitted = review !== null && !review.skipped;

  const task = row.nodeId
    ? await finishTask(db, user, row, row.nodeId, review, input.markComplete ?? false, now)
    : NO_TASK;

  // Streak (lazy; also picks up today's session).
  const streakSync = await syncStreak(db, user, now);

  // XP.
  const overlaps = row.nodeId
    ? await overlapsPlannedBlock(
        db,
        user.id,
        row.nodeId,
        row.startedAt.toISOString(),
        row.endedAt?.toISOString() ?? now,
      )
    : false;
  const endedEarly = isEndedEarly({
    mode: row.timer.mode,
    cycle: row.timer.cycle,
    autoEnded: row.timer.autoEnded,
    endedAt: row.timer.endedAt,
    plannedEndAt: row.timer.plannedEndAt,
  });
  const xp = computeSessionXp({
    endedEarly,
    workMinutes: row.workSeconds / 60,
    reviewSubmitted,
    distracted: review?.distracted ?? null,
    overlapsPlannedBlock: overlaps,
    statusAfter: task.statusAfter,
    nodeJustCompleted: task.nodeCompleted,
    loggedWorkMinutesAfter: task.loggedAfter,
    estimatedMinutes: task.estimatedMinutes,
    streakCurrent: streakSync.streak.current,
  });

  // A routine session ticks its occurrence off when the user says it got done.
  let routineTicked = false;
  let tickXp = 0;
  if (row.routineId && row.routineDate && input.markComplete) {
    const tick = await tickFromSession(
      db,
      user,
      row.routineId,
      row.routineDate,
      { minutes: Math.round(row.workSeconds / 60), sessionXp: xp.total },
      now,
    );
    routineTicked = tick.ticked;
    tickXp = tick.xpAwarded;
  }

  const levelBefore = user.level;
  const xpTotal = user.xp + xp.total + tickXp;
  const levelAfter = levelForXp(xpTotal);
  await db.update(users).set({ xp: xpTotal, level: levelAfter }).where(eq(users.id, user.id));
  await db
    .insert(xpTransactions)
    .values({ userId: user.id, at: dt(now), delta: xp.total, kind: 'session', ref: row.id });
  user.xp = xpTotal;
  user.level = levelAfter;

  const settings = settingsOf(user);

  // Put the session on the calendar as what it was: study that happened. Best effort -
  // a calendar that will not take it must never cost the user the session or its XP.
  if (settings.calendar.logSessions) {
    try {
      const block = await logSessionBlock(
        db,
        user.id,
        {
          id: row.id,
          nodeId: row.nodeId,
          // A routine has no node to name the block after, so the block carries the title.
          title: row.routineId ? await subjectTitle(db, row) : null,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
        },
        now,
      );
      if (block && settings.calendar.syncPlannedBlocks) {
        await pushBlockCreated(db, calendar, block);
      }
    } catch {
      /* the calendar is a record of the session, never a condition of it */
    }
  }

  // Phrase.
  let phrase: Phrase | null = null;
  if (settings.effects.phrases) {
    const bucket = bucketForSession({
      isAssessment: task.isAssessment,
      preparedRating: review?.prepared ?? null,
      preparedPrev: task.preparedPrev,
      status: task.statusAfter,
      isFirstSessionOnNode: task.isFirstSessionOnNode,
      nodeJustCompleted: task.nodeCompleted,
      distracted: review?.distracted ?? null,
      streakAfter: streakSync.streak.current,
      localHour: localHour(now, user.timezone),
    });
    phrase = pickPhrase({ bucket, seed: row.id, lastPhraseId: user.lastPhraseId });
    await db.update(users).set({ lastPhraseId: phrase.id }).where(eq(users.id, user.id));
  }

  const [saved] = await db
    .update(sessions)
    .set({ review, xpAwarded: xp.total, phraseId: phrase?.id ?? null })
    .where(eq(sessions.id, row.id))
    .returning();
  const badges = await unlockNewBadges(db, user, now, row.id);

  const confetti =
    settings.effects.confetti &&
    !endedEarly &&
    (review?.distracted === 'no' ||
      task.nodeCompleted ||
      routineTicked ||
      levelAfter > levelBefore ||
      streakSync.milestonesReached.length > 0);

  return {
    session: toSession(saved!),
    xp,
    xpTotal,
    levelBefore,
    levelAfter,
    leveledUp: levelAfter > levelBefore,
    streak: {
      current: streakSync.streak.current,
      longest: streakSync.streak.longest,
      message: streakSync.message,
      milestonesReached: streakSync.milestonesReached,
    },
    statusAfter: task.statusAfter,
    nodeCompleted: task.nodeCompleted,
    routineTicked,
    phrase,
    badges,
    confetti,
    isFirstSessionOnNode: task.isFirstSessionOnNode,
    endedEarly,
  };
}

export async function listSessions(
  db: Db,
  userId: string,
  opts: { nodeId?: string; from?: string; to?: string; limit?: number } = {},
): Promise<Session[]> {
  const conds = [eq(sessions.userId, userId)];
  if (opts.nodeId) conds.push(eq(sessions.nodeId, opts.nodeId));
  const rows = await db.query.sessions.findMany({
    where: and(...conds),
    orderBy: [desc(sessions.startedAt)],
    limit: Math.min(opts.limit ?? 200, 1000),
  });
  return rows
    .map(toSession)
    .filter(
      (s) => (!opts.from || s.startedAt >= opts.from) && (!opts.to || s.startedAt <= opts.to),
    );
}

export async function getSession(db: Db, userId: string, id: string): Promise<Session> {
  const row = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, id), eq(sessions.userId, userId)),
  });
  if (!row) throw notFound('Session not found');
  return toSession(row);
}
