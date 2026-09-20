import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  achievements,
  estimateChanges,
  nodes,
  plannedBlocks,
  quotesSeen,
  sessions,
  weeklyReviews,
  xpTransactions,
  type UserRow,
} from '../db/schema';
import { iso, toNode, toPlannedBlock, toSession } from './sessions-mapper';
import { getPolicy, toUser } from './users';

/** Everything the user owns, as plain JSON. Secrets (ics token, Google tokens) are excluded. */
export async function exportUserData(db: Db, user: UserRow) {
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
    quotesSeen: q,
  };
}
