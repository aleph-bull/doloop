import {
  computePace,
  getDailyPlan,
  type NodePace,
  type PaceContext,
  type PlanItem,
  type Session,
  type StudyNode,
} from '@komogon/core';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions, type UserRow } from '../db/schema';
import { listNodes } from './nodes';
import { toSession } from './sessions-mapper';
import { getPolicy, settingsOf } from './users';

export interface PaceSnapshot {
  nodes: StudyNode[];
  sessions: Session[];
  ctx: PaceContext;
  pace: Map<string, NodePace>;
}

export async function loadCompletedSessions(db: Db, userId: string): Promise<Session[]> {
  const rows = await db.query.sessions.findMany({
    where: and(eq(sessions.userId, userId), isNotNull(sessions.endedAt)),
    orderBy: (s, { asc }) => [asc(s.startedAt)],
  });
  return rows.map(toSession);
}

export async function paceContext(db: Db, user: UserRow, now: string): Promise<PaceContext> {
  const settings = settingsOf(user);
  return {
    now,
    timezone: user.timezone,
    policy: await getPolicy(db, user.id),
    maxComfortableMinutesPerDay: settings.pace.maxComfortableMinutesPerDay,
  };
}

export async function paceSnapshot(db: Db, user: UserRow, now: string): Promise<PaceSnapshot> {
  const [nodes, sess, ctx] = await Promise.all([
    listNodes(db, user.id),
    loadCompletedSessions(db, user.id),
    paceContext(db, user, now),
  ]);
  return { nodes, sessions: sess, ctx, pace: computePace(nodes, sess, ctx) };
}

export async function dailyPlan(db: Db, user: UserRow, now: string): Promise<PlanItem[]> {
  const snap = await paceSnapshot(db, user, now);
  return getDailyPlan(snap.nodes, snap.sessions, snap.ctx);
}

export function paceToJson(pace: Map<string, NodePace>): Record<string, NodePace> {
  return Object.fromEntries(pace);
}
