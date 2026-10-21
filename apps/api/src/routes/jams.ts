import type { FastifyInstance } from 'fastify';
import { randomInt } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { jamMembers, jams, sessions } from '../db/schema';
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
export async function loadJam(db: Db, row: JamRow, viewerId: string, now: Date): Promise<Jam> {
  const rows = await db.query.jamMembers.findMany({ where: eq(jamMembers.jamId, row.id) });
  const until = row.endedAt ?? row.endsAt;
  const members = await Promise.all(
    rows.map(async (m) => {
      const since = m.joinedAt > row.startsAt ? m.joinedAt : row.startsAt;
      const [sum] = await db
        .select({
          seconds: sql<number>`coalesce(sum(${sessions.workSeconds}), 0)::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, m.userId),
            isNotNull(sessions.endedAt),
            gte(sessions.startedAt, since),
            lte(sessions.startedAt, until),
          ),
        );
      return {
        userId: m.userId,
        joinedAt: m.joinedAt.toISOString(),
        minutes: Math.round(Number(sum?.seconds ?? 0) / 60),
        sessions: Number(sum?.count ?? 0),
      };
    }),
  );
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
  };
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
    const running = and(isNull(jams.endedAt), sql`${jams.endsAt} > ${now}`);
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
      where: and(
        inArray(jams.id, mine),
        sql`(${jams.endedAt} is not null or ${jams.endsAt} <= ${now})`,
      ),
      orderBy: [desc(jams.endsAt)],
      limit: JAM_ENDED_LIMIT,
    });
    const load = (rows: JamRow[]) => Promise.all(rows.map((r) => loadJam(db, r, me, now)));
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
        const loaded = await loadJam(db, jam, req.user.id, now);
        return reply.code(201).send({ jam: loaded, people: await withPeople([loaded]) });
      } catch (err) {
        if (attempt < 3 && (err as { cause?: { code?: string } }).cause?.code === '23505') continue;
        throw err;
      }
    }
  });

  const join = async (row: JamRow, userId: string, now: Date) => {
    if (endedBy(row, now)) throw conflict('That jam has ended');
    await db
      .insert(jamMembers)
      .values({ jamId: row.id, userId, joinedAt: now })
      .onConflictDoNothing();
    const loaded = await loadJam(db, row, userId, now);
    return { jam: loaded, people: await withPeople([loaded]) };
  };

  /** Join with the code someone passed on. */
  app.post('/api/social/jams/join', async (req) => {
    const { code } = z.object({ code: z.string().trim().toUpperCase().length(6) }).parse(req.body);
    const row = await db.query.jams.findFirst({ where: eq(jams.code, code) });
    if (!row) throw notFound('No jam with that code');
    return join(row, req.user.id, dt(clock()));
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
    return join(row, req.user.id, dt(clock()));
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
    const loaded = await loadJam(db, fresh, req.user.id, now);
    return { jam: loaded, people: await withPeople([loaded]) };
  });
}
