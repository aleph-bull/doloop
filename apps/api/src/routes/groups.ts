import type { FastifyInstance } from 'fastify';
import { addDays, toLocalDate, withDefaults } from '@komogon/core';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { groupMembers, groups, nodes, nudges, routines, sessions, users } from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { loadPeople, type Person } from '../services/people';
import { dt } from '../services/sessions-mapper';
import { uuid } from '../validation';
import { newJamCode } from './jams';
import { friendIds } from './social';

export const GROUP_NAME_MAX = 40;
/** A session still counts as live this long after the timer last reported in. */
export const LIVE_WINDOW_MS = 10 * 60_000;
/** How long one nudge covers before the same person can be nudged again. */
export const NUDGE_EVERY_MS = 2 * 60 * 60_000;
/** Subjects named on a member's week; the rest fold into "Other". */
export const GROUP_SUBJECTS = 3;

export interface LiveMember {
  userId: string;
  startedAt: string;
  /** The task or routine, by title; null for a free session. */
  subject: string | null;
  /** Where the timer is: a stretch of focus, a break, or paused. */
  state: 'focus' | 'break' | 'paused';
}

export interface LiveResponse {
  /** Friends in a session right now, the one at it longest first. */
  live: LiveMember[];
  people: Record<string, Person>;
}

export interface GroupMemberWeek {
  userId: string;
  minutes: number;
  /** Running total of focused minutes over `days`, one entry per day, ending today. */
  byDay: number[];
  /** The biggest subjects in the window, most first, plus "Other" when there are more. */
  subjects: Array<{ title: string; minutes: number }>;
  /** You may nudge them now (not you, and not nudged in the last two hours). */
  nudgeable: boolean;
}

export interface Group {
  id: string;
  hostId: string;
  name: string;
  /** Members see the code; others get null. */
  code: string | null;
  you: boolean;
  /** The days shown, oldest first, ending today: the last seven, or fewer for a young group. */
  days: string[];
  totalMinutes: number;
  /** Ranked, most minutes first. */
  members: GroupMemberWeek[];
  live: LiveMember[];
}

export interface GroupsResponse {
  groups: Group[];
  /** Friends' groups you could join. */
  open: Group[];
  /** Friends studying right now, whichever group. */
  live: LiveMember[];
  people: Record<string, Person>;
}

type GroupRow = typeof groups.$inferSelect;

