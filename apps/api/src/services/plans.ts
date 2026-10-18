import {
  addDays,
  isDue,
  planPacing,
  planStreak,
  planTopics,
  planWeeks,
  rebalanceOptions,
  roundAccuracy,
  scheduleItem,
  STUDY_PLAN,
  toLocalDate,
  zonedTimeUtc,
  type DrillItem,
  type DrillResult,
  type DrillRound,
  type PlanPacing,
  type PlanTopic,
  type PlanWeek,
  type Routine,
  type StudyPlan,
  type TopicProgress,
} from '@komogon/core';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/client';
import {
  drillItems,
  drillRounds,
  nodes,
  planTopics as planTopicsTable,
  routineCompletions,
  routines,
  sessions,
  studyPlans,
  type DrillItemRow,
  type DrillRoundRow,
  type NodeRow,
  type StudyPlanRow,
  type UserRow,
} from '../db/schema';
import { badRequest, notFound } from '../errors';
import type {
  createPlanSchema,
  createTopicSchema,
  logDrillSchema,
  updatePlanSchema,
  updateTopicSchema,
} from '../validation';
import { createRoutine, listRoutines } from './routines';
import { dt } from './sessions-mapper';

type PlanUser = Pick<UserRow, 'id' | 'timezone'>;

export interface QueuedItem extends DrillItem {
  topicTitle: string;
}

export interface PlanView {
  today: string;
  plan: StudyPlan;
  color: string | null;
  topics: TopicProgress[];
  pacing: PlanPacing;
  rebalance: { raiseWeeklyTo: number | null; moveTargetTo: string | null };
  weeks: PlanWeek[];
  streak: number;
  /** Misses due back today or earlier, oldest first. */
  queue: QueuedItem[];
  /** Queued for a later day. */
  laterCount: number;
  milestones: Array<{ topicId: string; title: string; at: string }>;
  maintenance: Routine | null;
  totals: {
    /** Every minute spent on the plan: topic sessions, sessions on the plan itself, top-ups. */
    minutes: number;
    rounds: number;
    answers: number;
    accuracy: number | null;
    /** Missed questions that came back right enough times to leave the queue. */
    cleared: number;
    days: number;
  };
}

export interface PlanSummary {
  plan: StudyPlan;
  color: string | null;
  pacing: PlanPacing;
  upNext: { id: string; title: string } | null;
  dueItems: number;
  streak: number;
}

function toRound(r: DrillRoundRow): DrillRound {
  return {
    id: r.id,
    topicId: r.nodeId,
    sessionId: r.sessionId,
    date: r.date,
    ok: r.ok,
    shaky: r.shaky,
    miss: r.miss,
    createdAt: r.createdAt.toISOString(),
  };
}

function toItem(r: DrillItemRow): DrillItem {
  return {
    id: r.id,
    topicId: r.nodeId,
    prompt: r.prompt,
    lastResult: r.lastResult,
    dueOn: r.dueOn,
    box: r.box,
    attempts: r.attempts,
    retired: r.retired,
    createdAt: r.createdAt.toISOString(),
  };
}

