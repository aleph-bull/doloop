import type { FastifyInstance } from 'fastify';
import { randomInt } from 'node:crypto';
import { addDays, toLocalDate } from '@komogon/core';
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
} from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { jamMembers, jams, nodes, routines, sessions, users } from '../db/schema';
import { sameWorld } from '../services/dev-accounts';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { loadPeople, type Person } from '../services/people';
import { dt } from '../services/sessions-mapper';
import { uuid } from '../validation';
import { friendIds } from './social';

export const JAM_TITLE_MAX = 60;
export const JAM_MAX_DAYS = 7;
/** Ended jams a person is shown, newest first. */
export const JAM_ENDED_LIMIT = 5;

export interface JamMember {
  userId: string;
  joinedAt: string;
  /** Focused minutes from joining (or the start, if later) to the end. */
  minutes: number;
  sessions: number;
  /** Running total over the jam's `days`, one entry per day up to today or the end. */
  byDay: number[];
  /** What they put the time into, biggest first, plus "Other". */
  subjects: Array<{ title: string; minutes: number }>;
}

export interface Jam {
  id: string;
  hostId: string;
  title: string;
  /** Only the members see the code; others get null. */
  code: string | null;
  startsAt: string;
  endsAt: string;
  ended: boolean;
  /** The person asking is in it. */
  you: boolean;
  /** Ranked, most minutes first. */
  members: JamMember[];
  /** The jam's days so far, oldest first, in the viewer's timezone. */
  days: string[];
}

export interface JamsResponse {
  /** The ones you are in that are still running. */
  active: Jam[];
  /** Running jams with a friend in them that you could join. */
  open: Jam[];
  /** The last few you were in that have finished. */
  ended: Jam[];
  people: Record<string, Person>;
}

type JamRow = typeof jams.$inferSelect;

/** No vowels and no confusable letters, so a code reads out loud without mistakes. */
const CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXYZ23456789';
export function newJamCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

const endedBy = (row: JamRow, now: Date) =>
  row.endedAt !== null || row.endsAt.getTime() <= now.getTime();

/** A jam with its members' minutes worked out, ranked. */
export async function loadJam(
  db: Db,
  row: JamRow,
  viewerId: string,
  now: Date,
  tz: string,
): Promise<Jam> {
  const rows = await db.query.jamMembers.findMany({ where: eq(jamMembers.jamId, row.id) });
  const until = row.endedAt ?? row.endsAt;
  const last = until < now ? until : now;
  const days: string[] = [];
  for (let d = toLocalDate(row.startsAt, tz); d <= toLocalDate(last, tz); d = addDays(d, 1))
    days.push(d);
  const all = rows.length
    ? await db.query.sessions.findMany({
        where: and(
          inArray(
            sessions.userId,
            rows.map((m) => m.userId),
          ),
          isNotNull(sessions.endedAt),
          gte(sessions.startedAt, row.startsAt),
          lte(sessions.startedAt, until),
        ),
      })
    : [];
  const titles = await subjectTitles(
    db,
    all.map((s) => s.nodeId),
    all.map((s) => s.routineId),
  );
  const members = rows.map((m) => {
    const since = m.joinedAt > row.startsAt ? m.joinedAt : row.startsAt;
    const perDay = new Array<number>(days.length).fill(0);
    const subjects = new Map<string, number>();
    let count = 0;
    for (const s of all) {
      if (s.userId !== m.userId || s.startedAt < since) continue;
      const i = days.indexOf(toLocalDate(s.startedAt, tz));
      if (i < 0) continue;
      const minutes = s.workSeconds / 60;
      perDay[i] = (perDay[i] ?? 0) + minutes;
      count += 1;
      const title =
        (s.nodeId && titles.get(s.nodeId)) || (s.routineId && titles.get(s.routineId)) || 'Free';
      subjects.set(title, (subjects.get(title) ?? 0) + minutes);
    }
    const byDay: number[] = [];
    let run = 0;
    for (const x of perDay) {
      run += x;
      byDay.push(Math.round(run));
    }
    const sorted = [...subjects.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 3).map(([title, x]) => ({ title, minutes: Math.round(x) }));
    const rest = sorted.slice(3).reduce((a, [, x]) => a + x, 0);
    if (rest > 0) top.push({ title: 'Other', minutes: Math.round(rest) });
    return {
      userId: m.userId,
      joinedAt: m.joinedAt.toISOString(),
      minutes: Math.round(run),
      sessions: count,
      byDay,
      subjects: top,
    };
  });
  members.sort((a, b) => b.minutes - a.minutes || a.joinedAt.localeCompare(b.joinedAt));
  const you = rows.some((m) => m.userId === viewerId);
  return {
    id: row.id,
    hostId: row.hostId,
    title: row.title,
    code: you ? row.code : null,
    startsAt: row.startsAt.toISOString(),
    endsAt: (row.endedAt ?? row.endsAt).toISOString(),
    ended: endedBy(row, now),
    you,
    members,
    days,
  };
}