/** Who is in a session right now, among these people. */
export async function liveAmong(db: Db, ids: string[], now: Date): Promise<LiveMember[]> {
  if (ids.length === 0) return [];
  const rows = await db.query.sessions.findMany({
    where: and(
      inArray(sessions.userId, ids),
      isNull(sessions.endedAt),
      gte(sessions.lastSeenAt, new Date(now.getTime() - LIVE_WINDOW_MS)),
    ),
  });
  const titles = await subjectTitles(
    db,
    rows.map((r) => r.nodeId),
    rows.map((r) => r.routineId),
  );
  return rows
    .map((r) => ({
      userId: r.userId,
      startedAt: r.startedAt.toISOString(),
      subject:
        (r.nodeId && titles.get(r.nodeId)) || (r.routineId && titles.get(r.routineId)) || null,
      state:
        r.timer.phase === 'paused'
          ? ('paused' as const)
          : r.timer.phase === 'short-break' || r.timer.phase === 'long-break'
            ? ('break' as const)
            : ('focus' as const),
    }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/**
 * Of these friends, the ones who let friends see when they are studying (Settings › Social).
 * Group members see each other regardless: joining a group is the consent.
 */
export async function sharingLive(db: Db, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.query.users.findMany({
    where: inArray(users.id, ids),
    columns: { id: true, settings: true },
  });
  return rows.filter((r) => withDefaults(r.settings).social.live).map((r) => r.id);
}

async function subjectTitles(
  db: Db,
  nodeIds: Array<string | null>,
  routineIds: Array<string | null>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const n = [...new Set(nodeIds.filter((x): x is string => !!x))];
  const r = [...new Set(routineIds.filter((x): x is string => !!x))];
  if (n.length) {
    const rows = await db.query.nodes.findMany({
      where: inArray(nodes.id, n),
      columns: { id: true, title: true },
    });
    for (const row of rows) out.set(row.id, row.title);
  }
  if (r.length) {
    const rows = await db.query.routines.findMany({
      where: inArray(routines.id, r),
      columns: { id: true, title: true },
    });
    for (const row of rows) out.set(row.id, row.title);
  }
  return out;
}

/** A group with this week's numbers, in the viewer's week. */
export async function loadGroup(db: Db, row: GroupRow, viewerId: string, now: Date, tz: string) {
  const memberRows = await db.query.groupMembers.findMany({
    where: eq(groupMembers.groupId, row.id),
  });
  const ids = memberRows.map((m) => m.userId);
  // The last seven days, ending today; a group younger than that starts on its first day.
  const today = toLocalDate(now, tz);
  const born = toLocalDate(row.createdAt, tz);
  const earliest = addDays(today, -6);
  const from = born > earliest ? born : earliest;
  const days: string[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) days.push(d);
  const weekSessions = ids.length
    ? await db.query.sessions.findMany({
        where: and(
          inArray(sessions.userId, ids),
          isNotNull(sessions.endedAt),
          gte(sessions.startedAt, new Date(Date.parse(from) - 2 * 86_400_000)),
          lte(sessions.startedAt, now),
        ),
      })
    : [];
  const titles = await subjectTitles(
    db,
    weekSessions.map((s) => s.nodeId),
    weekSessions.map((s) => s.routineId),
  );
  // Who you nudged in the last two hours: not again yet.
  const recent = await db.query.nudges.findMany({
    where: and(
      eq(nudges.fromId, viewerId),
      gte(nudges.at, new Date(now.getTime() - NUDGE_EVERY_MS)),
    ),
    columns: { toId: true },
  });
  const nudged = new Set(recent.map((n) => n.toId));
  const members: GroupMemberWeek[] = ids.map((userId) => {
    const perDay = new Array<number>(days.length).fill(0);
    const subjects = new Map<string, number>();
    for (const s of weekSessions) {
      if (s.userId !== userId) continue;
      const d = toLocalDate(s.startedAt, tz);
      const i = days.indexOf(d);
      if (i < 0) continue;
      const minutes = s.workSeconds / 60;
      perDay[i] = (perDay[i] ?? 0) + minutes;
      const title =
        (s.nodeId && titles.get(s.nodeId)) || (s.routineId && titles.get(s.routineId)) || 'Free';
      subjects.set(title, (subjects.get(title) ?? 0) + minutes);
    }
    const byDay: number[] = [];
    let run = 0;
    for (const m of perDay) {
      run += m;
      byDay.push(Math.round(run));
    }
    const sorted = [...subjects.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted
      .slice(0, GROUP_SUBJECTS)
      .map(([title, m]) => ({ title, minutes: Math.round(m) }));
    const rest = sorted.slice(GROUP_SUBJECTS).reduce((a, [, m]) => a + m, 0);
    if (rest > 0) top.push({ title: 'Other', minutes: Math.round(rest) });
    return {
      userId,
      minutes: Math.round(run),
      byDay,
      subjects: top,
      nudgeable: userId !== viewerId && !nudged.has(userId),
    };
  });
  members.sort((a, b) => b.minutes - a.minutes);
  const you = ids.includes(viewerId);
  const group: Group = {
    id: row.id,
    hostId: row.hostId,
    name: row.name,
    code: you ? row.code : null,
    you,
    days,
    totalMinutes: members.reduce((a, m) => a + m.minutes, 0),
    members,
    live: you ? await liveAmong(db, ids, now) : [],
  };
  return group;
}

/**
 * Study groups: friends who keep each other company week after week. A group shows this
 * week's minutes for everyone in it, who is studying right now, and a way to nudge whoever
 * has gone quiet. Join from a friend's list or with the code.
 */
export function groupRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  const idParam = z.object({ id: uuid });
  const peopleOf = (list: Group[], extra: string[] = []) =>
    loadPeople(db, [...list.flatMap((g) => g.members.map((m) => m.userId)), ...extra]);
  const findGroup = async (id: string) => {
    const row = await db.query.groups.findFirst({ where: eq(groups.id, id) });
    if (!row) throw notFound('No such group');
    return row;
  };

  /** Friends studying right now, for the feed and the friends list. */
  app.get('/api/social/live', async (req) => {
    const friends = await friendIds(db, req.user.id);
    const live = await liveAmong(db, await sharingLive(db, friends), dt(clock()));
    const response: LiveResponse = {
      live,
      people: await loadPeople(
        db,
        live.map((l) => l.userId),
      ),
    };
    return response;
  });

  app.get('/api/social/groups', async (req) => {
    const me = req.user;
    const now = dt(clock());
    const mine = db
      .select({ id: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, me.id));
    const rows = await db.query.groups.findMany({
      where: inArray(groups.id, mine),
      orderBy: [desc(groups.createdAt)],
    });
    const friends = await friendIds(db, me.id);
    const openRows =
      friends.length === 0
        ? []
        : await db.query.groups.findMany({
            where: and(
              notInArray(groups.id, mine),
              inArray(
                groups.id,
                db
                  .select({ id: groupMembers.groupId })
                  .from(groupMembers)
                  .where(inArray(groupMembers.userId, friends)),
              ),
            ),
            orderBy: [desc(groups.createdAt)],
          });
    const load = (list: GroupRow[]) =>
      Promise.all(list.map((r) => loadGroup(db, r, me.id, now, me.timezone)));
    const [list, open] = await Promise.all([load(rows), load(openRows)]);
    const live = await liveAmong(db, await sharingLive(db, friends), now);
    const response: GroupsResponse = {
      groups: list,
      open,
      live,
      people: await peopleOf(
        [...list, ...open],
        live.map((l) => l.userId),
      ),
    };
    return response;
  });

  app.post('/api/social/groups', async (req, reply) => {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(GROUP_NAME_MAX) })
      .parse(req.body);
    const now = dt(clock());
    for (let attempt = 0; ; attempt++) {
      try {
        const row = await db.transaction(async (tx) => {
          const [g] = await tx
            .insert(groups)
            .values({ hostId: req.user.id, name, code: newJamCode(), createdAt: now })
            .returning();
          await tx
            .insert(groupMembers)
            .values({ groupId: g!.id, userId: req.user.id, joinedAt: now });
          return g!;
        });
        const group = await loadGroup(db, row, req.user.id, now, req.user.timezone);
        return reply.code(201).send({ group, people: await peopleOf([group]) });
      } catch (err) {
        if (attempt < 3 && (err as { cause?: { code?: string } }).cause?.code === '23505') continue;
        throw err;
      }
    }
  });

  const join = async (row: GroupRow, userId: string, tz: string) => {
    const now = dt(clock());
    await db
      .insert(groupMembers)
      .values({ groupId: row.id, userId, joinedAt: now })
      .onConflictDoNothing();
    const group = await loadGroup(db, row, userId, now, tz);
    return { group, people: await peopleOf([group]) };
  };

  app.post('/api/social/groups/join', async (req) => {
    const { code } = z.object({ code: z.string().trim().toUpperCase().length(6) }).parse(req.body);
    const row = await db.query.groups.findFirst({ where: eq(groups.code, code) });
    if (!row) throw notFound('No group with that code');
    return join(row, req.user.id, req.user.timezone);
  });

  app.post('/api/social/groups/:id/join', async (req) => {
    const { id } = idParam.parse(req.params);
    const row = await findGroup(id);
    const members = await db.query.groupMembers.findMany({ where: eq(groupMembers.groupId, id) });
    const friends = new Set(await friendIds(db, req.user.id));
    if (!members.some((m) => m.userId === req.user.id || friends.has(m.userId)))
      throw forbidden('Ask a member for the code');
    return join(row, req.user.id, req.user.timezone);
  });

  app.post('/api/social/groups/:id/leave', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await findGroup(id);
    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, id), eq(groupMembers.userId, req.user.id)));
    // A group nobody is in any more is gone.
    const left = await db.query.groupMembers.findFirst({ where: eq(groupMembers.groupId, id) });
    if (!left) await db.delete(groups).where(eq(groups.id, id));
    return reply.code(204).send();
  });

  /* ---------- nudges ---------- */

  /** Nudge a friend (or someone in one of your groups) to study: once every two hours each. */
  app.post('/api/social/nudges', async (req, reply) => {
    const { userId, groupId } = z
      .object({ userId: uuid, groupId: uuid.optional() })
      .parse(req.body);
    const me = req.user.id;
    if (userId === me) throw badRequest('That is you');
    const friends = await friendIds(db, me);
    let allowed = friends.includes(userId);
    if (!allowed) {
      const shared = await db
        .select({ id: groupMembers.groupId })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.userId, userId),
            inArray(
              groupMembers.groupId,
              db
                .select({ id: groupMembers.groupId })
                .from(groupMembers)
                .where(eq(groupMembers.userId, me)),
            ),
          ),
        );
      allowed = shared.length > 0;
    }
    if (!allowed) throw forbidden('Only friends and group members can be nudged');
    const now = dt(clock());
    const last = await db.query.nudges.findFirst({
      where: and(eq(nudges.fromId, me), eq(nudges.toId, userId)),
      orderBy: [desc(nudges.at)],
    });
    if (last && now.getTime() - last.at.getTime() < NUDGE_EVERY_MS) {
      const minutes = Math.ceil((NUDGE_EVERY_MS - (now.getTime() - last.at.getTime())) / 60_000);
      throw conflict(
        `Nudged already. Again in ${minutes >= 60 ? `${Math.ceil(minutes / 60)} h` : `${minutes} min`}`,
      );
    }
    const [row] = await db
      .insert(nudges)
      .values({ fromId: me, toId: userId, groupId: groupId ?? null, at: now })
      .returning();
    return reply.code(201).send({ nudge: { id: row!.id, toId: userId, at: now.toISOString() } });
  });

  /** Nudges to you from the last day that you have not waved away, for the dashboard. */
  app.get('/api/social/nudges', async (req) => {
    const now = dt(clock());
    const rows = await db.query.nudges.findMany({
      where: and(
        eq(nudges.toId, req.user.id),
        isNull(nudges.seenAt),
        gte(nudges.at, new Date(now.getTime() - 24 * 60 * 60_000)),
      ),
      orderBy: [desc(nudges.at)],
      limit: 20,
    });
    const groupIds = [...new Set(rows.map((r) => r.groupId).filter((g): g is string => !!g))];
    const names = new Map<string, string>();
    if (groupIds.length) {
      const gs = await db.query.groups.findMany({
        where: inArray(groups.id, groupIds),
        columns: { id: true, name: true },
      });
      for (const g of gs) names.set(g.id, g.name);
    }
    const people = await loadPeople(
      db,
      rows.map((r) => r.fromId),
    );
    return {
      nudges: rows.map((r) => ({
        id: r.id,
        fromId: r.fromId,
        groupName: r.groupId ? (names.get(r.groupId) ?? null) : null,
        at: r.at.toISOString(),
      })),
      people,
    };
  });

  /** Wave the nudges away. */
  app.post('/api/social/nudges/seen', async (req, reply) => {
    await db
      .update(nudges)
      .set({ seenAt: dt(clock()) })
      .where(and(eq(nudges.toId, req.user.id), isNull(nudges.seenAt)));
    return reply.code(204).send();
  });
}
