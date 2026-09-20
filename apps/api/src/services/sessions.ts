import {
  advance,
  applyEvent,
  bucketForSession,
  computePace,
  computeSessionXp,
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
} from '@doloop/core';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/client';
import {
  estimateChanges,
  nodes,
  sessions,
  users,
  xpTransactions,
  type SessionRow,
  type UserRow,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../errors';
import type { endSessionSchema, reviewSchema, startSessionSchema } from '../validation';
import { getNodeRow } from './nodes';
import { loadCompletedSessions, paceContext } from './pace';
import { overlapsPlannedBlock } from './planned-blocks';
import { dt, dtn, toNode, toSession } from './sessions-mapper';
import { settingsOf, syncStreak } from './users';
import { unlockNewBadges } from './achievements';

export interface SessionView {
  session: Session;
  timer: TimerState;
  view: TimerView;
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
  const node = await db.query.nodes.findFirst({ where: eq(nodes.id, row.nodeId) });
  return {
    session: toSession(persisted),
    timer: advanced,
    view: viewTimer(advanced, now),
    nodeTitle: node?.title ?? '',
  };
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
  const node = await getNodeRow(db, user.id, input.nodeId);
  if (node.archived) throw badRequest('Cannot study an archived node');
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
  if (input.mode === 'scheduled') {
    if (!input.plannedEndAt) throw badRequest('Scheduled sessions need plannedEndAt');
    if (Date.parse(input.plannedEndAt) <= Date.parse(now))
      throw badRequest('plannedEndAt must be in the future');
  }
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
      nodeId: node.id,
      startedAt: dt(now),
      mode: input.mode,
      pomodoroConfigSnapshot: input.mode === 'pomodoro' ? snapshot : null,
      timer,
      lastSeenAt: dt(now),
      ...derivedColumns(timer),
    })
    .returning();
  return { session: toSession(row!), timer, view: viewTimer(timer, now), nodeTitle: node.title };
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
  const node = await db.query.nodes.findFirst({ where: eq(nodes.id, row.nodeId) });
  return {
    session: toSession(persisted),
    timer: next,
    view: viewTimer(next, now),
    nodeTitle: node?.title ?? '',
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
  phrase: Phrase | null;
  badges: string[];
  confetti: boolean;
  isFirstSessionOnNode: boolean;
}

export async function endSession(
  db: Db,
  user: UserRow,
  id: string,
  input: z.infer<typeof endSessionSchema>,
  now: string,
): Promise<EndSummary> {
  const row = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, id), eq(sessions.userId, user.id)),
  });
  if (!row) throw notFound('Session not found');
  if (row.endedAt) throw conflict('Session already ended');
  const opts = advanceOptions(user, row.pomodoroConfigSnapshot);
  const ended = applyEvent(row.timer, { type: 'end' }, now, opts);
  const persisted = await persistTimer(db, row, ended, now);
  return finalize(db, user, persisted, input, now);
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

/**
 * The end-of-session pipeline: review -> node updates -> pace -> streak -> XP -> phrase.
 * Safe to call once per session; guarded by the caller's endedAt check.
 */
async function finalize(
  db: Db,
  user: UserRow,
  row: SessionRow,
  input: z.infer<typeof endSessionSchema>,
  now: string,
): Promise<EndSummary> {
  const review = normaliseReview(input.review);
  const reviewSubmitted = review !== null && !review.skipped;

  // Review side effects on the node.
  let node = await getNodeRow(db, user.id, row.nodeId);
  if (reviewSubmitted && review.extraMinutesAdded && review.extraMinutesAdded > 0) {
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
  if (input.markComplete && !wasCompleted) {
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
  const statusAfter: PaceStatus = nodePace?.status ?? 'no-estimate';
  const loggedAfter = nodePace?.loggedWorkMinutes ?? 0;
  const sessionsOnNode = completed.filter((s) => s.nodeId === node.id);
  const isFirstSessionOnNode = sessionsOnNode.length === 1;
  // Auto-complete when the estimate is met and the node has no children? No: completion is
  // the user's call. Only the explicit markComplete flag completes a node.

  // Streak (lazy; also picks up today's session).
  const streakSync = await syncStreak(db, user, now);

  // XP.
  const overlaps = await overlapsPlannedBlock(
    db,
    user.id,
    node.id,
    row.startedAt.toISOString(),
    row.endedAt?.toISOString() ?? now,
  );
  const xp = computeSessionXp({
    workMinutes: row.workSeconds / 60,
    reviewSubmitted,
    distracted: review?.distracted ?? null,
    overlapsPlannedBlock: overlaps,
    statusAfter,
    nodeJustCompleted: nodeCompleted,
    loggedWorkMinutesAfter: loggedAfter,
    estimatedMinutes: node.estimatedMinutes,
    streakCurrent: streakSync.streak.current,
  });
  const levelBefore = user.level;
  const xpTotal = user.xp + xp.total;
  const levelAfter = levelForXp(xpTotal);
  await db.update(users).set({ xp: xpTotal, level: levelAfter }).where(eq(users.id, user.id));
  await db
    .insert(xpTransactions)
    .values({ userId: user.id, at: dt(now), delta: xp.total, kind: 'session', ref: row.id });
  user.xp = xpTotal;
  user.level = levelAfter;

  // Phrase.
  const settings = settingsOf(user);
  let phrase: Phrase | null = null;
  if (settings.effects.phrases) {
    const preparedPrev = sessionsOnNode
      .filter((s) => s.id !== row.id && s.review && !s.review.skipped && s.review.prepared !== null)
      .map((s) => s.review!.prepared!);
    const bucket = bucketForSession({
      isAssessment: isUnderAssessment(index, node.id),
      preparedRating: review?.prepared ?? null,
      preparedPrev,
      status: statusAfter,
      isFirstSessionOnNode,
      nodeJustCompleted: nodeCompleted,
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
    (review?.distracted === 'no' ||
      nodeCompleted ||
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
    statusAfter,
    nodeCompleted,
    phrase,
    badges,
    confetti,
    isFirstSessionOnNode,
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
