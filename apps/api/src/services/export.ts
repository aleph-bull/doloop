import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  achievements,
  customRewards,
  drillItems,
  drillRounds,
  estimateChanges,
  gradeComponents,
  nodes,
  plannedBlocks,
  planTopics,
  quotesSeen,
  routineCompletions,
  routines,
  sessions,
  streakEvents,
  studyPlans,
  trackerEntries,
  trackers,
  weeklyReviews,
  xpTransactions,
  type UserRow,
} from '../db/schema';
import { iso, toNode, toPlannedBlock, toSession } from './sessions-mapper';
import { getPolicy, toUser } from './users';

/**
 * A stored row as exported: the owner column dropped (it is always this user) and dates
 * as ISO strings. Used for the tables without a mapper of their own.
 */
function plain(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'userId') continue;
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

/**
 * Everything the user owns, as plain JSON. Secrets (ics token, Google tokens) are excluded,
 * and so is an uploaded background image, which is a picture rather than information.
 */
export async function exportUserData(db: Db, user: UserRow) {
  const [rt, rc, tr, te, gc, sp, pt, dr, di, cr, se] = await Promise.all([
    db.query.routines.findMany({ where: eq(routines.userId, user.id) }),
    db.query.routineCompletions.findMany({ where: eq(routineCompletions.userId, user.id) }),
    db.query.trackers.findMany({ where: eq(trackers.userId, user.id) }),
    db.query.trackerEntries.findMany({ where: eq(trackerEntries.userId, user.id) }),
    db.query.gradeComponents.findMany({ where: eq(gradeComponents.userId, user.id) }),
    db.query.studyPlans.findMany({ where: eq(studyPlans.userId, user.id) }),
    db.query.planTopics.findMany({ where: eq(planTopics.userId, user.id) }),
    db.query.drillRounds.findMany({ where: eq(drillRounds.userId, user.id) }),
    db.query.drillItems.findMany({ where: eq(drillItems.userId, user.id) }),
    db.query.customRewards.findMany({ where: eq(customRewards.userId, user.id) }),
    db.query.streakEvents.findMany({ where: eq(streakEvents.userId, user.id) }),
  ]);
  const more = {
    routines: rt.map(plain),
    routineCompletions: rc.map(plain),
    trackers: tr.map(plain),
    trackerEntries: te.map(plain),
    gradeComponents: gc.map(plain),
    studyPlans: sp.map(plain),
    planTopics: pt.map(plain),
    drillRounds: dr.map(plain),
    drillItems: di.map(plain),
    rewards: cr.map(plain),
    streakEvents: se.map(plain),
  };
  const [n, s, b, a, x, e, w, q, policy] = await Promise.all([
    db.query.nodes.findMany({ where: eq(nodes.userId, user.id) }),
    db.query.sessions.findMany({ where: eq(sessions.userId, user.id) }),
    db.query.plannedBlocks.findMany({ where: eq(plannedBlocks.userId, user.id) }),
    db.query.achievements.findMany({ where: eq(achievements.userId, user.id) }),
    db.query.xpTransactions.findMany({ where: eq(xpTransactions.userId, user.id) }),
    db.query.estimateChanges.findMany({ where: eq(estimateChanges.userId, user.id) }),
    db.query.weeklyReviews.findMany({ where: eq(weeklyReviews.userId, user.id) }),
    db.query.quotesSeen.findMany({ where: eq(quotesSeen.userId, user.id) }),
    getPolicy(db, user.id),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    user: toUser(user),
    restDays: policy,
    nodes: n.map(toNode),
    sessions: s.map(toSession),
    plannedBlocks: b.map(toPlannedBlock),
    achievements: a.map((r) => ({ key: r.key, unlockedAt: iso(r.unlockedAt) })),
    xpTransactions: x.map((r) => ({ at: iso(r.at), delta: r.delta, kind: r.kind, ref: r.ref })),
    estimateChanges: e.map((r) => ({
      nodeId: r.nodeId,
      at: iso(r.at),
      fromMinutes: r.fromMinutes,
      toMinutes: r.toMinutes,
      source: r.source,
    })),
    weeklyReviews: w.map((r) => ({
      weekStart: r.weekStart,
      note: r.note,
      updatedAt: iso(r.updatedAt),
    })),
    quotesSeen: q.map(plain),
    ...more,
  };
}