function toPlan(row: StudyPlanRow, node: NodeRow, tz: string): StudyPlan {
  return {
    id: row.nodeId,
    userId: row.userId,
    title: node.title,
    weeklyMinutes: row.weeklyMinutes,
    startedOn: row.startedOn,
    targetDate: node.dueAt ? toLocalDate(node.dueAt, tz) : null,
    method: row.method,
    masteryTarget: row.masteryTarget,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A target date is the end of that day where the user is, as due dates are elsewhere. */
const targetToDue = (date: string | null | undefined, tz: string) =>
  date ? zonedTimeUtc(date, 23, 59, tz) : null;

async function getPlanRows(db: Db, userId: string, id: string) {
  const plan = await db.query.studyPlans.findFirst({
    where: and(eq(studyPlans.nodeId, id), eq(studyPlans.userId, userId)),
  });
  if (!plan) throw notFound('Plan not found');
  const node = await db.query.nodes.findFirst({ where: eq(nodes.id, id) });
  if (!node) throw notFound('Plan not found');
  return { plan, node };
}

/** The topic's node and the plan it belongs to, checked against the user. */
async function getTopic(db: Db, userId: string, topicId: string) {
  const meta = await db.query.planTopics.findFirst({
    where: and(eq(planTopicsTable.nodeId, topicId), eq(planTopicsTable.userId, userId)),
  });
  if (!meta) throw notFound('Topic not found');
  const node = await db.query.nodes.findFirst({ where: eq(nodes.id, topicId) });
  if (!node) throw notFound('Topic not found');
  return { meta, node };
}

async function loadTopics(
  db: Db,
  planId: string,
): Promise<{ topics: PlanTopic[]; rows: NodeRow[] }> {
  const metas = await db.query.planTopics.findMany({ where: eq(planTopicsTable.planId, planId) });
  if (metas.length === 0) return { topics: [], rows: [] };
  const rows = await db.query.nodes.findMany({
    where: and(
      inArray(
        nodes.id,
        metas.map((m) => m.nodeId),
      ),
      eq(nodes.archived, false),
    ),
  });
  const byId = new Map(metas.map((m) => [m.nodeId, m]));
  const topics = rows.map((n) => {
    const m = byId.get(n.id)!;
    return {
      id: n.id,
      planId,
      title: n.title,
      plannedMinutes: n.estimatedMinutes ?? 0,
      sortOrder: n.sortOrder,
      resource: m.resource,
      practice: m.practice,
      completedAt: n.completedAt ? n.completedAt.toISOString() : null,
    };
  });
  return { topics, rows };
}

export async function planView(db: Db, user: PlanUser, id: string, now: string): Promise<PlanView> {
  const tz = user.timezone;
  const today = toLocalDate(now, tz);
  const { plan: planRow, node } = await getPlanRows(db, user.id, id);
  const plan = toPlan(planRow, node, tz);
  const { topics } = await loadTopics(db, id);
  const topicIds = topics.map((t) => t.id);
  const nodeIds = [id, ...topicIds];

  const sessionRows = await db.query.sessions.findMany({
    where: and(inArray(sessions.nodeId, nodeIds), isNotNull(sessions.endedAt)),
    columns: { nodeId: true, startedAt: true, workSeconds: true },
  });
  const loggedByTopic = new Map<string, number>();
  const minutesByDay = new Map<string, number>();
  const activeDays = new Set<string>();
  for (const s of sessionRows) {
    const m = s.workSeconds / 60;
    if (s.nodeId) loggedByTopic.set(s.nodeId, (loggedByTopic.get(s.nodeId) ?? 0) + m);
    const d = toLocalDate(s.startedAt, tz);
    minutesByDay.set(d, (minutesByDay.get(d) ?? 0) + m);
    if (m >= 1) activeDays.add(d);
  }

  // The daily top-up is a routine on the plan; its ticks count as plan time and plan days.
  const maint = (await listRoutines(db, user.id)).find((r) => r.nodeId === id) ?? null;
  if (maint) {
    const ticks = await db.query.routineCompletions.findMany({
      where: eq(routineCompletions.routineId, maint.id),
    });
    for (const t of ticks) {
      minutesByDay.set(t.date, (minutesByDay.get(t.date) ?? 0) + t.minutes);
      activeDays.add(t.date);
    }
  }

  const rounds = topicIds.length
    ? (await db.query.drillRounds.findMany({ where: inArray(drillRounds.nodeId, topicIds) })).map(
        toRound,
      )
    : [];
  for (const r of rounds) activeDays.add(r.date);
  const items = topicIds.length
    ? (await db.query.drillItems.findMany({ where: inArray(drillItems.nodeId, topicIds) })).map(
        toItem,
      )
    : [];

  const progress = planTopics(topics, loggedByTopic, rounds, items, plan.masteryTarget, today);
  const pacing = planPacing({ plan, topics: progress, minutesByDay, today });
  const titleOf = new Map(topics.map((t) => [t.id, t.title]));
  const open = items.filter((i) => !i.retired);
  const queue = open
    .filter((i) => isDue(i, today))
    .sort((a, b) =>
      a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.createdAt < b.createdAt ? -1 : 1,
    )
    .map((i) => ({ ...i, topicTitle: titleOf.get(i.topicId) ?? '' }));

  const pooled = {
    ok: rounds.reduce((s, r) => s + r.ok, 0),
    shaky: rounds.reduce((s, r) => s + r.shaky, 0),
    miss: rounds.reduce((s, r) => s + r.miss, 0),
  };

  return {
    today,
    plan,
    color: node.color,
    topics: progress,
    pacing,
    rebalance: rebalanceOptions(pacing),
    weeks: planWeeks(plan.startedOn, today, minutesByDay, rounds),
    streak: planStreak(activeDays, today),
    queue,
    laterCount: open.length - queue.length,
    milestones: topics
      .filter((t) => t.completedAt)
      .map((t) => ({ topicId: t.id, title: t.title, at: t.completedAt! }))
      .sort((a, b) => (a.at < b.at ? 1 : -1)),
    maintenance: maint,
    totals: {
      minutes: [...minutesByDay.values()].reduce((s, m) => s + m, 0),
      rounds: rounds.length,
      answers: pooled.ok + pooled.shaky + pooled.miss,
      accuracy: roundAccuracy(pooled),
      cleared: items.filter((i) => i.retired).length,
      days: activeDays.size,
    },
  };
}

export async function listPlans(db: Db, user: PlanUser, now: string): Promise<PlanSummary[]> {
  const rows = await db.query.studyPlans.findMany({
    where: eq(studyPlans.userId, user.id),
    orderBy: [desc(studyPlans.createdAt)],
  });
  const out: PlanSummary[] = [];
  for (const r of rows) {
    const node = await db.query.nodes.findFirst({ where: eq(nodes.id, r.nodeId) });
    if (!node || node.archived) continue;
    const v = await planView(db, user, r.nodeId, now);
    const next = v.topics.find((t) => t.state !== 'mastered');
    out.push({
      plan: v.plan,
      color: v.color,
      pacing: v.pacing,
      upNext: next ? { id: next.topic.id, title: next.topic.title } : null,
      dueItems: v.queue.length,
      streak: v.streak,
    });
  }
  return out;
}

export async function createPlan(
  db: Db,
  user: PlanUser,
  input: z.infer<typeof createPlanSchema>,
  now: string,
): Promise<PlanView> {
  const tz = user.timezone;
  const today = toLocalDate(now, tz);
  const startedOn = input.startedOn ?? today;
  if (input.targetDate && input.targetDate < startedOn) {
    throw badRequest('The target date is before the plan starts');
  }
  // New plans sit at the end of the top level, like any new course.
  const last = await db.query.nodes.findFirst({
    where: eq(nodes.userId, user.id),
    orderBy: (n, { desc: d }) => [d(n.sortOrder)],
    columns: { sortOrder: true },
  });
  const [root] = await db
    .insert(nodes)
    .values({
      userId: user.id,
      parentId: null,
      title: input.title,
      kind: 'course',
      // A plan has no mark: keep it off the Grades page.
      gradeMode: 'off',
      dueAt: targetToDue(input.targetDate, tz),
      color: input.color ?? null,
      sortOrder: (last?.sortOrder ?? 0) + 1,
      updatedAt: dt(now),
    })
    .returning();
  await db.insert(studyPlans).values({
    nodeId: root!.id,
    userId: user.id,
    weeklyMinutes: input.weeklyMinutes,
    startedOn,
    method: input.method ?? null,
    masteryTarget: input.masteryTarget ?? STUDY_PLAN.DEFAULT_MASTERY,
    updatedAt: dt(now),
  });
  for (const [i, t] of input.topics.entries()) {
    await insertTopic(db, user.id, root!.id, t, i + 1, now);
  }
  if (input.maintenance) {
    await createRoutine(
      db,
      user.id,
      {
        title: input.maintenance.title,
        nodeId: root!.id,
        estimatedMinutes: input.maintenance.minutes,
        freq: 'daily',
        startDate: startedOn,
        endDate: input.targetDate ?? null,
      },
      now,
    );
  }
  return planView(db, user, root!.id, now);
}

async function insertTopic(
  db: Db,
  userId: string,
  planId: string,
  t: z.infer<typeof createTopicSchema>,
  sortOrder: number,
  now: string,
) {
  const [n] = await db
    .insert(nodes)
    .values({
      userId,
      parentId: planId,
      title: t.title,
      kind: 'task',
      estimatedMinutes: t.plannedMinutes,
      sortOrder,
      countUnit: t.practice ? 'custom' : null,
      countUnitLabel: t.practice ? 'questions' : null,
      updatedAt: dt(now),
    })
    .returning();
  await db.insert(planTopicsTable).values({
    nodeId: n!.id,
    planId,
    userId,
    resource: t.resource ?? null,
    practice: t.practice ?? false,
  });
  return n!;
}

export async function updatePlan(
  db: Db,
  user: PlanUser,
  id: string,
  patch: z.infer<typeof updatePlanSchema>,
  now: string,
): Promise<PlanView> {
  const { plan } = await getPlanRows(db, user.id, id);
  if (patch.targetDate && patch.targetDate < plan.startedOn) {
    throw badRequest('The target date is before the plan starts');
  }
  const nodePatch: Partial<typeof nodes.$inferInsert> = {};
  if (patch.title !== undefined) nodePatch.title = patch.title;
  if (patch.targetDate !== undefined)
    nodePatch.dueAt = targetToDue(patch.targetDate, user.timezone);
  if (Object.keys(nodePatch).length) {
    await db
      .update(nodes)
      .set({ ...nodePatch, updatedAt: dt(now) })
      .where(eq(nodes.id, id));
  }
  const planPatch: Partial<typeof studyPlans.$inferInsert> = {};
  if (patch.weeklyMinutes !== undefined) planPatch.weeklyMinutes = patch.weeklyMinutes;
  if (patch.method !== undefined) planPatch.method = patch.method;
  if (patch.masteryTarget !== undefined) planPatch.masteryTarget = patch.masteryTarget;
  if (Object.keys(planPatch).length) {
    await db
      .update(studyPlans)
      .set({ ...planPatch, updatedAt: dt(now) })
      .where(eq(studyPlans.nodeId, id));
  }
  return planView(db, user, id, now);
}

/** Deletes the plan, its topics and everything logged on them. */
export async function deletePlan(db: Db, userId: string, id: string): Promise<void> {
  await getPlanRows(db, userId, id);
  const metas = await db.query.planTopics.findMany({ where: eq(planTopicsTable.planId, id) });
  const ids = [...metas.map((m) => m.nodeId), id];
  await db.delete(routines).where(and(eq(routines.userId, userId), eq(routines.nodeId, id)));
  await db.delete(nodes).where(and(eq(nodes.userId, userId), inArray(nodes.id, ids)));
}

export async function addTopic(
  db: Db,
  user: PlanUser,
  planId: string,
  input: z.infer<typeof createTopicSchema>,
  now: string,
): Promise<PlanView> {
  await getPlanRows(db, user.id, planId);
  const { topics } = await loadTopics(db, planId);
  const max = topics.reduce((m, t) => Math.max(m, t.sortOrder), 0);
  await insertTopic(db, user.id, planId, input, max + 1, now);
  return planView(db, user, planId, now);
}

export async function updateTopic(
  db: Db,
  user: PlanUser,
  topicId: string,
  patch: z.infer<typeof updateTopicSchema>,
  now: string,
): Promise<PlanView> {
  const { meta, node } = await getTopic(db, user.id, topicId);
  const nodePatch: Partial<typeof nodes.$inferInsert> = {};
  if (patch.title !== undefined) nodePatch.title = patch.title;
  if (patch.plannedMinutes !== undefined) nodePatch.estimatedMinutes = patch.plannedMinutes;
  if (patch.sortOrder !== undefined) nodePatch.sortOrder = patch.sortOrder;
  if (patch.done !== undefined) {
    nodePatch.completedAt = patch.done ? (node.completedAt ?? dt(now)) : null;
  }
  if (patch.practice !== undefined) {
    nodePatch.countUnit = patch.practice ? 'custom' : null;
    nodePatch.countUnitLabel = patch.practice ? 'questions' : null;
  }
  if (Object.keys(nodePatch).length) {
    await db
      .update(nodes)
      .set({ ...nodePatch, updatedAt: dt(now) })
      .where(eq(nodes.id, topicId));
  }
  const metaPatch: Partial<typeof planTopicsTable.$inferInsert> = {};
  if (patch.resource !== undefined) metaPatch.resource = patch.resource;
  if (patch.practice !== undefined) metaPatch.practice = patch.practice;
  if (Object.keys(metaPatch).length) {
    await db.update(planTopicsTable).set(metaPatch).where(eq(planTopicsTable.nodeId, topicId));
  }
  return planView(db, user, meta.planId, now);
}

export async function deleteTopic(
  db: Db,
  user: PlanUser,
  topicId: string,
  now: string,
): Promise<PlanView> {
  const { meta } = await getTopic(db, user.id, topicId);
  await db.delete(nodes).where(and(eq(nodes.id, topicId), eq(nodes.userId, user.id)));
  return planView(db, user, meta.planId, now);
}

/**
 * Marks a practised topic mastered the moment it meets the bar. Returns the topic when
 * this call is what crossed the line, so the client can celebrate once and only once.
 */
async function settleMastery(db: Db, user: PlanUser, planId: string, topicId: string, now: string) {
  const view = await planView(db, user, planId, now);
  const t = view.topics.find((x) => x.topic.id === topicId);
  if (!t || t.state === 'mastered' || !t.meetsMastery) return { view, mastered: null };
  await db
    .update(nodes)
    .set({ completedAt: dt(now), updatedAt: dt(now) })
    .where(eq(nodes.id, topicId));
  return {
    view: await planView(db, user, planId, now),
    mastered: { id: topicId, title: t.topic.title },
  };
}

export async function logDrill(
  db: Db,
  user: PlanUser,
  topicId: string,
  input: z.infer<typeof logDrillSchema>,
  now: string,
) {
  const { meta } = await getTopic(db, user.id, topicId);
  const today = toLocalDate(now, user.timezone);
  if (input.sessionId) {
    const s = await db.query.sessions.findFirst({
      where: and(eq(sessions.id, input.sessionId), eq(sessions.userId, user.id)),
      columns: { id: true },
    });
    if (!s) throw notFound('Session not found');
  }
  const misses = input.misses ?? [];
  const shakies = input.shakies ?? [];
  // Named misses count even if the tallies were left at zero.
  await db.insert(drillRounds).values({
    userId: user.id,
    nodeId: topicId,
    sessionId: input.sessionId ?? null,
    date: today,
    ok: input.ok,
    shaky: Math.max(input.shaky, shakies.length),
    miss: Math.max(input.miss, misses.length),
    createdAt: dt(now),
  });
  const queued = [
    ...misses.map((prompt) => ({ prompt, result: 'miss' as const })),
    ...shakies.map((prompt) => ({ prompt, result: 'shaky' as const })),
  ];
  if (queued.length) {
    await db.insert(drillItems).values(
      queued.map((q) => ({
        userId: user.id,
        nodeId: topicId,
        prompt: q.prompt,
        lastResult: q.result,
        dueOn: addDays(today, 1),
        box: 0,
        attempts: 1,
        createdAt: dt(now),
        updatedAt: dt(now),
      })),
    );
  }
  // A drill is practice: a topic logged this way is practised from now on.
  if (!meta.practice) {
    await db
      .update(planTopicsTable)
      .set({ practice: true })
      .where(eq(planTopicsTable.nodeId, topicId));
  }
  return settleMastery(db, user, meta.planId, topicId, now);
}

export async function answerItem(
  db: Db,
  user: PlanUser,
  itemId: string,
  result: DrillResult,
  now: string,
) {
  const row = await db.query.drillItems.findFirst({
    where: and(eq(drillItems.id, itemId), eq(drillItems.userId, user.id)),
  });
  if (!row) throw notFound('Item not found');
  const { meta } = await getTopic(db, user.id, row.nodeId);
  const next = scheduleItem(row, result, toLocalDate(now, user.timezone));
  await db
    .update(drillItems)
    .set({ ...next, updatedAt: dt(now) })
    .where(eq(drillItems.id, itemId));
  return settleMastery(db, user, meta.planId, row.nodeId, now);
}

export async function deleteItem(db: Db, user: PlanUser, itemId: string, now: string) {
  const row = await db.query.drillItems.findFirst({
    where: and(eq(drillItems.id, itemId), eq(drillItems.userId, user.id)),
  });
  if (!row) throw notFound('Item not found');
  const { meta } = await getTopic(db, user.id, row.nodeId);
  await db.delete(drillItems).where(eq(drillItems.id, itemId));
  return planView(db, user, meta.planId, now);
}
