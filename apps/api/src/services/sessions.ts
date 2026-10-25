import {
  advance,
  applyEvent,
  bucketForSession,
  computePace,
  computeSessionXp,
  estimateAfterMoreTime,
  isEndedEarly,
  isUnderAssessment,
  buildIndex,
  localHour,
  answerSleep,
  logSleep,
  trimByWall,
  trimFocus,
  normalizeTimer,
  pickPhrase,
  startTimer,
  streakDay,
  viewTimer,
  weekStreakNumbers,
  type AdvanceOptions,
  type PaceStatus,
  type Phrase,
  type Session,
  type SessionReview,
  type SessionXpBreakdown,
  type TimerEvent,
  type TimerState,
  type TimerView,
} from '@komogon/core';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
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
import { badRequest, conflict, isUniqueViolation, notFound } from '../errors';
import type {
  endSessionSchema,
  reviewSchema,
  sleepSchema,
  startSessionSchema,
} from '../validation';
import { cascadeCompletion, getNodeRow } from './nodes';
import { routineForSession, tickFromSession } from './routines';
import { loadCompletedSessions, paceContext, paceSnapshot } from './pace';
import { logSessionBlock, overlapsPlannedBlock } from './planned-blocks';
import { pushBlockCreated, pushBlockUpdated, type CalendarDeps } from './calendar-sync';
import { dt, dtn, toNode, toSession } from './sessions-mapper';
import { addXp, rewindStreak, settingsOf, syncStreak } from './users';
import { revokeLapsedBadges, unlockNewBadges } from './achievements';

export interface SessionView {
  session: Session;
  timer: TimerState;
  view: TimerView;
  /**
   * What is being studied: the task's title, the routine's for a routine session, or
   * `FREE_SESSION_TITLE` for a session started with nothing picked.
   */
  nodeTitle: string;
}

/** What a session with no task and no routine is called. */
export const FREE_SESSION_TITLE = 'Free session';

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

/** How often a running session that is being watched refreshes its last_seen_at. */
const SEEN_EVERY_MS = 60_000;

/**
 * Save the timer. The write that ends a session only lands if no other request ended it
 * first, and `claimed` says whether this one did: only the claimant finalizes, so a
 * session ended from two places at once (the portal and the extension polling the same
 * auto-end, or a double-click on End) pays its XP once.
 */
async function persistTimer(
  db: Db,
  row: SessionRow,
  timer: TimerState,
  now: string,
): Promise<{ row: SessionRow; claimed: boolean }> {
  if (timer === row.timer) return { row, claimed: false };
  const ending = !row.endedAt && timer.endedAt !== null;
  const [updated] = await db
    .update(sessions)
    .set({ timer, ...derivedColumns(timer), lastSeenAt: dt(now) })
    .where(
      ending ? and(eq(sessions.id, row.id), isNull(sessions.endedAt)) : eq(sessions.id, row.id),
    )
    .returning();
  if (updated) return { row: updated, claimed: ending };
  // Another request ended it first: carry on with what that one saved.
  const saved = await db.query.sessions.findFirst({ where: eq(sessions.id, row.id) });
  return { row: saved ?? row, claimed: false };
}

export async function getActiveRow(db: Db, userId: string): Promise<SessionRow | undefined> {
  return db.query.sessions.findFirst({
    where: and(eq(sessions.userId, userId), isNull(sessions.endedAt)),
  });
}

/**
 * The session as it stands now. A scheduled session whose end arrived while nobody was
 * looking is finalized here (with no review), by whichever request claims the end.
 */
async function view(db: Db, user: UserRow, row: SessionRow, now: string): Promise<SessionView> {
  const opts = advanceOptions(user, row.pomodoroConfigSnapshot);
  const advanced = advance(normalizeTimer(row.timer), now, opts);
  const { row: persisted, claimed } = await persistTimer(db, row, advanced, now);
  if (claimed) await finalize(db, user, persisted, { review: null }, now);
  // A timer that hasn't changed isn't saved, but someone is still looking at it. Friends see
  // a session as live by `last_seen_at`, so an open-ended session must keep reporting in.
  if (
    persisted === row &&
    !row.endedAt &&
    Date.parse(now) - row.lastSeenAt.getTime() > SEEN_EVERY_MS
  )
    await db
      .update(sessions)
      .set({ lastSeenAt: dt(now) })
      .where(and(eq(sessions.id, row.id), isNull(sessions.endedAt)));
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
  return FREE_SESSION_TITLE;
}