/** Titles for the tasks and routines behind sessions, by id. */
async function subjectTitles(
  db: Db,
  nodeIds: Array<string | null>,
  routineIds: Array<string | null>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const n = [...new Set(nodeIds.filter((x): x is string => !!x))];
  const r = [...new Set(routineIds.filter((x): x is string => !!x))];
  if (n.length) {
    const found = await db.query.nodes.findMany({
      where: inArray(nodes.id, n),
      columns: { id: true, title: true },
    });
    for (const row of found) out.set(row.id, row.title);
  }
  if (r.length) {
    const found = await db.query.routines.findMany({
      where: inArray(routines.id, r),
      columns: { id: true, title: true },
    });
    for (const row of found) out.set(row.id, row.title);
  }
  return out;
}

/**
 * Jams: a game people enter, the way a Spotify jam is joined. Someone starts one for a day
 * or a week, friends join (or anyone with the code), and from the moment each joins their
 * focused minutes count; the most at the end wins. Joining is the only way in, so there is
 * no sharing setting for it.
 */
export function jamRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  const idParam = z.object({ id: uuid });

  const withPeople = async (list: Jam[]) =>
    loadPeople(
      db,
      list.flatMap((j) => j.members.map((m) => m.userId)),
    );

  const findJam = async (id: string) => {
    const row = await db.query.jams.findFirst({ where: eq(jams.id, id) });
    if (!row) throw notFound('No such jam');
    return row;
  };

  app.get('/api/social/jams', async (req) => {
    const me = req.user.id;
    const now = dt(clock());
    const mine = db
      .select({ id: jamMembers.jamId })
      .from(jamMembers)
      .where(eq(jamMembers.userId, me));
    const running = and(isNull(jams.endedAt), gt(jams.endsAt, now));
    const activeRows = await db.query.jams.findMany({
      where: and(inArray(jams.id, mine), running),
      orderBy: [jams.endsAt],
    });
    const friends = await friendIds(db, me);
    const openRows =
      friends.length === 0
        ? []
        : await db.query.jams.findMany({
            where: and(
              running,
              notInArray(jams.id, mine),
              inArray(
                jams.id,
                db
                  .select({ id: jamMembers.jamId })
                  .from(jamMembers)
                  .where(inArray(jamMembers.userId, friends)),
              ),
            ),
            orderBy: [jams.endsAt],
          });
    const endedRows = await db.query.jams.findMany({
      where: and(inArray(jams.id, mine), or(isNotNull(jams.endedAt), lte(jams.endsAt, now))),
      orderBy: [desc(jams.endsAt)],
      limit: JAM_ENDED_LIMIT,
    });
    const load = (rows: JamRow[]) =>
      Promise.all(rows.map((r) => loadJam(db, r, me, now, req.user.timezone)));
    const [active, open, ended] = await Promise.all([
      load(activeRows),
      load(openRows),
      load(endedRows),
    ]);
    const response: JamsResponse = {
      active,
      open,
      ended,
      people: await withPeople([...active, ...open, ...ended]),
    };
    return response;
  });

  app.post('/api/social/jams', async (req, reply) => {
    const input = z
      .object({
        title: z.string().trim().max(JAM_TITLE_MAX).default(''),
        days: z.number().int().min(1).max(JAM_MAX_DAYS).default(1),
      })
      .parse(req.body);
    const now = dt(clock());
    const endsAt = new Date(now.getTime() + input.days * 86_400_000);
    // A code clash is one in half a billion; the unique index catches it and we try again.
    for (let attempt = 0; ; attempt++) {
      try {
        const jam = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(jams)
            .values({
              hostId: req.user.id,
              title: input.title || 'Study jam',
              code: newJamCode(),
              startsAt: now,
              endsAt,
              createdAt: now,
            })
            .returning();
          await tx
            .insert(jamMembers)
            .values({ jamId: row!.id, userId: req.user.id, joinedAt: now });
          return row!;
        });
        const loaded = await loadJam(db, jam, req.user.id, now, req.user.timezone);
        return reply.code(201).send({ jam: loaded, people: await withPeople([loaded]) });
      } catch (err) {
        if (attempt < 3 && (err as { cause?: { code?: string } }).cause?.code === '23505') continue;
        throw err;
      }
    }
  });

  const join = async (row: JamRow, userId: string, now: Date, tz: string) => {
    if (endedBy(row, now)) throw conflict('That jam has ended');
    await db
      .insert(jamMembers)
      .values({ jamId: row.id, userId, joinedAt: now })
      .onConflictDoNothing();
    const loaded = await loadJam(db, row, userId, now, tz);
    return { jam: loaded, people: await withPeople([loaded]) };
  };

  /** Join with the code someone passed on. */
  app.post('/api/social/jams/join', async (req) => {
    const { code } = z.object({ code: z.string().trim().toUpperCase().length(6) }).parse(req.body);
    const row = await db.query.jams.findFirst({ where: eq(jams.code, code) });
    const host =
      row &&
      (await db.query.users.findFirst({
        where: eq(users.id, row.hostId),
        columns: { devWorld: true },
      }));
    // A code from the other side (real people, or a dev world) reads as no jam at all.
    if (!row || !sameWorld(req.user, host)) throw notFound('No jam with that code');
    return join(row, req.user.id, dt(clock()), req.user.timezone);
  });

  /** Join a friend's jam from the list. */
  app.post('/api/social/jams/:id/join', async (req) => {
    const { id } = idParam.parse(req.params);
    const row = await findJam(id);
    const members = await db.query.jamMembers.findMany({ where: eq(jamMembers.jamId, id) });
    const friends = new Set(await friendIds(db, req.user.id));
    const allowed =
      members.some((m) => m.userId === req.user.id) || members.some((m) => friends.has(m.userId));
    if (!allowed) throw forbidden('Ask a member for the code');
    return join(row, req.user.id, dt(clock()), req.user.timezone);
  });

  app.post('/api/social/jams/:id/leave', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const row = await findJam(id);
    if (row.hostId === req.user.id) throw badRequest('The host ends the jam instead of leaving');
    await db
      .delete(jamMembers)
      .where(and(eq(jamMembers.jamId, id), eq(jamMembers.userId, req.user.id)));
    return reply.code(204).send();
  });

  /** The host calls it early; the minutes so far stand. */
  app.post('/api/social/jams/:id/end', async (req) => {
    const { id } = idParam.parse(req.params);
    const row = await findJam(id);
    if (row.hostId !== req.user.id) throw forbidden('Only the host can end it');
    const now = dt(clock());
    if (!endedBy(row, now)) await db.update(jams).set({ endedAt: now }).where(eq(jams.id, id));
    const fresh = await findJam(id);
    const loaded = await loadJam(db, fresh, req.user.id, now, req.user.timezone);
    return { jam: loaded, people: await withPeople([loaded]) };
  });
}
