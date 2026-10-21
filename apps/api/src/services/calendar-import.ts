import { addDays, toLocalDate, zonedMidnightUtc } from '@komogon/core';
import { and, eq, gte, lt, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { calendarImports, nodes, outlookCalendar, plannedBlocks, type UserRow } from '../db/schema';
import { accessTokenFor, type CalendarDeps } from './calendar-sync';
import {
  courseKey,
  recognizeCalendarEvent,
  type AcademicEvent,
  type CalendarProvider,
} from './calendar-recognition';
import { decrypt, encrypt } from './crypto';
import { OutlookRevokedError, type OutlookClient } from './outlook';

export interface OutlookDeps {
  client: OutlookClient;
  encryptionKey: string;
}
export interface ImportResult {
  status: 'ok' | 'not-connected' | 'revoked';
  courses: number;
  tasks: number;
  events: number;
}
const empty = (status: ImportResult['status']): ImportResult => ({
  status,
  courses: 0,
  tasks: 0,
  events: 0,
});
const locks = new Map<string, Promise<ImportResult>>();

/** Serialize each user's imports, including manual sync racing the background worker. */
export async function syncCalendarImport(
  db: Db,
  user: UserRow,
  provider: CalendarProvider,
  deps: { google: CalendarDeps | null; outlook: OutlookDeps | null },
  now: string,
): Promise<ImportResult> {
  const key = user.id;
  const previous = locks.get(key);
  const run = (async () => {
    if (previous) await previous.catch(() => undefined);
    const from = new Date(Date.parse(now) - 30 * 86_400_000).toISOString();
    const to = new Date(Date.parse(now) + 180 * 86_400_000).toISOString();
    let events: AcademicEvent[];
    if (provider === 'google') {
      if (!deps.google) return empty('not-connected');
      const auth = await accessTokenFor(db, deps.google, user.id);
      if (!auth) return empty('not-connected');
      events = [];
      for (const calendar of await deps.google.google.listCalendars(auth.token)) {
        if (calendar.id === auth.calendarId) continue;
        const result = await deps.google.google.listEvents(auth.token, calendar.id, {
          timeMin: from,
          timeMax: to,
        });
        for (const event of result.items) {
          if (event.extendedProperties?.private?.komogonBlockId) continue;
          const start =
            event.start?.dateTime ??
            (event.start?.date
              ? zonedMidnightUtc(event.start.date, user.timezone).toISOString()
              : null);
          const end =
            event.end?.dateTime ??
            (event.end?.date
              ? zonedMidnightUtc(event.end.date, user.timezone).toISOString()
              : null);
          if (!start || !end) continue;
          events.push({
            id: event.id,
            title: event.summary ?? 'Calendar event',
            description: event.description,
            calendarId: calendar.id,
            calendarName: calendar.summary,
            start,
            end,
            allDay: !!event.start?.date,
            cancelled: event.status === 'cancelled',
          });
        }
      }
    } else {
      if (!deps.outlook) return empty('not-connected');
      const row = await db.query.outlookCalendar.findFirst({
        where: eq(outlookCalendar.userId, user.id),
      });
      if (!row) return empty('not-connected');
      if (row.revokedAt) return empty('revoked');
      try {
        const tokens = await deps.outlook.client.refreshAccessToken(
          decrypt(row.refreshTokenEnc, deps.outlook.encryptionKey),
        );
        if (tokens.refreshToken)
          await db
            .update(outlookCalendar)
            .set({
              refreshTokenEnc: encrypt(tokens.refreshToken, deps.outlook.encryptionKey),
            })
            .where(eq(outlookCalendar.userId, user.id));
        events = await deps.outlook.client.events(tokens.accessToken, from, to);
      } catch (err) {
        if (!(err instanceof OutlookRevokedError)) throw err;
        await db
          .update(outlookCalendar)
          .set({ revokedAt: new Date(now) })
          .where(eq(outlookCalendar.userId, user.id));
        return empty('revoked');
      }
    }
    // Only reconcile a complete remote snapshot. A failed page must never remove local items.
    const result = await importCalendarSnapshot(db, user, provider, events, from, to, now);
    if (provider === 'outlook')
      await db
        .update(outlookCalendar)
        .set({ lastSyncAt: new Date(now) })
        .where(eq(outlookCalendar.userId, user.id));
    return result;
  })();
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

export async function importCalendarSnapshot(
  db: Db,
  user: Pick<UserRow, 'id' | 'timezone'>,
  provider: CalendarProvider,
  events: AcademicEvent[],
  from: string,
  to: string,
  now: string,
): Promise<ImportResult> {
  return db.transaction(async (transaction) => {
    const tx = transaction as unknown as Db;
    const result = empty('ok');
    const previous = await tx.query.calendarImports.findMany({
      where: and(eq(calendarImports.userId, user.id), eq(calendarImports.provider, provider)),
    });
    const byKey = new Map(
      previous.map((row) => [JSON.stringify([row.calendarId, row.eventId]), row]),
    );
    const seen = new Set<string>();
    const courses = await tx.query.nodes.findMany({
      where: and(eq(nodes.userId, user.id), eq(nodes.kind, 'course'), eq(nodes.archived, false)),
    });

    const cancel = async (row: (typeof previous)[number]) => {
      if (row.cancelled) return;
      if (row.blockId)
        await tx
          .update(plannedBlocks)
          .set({ cancelled: true, updatedAt: new Date(now) })
          .where(and(eq(plannedBlocks.id, row.blockId), eq(plannedBlocks.userId, user.id)));
      if (row.nodeId && row.ownsNode) {
        const node = await tx.query.nodes.findFirst({
          where: and(eq(nodes.id, row.nodeId), eq(nodes.userId, user.id)),
        });
        const shared = await tx.query.calendarImports.findFirst({
          where: and(
            eq(calendarImports.nodeId, row.nodeId),
            ne(calendarImports.id, row.id),
            eq(calendarImports.cancelled, false),
          ),
        });
        if (
          node &&
          !shared &&
          !node.completedAt &&
          node.title === row.title &&
          node.dueAt?.toISOString() === row.dueAt?.toISOString()
        ) {
          await tx
            .update(nodes)
            .set({ archived: true, updatedAt: new Date(now) })
            .where(eq(nodes.id, node.id));
        }
      }
      await tx
        .update(calendarImports)
        .set({ cancelled: true })
        .where(eq(calendarImports.id, row.id));
    };

    for (const event of events) {
      const key = JSON.stringify([event.calendarId, event.id]);
      if (seen.has(key)) continue;
      seen.add(key);
      const old = byKey.get(key);
      if (event.cancelled) {
        if (old) await cancel(old);
        continue;
      }
      const start = new Date(event.start),
        end = new Date(event.end);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start)
        continue;
      const title = event.title.trim().slice(0, 200) || 'Calendar event';
      const match = recognizeCalendarEvent(event, courses);
      let course = match.course
        ? courses.find((c) => courseKey(c.title) === courseKey(match.course!))
        : undefined;
      if (!course && match.course) {
        [course] = await tx
          .insert(nodes)
          .values({
            userId: user.id,
            title: match.course,
            kind: 'course',
            createdAt: new Date(now),
            updatedAt: new Date(now),
          })
          .returning();
        courses.push(course!);
        result.courses++;
      }
      // A date-only deadline lasts through that day in the account's timezone, including DST.
      const dueAt = match.kind
        ? event.allDay
          ? new Date(
              zonedMidnightUtc(
                addDays(toLocalDate(start, user.timezone), 1),
                user.timezone,
              ).getTime() - 1,
            )
          : start
        : null;
      let nodeId = old?.nodeId ?? null;
      let ownsNode = old?.ownsNode ?? false;
      if (!match.kind && old?.dueAt) {
        await cancel(old);
        nodeId = null;
        ownsNode = false;
      }
      if (match.kind && dueAt) {
        if (old?.nodeId) {
          const node = await tx.query.nodes.findFirst({
            where: and(eq(nodes.id, old.nodeId), eq(nodes.userId, user.id)),
          });
          if (node && old.ownsNode) {
            await tx
              .update(nodes)
              .set({
                ...(node.title === old.title ? { title } : {}),
                ...(node.dueAt?.toISOString() === old.dueAt?.toISOString() ? { dueAt } : {}),
                ...(old.cancelled &&
                node.archived &&
                node.title === old.title &&
                node.dueAt?.toISOString() === old.dueAt?.toISOString()
                  ? { archived: false }
                  : {}),
                updatedAt: new Date(now),
              })
              .where(eq(nodes.id, node.id));
          }
        } else if (!old || !old.dueAt) {
          // Reuse an existing matching task, including a mirrored event from the other provider.
          const existing = await tx.query.nodes.findFirst({
            where: and(
              eq(nodes.userId, user.id),
              eq(nodes.title, title),
              eq(nodes.dueAt, dueAt),
              eq(nodes.archived, false),
            ),
          });
          if (existing && existing.parentId === (course?.id ?? null)) {
            nodeId = existing.id;
            ownsNode = false;
          } else {
            const [created] = await tx
              .insert(nodes)
              .values({
                userId: user.id,
                parentId: course?.id ?? null,
                title,
                kind: match.kind,
                dueAt,
                createdAt: new Date(now),
                updatedAt: new Date(now),
              })
              .returning();
            nodeId = created!.id;
            ownsNode = true;
            result.tasks++;
          }
        }
      }
      let blockId = old?.blockId ?? null;
      // A date-only deadline belongs in the due row, not across the whole day's free time.
      const commitment = !(event.allDay && match.kind);
      if (blockId)
        await tx
          .update(plannedBlocks)
          .set({
            title,
            startAt: start,
            endAt: end,
            cancelled: !commitment,
            updatedAt: new Date(now),
          })
          .where(and(eq(plannedBlocks.id, blockId), eq(plannedBlocks.userId, user.id)));
      else if (!old) {
        const [block] = await tx
          .insert(plannedBlocks)
          .values({
            userId: user.id,
            title,
            startAt: start,
            endAt: end,
            source: provider,
            cancelled: !commitment,
          })
          .returning();
        blockId = block!.id;
      }
      const values = {
        title,
        dueAt,
        startAt: start,
        endAt: end,
        nodeId,
        blockId,
        ownsNode,
        cancelled: false,
      };
      if (old) await tx.update(calendarImports).set(values).where(eq(calendarImports.id, old.id));
      else
        await tx.insert(calendarImports).values({
          ...values,
          userId: user.id,
          provider,
          calendarId: event.calendarId,
          eventId: event.id,
        });
      result.events++;
    }
    for (const old of previous)
      if (
        !seen.has(JSON.stringify([old.calendarId, old.eventId])) &&
        old.endAt >= new Date(from) &&
        old.startAt < new Date(to)
      )
        await cancel(old);
    return result;
  });
}

/** Imported Outlook commitments also participate in free-slot suggestions. */
export async function outlookBusy(db: Db, userId: string, from: string, to: string) {
  const blocks = await db.query.plannedBlocks.findMany({
    where: and(
      eq(plannedBlocks.userId, userId),
      eq(plannedBlocks.source, 'outlook'),
      eq(plannedBlocks.cancelled, false),
      gte(plannedBlocks.endAt, new Date(from)),
      lt(plannedBlocks.startAt, new Date(to)),
    ),
  });
  return blocks.map((b) => ({ start: b.startAt.toISOString(), end: b.endAt.toISOString() }));
}