export async function getActive(db: Db, user: UserRow, now: string): Promise<SessionView | null> {
  const row = await getActiveRow(db, user.id);
  if (!row) return null;
  const v = await view(db, user, row, now);
  // A scheduled session may have auto-ended while nobody was looking; view() finalized it.
  return v.timer.phase === 'ended' ? null : v;
}

export async function startSession(
  db: Db,
  user: UserRow,
  input: z.infer<typeof startSessionSchema>,
  now: string,
): Promise<SessionView> {
  // A task, one occurrence of a routine, or nothing at all: a free session is just the
  // timer. The schema guarantees at most one was given.
  let subject: { nodeId: string | null; routineId: string | null; routineDate: string | null } = {
    nodeId: null,
    routineId: null,
    routineDate: null,
  };
  let title = FREE_SESSION_TITLE;
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
  } else if (input.nodeId) {
    const node = await getNodeRow(db, user.id, input.nodeId);
    if (node.archived) throw badRequest('Cannot study an archived node');
    subject = { nodeId: node.id, routineId: null, routineDate: null };
    title = node.title;
  }
  const active = await getActiveRow(db, user.id);
  if (active) {
    // A stale auto-ended scheduled session is finalized by view(); anything else refuses.
    const v = await view(db, user, active, now);
    if (v.timer.phase !== 'ended') throw conflict('A session is already running');
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
    jackSeed: settings.pomodoro.jackMode ? randomUUID() : null,
  });
  let row: SessionRow | undefined;
  try {
    [row] = await db
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
  } catch (err) {
    // Two starts at once (a double click, or the portal and the extension): the one-active
    // index lets one through, and the other gets the same answer as starting over a session.
    if (isUniqueViolation(err)) throw conflict('A session is already running');
    throw err;
  }
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
  const next = applyEvent(normalizeTimer(row.timer), event, now, opts);
  const { row: persisted, claimed } = await persistTimer(db, row, next, now);
  // A planned end arrived while the event was in flight; finalize with no review.
  if (claimed) await finalize(db, user, persisted, { review: null }, now);
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
  streak: {
    current: number;
    longest: number;
    message: string | null;
    milestonesReached: number[];
    weeks: { current: number; longest: number };
  };
  statusAfter: PaceStatus;
  nodeCompleted: boolean;
  /** A routine session whose occurrence was ticked off as it ended. */
  routineTicked: boolean;
  phrase: Phrase | null;
  badges: string[];
  confetti: boolean;
  isFirstSessionOnNode: boolean;
  /** True when the session was cancelled early. It still pays unless `xp.withheld`. */
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
  let ended = applyEvent(normalizeTimer(row.timer), { type: 'end' }, now, opts);
  let current = row;
  if (input.endAt) {
    // "I stopped when the computer fell asleep": end back then, taking the time since off
    // focus and breaks at the session's own mix, and answer the sleep that began there.
    const endAtMs = Date.parse(input.endAt);
    if (endAtMs > Date.parse(now)) throw badRequest('A session cannot end in the future');
    if (endAtMs < row.startedAt.getTime() + 60_000)
      throw badRequest('That is before the session had started');
    const t = trimByWall(
      {
        startedAt: row.startedAt.toISOString(),
        endedAt: ended.endedAt!,
        workSeconds: ended.workSeconds,
        breakSeconds: ended.breakSeconds,
        xpAwarded: 0,
      },
      (Date.parse(ended.endedAt!) - endAtMs) / 1000,
    );
    if (t)
      ended = {
        ...ended,
        endedAt: t.endedAt,
        workSeconds: t.workSeconds,
        breakSeconds: t.breakSeconds,
      };
    const stopped = row.sleeps.find((g) => g.answer === null && Date.parse(g.from) === endAtMs);
    if (stopped) {
      const [updated] = await db
        .update(sessions)
        .set({ sleeps: answerSleep(row.sleeps, stopped.from, 'stopped') })
        .where(eq(sessions.id, row.id))
        .returning();
      current = updated!;
    }
  }
  const { row: persisted, claimed } = await persistTimer(db, current, ended, now);
  // Ended from elsewhere a moment ago (another tab, the extension, a second click).
  if (!claimed) throw conflict('Session already ended');
  return finalize(db, user, persisted, input, now, calendar);
}

/* ---------- deleting time, and the sleeps a session slept through ---------- */

export interface TrimSummary {
  session: Session & { title: string };
  removedFocusSeconds: number;
  removedBreakSeconds: number;
  xpRemoved: number;
  xpTotal: number;
  level: number;
  /** Badges that session earned which no longer hold, and were taken back. */
  badgesRevoked: string[];
}

/**
 * Delete focused time from the end of a finished session. The end moves back with it, the
 * session's XP scales down with its minutes and comes off the user's total, and any badge
 * the session earned that no longer holds is taken back. The calendar's record of the
 * session is shortened to match.
 *
 * The streak is left as it was: a day already counted stays counted.
 */
export async function trimSession(
  db: Db,
  user: UserRow,
  id: string,
  removeFocusMinutes: number,
  now: string,
  calendar: CalendarDeps | null = null,
): Promise<TrimSummary> {
  const row = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, id), eq(sessions.userId, user.id)),
  });
  if (!row) throw notFound('Session not found');
  if (!row.endedAt) throw conflict('Stop the session first, then delete time from it');
  const t = trimFocus(
    {
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt.toISOString(),
      workSeconds: row.workSeconds,
      breakSeconds: row.breakSeconds,
      xpAwarded: row.xpAwarded,
    },
    removeFocusMinutes * 60,
  );
  if (!t) throw badRequest('There is no focused time left to delete from that session');

  const timer = {
    ...row.timer,
    endedAt: t.endedAt,
    workSeconds: t.workSeconds,
    breakSeconds: t.breakSeconds,
  };
  let [saved] = await db
    .update(sessions)
    .set({
      timer,
      workSeconds: t.workSeconds,
      breakSeconds: t.breakSeconds,
      endedAt: dt(t.endedAt),
      xpAwarded: t.xpAwarded,
    })
    .where(eq(sessions.id, row.id))
    .returning();

  // A session that doesn't count has no XP on the total to take back.
  if (t.xpRemoved > 0 && row.counted) {
    const before = user.xp;
    const saved = await addXp(db, user.id, -t.xpRemoved, { withLevel: true });
    await db.insert(xpTransactions).values({
      userId: user.id,
      at: dt(now),
      delta: -Math.min(t.xpRemoved, before),
      kind: 'session',
      ref: row.id,
    });
    user.xp = saved.xp;
    user.level = saved.level;
  }

  // Shorten the calendar's record of it. Best effort, as when it was logged.
  const settings = settingsOf(user);
  if (settings.calendar.logSessions) {
    try {
      const block = await logSessionBlock(
        db,
        user.id,
        {
          id: row.id,
          nodeId: row.nodeId,
          title: row.nodeId ? null : await subjectTitle(db, row),
          startedAt: row.startedAt,
          endedAt: dt(t.endedAt),
        },
        now,
      );
      if (block?.googleEventId && settings.calendar.syncPlannedBlocks)
        await pushBlockUpdated(db, calendar, block);
    } catch {
      /* the calendar is a record of the session, never a condition of it */
    }
  }

  const badgesRevoked = await revokeLapsedBadges(db, user, row.badgesAwarded, now);
  if (badgesRevoked.length > 0) {
    [saved] = await db
      .update(sessions)
      .set({ badgesAwarded: row.badgesAwarded.filter((k) => !badgesRevoked.includes(k)) })
      .where(eq(sessions.id, row.id))
      .returning();
  }

  return {
    session: { ...toSession(saved!), title: await subjectTitle(db, saved!) },
    removedFocusSeconds: t.removedWorkSeconds,
    removedBreakSeconds: t.removedBreakSeconds,
    xpRemoved: t.xpRemoved,
    xpTotal: user.xp,
    level: user.level,
    badgesRevoked,
  };
}

export interface CountSummary {
  session: Session;
  xpTotal: number;
  level: number;
  streak: { current: number; longest: number; weeks: { current: number; longest: number } };
  /** Badges the session earned that no longer hold now it doesn't count, and were taken back. */
  badgesRevoked: string[];
}

/**
 * Stop counting a finished session, or count it again. One that doesn't count stays in the
 * history, but every total of focused time leaves it out, so it gives no hours anywhere, no
 * streak day and no XP: its XP comes off the total, badges it earned that no longer hold
 * are taken back, and the streaks are wound back to before its day and judged again.
 * Counting it again puts all of that back.
 */
export async function setSessionCounted(
  db: Db,
  user: UserRow,
  id: string,
  counted: boolean,
  now: string,
): Promise<CountSummary> {
  const row = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, id), eq(sessions.userId, user.id)),
  });
  if (!row) throw notFound('Session not found');
  if (!row.endedAt) throw conflict('Stop the session first');
  const changed = row.counted !== counted;
  let saved = row;
  let badgesRevoked: string[] = [];

  if (changed) {
    await db.update(sessions).set({ counted }).where(eq(sessions.id, row.id));
    if (row.xpAwarded > 0) {
      const before = user.xp;
      const totals = await addXp(db, user.id, counted ? row.xpAwarded : -row.xpAwarded, {
        withLevel: true,
      });
      await db.insert(xpTransactions).values({
        userId: user.id,
        at: dt(now),
        delta: counted ? row.xpAwarded : -Math.min(row.xpAwarded, before),
        kind: 'session',
        ref: row.id,
      });
      user.xp = totals.xp;
      user.level = totals.level;
    }
    const { dayStartHour } = settingsOf(user).streak;
    await rewindStreak(
      db,
      user,
      streakDay(row.startedAt.toISOString(), user.timezone, dayStartHour),
    );
  }

  const streakSync = await syncStreak(db, user, now);

  if (changed) {
    let badgesAwarded: string[];
    if (counted) {
      const fresh = await unlockNewBadges(db, user, now);
      badgesAwarded = [...new Set([...row.badgesAwarded, ...fresh])];
    } else {
      badgesRevoked = await revokeLapsedBadges(db, user, row.badgesAwarded, now);
      badgesAwarded = row.badgesAwarded.filter((k) => !badgesRevoked.includes(k));
    }
    const [updated] = await db
      .update(sessions)
      .set({ badgesAwarded, streak: streakSync.streak.current })
      .where(eq(sessions.id, row.id))
      .returning();
    saved = updated ?? saved;
  }

  return {
    session: toSession(saved),
    // After any badges taken back or paid again.
    xpTotal: user.xp,
    level: user.level,
    streak: {
      current: streakSync.streak.current,
      longest: streakSync.streak.longest,
      weeks: weekStreakNumbers(streakSync.streak),
    },
    badgesRevoked,
  };
}

async function activeRowById(db: Db, user: UserRow, id: string): Promise<SessionRow> {
  const row = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, id), eq(sessions.userId, user.id)),
  });
  if (!row) throw notFound('Session not found');
  if (row.endedAt) throw conflict('Session already ended');
  return row;
}

/**
 * Log a sleep the portal noticed while the session ran. The session keeps running: the
 * user is asked about it when they are back, and nothing changes until they answer.
 */
export async function recordSleep(
  db: Db,
  user: UserRow,
  id: string,
  gap: z.infer<typeof sleepSchema>,
  now: string,
): Promise<SessionView> {
  const row = await activeRowById(db, user, id);
  const from = Math.max(Date.parse(gap.from), row.startedAt.getTime());
  const to = Math.min(Date.parse(gap.to), Date.parse(now) + 60_000);
  const sleeps = logSleep(row.sleeps, {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
  });
  const [updated] = await db
    .update(sessions)
    .set({ sleeps })
    .where(eq(sessions.id, row.id))
    .returning();
  return view(db, user, updated!, now);
}

/** "I kept studying": the sleep is answered and the session carries on untouched. */
export async function keptStudying(
  db: Db,
  user: UserRow,
  id: string,
  from: string,
  now: string,
): Promise<SessionView> {
  const row = await activeRowById(db, user, id);
  const match = row.sleeps.find((g) => Date.parse(g.from) === Date.parse(from));
  if (!match) throw notFound('No such sleep on this session');
  const [updated] = await db
    .update(sessions)
    .set({ sleeps: answerSleep(row.sleeps, match.from, 'kept') })
    .where(eq(sessions.id, row.id))
    .returning();
  return view(db, user, updated!, now);
}

/**
 * Finished sessions, newest first, each with what it was for, for the history page. Pages
 * by start time: pass the last one's `startedAt` as `before` for the next page.
 */
export async function sessionHistory(
  db: Db,
  userId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<Array<Session & { title: string }>> {
  const conds = [eq(sessions.userId, userId), isNotNull(sessions.endedAt)];
  if (opts.before) conds.push(lt(sessions.startedAt, dt(opts.before)));
  const rows = await db.query.sessions.findMany({
    where: and(...conds),
    orderBy: [desc(sessions.startedAt)],
    limit: Math.min(opts.limit ?? 30, 200),
  });
  const nodeIds = [...new Set(rows.map((r) => r.nodeId).filter((x): x is string => !!x))];
  const routineIds = [...new Set(rows.map((r) => r.routineId).filter((x): x is string => !!x))];
  const [nodeRows, routineRows] = await Promise.all([
    nodeIds.length
      ? db.query.nodes.findMany({ where: inArray(nodes.id, nodeIds) })
      : Promise.resolve([]),
    routineIds.length
      ? db.query.routines.findMany({ where: inArray(routines.id, routineIds) })
      : Promise.resolve([]),
  ]);
  const nodeTitle = new Map(nodeRows.map((n) => [n.id, n.title]));
  const routineTitle = new Map(routineRows.map((r) => [r.id, r.title]));
  return rows.map((r) => ({
    ...toSession(r),
    title: r.nodeId
      ? (nodeTitle.get(r.nodeId) ?? 'A deleted task')
      : r.routineId
        ? (routineTitle.get(r.routineId) ?? 'A deleted routine')
        : FREE_SESSION_TITLE,
  }));
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
      effort: null,
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
    effort: r.effort ?? null,
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
    // Time studied on it so far (with everything under it), this session included, so the
    // extra time goes on from where the user is when there's no estimate or it's passed.
    const logged = (await paceSnapshot(db, user, now)).pace.get(node.id)?.loggedWorkMinutes ?? 0;
    const to = estimateAfterMoreTime(from, logged, review.extraMinutesAdded);
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
    await cascadeCompletion(db, user.id, node.id, null, node.completedAt, now);
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

  // Streak (lazy; also picks up today's session). What it was before is kept on the
  // session, so not counting the session can wind it back.
  const streakBefore = user.streak;
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
  // A routine session ticks its occurrence off when the user says it got done.
  const routineDone = !!(row.routineId && row.routineDate && input.markComplete);
  const xp = computeSessionXp({
    endedEarly,
    workMinutes: row.workSeconds / 60,
    reviewSubmitted,
    distracted: review?.distracted ?? null,
    overlapsPlannedBlock: overlaps,
    statusAfter: task.statusAfter,
    nodeJustCompleted: task.nodeCompleted,
    // Finished is finished, early or not: a ticked routine pays like a completed task.
    subjectCompleted: task.nodeCompleted || routineDone,
    loggedWorkMinutesAfter: task.loggedAfter,
    estimatedMinutes: task.estimatedMinutes,
    streakCurrent: streakSync.streak.current,
  });

  let routineTicked = false;
  let tickXp = 0;
  if (routineDone) {
    const tick = await tickFromSession(
      db,
      user,
      row.routineId!,
      row.routineDate!,
      { minutes: Math.round(row.workSeconds / 60), sessionXp: xp.total },
      now,
    );
    routineTicked = tick.ticked;
    tickXp = tick.xpAwarded;
  }

  const levelBefore = user.level;
  const totals = await addXp(db, user.id, xp.total + tickXp, { withLevel: true });
  const xpTotal = totals.xp;
  const levelAfter = totals.level;
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
          // Without a node to name the block after, the block carries the title itself.
          title: row.nodeId ? null : await subjectTitle(db, row),
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
    .set({
      review,
      xpAwarded: xp.total,
      phraseId: phrase?.id ?? null,
      streak: streakSync.streak.current,
      streakBefore,
    })
    .where(eq(sessions.id, row.id))
    .returning();
  const badges = await unlockNewBadges(db, user, now, row.id);

  const confetti =
    settings.effects.confetti &&
    !xp.withheld &&
    (review?.distracted === 'no' ||
      task.nodeCompleted ||
      routineTicked ||
      levelAfter > levelBefore ||
      streakSync.milestonesReached.length > 0);

  return {
    session: toSession(saved!),
    xp,
    // After any badges this session unlocked were paid.
    xpTotal: user.xp,
    levelBefore,
    levelAfter,
    leveledUp: levelAfter > levelBefore,
    streak: {
      current: streakSync.streak.current,
      longest: streakSync.streak.longest,
      message: streakSync.message,
      milestonesReached: streakSync.milestonesReached,
      weeks: weekStreakNumbers(streakSync.streak),
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
